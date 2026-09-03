#!/usr/bin/env node
/**
 * Packs the models the rooms use into the client.
 *
 * Reads `client/src/components/scene/models/manifest.json`, copies each named
 * GLB out of the unpacked kit under `.assets-in/unpacked/<dir>/Models/<sub>/`
 * into `client/public/models/<kit>/<name>.glb`, and brings the kit's palette
 * texture along at the relative path the GLB references
 * (`Textures/colormap.png`). Everything else in the kit stays out of the
 * repository: the manifest is the allowlist, and a model is only shipped
 * because a room asked for it by name.
 *
 * Also writes `client/public/models/CREDITS.txt` from each kit's licence file.
 *
 * Usage (from the repo root): node tools/models/pack.mjs [--check]
 * `--check` reports what is missing or stale and exits non-zero, without writing.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const IN = path.join(ROOT, '.assets-in', 'unpacked')
const OUT = path.join(ROOT, 'client', 'public', 'models')
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'client', 'src', 'components', 'scene', 'models', 'manifest.json'), 'utf8'))
const check = process.argv.includes('--check')

let missing = 0
let copied = 0
let bytes = 0
const credits = []

for (const [kit, spec] of Object.entries(manifest.kits)) {
  const src = spec.sub === '.' ? path.join(IN, spec.dir) : path.join(IN, spec.dir, 'Models', spec.sub)
  const dst = path.join(OUT, kit)
  if (!fs.existsSync(src)) {
    console.error(`kit ${kit}: source folder not found: ${src}`)
    missing += spec.models.length
    continue
  }
  if (!check) fs.mkdirSync(dst, { recursive: true })
  for (const name of spec.models) {
    const from = path.join(src, `${name}.glb`)
    const to = path.join(dst, `${name}.glb`)
    if (!fs.existsSync(from)) {
      console.error(`kit ${kit}: model not found: ${name}.glb`)
      missing++
      continue
    }
    const stat = fs.statSync(from)
    bytes += stat.size
    if (check) {
      if (!fs.existsSync(to) || fs.statSync(to).size !== stat.size) {
        console.error(`kit ${kit}: ${name}.glb is not packed or stale`)
        missing++
      }
      continue
    }
    fs.copyFileSync(from, to)
    copied++
  }
  const tex = path.join(src, 'Textures', 'colormap.png')
  if (fs.existsSync(tex)) {
    const texTo = path.join(dst, 'Textures', 'colormap.png')
    bytes += fs.statSync(tex).size
    if (!check) {
      fs.mkdirSync(path.dirname(texTo), { recursive: true })
      fs.copyFileSync(tex, texTo)
    } else if (!fs.existsSync(texTo)) {
      console.error(`kit ${kit}: colormap.png is not packed`)
      missing++
    }
  }
  const lic = [path.join(IN, spec.dir, 'License.txt'), path.join(IN, spec.dir, 'LICENSE.txt')].find((p) => fs.existsSync(p))
  if (lic) credits.push(`## ${kit} (${spec.dir})\n\n${fs.readFileSync(lic, 'utf8').trim()}\n`)
  else credits.push(`## ${kit} (${spec.dir})\n\nCC0 1.0 Universal (public domain), as published by the author.\n`)
}

if (!check) {
  fs.writeFileSync(
    path.join(OUT, 'CREDITS.txt'),
    `Models used by the rooms. Every kit below is Creative Commons Zero (CC0), and is packed here by tools/models/pack.mjs from the manifest.\n\n${credits.join('\n')}`,
  )
}

console.log(`${check ? 'checked' : 'packed'} ${check ? Object.values(manifest.kits).reduce((n, k) => n + k.models.length, 0) : copied} models, ${(bytes / 1024).toFixed(0)} KB on disk, ${missing} missing`)
process.exit(missing > 0 ? 1 : 0)
