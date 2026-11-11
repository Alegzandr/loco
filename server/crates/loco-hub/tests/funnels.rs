//! Two rules that are about where code is, not what it does on one path, so
//! they are checked on the source: a new call site is exactly how either one
//! gets broken, and no single behaviour test would see it.

use std::path::Path;

/// Every `.rs` file of the crate's own source, at any depth, tests excluded,
/// named by its path under `src/` (`table/broadcast.rs`).
fn sources() -> Vec<(String, String)> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, String)>) {
        for entry in std::fs::read_dir(dir).expect("read src") {
            let path = entry.expect("entry").path();
            if path.is_dir() {
                if path.file_name().is_some_and(|n| n != "internal_tests") {
                    walk(root, &path, out);
                }
            } else if path.extension().is_some_and(|e| e == "rs") {
                let name = path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                let src = std::fs::read_to_string(&path)
                    .expect("read")
                    .replace("\r\n", "\n");
                out.push((name, src));
            }
        }
    }
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut out = Vec::new();
    walk(&dir, &dir, &mut out);
    assert!(out.len() > 20, "read only {} files from {dir:?}", out.len());
    out
}

// "Every path that grows a hand goes through send_hand_growth": the cards
// themselves may only ever reach the seat that drew them, so the message that
// carries them is built in one place. A draw, a bot's draw, a penalty, a catch
// and a counter all announce through `announce_cards_drawn`.
#[test]
fn card_drawn_is_built_in_one_place() {
    let builders: Vec<String> = sources()
        .into_iter()
        .filter(|(_, src)| src.contains("CardDrawnMsg {"))
        .map(|(name, _)| name)
        .collect();
    assert_eq!(
        builders,
        vec!["table/broadcast.rs".to_owned()],
        "card_drawn is built outside the funnel"
    );
}

// A post that is refused hands its job back; ignoring that answer is a job
// lost in silence. Every post either handles the refusal or goes through
// `post_from_timer` (a loss that is legal, and logged) or `post_critical`
// (retried once).
#[test]
fn no_post_result_is_thrown_away() {
    for (name, src) in sources() {
        for (i, line) in src.lines().enumerate() {
            let t = line.trim_start();
            assert!(
                !(t.starts_with("let _ =") && t.contains(".post(")),
                "{name}:{}: a post's refusal is discarded: {t}",
                i + 1
            );
        }
        // The same thing written over two lines.
        assert!(
            !src.contains("let _ = handle\n") && !src.contains("let _ = handle.post"),
            "{name}: a post's refusal is discarded"
        );
    }
}
