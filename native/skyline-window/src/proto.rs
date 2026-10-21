//! What both frontends share: the line protocol with bin/skyline-window.js, the frame as runs of one colour, where a
//! preset puts the window, and the right-click menu. Toolkit-free, so it is all tested here.
//!
//! In (stdin, one JSON object per line):
//!   {"frame": {"w", "h", "rgba": base64}}  — the pixels, row-major from the top, alpha 0 or 255
//!   {"config": {"scale", "opacity", "visible", "position", "size", "color", "colors"}}
//!   {"banner": {"text", "color": "#rrggbb"}} — `{}` clears it
//! Out (stdout): {"menu": {"key", "value"}} for a pick, {"moved": {"x", "y"}} after a drag, and
//!   {"resized": {"scale", "x", "y"}} after a drag on the frame's edge (the new zoom and where the window went).

use std::io::Write;

use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(default)]
pub(crate) struct Config {
    /// Points per skyline pixel.
    pub(crate) scale: f64,
    pub(crate) opacity: f64,
    pub(crate) visible: bool,
    /// A preset (`top-left` … `bottom-right`), or `x,y` where it was dragged, in the platform's own coordinates.
    pub(crate) position: String,
    pub(crate) size: String,
    pub(crate) color: String,
    /// The colour menu's entries, in order.
    pub(crate) colors: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            scale: 3.0,
            opacity: 0.85,
            visible: true,
            position: "bottom-right".into(),
            size: "medium".into(),
            color: "fg".into(),
            colors: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Frame {
    pub(crate) w: usize,
    pub(crate) h: usize,
    pub(crate) rgba: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Msg {
    Frame(Frame),
    Config(Config),
    /// The text and its colour; `None` clears it.
    Banner(Option<(String, u32)>),
}

#[derive(Deserialize)]
struct Line {
    frame: Option<RawFrame>,
    config: Option<Config>,
    banner: Option<RawBanner>,
}

#[derive(Deserialize)]
struct RawFrame {
    w: usize,
    h: usize,
    rgba: String,
}

#[derive(Deserialize)]
struct RawBanner {
    text: Option<String>,
    color: Option<String>,
}

/// One line in; nothing when it is not one of ours or is malformed.
pub(crate) fn parse(line: &str) -> Option<Msg> {
    let line: Line = serde_json::from_str(line).ok()?;
    if let Some(f) = line.frame {
        let rgba = base64(&f.rgba)?;
        return (rgba.len() == f.w * f.h * 4).then_some(Msg::Frame(Frame { w: f.w, h: f.h, rgba }));
    }
    if let Some(c) = line.config {
        return Some(Msg::Config(c));
    }
    let b = line.banner?;
    let text = b.text.filter(|t| !t.is_empty());
    let color = b.color.and_then(|c| u32::from_str_radix(c.trim_start_matches('#'), 16).ok());
    Some(Msg::Banner(text.zip(color)))
}

fn base64(s: &str) -> Option<Vec<u8>> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    };
    let bytes: Vec<u8> = s.bytes().filter(|&c| c != b'=').collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let v: Vec<u8> = chunk.iter().map(|&c| value(c)).collect::<Option<_>>()?;
        let n = v.iter().enumerate().fold(0u32, |n, (i, &d)| n | (u32::from(d) << (18 - 6 * i)));
        for i in 0..v.len().saturating_sub(1) {
            out.push((n >> (16 - 8 * i)) as u8);
        }
    }
    Some(out)
}

/// A horizontal run of one colour: what each frontend fills as one rectangle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Run {
    pub(crate) x: usize,
    pub(crate) y: usize,
    pub(crate) len: usize,
    pub(crate) rgb: u32,
}

/// The frame's drawn pixels as runs, row by row from the top; see-through pixels are left out.
pub(crate) fn runs(frame: &Frame) -> Vec<Run> {
    let mut out = Vec::new();
    for y in 0..frame.h {
        let mut current: Option<Run> = None;
        for x in 0..frame.w {
            let i = (y * frame.w + x) * 4;
            let px = &frame.rgba[i..i + 4];
            let rgb = (u32::from(px[0]) << 16) | (u32::from(px[1]) << 8) | u32::from(px[2]);
            match current.as_mut() {
                Some(run) if px[3] > 0 && run.rgb == rgb => run.len += 1,
                _ => {
                    out.extend(current.take());
                    current = (px[3] > 0).then_some(Run { x, y, len: 1, rgb });
                }
            }
        }
        out.extend(current);
    }
    out
}

/// A rectangle with the origin at the top left.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Rect {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) w: f64,
    pub(crate) h: f64,
}

impl Rect {
    pub(crate) fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
    }
}

/// The light frame around the skyline: this much padding, a rounded edge, and two buttons in its top-right corner.
pub(crate) const PAD: f64 = 6.0;
pub(crate) const RADIUS: f64 = 8.0;
const BUTTON: f64 = 14.0;
const BUTTON_GAP: f64 = 4.0;

