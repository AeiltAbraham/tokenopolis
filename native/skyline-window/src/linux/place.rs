// Copied from cornercase-float b45f36c (src/linux/place/mod.rs): the backend choice and the layer margins. The
// card placement is dropped; the env names are the skyline's own.
//! How the window is placed: chosen once at startup, before GTK starts.

use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use wayland_client::globals::{GlobalListContents, registry_queue_init};
use wayland_client::protocol::wl_registry::WlRegistry;
use wayland_client::{Connection, Dispatch, QueueHandle};

/// Set on the re-exec that has the layer-shell library preloaded.
const PRELOADED: &str = "TOKENOPOLIS_SKYLINE_PRELOADED";
/// For an install the usual directories do not cover.
const LIBRARY_VAR: &str = "TOKENOPOLIS_SKYLINE_LAYER_SHELL";
const LIBRARY: &str = "libgtk4-layer-shell.so.0";
const LIBRARY_DIRS: [&str; 10] = [
    "/usr/lib/x86_64-linux-gnu",
    "/usr/lib/aarch64-linux-gnu",
    "/usr/lib/arm-linux-gnueabihf",
    "/usr/lib64",
    "/usr/lib",
    "/usr/local/lib64",
    "/usr/local/lib",
    "/lib/x86_64-linux-gnu",
    "/lib/aarch64-linux-gnu",
    "/lib64",
];
/// `on_demand` keyboard interactivity came with version 4 of the protocol.
const LAYER_SHELL_VERSION: u32 = 4;
/// A press that travels farther than this many points is a drag, not a click.
pub(crate) const DRAG_THRESHOLD: f64 = 3.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Backend {
    Layer,
    X11,
    Plain,
}

/// What the choice depends on.
#[derive(Debug, Clone, Default)]
pub(crate) struct Probe {
    pub(crate) wayland: bool,
    pub(crate) x11: bool,
    /// The Wayland registry lists `zwlr_layer_shell_v1`.
    pub(crate) layer_shell: bool,
    /// Where `libgtk4-layer-shell.so.0` is.
    pub(crate) library: Option<PathBuf>,
}

pub(crate) fn choose(probe: &Probe) -> Backend {
    if probe.wayland && probe.layer_shell && probe.library.is_some() {
        Backend::Layer
    } else if probe.x11 {
        Backend::X11
    } else {
        Backend::Plain
    }
}

/// Picks the backend for this process and sets the environment GTK reads. When the layer backend is wanted and the
/// library is not loaded yet, this re-executes the process with it preloaded and does not return.
pub(crate) fn select() -> (Backend, Option<PathBuf>) {
    let set = |var: &str| std::env::var_os(var).is_some_and(|value| !value.is_empty());
    let wayland = set("WAYLAND_DISPLAY");
    let mut probe = Probe { wayland, x11: set("DISPLAY"), layer_shell: false, library: None };
    if wayland {
        probe.library = find_library(std::env::var_os(LIBRARY_VAR).map(PathBuf::from), Path::exists);
        probe.layer_shell = probe.library.is_some() && registry_has_layer_shell();
    }
    let mut backend = choose(&probe);
    if backend == Backend::Layer && std::env::var_os(PRELOADED).is_none() {
        let library = probe.library.as_deref().unwrap_or(Path::new(LIBRARY));
        let error = reexec_preloaded(library);
        eprintln!("skyline-window: {}", format!("could not start with {} preloaded: {error}", library.display()));
        backend = if probe.x11 { Backend::X11 } else { Backend::Plain };
    }
    // SAFETY: nothing else is running yet; GTK and the watcher start after this.
    unsafe {
        if let (Some(library), Some(preload)) =
            (&probe.library, std::env::var_os(PRELOADED).and(std::env::var("LD_PRELOAD").ok()))
        {
            // The library is loaded; what the plugin starts (`cornercase`, `swaymsg`...) does not need it.
            match without_preload(&preload, library) {
                Some(rest) => std::env::set_var("LD_PRELOAD", rest),
                None => std::env::remove_var("LD_PRELOAD"),
            }
        }
        match backend {
            Backend::Layer => std::env::set_var("GDK_BACKEND", "wayland"),
            Backend::X11 => std::env::set_var("GDK_BACKEND", "x11"),
            Backend::Plain => {}
        }
    }
    (backend, probe.library)
}

