#!/usr/bin/env node
// Picks the protocol parity fixtures out of a capture of real frames.
//
//   node tools/protocol/sample-frames.mjs <capture.jsonl> > fixture.jsonl
//
// A capture is one JSON frame per line, as a server wrote (or read) them; the
// Go server's whole hub suite writes about four thousand. Most are the same
// message with different numbers, so this keeps the first frame of every
// distinct *shape*: its `type` and the set of key paths present, arrays
// flattened to their elements. A field that is present on one frame and
// omitted on another is two shapes, which is the point: the omission rules are
// what the parity test exists to hold.
//
// How the fixtures under server/crates/loco-protocol/tests/fixtures/ were
// captured is written down in docs/protocol.md ("Parity fixtures").

import { readFileSync } from 'node:fs'

function paths(value, prefix, out) {
  if (Array.isArray(value)) {
    for (const v of value) paths(v, `${prefix}[]`, out)
    if (value.length === 0) out.add(`${prefix}[]empty`)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(`${prefix}.${k}`)
      paths(v, `${prefix}.${k}`, out)
    }
  } else if (value === 0 || value === false || value === '') {
    // A zero that was written is a rule being exercised.
    out.add(`${prefix}=zero`)
  }
  return out
}

const lines = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean)
const seen = new Set()
let skipped = 0
for (const line of lines) {
  let frame
  try {
    frame = JSON.parse(line)
  } catch {
    // An inbound capture holds the suite's deliberately malformed frames too.
    skipped++
    continue
  }
  if (!frame || typeof frame !== 'object' || typeof frame.type !== 'string') {
    skipped++
    continue
  }
  const shape = frame.type + ' ' + [...paths(frame, '', new Set())].sort().join(' ')
  if (seen.has(shape)) continue
  seen.add(shape)
  process.stdout.write(line + '\n')
}
if (skipped) process.stderr.write(`skipped ${skipped} frame(s) that are not a typed JSON object\n`)
