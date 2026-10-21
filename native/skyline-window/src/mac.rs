//! The macOS frontend (AppKit): a borderless, non-activating `NSPanel` with cornercase-float's recipe — over
//! everything, on every Space and over full-screen apps, never the key window — whose one view fills the frame's runs.
//! Fully transparent pixels let clicks through to what is behind; a drag moves it, a right-click opens the menu.

use std::cell::{Cell, OnceCell, RefCell};
use std::sync::Arc;

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, Message, define_class, msg_send, sel};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSBackingStoreType, NSBezierPath, NSColor, NSControlStateValueOff,
    NSControlStateValueOn, NSEvent, NSFont, NSFontWeightSemibold, NSMenu, NSMenuItem, NSPanel, NSScreen,
    NSStatusWindowLevel, NSTextField, NSView, NSWindingRule, NSWindowAnimationBehavior, NSWindowCollectionBehavior, NSWindowStyleMask,
};
use objc2_foundation::{NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString, NSTimer};

use crate::Inbox;
use crate::proto::{self, Config, Msg, Run};

/// How often the inbox is drained: frames come at ~7 a second.
const TICK: f64 = 0.03;

struct Ivars {
    inbox: Arc<Inbox>,
    panel: OnceCell<Retained<NSPanel>>,
    sky: OnceCell<Retained<Sky>>,
    banner: OnceCell<Retained<NSTextField>>,
    config: RefCell<Config>,
    /// The frame's size in skyline pixels.
    grid: Cell<(usize, usize)>,
}

define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = Ivars]
    struct Controller;

    unsafe impl NSObjectProtocol for Controller {}

    impl Controller {
        #[unsafe(method(tick:))]
        fn tick(&self, _timer: &NSTimer) {
            for line in self.ivars().inbox.take() {
                if let Some(msg) = proto::parse(&line) {
                    self.apply(msg);
                }
            }
            if self.ivars().inbox.closed() {
                std::process::exit(0);
            }
        }

        /// A menu item: its represented object is `key\tvalue`.
        #[unsafe(method(pick:))]
        fn pick(&self, item: &NSMenuItem) {
            let Some(object) = item.representedObject() else { return };
            let Ok(text) = object.downcast::<NSString>() else { return };
            if let Some((key, value)) = text.to_string().split_once('\t') {
                proto::emit_pick(key, value);
            }
        }
    }
);

/// A press in progress: the mouse and the window's frame, in screen coordinates, when it began, and the edges it
/// resizes from when it began on the frame's edge.
struct Press {
    mouse: NSPoint,
    origin: NSPoint,
    size: NSSize,
    resize: Option<proto::Edges>,
    dragged: bool,
}

#[derive(Default)]
struct SkyIvars {
    controller: OnceCell<Retained<Controller>>,
    runs: RefCell<Vec<Run>>,
    scale: Cell<f64>,
    press: RefCell<Option<Press>>,
}