/// The window's size in points for a grid of skyline pixels at `scale`: the pixels plus the frame.
pub(crate) fn window_size(grid: (usize, usize), scale: f64) -> (f64, f64) {
    let len = |n: usize| f64::from(u32::try_from(n).unwrap_or(u32::MAX));
    (len(grid.0) * scale + 2.0 * PAD, len(grid.1) * scale + 2.0 * PAD)
}

/// The close button, in the frame's top-right corner of a window `width` wide (top-left origin).
pub(crate) fn close_button(width: f64) -> Rect {
    Rect { x: width - PAD - BUTTON, y: PAD, w: BUTTON, h: BUTTON }
}

/// The settings gear, left of the close button.
pub(crate) fn gear_button(width: f64) -> Rect {
    let close = close_button(width);
    Rect { x: close.x - BUTTON_GAP - BUTTON, ..close }
}

/// How close to the frame's edge a press resizes rather than moves.
pub(crate) const GRIP: f64 = 5.0;
/// The zoom a resize stays within, in points per skyline pixel.
pub(crate) const MIN_SCALE: f64 = 1.0;
pub(crate) const MAX_SCALE: f64 = 8.0;

/// Which edges a resize drags (a corner drags two).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Edges {
    pub(crate) left: bool,
    pub(crate) right: bool,
    pub(crate) top: bool,
    pub(crate) bottom: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Hit {
    Gear,
    Close,
    /// Near the edge: a drag zooms the city, keeping its shape.
    Edge(Edges),
    /// Anywhere else in the frame: a drag moves the window, a click does nothing.
    Body,
}

/// What a press at `(x, y)` in a window of `size` lands on (top-left origin). The buttons win over the edge.
pub(crate) fn hit(size: (f64, f64), x: f64, y: f64) -> Hit {
    let (w, h) = size;
    if close_button(w).contains(x, y) {
        return Hit::Close;
    }
    if gear_button(w).contains(x, y) {
        return Hit::Gear;
    }
    let edges = Edges { left: x < GRIP, right: x >= w - GRIP, top: y < GRIP, bottom: y >= h - GRIP };
    if edges.left || edges.right || edges.top || edges.bottom { Hit::Edge(edges) } else { Hit::Body }
}

/// The zoom a resize gives: a window of `start` points, its `edges` dragged by `(dx, dy)` (right and down are
/// positive), showing a grid of `grid` pixels. A corner follows whichever way grew more. Kept to two decimals.
pub(crate) fn resize_scale(grid: (usize, usize), start: (f64, f64), edges: Edges, dx: f64, dy: f64) -> f64 {
    let len = |n: usize| f64::from(u32::try_from(n.max(1)).unwrap_or(u32::MAX));
    let w = start.0 + if edges.right { dx } else if edges.left { -dx } else { 0.0 };
    let h = start.1 + if edges.bottom { dy } else if edges.top { -dy } else { 0.0 };
    let by_w = (edges.left || edges.right).then(|| (w - 2.0 * PAD) / len(grid.0));
    let by_h = (edges.top || edges.bottom).then(|| (h - 2.0 * PAD) / len(grid.1));
    let scale = match (by_w, by_h) {
        (Some(a), Some(b)) => a.max(b),
        (Some(a), None) | (None, Some(a)) => a,
        (None, None) => (start.0 - 2.0 * PAD) / len(grid.0),
    };
    (scale.clamp(MIN_SCALE, MAX_SCALE) * 100.0).round() / 100.0
}

/// Where the window's top-left corner goes after a resize so the edges that were not dragged stay put (top-left
/// origin). A resize from a side only also changes the other dimension; it grows away from the top-left then.
#[cfg_attr(target_os = "macos", allow(dead_code, reason = "AppKit's y grows up; the macOS frontend works it out itself"))]
pub(crate) fn resize_origin(origin: (f64, f64), start: (f64, f64), size: (f64, f64), edges: Edges) -> (f64, f64) {
    let x = if edges.left { origin.0 + start.0 - size.0 } else { origin.0 };
    let y = if edges.top { origin.1 + start.1 - size.1 } else { origin.1 };
    (x, y)
}

/// The grip drawn in the bottom-right corner, as short diagonal strokes ((x0, y0), (x1, y1)).
pub(crate) fn grip_strokes(size: (f64, f64)) -> [((f64, f64), (f64, f64)); 2] {
    let (w, h) = (size.0 - 3.0, size.1 - 3.0);
    [((w - 7.0, h), (w, h - 7.0)), ((w - 3.5, h), (w, h - 3.5))]
}

