// main.rs — the whole desktop shell.
//
// A Tauri app around a built web tree. The window, its size and the entry page all come from
// ../tauri.conf.json (app.windows[0]) — or from the --config override `bun run desktop:build <plugin>`
// passes — so there is ONE place to change them and no value is duplicated between config and code.
//
// No commands, no IPC. The ONE piece of logic: a desktop plugin's engine. When the app bundles a
// `rudder-engine` sidecar (Tauri places it next to this executable), it is started with the webview's
// microphone mode (RUDDER_AUDIO=browser: the page captures the mic and streams it to the engine) and its
// runtime + model under the app's data directory, and it is stopped when the app exits. An app without the
// sidecar (the map gallery) starts nothing.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

struct Sidecar(Mutex<Option<Child>>);

fn main() {
    let app = tauri::Builder::default()
        .manage(Sidecar(Mutex::new(None)))
        .setup(|app| {
            let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf()));
            if let Some(dir) = exe_dir {
                let bin = dir.join(if cfg!(windows) { "rudder-engine.exe" } else { "rudder-engine" });
                if bin.exists() {
                    let home = app.path().app_data_dir().map(|d| d.join("rudder")).unwrap_or_default();
                    match Command::new(&bin).env("RUDDER_AUDIO", "browser").env("RUDDER_HOME", &home).spawn() {
                        Ok(child) => *app.state::<Sidecar>().0.lock().unwrap() = Some(child),
                        Err(e) => eprintln!("rudder-engine did not start: {e}"),
                    }
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Doxa Maps desktop shell");
    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = handle.state::<Sidecar>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
