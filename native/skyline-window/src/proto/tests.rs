use super::*;

#[test]
fn parses_a_frame_and_rejects_a_short_one() {
    // 2×1: one opaque red pixel, one see-through.
    let line = r#"{"frame":{"w":2,"h":1,"rgba":"/wAA/wAAAAA="}}"#;
    assert_eq!(parse(line), Some(Msg::Frame(Frame { w: 2, h: 1, rgba: vec![255, 0, 0, 255, 0, 0, 0, 0] })));
    assert_eq!(parse(r#"{"frame":{"w":3,"h":1,"rgba":"/wAA/wAAAAA="}}"#), None);
    assert_eq!(parse("not json"), None);
}

#[test]
fn parses_config_with_defaults_and_banners() {
    let Some(Msg::Config(c)) = parse(r#"{"config":{"scale":2,"position":"top-left","colors":["fg","cyan"]}}"#) else {
        panic!("config")
    };
    assert_eq!((c.scale, c.position.as_str(), c.opacity, c.visible), (2.0, "top-left", 0.85, true));
    assert_eq!(parse(r##"{"banner":{"text":"Meteor","color":"#ff8a7a"}}"##), Some(Msg::Banner(Some(("Meteor".into(), 0xff8a7a)))));
    assert_eq!(parse(r#"{"banner":{}}"#), Some(Msg::Banner(None)));
}

#[test]
fn base64_round_trips_every_padding() {
    assert_eq!(base64("TWFu"), Some(b"Man".to_vec()));
    assert_eq!(base64("TWE="), Some(b"Ma".to_vec()));
    assert_eq!(base64("TQ=="), Some(b"M".to_vec()));
    assert_eq!(base64("T!=="), None);
}

#[test]
fn runs_merge_one_colour_and_skip_see_through_pixels() {
    let px = |r, a| [r, 0, 0, a];
    let rgba: Vec<u8> = [px(9, 255), px(9, 255), px(0, 0), px(9, 255), px(7, 255)].concat();
    let frame = Frame { w: 5, h: 1, rgba };
    assert_eq!(
        runs(&frame),
        vec![
            Run { x: 0, y: 0, len: 2, rgb: 0x09_0000 },
            Run { x: 3, y: 0, len: 1, rgb: 0x09_0000 },
            Run { x: 4, y: 0, len: 1, rgb: 0x07_0000 },
        ]
    );
}

#[test]
fn presets_sit_inside_the_area_and_drags_parse() {
    let area = Rect { x: 0.0, y: 25.0, w: 1000.0, h: 600.0 };
    assert_eq!(preset_origin("top-left", (100.0, 50.0), area), Some((12.0, 37.0)));
    assert_eq!(preset_origin("bottom-right", (100.0, 50.0), area), Some((888.0, 563.0)));
    assert_eq!(preset_origin("top-center", (100.0, 50.0), area), Some((450.0, 37.0)));
    assert_eq!(preset_origin("120,40", (100.0, 50.0), area), None);
    assert_eq!(dragged("120,-40"), Some((120.0, -40.0)));
    assert_eq!(dragged("bottom-right"), None);
}

#[test]
fn the_frame_wraps_the_pixels_and_its_buttons_sit_top_right() {
    assert_eq!(window_size((120, 36), 3.0), (372.0, 120.0));
    let close = close_button(372.0);
    assert_eq!((close.x, close.y), (352.0, 6.0));
    let size = (372.0, 120.0);
    assert_eq!(hit(size, 358.0, 12.0), Hit::Close);
    assert_eq!(hit(size, gear_button(372.0).x + 1.0, 12.0), Hit::Gear);
    assert_eq!(hit(size, 100.0, 60.0), Hit::Body);
    let gear = gear_button(372.0);
    let outline = gear_outline(gear);
    assert_eq!(outline.len(), 32);
    assert!(outline.iter().all(|&(x, y)| gear.contains(x, y)), "the gear stays inside its button");
}

#[test]
fn the_menu_marks_what_is_chosen() {
    let config = Config { opacity: 1.0, color: "cyan".into(), colors: vec!["fg".into(), "cyan".into()], ..Config::default() };
    let menu = menu(&config);
    assert_eq!(menu.iter().map(|m| m.key).collect::<Vec<_>>(), ["position", "size", "opacity", "color"]);
    assert_eq!(menu[3].options, vec![("Terminal text".into(), "fg".into()), ("Cyan".into(), "cyan".into())]);
    assert_eq!(current(&config, "opacity"), "1");
    assert_eq!(current(&Config::default(), "opacity"), "0.85");
    assert!(menu[2].options.iter().any(|(_, v)| *v == current(&Config::default(), "opacity")));
}

#[test]
fn the_edge_resizes_and_the_buttons_win_over_it() {
    let size = (372.0, 120.0);
    assert_eq!(hit(size, 1.0, 60.0), Hit::Edge(Edges { left: true, ..Edges::default() }));
    assert_eq!(hit(size, 370.0, 118.0), Hit::Edge(Edges { right: true, bottom: true, ..Edges::default() }));
    assert_eq!(hit(size, 100.0, 2.0), Hit::Edge(Edges { top: true, ..Edges::default() }));
    assert_eq!(hit(size, 360.0, 8.0), Hit::Close, "the buttons sit just inside the grip");
}

#[test]
fn a_resize_zooms_keeping_the_shape_and_the_far_edges() {
    let grid = (120, 36);
    let start = window_size(grid, 3.0);
    let right = Edges { right: true, ..Edges::default() };
    assert_eq!(resize_scale(grid, start, right, 120.0, 0.0), 4.0);
    let left = Edges { left: true, ..Edges::default() };
    assert_eq!(resize_scale(grid, start, left, 120.0, 0.0), 2.0, "dragging the left edge right shrinks");
    let corner = Edges { right: true, bottom: true, ..Edges::default() };
    assert_eq!(resize_scale(grid, start, corner, 0.0, 36.0), 4.0, "a corner follows the bigger change");
    assert_eq!(resize_scale(grid, start, right, -10_000.0, 0.0), MIN_SCALE);
    assert_eq!(resize_scale(grid, start, right, 10_000.0, 0.0), MAX_SCALE);
    let size = window_size(grid, 2.0);
    assert_eq!(resize_origin((100.0, 50.0), start, size, left), (100.0 + start.0 - size.0, 50.0));
    let top_left = Edges { left: true, top: true, ..Edges::default() };
    assert_eq!(resize_origin((100.0, 50.0), start, size, top_left), (100.0 + start.0 - size.0, 50.0 + start.1 - size.1));
    assert_eq!(resize_origin((100.0, 50.0), start, size, right), (100.0, 50.0));
}
