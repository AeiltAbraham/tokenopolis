// Copied from cornercase-float b45f36c (src/linux/place/x11.rs), without the text field's focus hand-over.
//! The X11 backend: EWMH properties and messages written with x11rb on the GDK surface's window. Also under `XWayland`.

use x11rb::connection::Connection;

use x11rb::properties::WmHints;
use x11rb::protocol::xproto::{
    AtomEnum, ClientMessageEvent, ConfigureWindowAux, ConnectionExt, EventMask, KeyButMask, PropMode, Window,
};
use x11rb::rust_connection::RustConnection;
use x11rb::wrapper::ConnectionExt as _;

mod atoms {
    #![allow(clippy::struct_field_names, reason = "the fields are named after the EWMH atoms")]

    x11rb::atom_manager! {
        pub(crate) Atoms: AtomsCookie {
            _NET_WM_STATE,
            _NET_WM_STATE_ABOVE,
            _NET_WM_STATE_STICKY,
            _NET_WM_STATE_SKIP_TASKBAR,
            _NET_WM_STATE_SKIP_PAGER,
            _NET_WM_DESKTOP,
            _NET_WM_WINDOW_TYPE,
            _NET_WM_WINDOW_TYPE_UTILITY,
            _NET_WM_USER_TIME,
            WM_PROTOCOLS,
            WM_TAKE_FOCUS,
        }
    }
}

pub(crate) use atoms::Atoms;

/// `_NET_WM_DESKTOP` for "every desktop".
const ALL_DESKTOPS: u32 = 0xFFFF_FFFF;
const SOURCE_APPLICATION: u32 = 1;
const ADD: u32 = 1;
/// A little of the window must stay reachable when a saved position is applied.
const REACHABLE: i32 = 40;

/// The data of a `_NET_WM_STATE` message that adds up to two states.
pub(crate) fn add_state(first: u32, second: u32) -> [u32; 5] {
    [ADD, first, second, SOURCE_APPLICATION, 0]
}

/// A saved position moved back onto a screen of `screen`, keeping at least `REACHABLE` points of the window in view.
pub(crate) fn reachable(x: i32, y: i32, screen: (i32, i32)) -> (i32, i32) {
    (x.clamp(0, (screen.0 - REACHABLE).max(0)), y.clamp(0, (screen.1 - REACHABLE).max(0)))
}

/// Where `after_map` puts the window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Put {
    /// A saved position.
    To(i32, i32),
    /// Where it is.
    Stay,
}

pub(crate) struct X11 {
    conn: RustConnection,
    root: Window,
    atoms: Atoms,
    window: Window,
}

impl X11 {
    pub(crate) fn connect(window: u32) -> Result<Self, String> {
        let (conn, screen) = RustConnection::connect(None).map_err(|e| e.to_string())?;
        let root = conn.setup().roots[screen].root;
        let atoms = Atoms::new(&conn).map_err(|e| e.to_string())?.reply().map_err(|e| e.to_string())?;
        Ok(Self { conn, root, atoms, window })
    }

    pub(crate) fn screen_size(&self) -> (i32, i32) {
        self.conn
            .get_geometry(self.root)
            .ok()
            .and_then(|c| c.reply().ok())
            .map_or((i32::MAX, i32::MAX), |g| (i32::from(g.width), i32::from(g.height)))
    }

    /// Before the window is mapped: on top, on every desktop, off the taskbar, a utility window, and "no user
    /// interaction yet" so the window manager does not focus it on map.
    pub(crate) fn prepare(&self) -> Result<(), String> {
        let a = &self.atoms;
        let c = &self.conn;
        let w = self.window;
        let states =
            [a._NET_WM_STATE_ABOVE, a._NET_WM_STATE_STICKY, a._NET_WM_STATE_SKIP_TASKBAR, a._NET_WM_STATE_SKIP_PAGER];
        c.change_property32(PropMode::REPLACE, w, a._NET_WM_STATE, AtomEnum::ATOM, &states)
            .map_err(|e| e.to_string())?;
        c.change_property32(PropMode::REPLACE, w, a._NET_WM_DESKTOP, AtomEnum::CARDINAL, &[ALL_DESKTOPS])
            .map_err(|e| e.to_string())?;
        c.change_property32(
            PropMode::REPLACE,
            w,
            a._NET_WM_WINDOW_TYPE,
            AtomEnum::ATOM,
            &[a._NET_WM_WINDOW_TYPE_UTILITY],
        )
        .map_err(|e| e.to_string())?;
        c.change_property32(PropMode::REPLACE, w, a._NET_WM_USER_TIME, AtomEnum::CARDINAL, &[0])
            .map_err(|e| e.to_string())?;
        self.no_focus()
    }

