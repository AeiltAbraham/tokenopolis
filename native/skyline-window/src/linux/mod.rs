//! The Linux frontend (GTK 4): an undecorated, transparent window placed as cornercase-float places its own — a
//! layer-shell overlay where the compositor has it, else X11 hints (also under XWayland), else a plain window. It
//! never takes the keyboard. Its light frame takes the mouse: a drag moves it, a right-click or the gear opens the
//! menu, the cross closes it.

mod layer;
mod place;
mod x11;

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use gtk4::prelude::*;
use gtk4::{cairo, gdk, gio, glib};

use self::layer::Layer;
use self::place::{Backend, Margins};
use self::x11::{Put, X11};
use crate::Inbox;
use crate::proto::{self, Config, Msg, Run};

const TICK: Duration = Duration::from_millis(30);

struct Ui {
    window: gtk4::Window,
    area: gtk4::DrawingArea,
    backend: Backend,
    layer: Option<Layer>,
    x11: RefCell<Option<Rc<X11>>>,
    runs: RefCell<Vec<Run>>,
    grid: Cell<(usize, usize)>,
    config: RefCell<Config>,
    banner: RefCell<Option<(String, u32)>>,
    /// Layer backend: the margins the window is at now.
    margins: Cell<Margins>,
    /// The press of a drag in progress, in window coordinates.
    pressed: Cell<Option<(f64, f64)>>,
    dragging: Cell<bool>,
    /// A press on the frame's edge: the edges it drags, the window's size and top-left corner when it began (X11:
    /// device pixels; layer: margins).
    resizing: Cell<Option<(proto::Edges, (f64, f64), (f64, f64))>>,
    mapped: Cell<bool>,
    actions: gio::SimpleActionGroup,
}

pub(crate) fn run(inbox: Arc<Inbox>) -> Result<(), String> {
    let (backend, library) = place::select();
    gtk4::init().map_err(|e| format!("could not start GTK: {e}"))?;
    let provider = gtk4::CssProvider::new();
    provider.load_from_data("window.skyline, window.skyline > * { background: transparent; box-shadow: none; }");
    if let Some(display) = gdk::Display::default() {
        gtk4::style_context_add_provider_for_display(&display, &provider, gtk4::STYLE_PROVIDER_PRIORITY_APPLICATION);
    }
    let layer = match (backend, library.as_deref()) {
        (Backend::Layer, Some(path)) => Layer::load(path).map_err(|e| eprintln!("skyline-window: {e}")).ok(),
        _ => None,
    };
    let backend = if backend == Backend::Layer && layer.is_none() { Backend::Plain } else { backend };

    let window = gtk4::Window::builder().decorated(false).resizable(false).title("Tokenopolis skyline").build();
    window.add_css_class("skyline");
    let area = gtk4::DrawingArea::new();
    window.set_child(Some(&area));
    let ui = Rc::new(Ui {
        window,
        area,
        backend,
        layer,
        x11: RefCell::new(None),
        runs: RefCell::new(Vec::new()),
        grid: Cell::new((0, 0)),
        config: RefCell::new(Config::default()),
        banner: RefCell::new(None),
        margins: Cell::new(Margins::default()),
        pressed: Cell::new(None),
        dragging: Cell::new(false),
        resizing: Cell::new(None),
        mapped: Cell::new(false),
        actions: gio::SimpleActionGroup::new(),
    });
    ui.connect();

    let main_loop = glib::MainLoop::new(None, false);
    let ending = main_loop.clone();
    let ticking = Rc::clone(&ui);
    glib::timeout_add_local(TICK, move || {
        for line in inbox.take() {
            if let Some(msg) = proto::parse(&line) {
                ticking.apply(msg);
            }
        }
        if inbox.closed() {
            ending.quit();
        }
        glib::ControlFlow::Continue
    });
    main_loop.run();
    Ok(())
}