/// The layer-shell library: `$CORNERCASE_FLOAT_LAYER_SHELL` when it names a file, else the first usual directory
/// that has it.
fn find_library(var: Option<PathBuf>, exists: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    var.filter(|path| exists(path))
        .or_else(|| LIBRARY_DIRS.iter().map(|dir| Path::new(dir).join(LIBRARY)).find(|path| exists(path)))
}

/// The value of `LD_PRELOAD` that puts the library first, before whatever was there.
fn preload_value(library: &Path, existing: Option<&str>) -> String {
    match existing.filter(|value| !value.is_empty()) {
        Some(existing) => format!("{}:{existing}", library.display()),
        None => library.display().to_string(),
    }
}

/// `LD_PRELOAD` as it was before `preload_value` put the library first; nothing when that was nothing.
fn without_preload(value: &str, library: &Path) -> Option<String> {
    let library = library.display().to_string();
    let rest: Vec<&str> = value.split(':').filter(|entry| !entry.is_empty() && *entry != library).collect();
    (!rest.is_empty()).then(|| rest.join(":"))
}

/// The library shims libwayland and must be loaded before it, so the process starts again with `LD_PRELOAD`. Same
/// pid, same argv; only returns when `exec` failed.
fn reexec_preloaded(library: &Path) -> std::io::Error {
    let existing = std::env::var("LD_PRELOAD").ok();
    let mut args = std::env::args_os();
    let argv0 = args.next();
    let program = std::env::current_exe().unwrap_or_else(|_| argv0.clone().map(PathBuf::from).unwrap_or_default());
    let mut command = Command::new(program);
    if let Some(argv0) = argv0 {
        command.arg0(argv0);
    }
    command.args(args).env("LD_PRELOAD", preload_value(library, existing.as_deref())).env(PRELOADED, "1").exec()
}

struct Listing;

impl Dispatch<WlRegistry, GlobalListContents> for Listing {
    fn event(
        _: &mut Self,
        _: &WlRegistry,
        _: <WlRegistry as wayland_client::Proxy>::Event,
        _: &GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

fn registry_has_layer_shell() -> bool {
    let Ok(connection) = Connection::connect_to_env() else { return false };
    let Ok((globals, _queue)) = registry_queue_init::<Listing>(&connection) else { return false };
    globals
        .contents()
        .with_list(|list| layer_shell_listed(list.iter().map(|global| (global.interface.as_str(), global.version))))
}

fn layer_shell_listed<'a>(mut globals: impl Iterator<Item = (&'a str, u32)>) -> bool {
    globals.any(|(interface, version)| interface == "zwlr_layer_shell_v1" && version >= LAYER_SHELL_VERSION)
}

/// A window position in layer-shell terms: the margins from the top and left edges of its output.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Margins {
    pub(crate) top: i32,
    pub(crate) left: i32,
}

impl Margins {
    /// Moved by a drag's offset.
    pub(crate) fn moved(self, dx: f64, dy: f64) -> Self {
        Self { top: self.top + points(dy), left: self.left + points(dx) }
    }

    /// Kept inside the output: a window of `size` never reaches past the edges of `extent`.
    pub(crate) fn clamped(self, size: (i32, i32), extent: (i32, i32)) -> Self {
        Self {
            top: self.top.clamp(0, (extent.1 - size.1).max(0)),
            left: self.left.clamp(0, (extent.0 - size.0).max(0)),
        }
    }
}

/// A distance in points, to whole points.
#[allow(clippy::cast_possible_truncation, reason = "a position is a few thousand points at most")]
pub(crate) fn points(value: f64) -> i32 {
    value.round() as i32
}

/// Whether a press that has travelled `(dx, dy)` is a drag.
pub(crate) fn is_drag(dx: f64, dy: f64) -> bool {
    dx.hypot(dy) > DRAG_THRESHOLD
}