/// The gear's outline inside `button`: eight teeth around a disc, as a closed polygon (the hole is drawn on top).
pub(crate) fn gear_outline(button: Rect) -> Vec<(f64, f64)> {
    let (cx, cy) = (button.x + button.w / 2.0, button.y + button.h / 2.0);
    let (outer, inner) = (button.w * 0.42, button.w * 0.3);
    let tooth = std::f64::consts::PI / 8.0;
    (0..8)
        .flat_map(|i| {
            let a = f64::from(i) * std::f64::consts::PI / 4.0;
            [(a - tooth * 0.9, inner), (a - tooth * 0.45, outer), (a + tooth * 0.45, outer), (a + tooth * 0.9, inner)]
        })
        .map(|(a, r)| (cx + r * a.cos(), cy + r * a.sin()))
        .collect()
}

/// The gear's hole: centre and radius.
pub(crate) fn gear_hole(button: Rect) -> (f64, f64, f64) {
    (button.x + button.w / 2.0, button.y + button.h / 2.0, button.w * 0.13)
}

/// How far from the screen's edges a preset sits.
const EDGE: f64 = 12.0;

/// The top-left corner a preset puts a window of `size` at inside `area` (top-left origin). `None` for a dragged
/// position, which each frontend reads in its own coordinates.
pub(crate) fn preset_origin(position: &str, size: (f64, f64), area: Rect) -> Option<(f64, f64)> {
    let (vertical, horizontal) = position.split_once('-')?;
    let x = match horizontal {
        "left" => area.x + EDGE,
        "center" => area.x + (area.w - size.0) / 2.0,
        "right" => area.x + area.w - size.0 - EDGE,
        _ => return None,
    };
    let y = match vertical {
        "top" => area.y + EDGE,
        "bottom" => area.y + area.h - size.1 - EDGE,
        _ => return None,
    };
    Some((x.round(), y.round()))
}

/// A dragged position, `x,y`.
pub(crate) fn dragged(position: &str) -> Option<(f64, f64)> {
    let (x, y) = position.split_once(',')?;
    Some((x.trim().parse().ok()?, y.trim().parse().ok()?))
}

/// One submenu of the right-click menu: its title, the settings key it sets, and (label, value) options.
pub(crate) struct Submenu {
    pub(crate) title: &'static str,
    pub(crate) key: &'static str,
    pub(crate) options: Vec<(String, String)>,
}

/// The right-click menu, the same on both platforms; the current value of each key gets the check mark.
pub(crate) fn menu(config: &Config) -> Vec<Submenu> {
    let opts = |list: &[(&str, &str)]| list.iter().map(|(l, v)| ((*l).to_string(), (*v).to_string())).collect();
    vec![
        Submenu {
            title: "Position",
            key: "position",
            options: opts(&[
                ("Top left", "top-left"),
                ("Top centre", "top-center"),
                ("Top right", "top-right"),
                ("Bottom left", "bottom-left"),
                ("Bottom centre", "bottom-center"),
                ("Bottom right", "bottom-right"),
            ]),
        },
        Submenu { title: "Size", key: "size", options: opts(&[("Small", "small"), ("Medium", "medium"), ("Large", "large")]) },
        Submenu {
            title: "Opacity",
            key: "opacity",
            options: opts(&[("25%", "0.25"), ("50%", "0.5"), ("75%", "0.75"), ("85%", "0.85"), ("100%", "1")]),
        },
        Submenu {
            title: "Colour",
            key: "color",
            options: config.colors.iter().map(|c| (colour_label(c), c.clone())).collect(),
        },
    ]
}

/// The value of `key` the menu marks as chosen.
pub(crate) fn current(config: &Config, key: &str) -> String {
    match key {
        "position" => config.position.clone(),
        "size" => config.size.clone(),
        "opacity" => opacity_value(config.opacity),
        "color" => config.color.clone(),
        _ => String::new(),
    }
}

fn opacity_value(opacity: f64) -> String {
    if (opacity - 1.0).abs() < 1e-9 { "1".into() } else { format!("{opacity}") }
}

fn colour_label(value: &str) -> String {
    if value == "fg" {
        return "Terminal text".into();
    }
    let mut chars = value.chars();
    chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default()
}

pub(crate) fn emit_pick(key: &str, value: &str) {
    emit(&serde_json::json!({ "menu": { "key": key, "value": value } }));
}

pub(crate) fn emit_resized(scale: f64, x: f64, y: f64) {
    emit(&serde_json::json!({ "resized": { "scale": scale, "x": x.round(), "y": y.round() } }));
}

pub(crate) fn emit_moved(x: f64, y: f64) {
    emit(&serde_json::json!({ "moved": { "x": x.round(), "y": y.round() } }));
}

fn emit(value: &serde_json::Value) {
    let mut out = std::io::stdout().lock();
    drop(writeln!(out, "{value}").and_then(|()| out.flush()));
}

#[cfg(test)]
mod tests;