impl Ui {
    fn connect(self: &Rc<Self>) {
        let ui = Rc::clone(self);
        self.area.set_draw_func(move |_, cr, _, _| ui.draw(cr));

        let drag = gtk4::GestureDrag::new();
        drag.set_button(gdk::BUTTON_PRIMARY);
        let ui = Rc::clone(self);
        drag.connect_drag_begin(move |_, x, y| {
            ui.pressed.set(Some((x, y)));
            ui.dragging.set(false);
            ui.begin_resize(x, y);
        });
        let ui = Rc::clone(self);
        drag.connect_drag_update(move |gesture, dx, dy| ui.dragged(gesture, dx, dy));
        let ui = Rc::clone(self);
        drag.connect_drag_end(move |_, _, _| ui.released());
        self.area.add_controller(drag);

        let menu = gtk4::GestureClick::new();
        menu.set_button(gdk::BUTTON_SECONDARY);
        let ui = Rc::clone(self);
        menu.connect_pressed(move |_, _, x, y| ui.popup(x, y));
        self.area.add_controller(menu);

        // One stateful action per setting, so the menu shows the chosen value as a radio item; plus "hide".
        for key in ["position", "size", "opacity", "color"] {
            let action = gio::SimpleAction::new_stateful(key, Some(glib::VariantTy::STRING), &String::new().to_variant());
            action.connect_activate(move |_, value| {
                if let Some(value) = value.and_then(glib::Variant::str) {
                    proto::emit_pick(key, value);
                }
            });
            self.actions.add_action(&action);
        }
        let hide = gio::SimpleAction::new("hide", None);
        hide.connect_activate(|_, _| proto::emit_pick("visible", "false"));
        self.actions.add_action(&hide);
        self.window.insert_action_group("sky", Some(&self.actions));
    }

    fn apply(self: &Rc<Self>, msg: Msg) {
        match msg {
            Msg::Frame(frame) => {
                let resized = self.grid.replace((frame.w, frame.h)) != (frame.w, frame.h);
                *self.runs.borrow_mut() = proto::runs(&frame);
                if resized {
                    self.layout();
                }
                self.area.queue_draw();
            }
            Msg::Config(config) => {
                self.window.set_opacity(config.opacity);
                let visible = config.visible;
                for key in ["position", "size", "opacity", "color"] {
                    if let Some(action) = self.actions.lookup_action(key) {
                        action.change_state(&proto::current(&config, key).to_variant());
                    }
                }
                *self.config.borrow_mut() = config;
                self.layout();
                if visible { self.show() } else { self.window.set_visible(false) }
            }
            Msg::Banner(banner) => {
                *self.banner.borrow_mut() = banner;
                self.area.queue_draw();
            }
        }
    }

    fn scale(&self) -> f64 {
        self.config.borrow().scale.max(1.0)
    }

    /// The size in points: the grid × scale, in its frame.
    fn size(&self) -> (i32, i32) {
        let (w, h) = proto::window_size(self.grid.get(), self.scale());
        (place::points(w), place::points(h))
    }

    fn draw(&self, cr: &cairo::Context) {
        let (width, height) = (f64::from(self.area.width()), f64::from(self.area.height()));
        // The light frame: a faint fill and a thin rounded edge.
        rounded(cr, 0.5, 0.5, width - 1.0, height - 1.0, proto::RADIUS);
        cr.set_source_rgba(0.0, 0.0, 0.0, 0.18);
        drop(cr.fill_preserve());
        cr.set_source_rgba(1.0, 1.0, 1.0, 0.22);
        cr.set_line_width(1.0);
        drop(cr.stroke());

        let s = self.scale();
        for run in self.runs.borrow().iter() {
            let (r, g, b) = rgb(run.rgb);
            cr.set_source_rgb(r, g, b);
            cr.rectangle(proto::PAD + px(run.x) * s, proto::PAD + px(run.y) * s, px(run.len) * s, s);
            drop(cr.fill());
        }

        cr.set_source_rgba(1.0, 1.0, 1.0, 0.6);
        let gear = proto::gear_button(width);
        for (i, &(x, y)) in proto::gear_outline(gear).iter().enumerate() {
            if i == 0 { cr.move_to(x, y) } else { cr.line_to(x, y) }
        }
        cr.close_path();
        let (hx, hy, hr) = proto::gear_hole(gear);
        cr.new_sub_path();
        cr.arc(hx, hy, hr, 0.0, std::f64::consts::TAU);
        cr.set_fill_rule(cairo::FillRule::EvenOdd);
        drop(cr.fill());
        let r = proto::close_button(width);
        let m = 3.5;
        cr.move_to(r.x + m, r.y + m);
        cr.line_to(r.x + r.w - m, r.y + r.h - m);
        cr.move_to(r.x + r.w - m, r.y + m);
        cr.line_to(r.x + m, r.y + r.h - m);
        cr.set_line_width(1.5);
        drop(cr.stroke());
        for ((x0, y0), (x1, y1)) in proto::grip_strokes((width, height)) {
            cr.move_to(x0, y0);
            cr.line_to(x1, y1);
        }
        cr.set_source_rgba(1.0, 1.0, 1.0, 0.4);
        cr.set_line_width(1.0);
        drop(cr.stroke());
        if let Some((text, colour)) = self.banner.borrow().as_ref() {
            cr.select_font_face("monospace", cairo::FontSlant::Normal, cairo::FontWeight::Bold);
            cr.set_font_size((3.6 * s).max(9.0));
            let Ok(extents) = cr.text_extents(text) else { return };
            let (x, y) = (((width - extents.width()) / 2.0).max(2.0), proto::PAD + 1.0 - extents.y_bearing());
            cr.set_source_rgba(0.0, 0.0, 0.0, 0.8);
            cr.move_to(x + 1.0, y + 1.0);
            drop(cr.show_text(text));
            let (r, g, b) = rgb(*colour);
            cr.set_source_rgb(r, g, b);
            cr.move_to(x, y);
            drop(cr.show_text(text));
        }
    }