define_class!(
    /// The panel's content view, origin at the top left like the frame's rows.
    #[unsafe(super = NSView)]
    #[thread_kind = MainThreadOnly]
    #[ivars = SkyIvars]
    struct Sky;

    impl Sky {
        #[unsafe(method(isFlipped))]
        fn is_flipped(&self) -> bool {
            true
        }

        #[unsafe(method(acceptsFirstMouse:))]
        fn accepts_first_mouse(&self, _event: Option<&NSEvent>) -> bool {
            true
        }

        #[unsafe(method(mouseDownCanMoveWindow))]
        fn can_move_window(&self) -> bool {
            false
        }

        #[unsafe(method(drawRect:))]
        fn draw_rect(&self, _dirty: NSRect) {
            let bounds = self.bounds();
            // The light frame: a faint fill (which also keeps every point of it clickable) and a thin edge.
            let inset = NSRect::new(NSPoint::new(0.5, 0.5), NSSize::new(bounds.size.width - 1.0, bounds.size.height - 1.0));
            let frame = NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(inset, proto::RADIUS, proto::RADIUS);
            NSColor::colorWithSRGBRed_green_blue_alpha(0.0, 0.0, 0.0, 0.18).setFill();
            frame.fill();
            NSColor::colorWithSRGBRed_green_blue_alpha(1.0, 1.0, 1.0, 0.22).setStroke();
            frame.setLineWidth(1.0);
            frame.stroke();

            let s = self.ivars().scale.get();
            for run in self.ivars().runs.borrow().iter() {
                colour(run.rgb).setFill();
                NSBezierPath::fillRect(rect(proto::PAD + px(run.x) * s, proto::PAD + px(run.y) * s, px(run.len) * s, s));
            }

            let ink = NSColor::colorWithSRGBRed_green_blue_alpha(1.0, 1.0, 1.0, 0.6);
            let width = bounds.size.width;
            let gear = proto::gear_button(width);
            let path = NSBezierPath::bezierPath();
            for (i, &(x, y)) in proto::gear_outline(gear).iter().enumerate() {
                if i == 0 { path.moveToPoint(NSPoint::new(x, y)) } else { path.lineToPoint(NSPoint::new(x, y)) }
            }
            path.closePath();
            let (hx, hy, hr) = proto::gear_hole(gear);
            path.appendBezierPathWithOvalInRect(rect(hx - hr, hy - hr, 2.0 * hr, 2.0 * hr));
            path.setWindingRule(NSWindingRule::EvenOdd);
            ink.setFill();
            path.fill();

            let close = proto::close_button(width);
            let cross = NSBezierPath::bezierPath();
            let (m, r) = (3.5, close);
            cross.moveToPoint(NSPoint::new(r.x + m, r.y + m));
            cross.lineToPoint(NSPoint::new(r.x + r.w - m, r.y + r.h - m));
            cross.moveToPoint(NSPoint::new(r.x + r.w - m, r.y + m));
            cross.lineToPoint(NSPoint::new(r.x + m, r.y + r.h - m));
            cross.setLineWidth(1.5);
            ink.setStroke();
            cross.stroke();

            // The resize grip, bottom right.
            let grip = NSBezierPath::bezierPath();
            for ((x0, y0), (x1, y1)) in proto::grip_strokes((width, bounds.size.height)) {
                grip.moveToPoint(NSPoint::new(x0, y0));
                grip.lineToPoint(NSPoint::new(x1, y1));
            }
            grip.setLineWidth(1.0);
            NSColor::colorWithSRGBRed_green_blue_alpha(1.0, 1.0, 1.0, 0.4).setStroke();
            grip.stroke();
        }

        #[unsafe(method(mouseDown:))]
        fn mouse_down(&self, event: &NSEvent) {
            let Some(window) = self.window() else { return };
            let frame = window.frame();
            let at = self.convertPoint_fromView(event.locationInWindow(), None);
            let resize = match proto::hit((frame.size.width, frame.size.height), at.x, at.y) {
                proto::Hit::Edge(edges) => Some(edges),
                _ => None,
            };
            *self.ivars().press.borrow_mut() =
                Some(Press { mouse: NSEvent::mouseLocation(), origin: frame.origin, size: frame.size, resize, dragged: false });
        }

        #[unsafe(method(mouseDragged:))]
        fn mouse_dragged(&self, _event: &NSEvent) {
            let mut press = self.ivars().press.borrow_mut();
            let (Some(press), Some(window)) = (press.as_mut(), self.window()) else { return };
            let now = NSEvent::mouseLocation();
            let (dx, dy) = (now.x - press.mouse.x, now.y - press.mouse.y);
            if !press.dragged && dx.hypot(dy) <= 3.0 {
                return;
            }
            press.dragged = true;
            let Some(edges) = press.resize else {
                window.setFrameOrigin(NSPoint::new(press.origin.x + dx, press.origin.y + dy));
                return;
            };
            let Some(controller) = self.ivars().controller.get() else { return };
            let grid = controller.ivars().grid.get();
            let start = (press.size.width, press.size.height);
            // The resize works with y down; AppKit's screen y grows up.
            let scale = proto::resize_scale(grid, start, edges, dx, -dy);
            let size = proto::window_size(grid, scale);
            let x = if edges.left { press.origin.x + start.0 - size.0 } else { press.origin.x };
            let y = if edges.top { press.origin.y } else { press.origin.y + start.1 - size.1 };
            controller.resize_to(scale, x, y);
        }

        #[unsafe(method(mouseUp:))]
        fn mouse_up(&self, event: &NSEvent) {
            let Some(press) = self.ivars().press.borrow_mut().take() else { return };
            let Some(window) = self.window() else { return };
            let o = window.frame().origin;
            if press.dragged && press.resize.is_some() {
                proto::emit_resized(self.ivars().scale.get(), o.x, o.y);
                return;
            }
            if press.dragged {
                proto::emit_moved(o.x, o.y);
                return;
            }
            let at = self.convertPoint_fromView(event.locationInWindow(), None);
            let size = self.bounds().size;
            match proto::hit((size.width, size.height), at.x, at.y) {
                proto::Hit::Close => proto::emit_pick("visible", "false"),
                proto::Hit::Gear => {
                    let Some(controller) = self.ivars().controller.get() else { return };
                    let gear = proto::gear_button(self.bounds().size.width);
                    let below = NSPoint::new(gear.x, gear.y + gear.h + 2.0);
                    controller.menu().popUpMenuPositioningItem_atLocation_inView(None, below, Some(self));
                }
                proto::Hit::Edge(_) | proto::Hit::Body => {}
            }
        }

        #[unsafe(method(rightMouseDown:))]
        fn right_mouse_down(&self, event: &NSEvent) {
            let Some(controller) = self.ivars().controller.get() else { return };
            let menu = controller.menu();
            NSMenu::popUpContextMenu_withEvent_forView(&menu, event, self);
        }
    }
);