    /// Focus model: the window manager never gives this window the keyboard on a click. `WM_HINTS.input = False`, and
    /// no `WM_TAKE_FOCUS` (with it the window manager would still ask the window to take the focus itself). GTK may
    /// write both again when it maps the window, so `after_map` repeats this.
    fn no_focus(&self) -> Result<(), String> {
        self.set_input(false)?;
        let a = &self.atoms;
        let reply = self
            .conn
            .get_property(false, self.window, a.WM_PROTOCOLS, AtomEnum::ATOM, 0, 32)
            .map_err(|e| e.to_string())?
            .reply()
            .map_err(|e| e.to_string())?;
        let all: Vec<u32> = reply.value32().map(Iterator::collect).unwrap_or_default();
        let kept: Vec<u32> = all.iter().copied().filter(|atom| *atom != a.WM_TAKE_FOCUS).collect();
        if kept.len() != all.len() {
            self.conn
                .change_property32(PropMode::REPLACE, self.window, a.WM_PROTOCOLS, AtomEnum::ATOM, &kept)
                .map_err(|e| e.to_string())?;
        }
        self.conn.flush().map_err(|e| e.to_string())
    }

    fn set_input(&self, on: bool) -> Result<(), String> {
        let mut hints =
            WmHints::get(&self.conn, self.window).map_err(|e| e.to_string())?.reply().map_err(|e| e.to_string())?;
        hints.get_or_insert_with(WmHints::new).input = Some(on);
        if let Some(hints) = hints {
            hints.set(&self.conn, self.window).map_err(|e| e.to_string())?;
        }
        self.conn.flush().map_err(|e| e.to_string())
    }

    fn send(&self, type_: u32, data: [u32; 5]) -> Result<(), String> {
        self.send_to(self.window, type_, data)
    }

    fn send_to(&self, window: Window, type_: u32, data: [u32; 5]) -> Result<(), String> {
        let event = ClientMessageEvent::new(32, window, type_, data);
        let mask = EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY;
        self.conn.send_event(false, self.root, mask, event).map_err(|e| e.to_string())?;
        self.conn.flush().map_err(|e| e.to_string())
    }

    /// Once it is mapped: the window manager owns the state now, so ask it, and put the window where it was.
    /// GTK may have rewritten what `prepare` set when it mapped the window.
    pub(crate) fn after_map(&self, put: Put) -> Result<(), String> {
        let a = &self.atoms;
        self.send(a._NET_WM_STATE, add_state(a._NET_WM_STATE_ABOVE, a._NET_WM_STATE_STICKY))?;
        self.send(a._NET_WM_STATE, add_state(a._NET_WM_STATE_SKIP_TASKBAR, a._NET_WM_STATE_SKIP_PAGER))?;
        self.send(a._NET_WM_DESKTOP, [ALL_DESKTOPS, SOURCE_APPLICATION, 0, 0, 0])?;
        self.no_focus()?;
        match put {
            Put::To(x, y) => {
                let (x, y) = reachable(x, y, self.screen_size());
                self.move_to(x, y)
            }
            Put::Stay => Ok(()),
        }
    }

    pub(crate) fn move_to(&self, x: i32, y: i32) -> Result<(), String> {
        self.conn.configure_window(self.window, &ConfigureWindowAux::new().x(x).y(y)).map_err(|e| e.to_string())?;
        self.conn.flush().map_err(|e| e.to_string())
    }

    pub(crate) fn size(&self) -> Option<(i32, i32)> {
        let geometry = self.conn.get_geometry(self.window).ok()?.reply().ok()?;
        Some((i32::from(geometry.width), i32::from(geometry.height)))
    }

    /// The window's top-left corner on the screen.
    pub(crate) fn position(&self) -> Option<(i32, i32)> {
        let at = self.conn.translate_coordinates(self.window, self.root, 0, 0).ok()?.reply().ok()?;
        Some((i32::from(at.dst_x), i32::from(at.dst_y)))
    }

    /// Whether the first mouse button is down (a move the window manager runs is over when it is not).
    pub(crate) fn button_down(&self) -> bool {
        self.conn
            .query_pointer(self.root)
            .ok()
            .and_then(|c| c.reply().ok())
            .is_some_and(|p| p.mask.contains(KeyButMask::BUTTON1))
    }
}
