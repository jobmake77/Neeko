use serde::Serialize;
use std::{
    env,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{Manager, RunEvent, State};

const DEFAULT_WORKBENCH_PORT: u16 = 4310;

#[derive(Default)]
struct WorkbenchServiceState {
    child: Mutex<Option<Child>>,
}

impl WorkbenchServiceState {
    fn cleanup_if_exited(&self) {
        if let Ok(mut slot) = self.child.lock() {
            if let Some(child) = slot.as_mut() {
                match child.try_wait() {
                    Ok(Some(_)) => {
                        *slot = None;
                    }
                    Ok(None) | Err(_) => {}
                }
            }
        }
    }

    fn shutdown(&self) {
        if let Ok(mut slot) = self.child.lock() {
            if let Some(child) = slot.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *slot = None;
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct BootstrapWorkbenchServiceResult {
    status: &'static str,
    port: u16,
    repo_root: Option<String>,
}

#[tauri::command]
fn bootstrap_workbench_service(
    state: State<'_, WorkbenchServiceState>,
    port: Option<u16>,
) -> Result<BootstrapWorkbenchServiceResult, String> {
    state.cleanup_if_exited();

    let port = port.unwrap_or(DEFAULT_WORKBENCH_PORT);

    {
        let mut slot = state
            .child
            .lock()
            .map_err(|_| String::from("The local service controller is temporarily unavailable."))?;
        if let Some(child) = slot.as_mut() {
            match child.try_wait() {
                Ok(None) => {
                    return Ok(BootstrapWorkbenchServiceResult {
                        status: "already_running",
                        port,
                        repo_root: None,
                    });
                }
                Ok(Some(_)) | Err(_) => {
                    *slot = None;
                }
            }
        }
    }

    let repo_root = resolve_repo_root()
        .ok_or_else(|| String::from("The local workbench source is not available on this machine."))?;

    ensure_node_available()?;
    ensure_dist_ready(&repo_root)?;

    let cli_entry = repo_root.join("dist/cli/index.js");
    if !cli_entry.exists() {
        return Err(String::from(
            "The local workbench core is still preparing. Please try again shortly.",
        ));
    }

    let child = Command::new("node")
        .arg(cli_entry)
        .arg("workbench-server")
        .arg("--port")
        .arg(port.to_string())
        .current_dir(&repo_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| String::from("The local service could not be started right now."))?;

    let mut slot = state
        .child
        .lock()
        .map_err(|_| String::from("The local service controller is temporarily unavailable."))?;
    *slot = Some(child);

    Ok(BootstrapWorkbenchServiceResult {
        status: "spawned",
        port,
        repo_root: Some(repo_root.display().to_string()),
    })
}

fn resolve_repo_root() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(root) = env::var("NEEKO_REPO_ROOT") {
        candidates.push(PathBuf::from(root));
    }
    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir);
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(repo_root) = manifest_dir.parent().and_then(Path::parent) {
        candidates.push(repo_root.to_path_buf());
    }

    if let Ok(exe_path) = env::current_exe() {
        for ancestor in exe_path.ancestors() {
            candidates.push(ancestor.to_path_buf());
        }
    }

    candidates.into_iter().find(|candidate| is_repo_root(candidate))
}

fn is_repo_root(candidate: &Path) -> bool {
    candidate.join("package.json").exists()
        && candidate.join("desktop/package.json").exists()
        && (candidate.join("dist/cli/index.js").exists() || candidate.join("src/cli/index.ts").exists())
}

fn ensure_node_available() -> Result<(), String> {
    let output = Command::new("node")
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| String::from("Node.js is not available for the local workbench service."))?;

    if output.success() {
        Ok(())
    } else {
        Err(String::from(
            "Node.js is not available for the local workbench service.",
        ))
    }
}

fn ensure_dist_ready(repo_root: &Path) -> Result<(), String> {
    if repo_root.join("dist/cli/index.js").exists() {
        return Ok(());
    }

    let status = Command::new("npm")
        .arg("run")
        .arg("build")
        .current_dir(repo_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| String::from("The local workbench core is still preparing."))?;

    if status.success() {
        Ok(())
    } else {
        Err(String::from(
            "The local workbench core is still preparing. Please try again shortly.",
        ))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WorkbenchServiceState::default())
        .invoke_handler(tauri::generate_handler![bootstrap_workbench_service])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if matches!(event, RunEvent::Exit { .. }) {
                if let Some(state) = app_handle.try_state::<WorkbenchServiceState>() {
                    state.inner().shutdown();
                }
            }
        });
}
