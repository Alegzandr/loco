//! Port of `server/hub/bottiming_internal_test.go`.

use crate::ops::config::{BotTimings, HubConfig};
use std::collections::HashMap;
use std::time::Duration;

fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> String + use<> {
    let m: HashMap<String, String> = pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    move |k| m.get(k).cloned().unwrap_or_default()
}

// The bot think delay is dead time in CI: 1.2–2.2 s per bot turn, paid by
// every E2E test that lets a bot play. It is the one bot timing that can be
// shortened without changing what a test proves, because nothing races it.
//
// The override is gated on LOCO_E2E for the same reason debug_set_state is: a
// production server must not be able to grow instant bots through a stray
// environment variable.
//
// Go's `botTimingOverride(getenv, defThink, defJitter)` is
// `BotTimings::apply_env` over the defaults here.
#[test]
fn bot_timing_override() {
    let def_think = Duration::from_millis(1200);
    let def_jitter = Duration::from_millis(1000);
    let ms = Duration::from_millis;

    struct Case {
        name: &'static str,
        vars: &'static [(&'static str, &'static str)],
        want: Option<(Duration, Duration)>,
    }
    let cases = [
        Case {
            name: "no debug gate is no override",
            vars: &[("LOCO_BOT_THINK_MS", "50"), ("LOCO_BOT_JITTER_MS", "0")],
            want: None,
        },
        Case {
            name: "debug gate alone changes nothing",
            vars: &[("LOCO_E2E", "1")],
            want: None,
        },
        Case {
            name: "both values",
            vars: &[
                ("LOCO_E2E", "1"),
                ("LOCO_BOT_THINK_MS", "150"),
                ("LOCO_BOT_JITTER_MS", "100"),
            ],
            want: Some((ms(150), ms(100))),
        },
        Case {
            name: "think alone keeps the default jitter",
            vars: &[("LOCO_E2E", "1"), ("LOCO_BOT_THINK_MS", "150")],
            want: Some((ms(150), def_jitter)),
        },
        Case {
            name: "jitter alone keeps the default think",
            vars: &[("LOCO_E2E", "1"), ("LOCO_BOT_JITTER_MS", "0")],
            want: Some((def_think, ms(0))),
        },
        // A typo must leave the shipped timing in place rather than silently
        // producing a 0 ms bot, which would rewrite every race in the suite.
        Case {
            name: "garbage is ignored",
            vars: &[("LOCO_E2E", "1"), ("LOCO_BOT_THINK_MS", "fast")],
            want: None,
        },
        Case {
            name: "negative is ignored",
            vars: &[("LOCO_E2E", "1"), ("LOCO_BOT_THINK_MS", "-1")],
            want: None,
        },
        Case {
            name: "a bad value does not void a good one",
            vars: &[
                ("LOCO_E2E", "1"),
                ("LOCO_BOT_THINK_MS", "150"),
                ("LOCO_BOT_JITTER_MS", "soon"),
            ],
            want: Some((ms(150), def_jitter)),
        },
    ];

    for tc in cases {
        let mut b = BotTimings::default();
        assert_eq!(b.think, def_think, "{}: default think", tc.name);
        assert_eq!(b.jitter_max, def_jitter, "{}: default jitter", tc.name);
        let ok = b.apply_env(&env(tc.vars));
        assert_eq!(ok, tc.want.is_some(), "{}: ok", tc.name);
        match tc.want {
            Some((think, jitter)) => {
                assert_eq!(b.think, think, "{}: think", tc.name);
                assert_eq!(b.jitter_max, jitter, "{}: jitter", tc.name);
            }
            // Go returned the defaults' copies untouched with ok=false; here
            // the timings themselves must not have moved.
            None => {
                assert_eq!(b.think, def_think, "{}: think moved", tc.name);
                assert_eq!(b.jitter_max, def_jitter, "{}: jitter moved", tc.name);
            }
        }
    }
}

// ApplyBotTimingEnv is called once at startup, so the only thing worth pinning
// about it is that it writes what the scheduler actually reads and leaves it
// alone when there is nothing to apply.
//
// Adapted: Go wrote package vars from the process environment; here the
// scheduler reads `HubConfig::timings.bots`, which `HubConfig::from_env`
// builds from an injected getenv (the process environment is not mutated: it
// is shared by every test in the binary).
#[test]
fn apply_bot_timing_env() {
    let c = HubConfig::from_env(&env(&[
        ("LOCO_E2E", "1"),
        ("LOCO_BOT_THINK_MS", "80"),
        ("LOCO_BOT_JITTER_MS", "40"),
    ]));
    assert_eq!(
        (c.timings.bots.think, c.timings.bots.jitter_max),
        (Duration::from_millis(80), Duration::from_millis(40)),
        "think/jitter, want 80ms/40ms"
    );

    let c = HubConfig::from_env(&env(&[
        ("LOCO_E2E", ""),
        ("LOCO_BOT_THINK_MS", "80"),
        ("LOCO_BOT_JITTER_MS", "40"),
    ]));
    let d = BotTimings::default();
    assert_eq!(
        (c.timings.bots.think, c.timings.bots.jitter_max),
        (d.think, d.jitter_max),
        "think/jitter without the debug gate, want the defaults"
    );
}