    fn layout(&self) {
        let (w, h) = self.size();
        if w == 0 {
            return;
        }
        self.area.set_content_width(w);
        self.area.set_content_height(h);
        self.window.set_default_size(w, h);
        let position = self.config.borrow().position.clone();
        match self.backend {
            Backend::Layer => {
                let Some(extent) = self.extent() else { return };
                let margins = match proto::dragged(&position) {
                    Some((left, top)) => Margins { top: place::points(top), left: place::points(left) },
                    None => {
                        let area = proto::Rect { x: 0.0, y: 0.0, w: f64::from(extent.0), h: f64::from(extent.1) };
                        let (left, top) =
                            proto::preset_origin(&position, (f64::from(w), f64::from(h)), area).unwrap_or((0.0, 0.0));
                        Margins { top: place::points(top), left: place::points(left) }
                    }
                }
                .clamped((w, h), extent);
                self.margins.set(margins);
                if let (Some(layer), true) = (&self.layer, self.mapped.get()) {
                    layer.margins(&self.window, margins);
                }
            }
            Backend::X11 => {
                if let (Some(x11), Some(at)) = (self.x11.borrow().as_ref(), self.x11_target(&position, (w, h))) {
                    drop(x11.move_to(at.0, at.1));
                }
            }
            Backend::Plain => {}
        }
    }

    /// X11: where the window goes, in X11 device pixels (GTK sizes are application pixels: device / scale).
    fn x11_target(&self, position: &str, size: (i32, i32)) -> Option<(i32, i32)> {
        if let Some((x, y)) = proto::dragged(position) {
            return Some((place::points(x), place::points(y)));
        }
        let display = gdk::Display::default()?;
        let monitor = self
            .window
            .surface()
            .and_then(|s| display.monitor_at_surface(&s))
            .or_else(|| display.monitors().item(0).and_then(|m| m.downcast::<gdk::Monitor>().ok()))?;
        let g = monitor.geometry();
        let area = proto::Rect { x: f64::from(g.x()), y: f64::from(g.y()), w: f64::from(g.width()), h: f64::from(g.height()) };
        let (x, y) = proto::preset_origin(position, (f64::from(size.0), f64::from(size.1)), area)?;
        let scale = f64::from(monitor.scale_factor().max(1));
        Some((place::points(x * scale), place::points(y * scale)))
    }

    /// The size, in points, of the monitor the window is on, else the first.
    fn extent(&self) -> Option<(i32, i32)> {
        let display = gdk::Display::default()?;
        let monitor = self
            .window
            .surface()
            .and_then(|s| display.monitor_at_surface(&s))
            .or_else(|| display.monitors().item(0).and_then(|m| m.downcast::<gdk::Monitor>().ok()))?;
        let g = monitor.geometry();
        Some((g.width(), g.height()))
    }

