use serde::Serialize;
use std::{
    env,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, RunEvent, State};

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
    runtime_root: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct WorkbenchBootstrapStatus {
    mode: &'static str,
    resolved_runtime_root: Option<String>,
    node_available: bool,
    node_source: &'static str,
    dist_ready: bool,
    service_managed: bool,
    message: String,
}

#[tauri::command]
fn bootstrap_workbench_service(
    app: AppHandle,
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
                        runtime_root: None,
                    });
                }
                Ok(Some(_)) | Err(_) => {
                    *slot = None;
                }
            }
        }
    }

    let runtime_root = resolve_workbench_root(Some(&app), repo_root)
        .ok_or_else(|| String::from("The local workbench source is not available on this machine."))?;

    let node_binary = resolve_node_binary(Some(&runtime_root))
        .ok_or_else(|| String::from("Node.js is not available for the local workbench service."))?;
    ensure_dist_ready(&runtime_root)?;

    let cli_entry = runtime_root.join("dist/cli/index.js");
    if !cli_entry.exists() {
        return Err(String::from(
            "The local workbench core is still preparing. Please try again shortly.",
        ));
    }

    let child = Command::new(node_binary)
        .arg(cli_entry)
        .arg("workbench-server")
        .arg("--port")
        .arg(port.to_string())
        .current_dir(&runtime_root)
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
        runtime_root: Some(runtime_root.display().to_string()),
    })
}

#[tauri::command]
fn get_workbench_bootstrap_status(
    app: AppHandle,
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

    let resolved_runtime_root = resolve_workbench_root(Some(&app), repo_root);
    let node_binary = resolved_runtime_root
        .as_ref()
        .and_then(|root| resolve_node_binary(Some(root)))
        .or_else(|| resolve_node_binary(None));
    let node_available = node_binary.is_some();
    let node_source = resolved_runtime_root
        .as_ref()
        .and_then(|root| bundled_node_binary(root))
        .map(|_| "bundled")
        .or_else(|| node_binary.as_ref().map(|_| "system"))
        .unwrap_or("missing");
    let dist_ready = resolved_runtime_root
        .as_ref()
        .map(|root| root.join("dist/cli/index.js").exists() && is_node_modules_ready(root))
        .unwrap_or(false);

    let (mode, message) = match (&resolved_runtime_root, node_available, dist_ready) {
        (Some(root), true, true) => (
            "ready",
            format!(
                "The local workbench core is ready at {} and will use {} Node runtime.",
                root.display(),
                if node_source == "bundled" { "the bundled" } else { "the system" }
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
        resolved_runtime_root: resolved_runtime_root.map(|path| path.display().to_string()),
        node_available,
        node_source,
        dist_ready,
        service_managed,
        message,
    }
}

fn resolve_workbench_root(app: Option<&AppHandle>, preferred_repo_root: Option<String>) -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(app) = app {
        if let Ok(resource_dir) = app.path().resource_dir() {
            candidates.push(resource_dir.join("neeko-runtime"));
            candidates.push(resource_dir.join("_up_").join("runtime").join("neeko-runtime"));
            candidates.push(resource_dir);
        }
    }
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
            candidates.push(ancestor.join("neeko-runtime"));
            candidates.push(ancestor.join("_up_").join("runtime").join("neeko-runtime"));
        }
    }

    candidates.into_iter().find(|candidate| is_workbench_root(candidate))
}

fn is_workbench_root(candidate: &Path) -> bool {
    let has_package = candidate.join("package.json").exists();
    let has_cli_dist = candidate.join("dist/cli/index.js").exists();
    let has_repo_source = candidate.join("desktop/package.json").exists();
    let has_source_cli = candidate.join("src/cli/index.ts").exists();
    let has_node_modules = is_node_modules_ready(candidate);

    has_package && ((has_cli_dist && has_node_modules) || (has_repo_source && has_source_cli))
}

fn is_node_modules_ready(candidate: &Path) -> bool {
    candidate.join("node_modules").exists()
}

fn resolve_node_binary(runtime_root: Option<&Path>) -> Option<PathBuf> {
    if let Some(root) = runtime_root {
        if let Some(bundled) = bundled_node_binary(root) {
            return Some(bundled);
        }
    }

    let output = Command::new("node")
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    if matches!(output, Ok(status) if status.success()) {
        Some(PathBuf::from("node"))
    } else {
        None
    }
}

fn bundled_node_binary(runtime_root: &Path) -> Option<PathBuf> {
    let candidate = runtime_root.join("bin").join("node");
    if candidate.exists() {
        Some(candidate)
    } else {
        None
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
