//! Go's `time.Time` on the wire and in the log, without a date crate.
//!
//! The snapshot carries two instants (`saved_at`, `match_started_at`), and a
//! snapshot written by the Go server has to load here: Go marshals them as
//! RFC 3339 with nanoseconds and the local offset, and the zero time as
//! `0001-01-01T00:00:00Z`. `None` is that zero time.

use serde::{Deserialize, Deserializer, Serializer};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const ZERO: &str = "0001-01-01T00:00:00Z";

/// Days from the civil date to 1970-01-01 (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn split(t: SystemTime) -> (i64, u32) {
    match t.duration_since(UNIX_EPOCH) {
        Ok(d) => (d.as_secs() as i64, d.subsec_nanos()),
        Err(e) => {
            let d = e.duration();
            let secs = -(d.as_secs() as i64);
            if d.subsec_nanos() == 0 {
                (secs, 0)
            } else {
                (secs - 1, 1_000_000_000 - d.subsec_nanos())
            }
        }
    }
}

/// `2006/01/02 15:04:05`, in UTC: what `log.LstdFlags` printed, which is what
/// every operator grep against the Go server's log was written for.
pub fn log_stamp(t: SystemTime) -> String {
    let (secs, _) = split(t);
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    let s = secs.rem_euclid(86_400);
    format!(
        "{y:04}/{m:02}/{d:02} {:02}:{:02}:{:02}",
        s / 3600,
        s % 3600 / 60,
        s % 60
    )
}

/// RFC 3339 with nanoseconds, trailing zeros trimmed, in UTC — Go's
/// `time.RFC3339Nano`, which is what `json.Marshal` writes.
pub fn format_rfc3339(t: SystemTime) -> String {
    let (secs, nanos) = split(t);
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    let s = secs.rem_euclid(86_400);
    let mut out = format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}",
        s / 3600,
        s % 3600 / 60,
        s % 60
    );
    if nanos > 0 {
        let frac = format!("{nanos:09}");
        out.push('.');
        out.push_str(frac.trim_end_matches('0'));
    }
    out.push('Z');
    out
}

/// Parses what Go's `json.Marshal` writes for a `time.Time`, any offset.
pub fn parse_rfc3339(s: &str) -> Option<SystemTime> {
    let (secs, nanos) = parse_unix(s)?;
    let base = if secs >= 0 {
        UNIX_EPOCH.checked_add(Duration::from_secs(secs as u64))?
    } else {
        // checked: some platforms cannot represent year 1 at all.
        UNIX_EPOCH.checked_sub(Duration::from_secs(secs.unsigned_abs()))?
    };
    base.checked_add(Duration::from_nanos(u64::from(nanos)))
}

/// The same, as seconds and nanoseconds from the Unix epoch.
fn parse_unix(s: &str) -> Option<(i64, u32)> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || !matches!(b[10], b'T' | b't') {
        return None;
    }
    let num = |r: std::ops::Range<usize>| -> Option<i64> { s.get(r)?.parse().ok() };
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, se) = (num(11..13)?, num(14..16)?, num(17..19)?);
    if b[13] != b':' || b[16] != b':' || !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
        return None;
    }
    let mut i = 19;
    let mut nanos: u32 = 0;
    if b.get(i) == Some(&b'.') {
        i += 1;
        let start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        let digits = &s[start..i];
        if digits.is_empty() || digits.len() > 9 {
            return None;
        }
        nanos = format!("{digits:0<9}").parse().ok()?;
    }
    let offset = match s.get(i..)? {
        "Z" | "z" => 0,
        tz if tz.len() == 6 && matches!(&tz[..1], "+" | "-") && &tz[3..4] == ":" => {
            let oh: i64 = tz[1..3].parse().ok()?;
            let om: i64 = tz[4..6].parse().ok()?;
            let off = oh * 3600 + om * 60;
            if &tz[..1] == "-" { -off } else { off }
        }
        _ => return None,
    };
    let secs = days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + se - offset;
    Some((secs, nanos))
}

/// Serde for an optional instant written the Go way, the zero time standing
/// for `None`. Use with `#[serde(with = "crate::gotime::opt")]`.
pub mod opt {
    use super::*;

    pub fn serialize<S: Serializer>(t: &Option<SystemTime>, s: S) -> Result<S::Ok, S::Error> {
        match t {
            Some(t) => s.serialize_str(&format_rfc3339(*t)),
            None => s.serialize_str(ZERO),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<SystemTime>, D::Error> {
        let raw = Option::<String>::deserialize(d)?;
        match raw.as_deref() {
            None | Some("") => Ok(None),
            Some(s) => {
                let bad = || serde::de::Error::custom(format!("not a Go time: {s:?}"));
                let (secs, _) = parse_unix(s).ok_or_else(bad)?;
                // Year 1 is Go's zero time, and it means "never". Nothing this
                // server stamps predates 1970, so anything before is that.
                if secs < 0 {
                    Ok(None)
                } else {
                    parse_rfc3339(s).map(Some).ok_or_else(bad)
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_the_go_spelling() {
        let t = UNIX_EPOCH + Duration::new(1_794_000_000, 123_456_700);
        let s = format_rfc3339(t);
        assert_eq!(s, "2026-11-06T21:20:00.1234567Z");
        assert_eq!(parse_rfc3339(&s), Some(t));
    }

    #[test]
    fn trailing_zeros_are_trimmed_like_rfc3339nano() {
        let t = UNIX_EPOCH + Duration::new(0, 500_000_000);
        assert_eq!(format_rfc3339(t), "1970-01-01T00:00:00.5Z");
        assert_eq!(format_rfc3339(UNIX_EPOCH), "1970-01-01T00:00:00Z");
    }

    // A Go server in a container with a TZ writes its own offset.
    #[test]
    fn reads_an_offset_written_by_go() {
        let utc = parse_rfc3339("2026-11-10T14:00:00Z").unwrap();
        assert_eq!(parse_rfc3339("2026-11-10T15:00:00+01:00"), Some(utc));
        assert_eq!(parse_rfc3339("2026-11-10T09:30:00-04:30"), Some(utc));
        assert_eq!(
            parse_rfc3339("2026-11-10T15:00:00.000000001+01:00"),
            Some(utc + Duration::from_nanos(1))
        );
    }

    #[test]
    fn refuses_what_is_not_a_time() {
        for s in [
            "",
            "soon",
            "2026-13-01T00:00:00Z",
            "2026-11-10 14:00:00Z",
            "2026-11-10T14:00:00",
        ] {
            assert_eq!(parse_rfc3339(s), None, "{s:?}");
        }
    }

    #[test]
    fn the_zero_time_is_none_both_ways() {
        #[derive(serde::Serialize, serde::Deserialize, PartialEq, Debug)]
        struct W {
            #[serde(with = "opt")]
            at: Option<SystemTime>,
        }
        let json = serde_json::to_string(&W { at: None }).unwrap();
        assert_eq!(json, r#"{"at":"0001-01-01T00:00:00Z"}"#);
        assert_eq!(serde_json::from_str::<W>(&json).unwrap(), W { at: None });
    }

    #[test]
    fn the_log_stamp_is_log_lstdflags() {
        let t = parse_rfc3339("2026-11-10T07:04:05Z").unwrap();
        assert_eq!(log_stamp(t), "2026/11/10 07:04:05");
    }
}