    /// Shown without being presented, so nothing takes the focus.
    fn show(self: &Rc<Self>) {
        if self.mapped.replace(true) {
            self.window.set_visible(true);
            return;
        }
        match self.backend {
            Backend::Layer => {
                if let Some(layer) = &self.layer {
                    layer.setup(&self.window, self.margins.get(), None);
                }
                self.window.set_visible(true);
            }
            Backend::X11 => {
                WidgetExt::realize(&self.window);
                let xid = self
                    .window
                    .surface()
                    .and_then(|s| s.downcast::<gdk4_x11::X11Surface>().ok())
                    .and_then(|s| u32::try_from(s.xid()).ok());
                if let Some(xid) = xid {
                    match X11::connect(xid).and_then(|x11| x11.prepare().map(|()| x11)) {
                        Ok(x11) => *self.x11.borrow_mut() = Some(Rc::new(x11)),
                        Err(e) => eprintln!("skyline-window: could not set the window's hints: {e}"),
                    }
                }
                self.window.set_visible(true);
                // The window manager may not have the window yet, and GTK may rewrite the hints on map: ask again a
                // moment later, and once more for a slow one; only the first pass moves it.
                for after in [150, 700] {
                    let ui = Rc::clone(self);
                    glib::timeout_add_local_once(Duration::from_millis(after), move || {
                        let position = ui.config.borrow().position.clone();
                        let put = match (after, ui.x11_target(&position, ui.size())) {
                            (150, Some((x, y))) => Put::To(x, y),
                            _ => Put::Stay,
                        };
                        if let Some(x11) = ui.x11.borrow().as_ref() {
                            drop(x11.after_map(put).map_err(|e| eprintln!("skyline-window: {e}")));
                        }
                    });
                }
            }
            Backend::Plain => self.window.present(),
        }
    }

    /// A press on the edge starts a resize: remember where the window was and how big.
    fn begin_resize(&self, x: f64, y: f64) {
        let size = (f64::from(self.area.width()), f64::from(self.area.height()));
        let proto::Hit::Edge(edges) = proto::hit(size, x, y) else {
            self.resizing.set(None);
            return;
        };
        let origin = match self.backend {
            Backend::Layer => {
                let m = self.margins.get();
                (f64::from(m.left), f64::from(m.top))
            }
            Backend::X11 => self.x11.borrow().as_ref().and_then(|x11| x11.position()).map_or((0.0, 0.0), |(x, y)| (f64::from(x), f64::from(y))),
            Backend::Plain => (0.0, 0.0),
        };
        self.resizing.set(Some((edges, size, origin)));
    }

    /// While resizing the window grows from its top-left corner (moving it under the pointer would shift the drag's
    /// offsets); on release it is put so the edges that were not dragged stay where they were.
    fn resize(&self, edges: proto::Edges, start: (f64, f64), dx: f64, dy: f64) {
        let scale = proto::resize_scale(self.grid.get(), start, edges, dx, dy);
        self.config.borrow_mut().scale = scale;
        let (w, h) = self.size();
        self.area.set_content_width(w);
        self.area.set_content_height(h);
        self.area.queue_draw();
    }

    fn end_resize(&self, edges: proto::Edges, start: (f64, f64), origin: (f64, f64)) {
        let scale = self.scale();
        let size = proto::window_size(self.grid.get(), scale);
        // X11 positions are device pixels, sizes application pixels.
        let device = if self.backend == Backend::X11 {
            f64::from(self.window.surface().map_or(1, |s| s.scale_factor()).max(1))
        } else {
            1.0
        };
        let (x, y) = proto::resize_origin(origin, (start.0 * device, start.1 * device), (size.0 * device, size.1 * device), edges);
        if self.backend != Backend::Plain {
            self.config.borrow_mut().position = format!("{},{}", x.round(), y.round());
        }
        self.layout();
        proto::emit_resized(scale, x, y);
    }

    fn dragged(self: &Rc<Self>, gesture: &gtk4::GestureDrag, dx: f64, dy: f64) {
        if let Some((edges, start, _)) = self.resizing.get() {
            if self.dragging.get() || place::is_drag(dx, dy) {
                self.dragging.set(true);
                self.resize(edges, start, dx, dy);
            }
            return;
        }
        if !self.dragging.get() {
            if !place::is_drag(dx, dy) {
                return;
            }
            self.dragging.set(true);
            if self.backend != Backend::Layer {
                self.hand_over(gesture);
                return;
            }
        }
        if self.backend != Backend::Layer {
            return;
        }
        // The pointer stays where it was pressed in the window's own frame, so each event's offset is the step.
        let (Some(layer), Some(extent)) = (&self.layer, self.extent()) else { return };
        let to = self.margins.get().moved(dx, dy).clamped(self.size(), extent);
        self.margins.set(to);
        layer.margins(&self.window, to);
    }

