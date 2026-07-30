#!/usr/bin/env node
/**
 * Audio verification harness.
 *
 * Every sound in LOCO is synthesised at runtime, which means a broken envelope
 * or a mis-wired node produces *silence* rather than an error — nothing fails,
 * nothing logs, and the bug survives every unit test. This script renders each
 * effect through a real AudioContext in a browser and measures the signal on the
 * effects bus, so "it makes a sound" is checked rather than assumed.
 *
 * Deliberately not part of the CI suite: audio devices in CI containers are
 * unreliable, and a flaky sound assertion would train people to ignore red.
 * Run it after touching audio/sfx.ts or audio/engine.ts.
 *
 *   node tools/audio/verify.mjs
 *   node tools/audio/verify.mjs --port=5199
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import net from 'node:net'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const require = createRequire(path.join(ROOT, 'e2e', 'package.json'))
const { chromium } = require('playwright')

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
const PORT = Number(args.port ?? 5198)

function waitForPort(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      const sock = net.connect(port, '127.0.0.1')
      sock.once('connect', () => { sock.destroy(); resolve() })
      sock.once('error', () => {
        sock.destroy()
        if (Date.now() > deadline) reject(new Error(`vite did not start on :${port}`))
        else setTimeout(tick, 250)
      })
    }
    tick()
  })
}

async function startVite() {
  const bin = path.join(ROOT, 'client', 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(process.execPath, [bin, '--port', String(PORT), '--strictPort'], {
    cwd: path.join(ROOT, 'client'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, VITE_HMR_CLIENT_PORT: String(PORT) },
  })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  await waitForPort(PORT)
  return child
}

const vite = await startVite()
let failures = 0
try {
  const browser = await chromium.launch({
    // Chromium needs an explicit opt-out of the gesture requirement here: the
    // page is driven by script, not by a person clicking.
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const page = await browser.newPage()
  await page.goto(`http://localhost:${PORT}/?showcase=lobby-home`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('html[data-showcase-ready]', { timeout: 15_000 })

  const results = await page.evaluate(async () => {
    const { audio } = await import('/src/audio/engine.ts')
    const sfx = await import('/src/audio/sfx.ts')
    const { music } = await import('/src/audio/music.ts')

    audio.unlock()
    audio.setSettings({ muted: false, master: 1, sfx: 1, music: 1 })
    const ctx = audio.context()
    if (!ctx) return { error: 'no AudioContext' }
    await ctx.resume()
    if (ctx.state !== 'running') return { error: `context state = ${ctx.state}` }

    /** Peak absolute sample seen on `bus` over `ms`, sampled once per animation frame. */
    const measure = async (bus, ms, trigger) => {
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      bus.connect(analyser)
      const buf = new Float32Array(analyser.fftSize)
      let peak = 0
      trigger()
      const until = performance.now() + ms
      while (performance.now() < until) {
        await new Promise((r) => requestAnimationFrame(() => r(null)))
        analyser.getFloatTimeDomainData(buf)
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i])
          if (v > peak) peak = v
        }
      }
      bus.disconnect(analyser)
      return peak
    }

    const names = [
      'cardPlay', 'cardDraw', 'cardDeal', 'uiTap', 'uiBack', 'yourTurn', 'skip', 'reverse',
      'drawStack', 'wild', 'swap', 'unoDeclare', 'unoCaught', 'interrupt', 'penalty', 'error',
      'countdown', 'playerJoin', 'roundWin', 'roundLose', 'matchWin', 'matchLose',
    ]

    const peaks = {}
    for (const name of names) {
      peaks[name] = await measure(audio.sfxDestination(), 420, () => sfx.playSfx(name))
    }
    peaks['<deal x8>'] = await measure(audio.sfxDestination(), 700, () => sfx.playDeal(8))

    /** Mean square energy on `bus` over `ms`. Density, not just "is it audible". */
    const rms = async (bus, ms) => {
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      bus.connect(analyser)
      const buf = new Float32Array(analyser.fftSize)
      let sum = 0
      let frames = 0
      const until = performance.now() + ms
      while (performance.now() < until) {
        await new Promise((r) => requestAnimationFrame(() => r(null)))
        analyser.getFloatTimeDomainData(buf)
        let frame = 0
        for (let i = 0; i < buf.length; i++) frame += buf[i] * buf[i]
        sum += frame / buf.length
        frames++
      }
      bus.disconnect(analyser)
      return frames ? Math.sqrt(sum / frames) : 0
    }

    const settle = (ms) => new Promise((r) => setTimeout(r, ms))

    // Music bed: give the lookahead scheduler a beat or two to emit something.
    music.setIntensity(0.9)
    const musicPeak = await measure(audio.musicDestination(), 1600, () => music.start('game'))

    // Adaptivity is the whole premise of the bed, so measure it rather than
    // trusting the layer conditions. Intensity is slewed, so each change needs a
    // moment to arrive before the level means anything.
    // The loop is four bars — ~11s at the slowest tempo. Measuring a shorter
    // window samples a random slice of the progression and the numbers mean
    // nothing, which is exactly how the first version of this check produced a
    // confident ×1.05 for a bed that does change.
    const LOOP_MS = 11_000

    music.setIntensity(0.08)
    await settle(3000)
    const calmRms = await rms(audio.musicDestination(), LOOP_MS)
    const calmIntensity = music.getIntensity()

    music.setIntensity(1)
    await settle(3000)
    const tenseRms = await rms(audio.musicDestination(), LOOP_MS)
    const tenseIntensity = music.getIntensity()

    // Ducking must actually pull the bed down under a fanfare.
    const beforeDuck = await rms(audio.musicDestination(), 4000)
    music.duck(9000)
    await settle(400)
    const duckedRms = await rms(audio.musicDestination(), 4000)

    music.stop()

    // Mute must actually mute: master gain is the only thing between the buses
    // and the speakers, so verify it rather than trusting it.
    audio.setSettings({ muted: true })
    await new Promise((r) => setTimeout(r, 150))
    const mutedPeak = await measure(ctx.destination ? audio.sfxDestination() : null, 300, () =>
      sfx.playSfx('unoDeclare'),
    ).catch(() => -1)
    audio.setSettings({ muted: false })

    return { peaks, musicPeak, mutedPeak, calmRms, tenseRms, calmIntensity, tenseIntensity, beforeDuck, duckedRms }
  })

  if (results.error) {
    console.error(`✗ ${results.error}`)
    failures++
  } else {
    const THRESHOLD = 0.001
    for (const [name, peak] of Object.entries(results.peaks)) {
      const ok = peak > THRESHOLD
      if (!ok) failures++
      console.log(`${ok ? '✓' : '✗'} ${name.padEnd(12)} peak=${peak.toFixed(4)}`)
    }
    const musicOk = results.musicPeak > THRESHOLD
    if (!musicOk) failures++
    console.log(`${musicOk ? '✓' : '✗'} ${'music bed'.padEnd(12)} peak=${results.musicPeak.toFixed(4)}`)

    // The bed's whole premise is that tension is audible. A 30% energy rise is a
    // deliberately loose floor — it only has to prove the layers really engage.
    const adaptiveOk = results.tenseRms > results.calmRms * 1.3
    if (!adaptiveOk) failures++
    console.log(
      `${adaptiveOk ? '✓' : '✗'} ${'adaptivity'.padEnd(12)} calm=${results.calmRms.toFixed(4)} ` +
        `tense=${results.tenseRms.toFixed(4)} (×${(results.tenseRms / (results.calmRms || 1e-9)).toFixed(2)})`,
    )

    const slewOk = results.calmIntensity < 0.2 && results.tenseIntensity > 0.8
    if (!slewOk) failures++
    console.log(
      `${slewOk ? '✓' : '✗'} ${'slew'.padEnd(12)} reached calm=${results.calmIntensity.toFixed(2)} ` +
        `tense=${results.tenseIntensity.toFixed(2)}`,
    )

    const duckOk = results.duckedRms < results.beforeDuck * 0.6
    if (!duckOk) failures++
    console.log(
      `${duckOk ? '✓' : '✗'} ${'duck'.padEnd(12)} before=${results.beforeDuck.toFixed(4)} ` +
        `during=${results.duckedRms.toFixed(4)}`,
    )
    // playSfx() early-returns while muted, so the effects bus stays silent.
    const muteOk = results.mutedPeak <= THRESHOLD
    if (!muteOk) failures++
    console.log(`${muteOk ? '✓' : '✗'} ${'mute'.padEnd(12)} peak=${results.mutedPeak.toFixed(4)} (want ~0)`)
  }

  await browser.close()
} finally {
  vite.kill()
}

console.log(failures === 0 ? '\n✓ every voice produces signal' : `\n✗ ${failures} silent voice(s)`)
process.exit(failures === 0 ? 0 : 1)
