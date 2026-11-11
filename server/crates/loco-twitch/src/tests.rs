//! The live-streams feature: configuration, Helix, the poller and the preview cache.

use crate::config::*;
use crate::helix::*;
use crate::poller::*;
use crate::thumbs::*;
use crate::*;
use axum::http::StatusCode;
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

// ── a gateway to talk to ────────────────────────────────────────────────────

#[derive(Default)]
struct Gw {
    games: String,
    streams: String,
    thumb: Vec<u8>,
    status: u16,
    retry_aft: String,
    calls: HashMap<String, usize>,
}

#[derive(Clone)]
struct FakeGateway {
    url: String,
    st: Arc<Mutex<Gw>>,
}

impl FakeGateway {
    fn set(&self, f: impl FnOnce(&mut Gw)) {
        f(&mut self.st.lock().unwrap());
    }
    fn count(&self, path: &str) -> usize {
        self.st
            .lock()
            .unwrap()
            .calls
            .get(path)
            .copied()
            .unwrap_or(0)
    }
    fn calls(&self) -> HashMap<String, usize> {
        self.st.lock().unwrap().calls.clone()
    }

    fn env(&self, extra: &[(&str, &str)]) -> impl Fn(&str) -> String + use<> {
        let mut base: HashMap<String, String> = [
            ("JANUS_URL", self.url.as_str()),
            ("JANUS_APPLICATION_ID", "app-1"),
            ("JANUS_API_KEY", "jns_test"),
            ("LOCO_TWITCH_GAME_ID", "1372128809"),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        for (k, v) in extra {
            base.insert(k.to_string(), v.to_string());
        }
        move |k| base.get(k).cloned().unwrap_or_default()
    }
}

async fn new_gateway() -> FakeGateway {
    let st: Arc<Mutex<Gw>> = Arc::default();
    let s = st.clone();
    let app = axum::Router::new().fallback(move |req: axum::extract::Request| {
        let s = s.clone();
        async move {
            let p = req.uri().path().to_owned();
            let mut g = s.lock().unwrap();
            *g.calls.entry(p.clone()).or_default() += 1;
            let b = axum::response::Response::builder();
            if p.ends_with("/games") {
                b.header("Content-Type", "application/json")
                    .body(axum::body::Body::from(g.games.clone()))
                    .unwrap()
            } else if p.ends_with("/streams") {
                let mut b = b.header("Content-Type", "application/json");
                if !g.retry_aft.is_empty() {
                    b = b.header("Retry-After", g.retry_aft.clone());
                }
                if g.status != 0 {
                    return b.status(g.status).body(axum::body::Body::empty()).unwrap();
                }
                b.body(axum::body::Body::from(g.streams.clone())).unwrap()
            } else {
                // The CDN. Deliberately wrong: ours is written from the bytes.
                b.header("Content-Type", "text/plain")
                    .body(axum::body::Body::from(g.thumb.clone()))
                    .unwrap()
            }
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    FakeGateway { url, st }
}

/// Stands in for the domain's blocked-term check without importing it: this
/// crate must stay independent of the domain.
fn screen_fuck() -> Option<Screen> {
    Some(Box::new(|s: &str| s.to_lowercase().contains("fuck")))
}

fn new_test_poller(g: &FakeGateway, extra: &[(&str, &str)]) -> (Arc<Poller>, PollState) {
    let p = Poller::new(&g.env(extra), screen_fuck())
        .expect("NewPoller reported the feature off with a full environment");
    let st = PollState {
        game_id: "1372128809".into(),
        ..Default::default()
    };
    (p, st)
}

fn streams_json(rows: &[String]) -> String {
    format!(r#"{{"data":[{}],"pagination":{{}}}}"#, rows.join(","))
}

fn row(login: &str, name: &str, viewers: i64) -> String {
    serde_json::json!({
        "user_login": login,
        "user_name": name,
        "viewer_count": viewers,
        "language": "fr",
        "thumbnail_url": format!("https://{THUMB_HOST}/previews-ttv/live_user_{login}-{{width}}x{{height}}.jpg"),
    })
    .to_string()
}

fn jpeg() -> Vec<u8> {
    let mut v = vec![0xFF, 0xD8, 0xFF];
    v.extend(std::iter::repeat_n(0u8, 64));
    v
}

fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> String + use<> {
    let m: HashMap<String, String> = pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    move |k| m.get(k).cloned().unwrap_or_default()
}

type Published = RefCell<Vec<Vec<LiveStream>>>;
fn recorder(p: &Published) -> impl Fn(Vec<LiveStream>) + '_ {
    move |rows| p.borrow_mut().push(rows)
}
fn ignore(_: Vec<LiveStream>) {}

// ── configuration ───────────────────────────────────────────────────────────

#[test]
fn config_from_env_no_gateway_key_is_off_and_off_is_the_default() {
    assert!(config_from_env(&|_| String::new()).is_none());
}

#[test]
fn config_from_env_a_key_with_no_url_is_a_typo_not_an_intention() {
    assert!(config_from_env(&env_of(&[("JANUS_API_KEY", "jns_x")])).is_none());
}

#[test]
fn config_from_env_defaults() {
    let cfg = config_from_env(&env_of(&[
        ("JANUS_API_KEY", "k"),
        ("JANUS_URL", "u"),
        ("JANUS_APPLICATION_ID", "a"),
    ]))
    .expect("a full environment did not switch it on");
    assert_eq!(cfg.helix_slug, DEFAULT_HELIX_SLUG);
    assert_eq!(cfg.game_name, DEFAULT_GAME_NAME);
    // Previews are off until the CDN is registered in Janus, and that is a
    // state this ships in rather than an error.
    assert_eq!(cfg.cdn_slug, "");
    assert_eq!(cfg.poll, LIVE_POLL_PERIOD);
}

#[test]
fn config_from_env_a_malformed_poll_period_keeps_the_shipped_one() {
    let cfg = config_from_env(&env_of(&[
        ("JANUS_API_KEY", "k"),
        ("JANUS_URL", "u"),
        ("JANUS_APPLICATION_ID", "a"),
        ("LOCO_TWITCH_POLL", "soon"),
    ]))
    .unwrap();
    assert_eq!(
        cfg.poll, LIVE_POLL_PERIOD,
        "a typo turned the poll period into something else"
    );
    assert_eq!(poll_period("90s"), Duration::from_secs(90));
    assert_eq!(
        poll_period("500ms"),
        LIVE_POLL_PERIOD,
        "under a second is a spin"
    );
}

#[test]
fn parse_duration_reads_what_an_env_file_carries() {
    assert_eq!(parse_duration("90s"), Some(Duration::from_secs(90)));
    assert_eq!(parse_duration("1m30s"), Some(Duration::from_secs(90)));
    assert_eq!(parse_duration("1.5h"), Some(Duration::from_secs(5400)));
    assert_eq!(parse_duration("250ms"), Some(Duration::from_millis(250)));
    assert_eq!(parse_duration("-5m"), None);
    assert_eq!(parse_duration("soon"), None);
    assert_eq!(parse_duration("120"), None, "a bare number needs a unit");
}

// The failure mode that matters most in this whole crate: /streams with no
// game_id is a request for every live channel on Twitch. An unresolvable
// category switches the feature off; it never widens the query.
#[tokio::test]
async fn no_game_id_switches_it_off_rather_than_widening_the_query() {
    let g = new_gateway().await;
    g.set(|g| g.games = r#"{"data":[]}"#.into());
    let p = Poller::new(&g.env(&[("LOCO_TWITCH_GAME_ID", "")]), screen_fuck()).unwrap();

    assert!(
        p.resolve_game_id().await.is_err(),
        "an empty lookup resolved to something"
    );
    // And the guard below it, in case a caller ever skips the resolution.
    assert!(p.fetch_streams("").await.is_err(), "polled with no game id");
    assert_eq!(g.count("/gateway/twitch-helix/streams"), 0);
}

// ── screening ───────────────────────────────────────────────────────────────

fn hs(login: &str, name: &str, viewers: i64) -> HelixStream {
    HelixStream {
        user_login: login.into(),
        user_name: name.into(),
        viewer_count: viewers,
        ..Default::default()
    }
}

#[tokio::test]
async fn screen_drops_what_a_player_must_not_be_shown() {
    let g = new_gateway().await;
    let (p, _) = new_test_poller(&g, &[("LOCO_TWITCH_BLOCKLIST", "quietone, OtherOne")]);

    let input = vec![
        hs("kisuke_", "Kisuke", 1200),
        hs("bad/login", "Sneaky", 900),
        hs("fuckery", "Fuckery", 800),
        hs("unofan", "UNO fan", 700),
        hs("quietone", "Quiet One", 600),
        hs("otherone", "Other One", 500),
        hs("normal2", "Norm\u{202E}l", 400),
    ];
    let (out, dropped) = p.screen(&input);

    assert_eq!(out.len(), 2, "kept the wrong number of rows: {out:?}");
    assert_eq!(out[0].login, "kisuke_");
    assert_eq!(out[1].login, "normal2");
    assert_eq!(dropped, 5);
    // A bidi override is taken out of the name, not made a reason to drop.
    assert!(
        !out[1].name.contains('\u{202E}'),
        "a bidi override survived into {:?}",
        out[1].name
    );
    // Order is Helix's, biggest first, and nothing here re-sorts it.
    assert!(out[0].viewers >= out[1].viewers);
}

#[tokio::test]
async fn screen_keeps_at_most_a_pageful() {
    let g = new_gateway().await;
    let (p, _) = new_test_poller(&g, &[]);
    let input: Vec<HelixStream> = (0..LIVE_PAGE_MAX + 5)
        .map(|i| {
            hs(
                &format!("chan{}", (b'a' + i as u8) as char),
                "C",
                100 - i as i64,
            )
        })
        .collect();
    assert_eq!(p.screen(&input).0.len(), LIVE_PAGE_MAX);
}

// The mark is matched as a word of its own. A channel called Unolingo keeps its
// name.
#[test]
fn mentions_uno_matches_a_word_and_not_a_substring() {
    for s in ["uno", "UNO fan", "team-uno", "uno_king", "play UNO now"] {
        assert!(mentions_uno(s), "mentions_uno({s:?}) = false");
    }
    for s in ["unolingo", "unopar", "kisuke", "junot", ""] {
        assert!(!mentions_uno(s), "mentions_uno({s:?}) = true");
    }
}

#[test]
fn login_ok_is_the_documented_alphabet() {
    assert!(login_ok("kisuke_"));
    assert!(login_ok("A9_z"));
    assert!(!login_ok(""));
    assert!(!login_ok("bad/login"));
    assert!(!login_ok(&"a".repeat(26)));
    assert!(
        !login_ok("٣٣"),
        "a non-ASCII digit is outside the alphabet the link is built from"
    );
}

// ── polling ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn poll_publishes_once_and_then_only_on_change() {
    let g = new_gateway().await;
    g.set(|g| g.streams = streams_json(&[row("kisuke_", "Kisuke", 1200)]));
    let (p, mut st) = new_test_poller(&g, &[]);

    let published = Published::default();
    p.tick(&mut st, &recorder(&published)).await;
    p.tick(&mut st, &recorder(&published)).await;
    assert_eq!(
        published.borrow().len(),
        1,
        "an unchanged list was published twice"
    );

    g.set(|g| g.streams = streams_json(&[row("kisuke_", "Kisuke", 1300)]));
    p.tick(&mut st, &recorder(&published)).await;
    assert_eq!(
        published.borrow().len(),
        2,
        "a changed viewer count was not published"
    );
}

// An outage is an error, and an error leaves the list alone — until it is old
// enough to be wrong, and then it is emptied rather than kept.
#[tokio::test]
async fn a_failing_poll_keeps_the_list_until_it_is_too_old_to_be_true() {
    let g = new_gateway().await;
    g.set(|g| g.streams = streams_json(&[row("kisuke_", "Kisuke", 1200)]));
    let (p, mut st) = new_test_poller(&g, &[]);

    let published = Published::default();
    p.tick(&mut st, &recorder(&published)).await;

    g.set(|g| g.status = 502);
    p.tick(&mut st, &recorder(&published)).await;
    assert_eq!(
        published.borrow().len(),
        1,
        "a failed poll published something"
    );
    assert_eq!(
        p.streams(0).len(),
        1,
        "a failed poll dropped a list that was still fresh"
    );

    // Age the snapshot past the point where it is still true.
    let snap = p.current().unwrap();
    let aged_at = Instant::now()
        .checked_sub(LIVE_MAX_AGE + Duration::from_secs(60))
        .expect("an uptime longer than eleven minutes");
    p.store(Snapshot {
        streams: snap.streams.clone(),
        thumbs: snap.thumbs.clone(),
        at: aged_at,
        updated: snap.updated,
        json_body: snap.json_body.clone(),
    });

    p.tick(&mut st, &recorder(&published)).await;
    let published = published.borrow();
    assert_eq!(published.len(), 2, "a stale list was not emptied");
    assert!(published[1].is_empty(), "a stale list was not emptied");
    assert!(
        p.streams(0).is_empty(),
        "streams still answers with the stale list"
    );
}

// The only pacing this crate does.
#[tokio::test]
async fn a_429_pauses_the_next_ticks_instead() {
    let g = new_gateway().await;
    g.set(|g| {
        g.status = 429;
        g.retry_aft = "60".into();
    });
    let (p, mut st) = new_test_poller(&g, &[]);

    p.tick(&mut st, &ignore).await;
    let before = g.count("/gateway/twitch-helix/streams");
    p.tick(&mut st, &ignore).await;
    assert_eq!(
        g.count("/gateway/twitch-helix/streams"),
        before,
        "the tick after a 429 called anyway"
    );
}

#[tokio::test]
async fn run_resolves_once_then_stops_with_the_context() {
    let g = new_gateway().await;
    g.set(|g| {
        g.games = r#"{"data":[{"id":"42"}]}"#.into();
        g.streams = streams_json(&[]);
    });
    let p = Poller::new(&g.env(&[("LOCO_TWITCH_GAME_ID", "")]), screen_fuck()).unwrap();

    let (tick_tx, tick_rx) = tokio::sync::mpsc::channel(1);
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
    let runner = {
        let p = p.clone();
        tokio::spawn(async move {
            p.run_with_ticks(&|_: Vec<LiveStream>| {}, tick_rx, async {
                let _ = stop_rx.await;
            })
            .await;
        })
    };

    // With one slot, the second send is the one that waits: it returns once the first is taken,
    // which is after the resolution and the first poll.
    tick_tx.send(()).await.unwrap();
    tick_tx.send(()).await.unwrap();
    let _ = stop_tx.send(());
    tokio::time::timeout(Duration::from_secs(2), runner)
        .await
        .expect("run did not return when it was told to stop")
        .unwrap();
    assert_eq!(
        g.count("/gateway/twitch-helix/games"),
        1,
        "the game id was not resolved exactly once"
    );
}

// ── previews ────────────────────────────────────────────────────────────────

// The host is checked rather than followed.
#[test]
fn thumb_path_refuses_any_other_host() {
    let ok = format!("https://{THUMB_HOST}/previews-ttv/live_user_x-{{width}}x{{height}}.jpg");
    let p = thumb_path(&ok).unwrap_or_else(|| panic!("thumb_path({ok:?}) was refused"));
    assert!(p.contains("440x248"), "{p}");
    for bad in [
        "https://evil.example/previews-ttv/x.jpg".to_owned(),
        format!("http://{THUMB_HOST}/x.jpg"),
        "not a url at all".to_owned(),
        format!("https://{THUMB_HOST}.evil.example/x.jpg"),
    ] {
        assert!(
            thumb_path(&bad).is_none(),
            "thumb_path({bad:?}) was accepted"
        );
    }
}

fn header<'a>(r: &'a axum::response::Response, n: &str) -> &'a str {
    r.headers()
        .get(n)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
}

#[tokio::test]
async fn previews_are_fetched_screened_and_served_from_memory() {
    let g = new_gateway().await;
    g.set(|g| {
        g.streams = streams_json(&[row("kisuke_", "Kisuke", 1200)]);
        g.thumb = jpeg();
    });
    let (p, mut st) = new_test_poller(&g, &[("LOCO_TWITCH_CDN_SLUG", "twitch-cdn")]);
    p.tick(&mut st, &ignore).await;

    let rows = p.streams(0);
    assert!(
        rows.len() == 1 && rows[0].thumb.starts_with(THUMB_PREFIX),
        "row = {rows:?}"
    );

    let rec = serve_thumb(Some(&p), &rows[0].thumb, None);
    assert_eq!(rec.status(), StatusCode::OK);
    // Ours, from the magic bytes. The gateway said text/plain.
    assert_eq!(header(&rec, "Content-Type"), "image/jpeg");
    let etag = header(&rec, "ETag").to_owned();
    assert!(!etag.is_empty(), "no ETag");

    let rec2 = serve_thumb(Some(&p), &rows[0].thumb, Some(&etag));
    assert_eq!(rec2.status(), StatusCode::NOT_MODIFIED);
}

#[tokio::test]
async fn serve_thumb_answers_404_to_anything_not_in_the_snapshot() {
    let g = new_gateway().await;
    g.set(|g| {
        g.streams = streams_json(&[row("kisuke_", "Kisuke", 1200)]);
        g.thumb = jpeg();
    });
    let (p, mut st) = new_test_poller(&g, &[("LOCO_TWITCH_CDN_SLUG", "twitch-cdn")]);
    p.tick(&mut st, &ignore).await;

    for path in [
        format!("{THUMB_PREFIX}deadbeefdeadbeef"),
        THUMB_PREFIX.to_owned(),
        format!("{THUMB_PREFIX}a/b"),
    ] {
        assert_eq!(
            serve_thumb(Some(&p), &path, None).status(),
            StatusCode::NOT_FOUND,
            "{path}"
        );
    }
}

#[tokio::test]
async fn a_preview_that_is_too_big_leaves_the_row_without_one() {
    let g = new_gateway().await;
    let mut big = jpeg();
    big.extend(std::iter::repeat_n(0u8, MAX_THUMB_BYTES));
    g.set(|g| {
        g.streams = streams_json(&[row("kisuke_", "Kisuke", 1200)]);
        g.thumb = big;
    });
    let (p, mut st) = new_test_poller(&g, &[("LOCO_TWITCH_CDN_SLUG", "twitch-cdn")]);
    p.tick(&mut st, &ignore).await;
    let rows = p.streams(0);
    assert!(
        rows.len() == 1 && rows[0].thumb.is_empty(),
        "row = {rows:?}"
    );
}

#[tokio::test]
async fn a_preview_that_is_not_an_image_leaves_the_row_without_one() {
    let g = new_gateway().await;
    g.set(|g| {
        g.streams = streams_json(&[row("kisuke_", "Kisuke", 1200)]);
        g.thumb = b"<html>nope</html>".to_vec();
    });
    let (p, mut st) = new_test_poller(&g, &[("LOCO_TWITCH_CDN_SLUG", "twitch-cdn")]);
    p.tick(&mut st, &ignore).await;
    let rows = p.streams(0);
    assert!(
        rows.len() == 1 && rows[0].thumb.is_empty(),
        "row = {rows:?}"
    );
}

// Without a registered CDN the rows are listed without pictures, and nothing
// about that path is a special case anywhere else.
#[tokio::test]
async fn no_cdn_slug_means_rows_without_pictures() {
    let g = new_gateway().await;
    g.set(|g| g.streams = streams_json(&[row("kisuke_", "Kisuke", 1200)]));
    let (p, mut st) = new_test_poller(&g, &[]);
    p.tick(&mut st, &ignore).await;

    let rows = p.streams(0);
    assert!(
        rows.len() == 1 && rows[0].thumb.is_empty(),
        "row = {rows:?}"
    );
    for (path, n) in g.calls() {
        assert!(
            !(path.contains("previews") && n > 0),
            "fetched a preview with no CDN slug: {path}"
        );
    }
}

// ── the page's surface ──────────────────────────────────────────────────────

async fn body_json(r: axum::response::Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(r.into_body(), 1 << 20).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn serve_json_answers_before_the_first_poll() {
    let g = new_gateway().await;
    let (p, _) = new_test_poller(&g, &[]);
    let rec = serve_json(Some(&p));
    assert_eq!(rec.status(), StatusCode::OK);
    let v = body_json(rec).await;
    // The page reads a list, and an empty one is a list.
    assert!(
        v["streams"].is_array(),
        "streams came back {:?}",
        v["streams"]
    );
    assert!(v["updated"].is_i64());
}

#[tokio::test]
async fn streams_caps_for_the_wire() {
    let g = new_gateway().await;
    let rows: Vec<String> = (0..8)
        .map(|i| row(&format!("chan{}", (b'a' + i) as char), "C", 100 - i as i64))
        .collect();
    g.set(|g| g.streams = streams_json(&rows));
    let (p, mut st) = new_test_poller(&g, &[]);
    p.tick(&mut st, &ignore).await;

    assert_eq!(p.streams(6).len(), 6);
    assert_eq!(p.streams(0).len(), 8, "streams(0) must return everything");
}

// A server with no gateway key registers /live.json all the same, so that it
// answers "nobody is live" rather than "no such resource".
#[tokio::test]
async fn a_missing_poller_still_answers() {
    let rec = serve_json(None);
    assert_eq!(rec.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(rec.into_body(), 1 << 20)
        .await
        .unwrap();
    let body = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(body.contains(r#""streams":[]"#), "body = {body}");

    let rec = serve_thumb(None, &format!("{THUMB_PREFIX}abc"), None);
    assert_eq!(rec.status(), StatusCode::NOT_FOUND);
}

#[test]
fn the_wire_shape_omits_empty_lang_and_thumb() {
    let row = LiveStream {
        login: "k".into(),
        name: "K".into(),
        lang: String::new(),
        viewers: 0,
        thumb: String::new(),
    };
    // No omitempty on viewers: zero is a live channel. lang and thumb drop out
    // when empty.
    assert_eq!(
        serde_json::to_string(&row).unwrap(),
        r#"{"login":"k","name":"K","viewers":0}"#
    );
}
