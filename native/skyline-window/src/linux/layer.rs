// Copied from cornercase-float b45f36c (src/linux/place/layer.rs); the keyboard toggle is dropped: the skyline never takes it.
//! wlr-layer-shell through `libgtk4-layer-shell.so.0`, loaded by hand: the crate that wraps it links the library hard,
//! and the binary has to start where the library is absent. The process was re-executed with the library preloaded
//! (see `select`), so loading it here finds the copy that is already there.

use std::ffi::c_int;
use std::path::Path;

use gtk4::glib::translate::ToGlibPtr;
use gtk4::prelude::*;
use gtk4::{ffi, gdk};
use libloading::Library;

use super::place::Margins;

type Window = *mut ffi::GtkWindow;

const LAYER_OVERLAY: c_int = 3;
const EDGE_LEFT: c_int = 0;
const EDGE_TOP: c_int = 2;
/// The window never takes the keyboard.
const KEYBOARD_NONE: c_int = 0;

pub(crate) struct Layer {
    init: unsafe extern "C" fn(Window),
    level: unsafe extern "C" fn(Window, c_int),
    anchor: unsafe extern "C" fn(Window, c_int, c_int),
    margin: unsafe extern "C" fn(Window, c_int, c_int),
    keyboard: unsafe extern "C" fn(Window, c_int),
    zone: unsafe extern "C" fn(Window, c_int),
    monitor: unsafe extern "C" fn(Window, *mut gdk::ffi::GdkMonitor),
    /// Keeps the functions above valid.
    _library: Library,
}

impl Layer {
    pub(crate) fn load(path: &Path) -> Result<Self, String> {
        // SAFETY: the library is the one the process was started with; the signatures are those of its header.
        unsafe {
            let library = Library::new(path).map_err(|e| format!("could not load {}: {e}", path.display()))?;
            macro_rules! symbol {
                ($name:literal) => {
                    *library.get(concat!($name, "\0").as_bytes()).map_err(|e| format!("{}: {e}", $name))?
                };
            }
            Ok(Self {
                init: symbol!("gtk_layer_init_for_window"),
                level: symbol!("gtk_layer_set_layer"),
                anchor: symbol!("gtk_layer_set_anchor"),
                margin: symbol!("gtk_layer_set_margin"),
                keyboard: symbol!("gtk_layer_set_keyboard_mode"),
                zone: symbol!("gtk_layer_set_exclusive_zone"),
                monitor: symbol!("gtk_layer_set_monitor"),
                _library: library,
            })
        }
    }

    /// Turns the window, not yet realized, into an overlay layer surface anchored top and left at `margins`.
    pub(crate) fn setup(&self, window: &gtk4::Window, margins: Margins, monitor: Option<&gdk::Monitor>) {
        let ptr: Window = window.to_glib_none().0;
        // SAFETY: `ptr` is a live GtkWindow that has not been realized.
        unsafe {
            (self.init)(ptr);
            (self.level)(ptr, LAYER_OVERLAY);
            (self.anchor)(ptr, EDGE_TOP, 1);
            (self.anchor)(ptr, EDGE_LEFT, 1);
            (self.keyboard)(ptr, KEYBOARD_NONE);
            (self.zone)(ptr, -1);
            if let Some(monitor) = monitor {
                (self.monitor)(ptr, monitor.to_glib_none().0);
            }
        }
        self.margins(window, margins);
    }

    pub(crate) fn margins(&self, window: &gtk4::Window, margins: Margins) {
        let ptr: Window = window.to_glib_none().0;
        // SAFETY: as in `setup`.
        unsafe {
            (self.margin)(ptr, EDGE_TOP, margins.top);
            (self.margin)(ptr, EDGE_LEFT, margins.left);
        }
    }
}
