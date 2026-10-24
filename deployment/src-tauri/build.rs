// build.rs — Tauri's standard build script. It reads ../tauri.conf.json and generates the
// context (window config, bundle metadata) the binary embeds. Nothing project-specific.
fn main() {
    tauri_build::build()
}
