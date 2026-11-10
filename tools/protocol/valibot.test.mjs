// node --test tools/protocol/
//
// The converter's promise is what it refuses, so that is what is tested: each
// construction below is one a JSON Schema can say and Valibot can only
// approximate, and a converter that approximated it would put a validator in
// front of every message that nobody decided on.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { convert, schemaName } from './valibot.mjs'

const DRAFT = 'https://json-schema.org/draft/2020-12/schema'

/** A root with one variant, `ping`, whose payload is `def`. */
function root(def, extraDefs = {}) {
  return {
    $schema: DRAFT,
    title: 'ServerMsg',
    oneOf: [
      {
        $ref: '#/$defs/PingMsg',
        type: 'object',
        properties: { type: { type: 'string', const: 'ping' } },
        required: ['type'],
      },
    ],
    $defs: { PingMsg: def, ...extraDefs },
  }
}

const obj = (properties, required = []) => ({ type: 'object', properties, required })

test('names follow the hand-written convention', () => {
  assert.equal(schemaName('CardDTO'), 'cardSchema')
  assert.equal(schemaName('GameStateDTO'), 'gameStateSchema')
  assert.equal(schemaName('ServerMsg'), 'serverMsgSchema')
})

test('writes a tagged variant over its payload, optional fields optional', () => {
  const out = convert(
    root(obj({ seat: { type: 'integer', format: 'int32' }, name: { type: 'string' } }, ['seat']), {}),
  )
  assert.match(out, /export const pingMsgSchema = v\.object\(\{/)
  assert.match(out, /seat: v\.pipe\(v\.number\(\), v\.integer\(\)\),/)
  assert.match(out, /name: v\.optional\(v\.string\(\)\),/)
  assert.match(out, /\.\.\.pingMsgSchema\.entries,\n\s+type: v\.literal\('ping'\),/)
  assert.match(out, /export const serverMsgTypeSchema = v\.picklist\(\[\n\s+'ping',\n\]\)/)
})

test('declares a definition before the one that uses it', () => {
  const out = convert(
    root(obj({ card: { $ref: '#/$defs/CardDTO' } }), {
      CardDTO: obj({ kind: { $ref: '#/$defs/CardKind' } }, ['kind']),
      CardKind: { type: 'string', enum: ['number', 'skip'] },
    }),
  )
  const at = (name) => out.indexOf(`export const ${name} =`)
  assert.ok(at('cardKindSchema') < at('cardSchema'))
  assert.ok(at('cardSchema') < at('pingMsgSchema'))
})

test('a oneOf of string constants is a picklist', () => {
  const out = convert(
    root(obj({}), {
      Emote: { oneOf: [{ type: 'string', const: 'gg' }, { type: 'string', const: 'close' }] },
    }),
  )
  assert.match(out, /export const emoteSchema = v\.picklist\(\[\n\s+'gg',\n\s+'close',\n\]\)/)
})

const refusals = {
  'a nullable field': obj({ seat: { type: ['integer', 'null'] } }),
  'an anyOf': obj({ seat: { anyOf: [{ type: 'integer' }, { type: 'string' }] } }),
  'a pattern': obj({ code: { type: 'string', pattern: '^[A-Z]+$' } }),
  'a minimum': obj({ seat: { type: 'integer', minimum: 0 } }),
  'a non-integer format': obj({ seat: { type: 'integer', format: 'uint8' } }),
  'a number': obj({ ratio: { type: 'number' } }),
  'an open map': { type: 'object', additionalProperties: { type: 'string' } },
  'a required field with no schema': obj({}, ['ghost']),
  'an array without items': obj({ list: { type: 'array' } }),
  'a ref outside $defs': obj({ x: { $ref: 'https://example.com/x.json' } }),
}

for (const [what, def] of Object.entries(refusals)) {
  test(`refuses ${what}`, () => {
    assert.throws(() => convert(root(def)), /cannot express|union of types|format|type "number"|additionalProperties|required but|no items|does not name/)
  })
}

test('refuses a recursive type, which cannot be a const', () => {
  assert.throws(
    () => convert(root(obj({ next: { $ref: '#/$defs/PingMsg' } }))),
    /recursive/,
  )
})

test('refuses a payload that carries its own type field', () => {
  assert.throws(() => convert(root(obj({ type: { type: 'string' } }))), /its own "type" field/)
})

test('refuses another draft', () => {
  assert.throws(() => convert({ ...root(obj({})), $schema: 'http://json-schema.org/draft-07/schema#' }), /draft 2020-12/)
})

test('refuses a reference to a missing definition', () => {
  assert.throws(() => convert(root(obj({ x: { $ref: '#/$defs/Nowhere' } }))), /missing definition/)
})