    /// X11 and plain: the window manager moves the window; on X11 its new place is reported when the move is over.
    fn hand_over(self: &Rc<Self>, gesture: &gtk4::GestureDrag) {
        let Some(toplevel) = self.window.surface().and_then(|s| s.downcast::<gdk::Toplevel>().ok()) else { return };
        let Some(device) = gesture.device() else { return };
        let (x, y) = self.pressed.get().unwrap_or_default();
        toplevel.begin_move(&device, i32::try_from(gesture.current_button()).unwrap_or(1), x, y, gesture.current_event_time());
        let Some(x11) = self.x11.borrow().clone() else { return };
        glib::timeout_add_local(Duration::from_millis(200), move || {
            if x11.button_down() {
                return glib::ControlFlow::Continue;
            }
            if let Some((x, y)) = x11.position() {
                proto::emit_moved(f64::from(x), f64::from(y));
            }
            glib::ControlFlow::Break
        });
    }

    /// The end of a drag reports where the window went; a press that never moved is a click on the frame.
    fn released(&self) {
        let pressed = self.pressed.take();
        let resizing = self.resizing.take();
        if let (Some((edges, start, origin)), true) = (resizing, self.dragging.get()) {
            self.dragging.set(false);
            self.end_resize(edges, start, origin);
            return;
        }
        if self.dragging.replace(false) {
            if self.backend == Backend::Layer {
                let m = self.margins.get();
                proto::emit_moved(f64::from(m.left), f64::from(m.top));
            }
            return;
        }
        let Some((x, y)) = pressed else { return };
        let width = f64::from(self.area.width());
        match proto::hit((width, f64::from(self.area.height())), x, y) {
            proto::Hit::Close => proto::emit_pick("visible", "false"),
            proto::Hit::Gear => {
                let gear = proto::gear_button(width);
                self.popup(gear.x + gear.w / 2.0, gear.y + gear.h);
            }
            proto::Hit::Edge(_) | proto::Hit::Body => {}
        }
    }

    fn popup(&self, x: f64, y: f64) {
        let model = gio::Menu::new();
        for sub in proto::menu(&self.config.borrow()) {
            let submenu = gio::Menu::new();
            for (label, value) in &sub.options {
                let item = gio::MenuItem::new(Some(label), None);
                item.set_action_and_target_value(Some(&format!("sky.{}", sub.key)), Some(&value.to_variant()));
                submenu.append_item(&item);
            }
            model.append_submenu(Some(sub.title), &submenu);
        }
        let end = gio::Menu::new();
        end.append(Some("Hide skyline"), Some("sky.hide"));
        model.append_section(None, &end);
        let popover = gtk4::PopoverMenu::from_model(Some(&model));
        popover.set_parent(&self.area);
        popover.set_has_arrow(false);
        popover.set_pointing_to(Some(&gdk::Rectangle::new(place::points(x), place::points(y), 1, 1)));
        popover.connect_closed(|p| {
            let p = p.clone();
            glib::idle_add_local_once(move || p.unparent());
        });
        popover.popup();
    }
}

fn rounded(cr: &cairo::Context, x: f64, y: f64, w: f64, h: f64, r: f64) {
    use std::f64::consts::{FRAC_PI_2, PI};
    cr.new_sub_path();
    cr.arc(x + w - r, y + r, r, -FRAC_PI_2, 0.0);
    cr.arc(x + w - r, y + h - r, r, 0.0, FRAC_PI_2);
    cr.arc(x + r, y + h - r, r, FRAC_PI_2, PI);
    cr.arc(x + r, y + r, r, PI, 3.0 * FRAC_PI_2);
    cr.close_path();
}

fn rgb(c: u32) -> (f64, f64, f64) {
    let part = |shift: u32| f64::from((c >> shift) & 0xff) / 255.0;
    (part(16), part(8), part(0))
}

/// A pixel count as a length.
fn px(n: usize) -> f64 {
    f64::from(u32::try_from(n).unwrap_or(u32::MAX))
}