impl Controller {
    fn new(mtm: MainThreadMarker, inbox: Arc<Inbox>) -> Retained<Self> {
        let ivars = Ivars {
            inbox,
            panel: OnceCell::new(),
            sky: OnceCell::new(),
            banner: OnceCell::new(),
            config: RefCell::new(Config::default()),
            grid: Cell::new((0, 0)),
        };
        let this = Self::alloc(mtm).set_ivars(ivars);
        unsafe { msg_send![super(this), init] }
    }

    fn start(&self) {
        let mtm = self.mtm();
        let panel = make_panel(mtm);
        let sky = Sky::alloc(mtm).set_ivars(SkyIvars::default());
        let sky: Retained<Sky> = unsafe { msg_send![super(sky), initWithFrame: rect(0.0, 0.0, 10.0, 10.0)] };
        let _ = sky.ivars().controller.set(self.retain());
        panel.setContentView(Some(&sky));
        let banner = NSTextField::labelWithString(&NSString::from_str(""), mtm);
        banner.setHidden(true);
        sky.addSubview(&banner);
        let _ = (self.ivars().panel.set(panel), self.ivars().sky.set(sky), self.ivars().banner.set(banner));
        unsafe {
            NSTimer::scheduledTimerWithTimeInterval_target_selector_userInfo_repeats(TICK, self, sel!(tick:), None, true);
        }
    }

    fn apply(&self, msg: Msg) {
        let ivars = self.ivars();
        let (Some(panel), Some(sky)) = (ivars.panel.get(), ivars.sky.get()) else { return };
        match msg {
            Msg::Frame(frame) => {
                let resized = ivars.grid.replace((frame.w, frame.h)) != (frame.w, frame.h);
                *sky.ivars().runs.borrow_mut() = proto::runs(&frame);
                if resized {
                    self.layout();
                }
                sky.setNeedsDisplay(true);
            }
            Msg::Config(config) => {
                panel.setAlphaValue(config.opacity);
                let visible = config.visible;
                *ivars.config.borrow_mut() = config;
                self.layout();
                if visible {
                    panel.orderFrontRegardless();
                } else {
                    panel.orderOut(None);
                }
            }
            Msg::Banner(banner) => self.banner(banner),
        }
    }

    /// The window's size is the grid × scale; a preset puts it on the main screen, a drag where it was left (kept on
    /// that screen).
    fn layout(&self) {
        let ivars = self.ivars();
        let (Some(panel), Some(sky)) = (ivars.panel.get(), ivars.sky.get()) else { return };
        let (w, h) = ivars.grid.get();
        if w == 0 {
            return;
        }
        let config = ivars.config.borrow();
        let s = config.scale.max(1.0);
        sky.ivars().scale.set(s);
        let size = proto::window_size((w, h), s);
        let Some(screen) = NSScreen::mainScreen(self.mtm()) else { return };
        let vf = screen.visibleFrame();
        let (x, y) = match proto::dragged(&config.position) {
            Some((x, y)) => (
                x.clamp(vf.origin.x, vf.origin.x + vf.size.width - size.0),
                y.clamp(vf.origin.y, vf.origin.y + vf.size.height - size.1),
            ),
            None => {
                // Presets are worked out with the origin at the top left, then flipped to AppKit's bottom left.
                let area = proto::Rect { x: vf.origin.x, y: 0.0, w: vf.size.width, h: vf.size.height };
                let (x, top) = proto::preset_origin(&config.position, size, area).unwrap_or((vf.origin.x, 0.0));
                (x, vf.origin.y + vf.size.height - top - size.1)
            }
        };
        panel.setFrame_display(rect(x, y, size.0, size.1), true);
        drop(config);
        self.place_banner();
    }

