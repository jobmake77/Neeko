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

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct WorkbenchBootstrapStatus {
    mode: &'static str,
    resolved_repo_root: Option<String>,
    node_available: bool,
    dist_ready: bool,
    service_managed: bool,
    message: String,
}

#[tauri::command]
fn bootstrap_workbench_service(
    state: State<'_, WorkbenchServiceState>,
    port: Option<u16>,
    repo_root: Option<String>,
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

    let repo_root = resolve_repo_root(repo_root)
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

#[tauri::command]
fn get_workbench_bootstrap_status(
    state: State<'_, WorkbenchServiceState>,
    repo_root: Option<String>,
) -> WorkbenchBootstrapStatus {
    state.cleanup_if_exited();

    let service_managed = state
        .child
        .lock()
        .ok()
        .and_then(|slot| slot.as_ref().map(|_| true))
        .unwrap_or(false);

    let resolved_repo_root = resolve_repo_root(repo_root);
    let node_available = is_node_available();
    let dist_ready = resolved_repo_root
        .as_ref()
        .map(|root| root.join("dist/cli/index.js").exists())
        .unwrap_or(false);

    let (mode, message) = match (&resolved_repo_root, node_available, dist_ready) {
        (Some(root), true, true) => (
            "ready",
            format!(
                "The local workbench core is ready at {}.",
                root.display()
            ),
        ),
        (Some(root), true, false) => (
            "preparing_core",
            format!(
                "The local workbench source was found at {}, but the built core is not ready yet.",
                root.display()
            ),
        ),
        (Some(_), false, _) => (
            "missing_node",
            String::from("Node.js is required before the local workbench service can start."),
        ),
        (None, _, _) => (
            "needs_repo_root",
            String::from(
                "Choose the local Neeko repository path so the desktop client can manage the workbench service.",
            ),
        ),
    };

    WorkbenchBootstrapStatus {
        mode,
        resolved_repo_root: resolved_repo_root.map(|path| path.display().to_string()),
        node_available,
        dist_ready,
        service_managed,
        message,
    }
}

fn resolve_repo_root(preferred_repo_root: Option<String>) -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(root) = preferred_repo_root {
        if !root.trim().is_empty() {
            candidates.push(PathBuf::from(root));
        }
    }
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
    if is_node_available() {
        Ok(())
    } else {
        Err(String::from(
            "Node.js is not available for the local workbench service.",
        ))
    }
}

fn is_node_available() -> bool {
    let output = Command::new("node")
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    matches!(output, Ok(status) if status.success())
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
        .invoke_handler(tauri::generate_handler![
            bootstrap_workbench_service,
            get_workbench_bootstrap_status
        ])
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
