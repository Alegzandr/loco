//! protocolgen turns `loco-protocol` into the client's TypeScript protocol.
//!
//! The wire used to be described three times (server types, a hand-written
//! TypeScript file and hand-written validation schemas) and nothing checked
//! that they agreed. The failure is silent: a field renamed on one side and
//! the client keeps compiling while dropping a value it can no longer read.
//! This writes the two client files from the Rust types instead:
//!
//! - `protocol.ts`, the types, by `ts-rs` (`loco_protocol::generate::typescript`);
//! - `protocolSchemas.ts`, the Valibot validators, from the JSON Schema
//!   `schemars` derives for `ServerMsg`, converted by
//!   `tools/protocol/valibot.mjs`. The converter refuses any construction it
//!   cannot write honestly, and so this program fails rather than emit it.
//!
//! `--check` writes nothing and fails if either file on disk differs from what
//! would be written, ignoring CRLF against LF: a Windows checkout must not be a
//! CI failure nobody can reproduce.

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};

struct Args {
    out: PathBuf,
    converter: PathBuf,
    node: String,
    check: bool,
}

fn repo_root() -> PathBuf {
    // crates/protocolgen -> crates -> server-rs -> the repository.
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn parse_args() -> Result<Args, String> {
    let root = repo_root();
    let mut args = Args {
        out: root.join("client/src/types"),
        converter: root.join("tools/protocol/valibot.mjs"),
        node: "node".to_owned(),
        check: false,
    };
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--check" | "-check" => args.check = true,
            "--out" => args.out = it.next().ok_or("--out needs a directory")?.into(),
            "--converter" => {
                args.converter = it.next().ok_or("--converter needs a path")?.into();
            }
            "--node" => args.node = it.next().ok_or("--node needs a program")?,
            other => return Err(format!("unknown argument {other:?}")),
        }
    }
    Ok(args)
}

/// Runs the converter with the schema on stdin and returns what it printed.
fn convert(args: &Args, schema: &str) -> Result<String, String> {
    let mut child = Command::new(&args.node)
        .arg(&args.converter)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot run {} {}: {e}", args.node, args.converter.display()))?;
    child
        .stdin
        .take()
        .ok_or("no stdin")?
        .write_all(schema.as_bytes())
        .map_err(|e| format!("writing the schema to the converter: {e}"))?;
    let out = child
        .wait_with_output()
        .map_err(|e| format!("waiting for the converter: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "the converter refused the schema:\n{}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    String::from_utf8(out.stdout).map_err(|e| format!("the converter wrote non-UTF-8: {e}"))
}

/// Lays the declarations out the way the client's own code is written: two
/// spaces, single quotes, no semicolons. `ts-rs` writes each declaration on
/// one line, and a thirty-six-way union on one line is not reviewable.
fn format_ts(text: String) -> Result<String, String> {
    use dprint_plugin_typescript::configuration::{
        ConfigurationBuilder, QuoteProps, QuoteStyle, SemiColons, TrailingCommas,
    };
    use dprint_plugin_typescript::{FormatTextOptions, format_text};

    let config = ConfigurationBuilder::new()
        .indent_width(2)
        .line_width(100)
        .quote_style(QuoteStyle::AlwaysSingle)
        .quote_props(QuoteProps::AsNeeded)
        .semi_colons(SemiColons::Asi)
        .trailing_commas(TrailingCommas::OnlyMultiLine)
        .build();
    let formatted = format_text(FormatTextOptions {
        path: Path::new("protocol.ts"),
        extension: None,
        text: text.clone(),
        config: &config,
        external_formatter: None,
    })
    .map_err(|e| format!("formatting protocol.ts: {e}"))?;
    Ok(formatted.unwrap_or(text))
}

fn normalise(s: &str) -> String {
    s.replace("\r\n", "\n")
}

fn run() -> Result<(), String> {
    let args = parse_args()?;
    let types = format_ts(loco_protocol::generate::typescript())?;
    let schema = serde_json::to_string_pretty(&loco_protocol::generate::server_schema())
        .map_err(|e| e.to_string())?;
    let schemas = convert(&args, &schema)?;

    let mut stale = Vec::new();
    for (name, want) in [("protocol.ts", &types), ("protocolSchemas.ts", &schemas)] {
        let path = args.out.join(name);
        if args.check {
            let got =
                std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
            if normalise(&got) != normalise(want) {
                stale.push(path.display().to_string());
            }
            continue;
        }
        std::fs::write(&path, want).map_err(|e| format!("{}: {e}", path.display()))?;
        eprintln!("wrote {}", path.display());
    }
    if !stale.is_empty() {
        return Err(format!(
            "out of date, run `make protocol`: {}",
            stale.join(", ")
        ));
    }
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("protocolgen: {e}");
            ExitCode::FAILURE
        }
    }
}