    /// A resize in progress: the new zoom and origin, kept as if they were the settings until Node's next config.
    fn resize_to(&self, scale: f64, x: f64, y: f64) {
        {
            let mut config = self.ivars().config.borrow_mut();
            config.scale = scale;
            config.position = format!("{},{}", x.round(), y.round());
        }
        self.layout();
        if let Some(sky) = self.ivars().sky.get() {
            sky.setNeedsDisplay(true);
        }
    }

    fn banner(&self, banner: Option<(String, u32)>) {
        let Some(label) = self.ivars().banner.get() else { return };
        match banner {
            Some((text, rgb)) => {
                label.setStringValue(&NSString::from_str(&text));
                label.setTextColor(Some(&colour(rgb)));
                label.setHidden(false);
                self.place_banner();
            }
            None => label.setHidden(true),
        }
    }

    fn place_banner(&self) {
        let ivars = self.ivars();
        let (Some(label), Some(sky)) = (ivars.banner.get(), ivars.sky.get()) else { return };
        let s = ivars.config.borrow().scale.max(1.0);
        label.setFont(Some(&NSFont::monospacedSystemFontOfSize_weight((3.6 * s).max(9.0), unsafe {
            NSFontWeightSemibold
        })));
        label.sizeToFit();
        let width = sky.bounds().size.width;
        let size = label.frame().size;
        label.setFrameOrigin(NSPoint::new(((width - size.width) / 2.0).max(2.0), proto::PAD + 1.0));
    }

    fn menu(&self) -> Retained<NSMenu> {
        let mtm = self.mtm();
        let config = self.ivars().config.borrow();
        let menu = NSMenu::new(mtm);
        for sub in proto::menu(&config) {
            let chosen = proto::current(&config, sub.key);
            let submenu = NSMenu::new(mtm);
            for (label, value) in &sub.options {
                let item = self.item(label, &format!("{}\t{value}", sub.key));
                item.setState(if *value == chosen { NSControlStateValueOn } else { NSControlStateValueOff });
                submenu.addItem(&item);
            }
            let parent = NSMenuItem::new(mtm);
            parent.setTitle(&NSString::from_str(sub.title));
            parent.setSubmenu(Some(&submenu));
            menu.addItem(&parent);
        }
        menu.addItem(&NSMenuItem::separatorItem(mtm));
        menu.addItem(&self.item("Hide skyline", "visible\tfalse"));
        menu
    }

    fn item(&self, title: &str, represented: &str) -> Retained<NSMenuItem> {
        let item = unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                NSMenuItem::alloc(self.mtm()),
                &NSString::from_str(title),
                Some(sel!(pick:)),
                &NSString::from_str(""),
            )
        };
        unsafe {
            item.setTarget(Some(self));
            item.setRepresentedObject(Some(&*NSString::from_str(represented) as &AnyObject));
        }
        item
    }
}

fn make_panel(mtm: MainThreadMarker) -> Retained<NSPanel> {
    let style = NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel;
    let panel: Retained<NSPanel> = unsafe {
        msg_send![
            NSPanel::alloc(mtm),
            initWithContentRect: rect(0.0, 0.0, 10.0, 10.0),
            styleMask: style,
            backing: NSBackingStoreType::Buffered,
            defer: false
        ]
    };
    unsafe { panel.setReleasedWhenClosed(false) };
    panel.setFloatingPanel(true);
    panel.setBecomesKeyOnlyIfNeeded(true);
    panel.setHidesOnDeactivate(false);
    panel.setAnimationBehavior(NSWindowAnimationBehavior::None);
    panel.setLevel(NSStatusWindowLevel + 1);
    panel.setOpaque(false);
    panel.setBackgroundColor(Some(&NSColor::clearColor()));
    panel.setHasShadow(false);
    panel.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    panel
}

fn colour(rgb: u32) -> Retained<NSColor> {
    let part = |shift: u32| f64::from((rgb >> shift) & 0xff) / 255.0;
    NSColor::colorWithSRGBRed_green_blue_alpha(part(16), part(8), part(0), 1.0)
}

fn rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
}

/// A pixel count as a length.
fn px(n: usize) -> f64 {
    f64::from(u32::try_from(n).unwrap_or(u32::MAX))
}

/// Shows the window and runs until stdin closes.
pub(crate) fn run(inbox: Arc<Inbox>) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("the window must start on the main thread")?;
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    let controller = Controller::new(mtm, inbox);
    controller.start();
    app.run();
    Ok(())
}
