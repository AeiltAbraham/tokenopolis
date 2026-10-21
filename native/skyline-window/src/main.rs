//! Tokenopolis' floating skyline window, run by bin/skyline-window.js: a small panel over everything, on every
//! desktop, that never takes the focus. It only shows the pixels it is sent and reports the right-click menu's picks
//! and drags back; all the city logic stays in Node. macOS: AppKit, the panel recipe of cornercase-float. Linux:
//! GTK 4, placed through layer-shell or X11 as cornercase-float does. Ends when its stdin closes.

mod proto;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod mac;

use std::io::BufRead;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Lines from stdin, handed to the UI thread, which drains them on its timer.
#[derive(Default)]
pub(crate) struct Inbox {
    lines: Mutex<Vec<String>>,
    closed: AtomicBool,
}

impl Inbox {
    pub(crate) fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.lines.lock().unwrap_or_else(std::sync::PoisonError::into_inner))
    }

    pub(crate) fn closed(&self) -> bool {
        self.closed.load(Ordering::Relaxed)
    }
}

fn main() {
    let inbox = Arc::new(Inbox::default());
    let reader = Arc::clone(&inbox);
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines().map_while(Result::ok) {
            reader.lines.lock().unwrap_or_else(std::sync::PoisonError::into_inner).push(line);
        }
        reader.closed.store(true, Ordering::Relaxed);
    });
    #[cfg(target_os = "macos")]
    let result = mac::run(inbox);
    #[cfg(target_os = "linux")]
    let result = linux::run(inbox);
    if let Err(e) = result {
        eprintln!("skyline-window: {e}");
        std::process::exit(1);
    }
}
