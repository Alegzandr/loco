/**
 * Marina: a harbour front.
 *
 * The table stands on a deck at the water's edge. The quay runs across the
 * top of the frame, the sea beyond it: a pier out to the boats, a lighthouse
 * on its rocks, buoys, a ferry in the channel. Behind the quay, blocks of
 * narrow painted houses along canals, a fish market, a fair with its wheel on
 * the right, a beach with its umbrellas at the bottom left. The sea is what
 * makes the weather here: a storm on the marina is the one that looks like
 * something.
 *
 * **Where the water starts is `shoreAt`, and nothing marine may be placed
 * against anything else.** The plaza the podium sits on is a wide oval of the
 * same sand, and it reaches four tiles past the straight quay in the middle of
 * the frame — so a boat moored "just past the quay" was moored on the paving,
 * with its hull buried in the beach. `shoreAt(sx)` is the higher of the two at
 * that point across the frame, which is the line the eye reads as the water's
 * edge, and the promenade, the bollards, the pier, the boats, the foam and the
 * buoys are all placed relative to it.
 */
import type { Builder } from './common'
import { MAPS } from '../../cards/maps'
import { cityGrid, lots, podium, crowd, at, screenOf, screenSpan, FLOOR } from './common'
import { mix, scale, cssHex } from '../sky'
import type { Actor, ScreenPt } from '../life'
import { balloon, bird, boat as vessel, cloud, pacers, streetWalkers, strollers, traffic } from './actors'

const SEA = 0x2c86c9
const DECK = 0xc49a62
const DECK2 = 0xb88c58

/** The cars, parked along the streets and driving them. */
const CARS = [0xd94c4c, 0x2f8fbf, 0xf4d35e, 0xf5f0e6] as const

export const marina: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  const { sx, sy, a, b } = k.anchor
  /** The straight quay wall, across the whole frame: where the built land ends. */
  const QUAY = sy + b + 4

  const sea = k.rig.wet ? mix(SEA, 0x1a3550, 0.4) : SEA
  k.box(0, -1.7, 0, FLOOR, 1, FLOOR, sea, { outline: false, cap: false })
  {
    const L = 170
    const [cx, cz] = at(0, QUAY - (L / 2) * 0.53)
    k.box(cx, -0.7, cz, L, 0.7, L, 0x6b6660, { rot: Math.PI / 4, outline: true, cap: false })
    // Grass, not stone: the town stands on lawns, and the paving is the plaza's.
    k.box(cx, 0, cz, L, 0.06, L, k.ground(0x7cc36a), { rot: Math.PI / 4, outline: false, cap: false })
  }
  const plaza = podium(k, { stone: 0x6e5232, step: DECK2, floor: DECK, floor2: DECK2, accent: 0xffd166, top: cssHex(MAPS.marina.table.felt) })
  // The steps and the drum are ground nothing is placed on; the paving round
  // them is where the crowd stands.
  k.claim(...at(sx, sy), (a + 3.4) * 2, ((b + 1.8) / 0.53) * 2, Math.PI / 4)

  /**
   * The water's edge, at this point across the frame: the quay wall, or the
   * plaza's own rim where the paving bulges past it. Everything marine is
   * placed from here rather than from `QUAY`.
   */
  const shoreAt = (px: number): number => {
    const t = (px - sx) / plaza.sa
    const rim = Math.abs(t) < 1 ? sy + plaza.sb * Math.sqrt(1 - t * t) : -Infinity
    return Math.max(QUAY, rim)
  }
  const atSea = (x: number, z: number) => {
    const [px, py] = screenOf(x, z)
    return py > shoreAt(px)
  }
  /** The world point `n` screen tiles out to sea from the shore at `px`. */
  const offshore = (px: number, n: number) => at(px, shoreAt(px) + n)

  for (let i = 0; i < 320; i++) {
    const x = rng.range(-110, 110), z = rng.range(-110, 110)
    const [px, py] = screenOf(x, z)
    if (py < shoreAt(px) + 0.5) continue
    k.slab(x, z, rng.range(0.6, 1.8), 0.16, mix(sea, 0xffffff, k.rig.weather === 'storm' ? 0.7 : 0.45), { y: -0.7, h: 0.03, rot: rng.range(-0.3, 0.3) })
  }

  // ─── The promenade: it follows the water, it does not cut across it ─────
  // Bollards at the edge, lamps and benches a few tiles inland, people between
  // the two. Laid on a straight screen line they ran through the middle of the
  // sand on one side of the frame and into the sea on the other, because the
  // shore is a curve here and only the quay wall is straight.
  for (let x = -60; x <= 60; x += 3.6) k.cyl(...at(x, shoreAt(x) - 0.7), 0, 0.24, 0.7, 0x2a2f3a, { seg: 8 })
  for (let x = -54; x <= 54; x += 12) k.cyl(...at(x, shoreAt(x) - 0.2), -0.3, 0.55, 0.25, 0xd94c4c, { axis: 'x', rot: Math.PI / 4, seg: 8 })
  for (let x = -48; x <= 48; x += 12) { if (Math.abs(x + 18) > 4) k.lamp(...at(x, shoreAt(x) - 2.2), { h: 2.8, color: 0xffe1a1, post: 0x2a2f3a }) }
  for (let x = -42; x <= 42; x += 12) k.bench(...at(x + 6, shoreAt(x + 6) - 2.6), Math.PI / 4, 0x6b4a2b)
  for (let i = 0; i < 9; i++) {
    const px = rng.range(-44, 44)
    k.person(...at(px, shoreAt(px) - 1.2 - rng.range(0, 3.4)), rng.range(0, 6.3))
  }
  for (let i = 0; i < 5; i++) {
    const px = rng.range(-38, 38)
    const [x, z] = at(px, shoreAt(px) - 3.4)
    k.crate(x, z, 0.6, 0xbfe3f0)
    k.barrel(x + 1.1, z + 0.4)
  }

  // ─── The pier ──────────────────────────────────────────────────────────
  // Laid out in screen tiles through `screenSpan`, because everything standing
  // on it is: the railing, the lamps and the cargo are placed at `PX ± W/2`,
  // and a deck whose width came out as `d` — which runs up the frame, not
  // across it — left all three of them floating in the water beside a plank
  // one tile wide.
  {
    const PX = -18
    /** The deck's width across the frame, in screen tiles. */
    const W = 4.6
    const BASE = shoreAt(PX) - 2
    const LEN = 17
    const deck = screenSpan(PX, BASE + LEN / 2, W, LEN)
    // Top face at exactly y = 0, so anything standing on the deck stands the
    // way it stands on the quay.
    k.slab(deck.x, deck.z, deck.w, deck.d, DECK2, { y: -0.16, h: 0.16, rot: deck.rot, outline: true })
    // Planks across it. Without them the deck is one brown rectangle running
    // off the top of the frame, which reads as a wall lying down rather than as
    // something anybody could walk on.
    for (let t = 0.8; t < LEN; t += 1.5) {
      const p = screenSpan(PX, BASE + t, W - 0.3, 0.12)
      k.slab(p.x, p.z, p.w, p.d, scale(DECK2, 0.9), { y: 0, h: 0.02, rot: p.rot })
    }
    const rail = W / 2 - 0.3
    for (let t = 1; t < LEN; t += 2.2) {
      for (const side of [-1, 1]) {
        // A mooring post at each pile, which is also what caps the pile.
        k.cyl(...at(PX + side * rail, BASE + t), -1.7, 0.2, 2.4, 0x4a3323, { seg: 6, cap: false })
        k.cyl(...at(PX + side * rail, BASE + t), 0.7, 0.26, 0.16, 0x2a2f3a, { seg: 6 })
      }
    }
    for (let t = 3.5; t < LEN - 1; t += 5.5) k.lamp(...at(PX + rail - 0.6, BASE + t), { h: 2.6, color: 0xffe1a1, post: 0x2a2f3a })
    k.crate(...at(PX - 0.7, BASE + 4), 0.7)
    k.crate(...at(PX + 0.1, BASE + 4.9), 0.55)
    k.barrel(...at(PX - 1.1, BASE + 7.6))
    k.person(...at(PX - 0.4, BASE + 12), Math.PI / 4 + Math.PI, { hat: 0xf4d35e })
    k.person(...at(PX + 1, BASE + 8.4), Math.PI / 4 + Math.PI)
    // The head of the pier: a low platform across its whole width.
    const head = screenSpan(PX, BASE + LEN + 0.8, W + 1.4, 2)
    k.slab(head.x, head.z, head.w, head.d, 0x6b4a2b, { y: -0.16, h: 0.2, rot: head.rot, outline: true })
  }

  // ─── Boats ─────────────────────────────────────────────────────────────
  const boat = (bsx: number, out: number, rot: number, hull: number, o: { sail?: boolean; cabin?: boolean; len?: number } = {}) => {
    const [x, z] = offshore(bsx, out)
    const len = o.len ?? 4.2
    k.box(x, -0.55, z, len, 0.9, 1.8, hull, { rot })
    k.box(x + (len / 2) * Math.cos(rot), -0.4, z - (len / 2) * Math.sin(rot), 1.0, 0.75, 1.2, hull, { rot: rot + Math.PI / 4 })
    k.box(x, 0.35, z, len - 0.2, 0.12, 1.6, mix(hull, 0xffffff, 0.5), { rot, outline: false, cap: false })
    if (o.cabin) {
      k.box(x - 0.4 * Math.cos(rot), 0.45, z + 0.4 * Math.sin(rot), 1.6, 1.0, 1.3, 0xf5f0e6, { rot })
      k.box(x - 0.4 * Math.cos(rot), 0.7, z + 0.4 * Math.sin(rot), 1.64, 0.4, 1.34, on ? 0xffe2a8 : 0x1a2233, { rot, glow: on, outline: false, cap: false })
      k.cyl(x - 0.6 * Math.cos(rot), 1.45, z + 0.6 * Math.sin(rot), 0.1, 0.6, 0x2a2f3a, { seg: 5, cap: false })
    }
    if (o.sail) {
      k.cyl(x, 0.4, z, 0.07, 3.6, 0x6b4a2b, { seg: 5, cap: false })
      k.box(x + 0.85 * Math.sin(rot), 1.3, z + 0.85 * Math.cos(rot), 0.06, 2.4, 1.5, 0xfaf6ee, { rot, cap: false })
      k.box(x - 0.6 * Math.sin(rot), 1.1, z - 0.6 * Math.cos(rot), 0.06, 1.8, 1.0, 0xff3d68, { rot, cap: false })
    }
    if (on) {
      k.sphere(x + (len / 2 + 0.3) * Math.cos(rot), 0.55, z - (len / 2 + 0.3) * Math.sin(rot), 0.12, 0x7cff6b, { glow: true, seg: 5, outline: false })
      k.halo(x, -0.68, z, len * 0.55, 0xffe2a8, 0.18)
    }
  }
  // Moored clear of the pier (`PX ± 3` is deck) and inside the band of sea the
  // frame shows. The shore runs high on the screen and the water above it is
  // four to ten tiles deep depending on where the plaza's rim has got to, so a
  // mast anchored fifteen tiles out is a mast nobody ever sees.
  // **Masts only in the side bands.** The plaza's rim reaches highest in the
  // middle of the frame, so the water there is about seventy pixels deep on a
  // monitor and a rig is eighty: every sail moored in front of the table was
  // cut off by the top edge. Past |sx| ≈ 27 the rim has dropped back to the
  // quay wall and there is twice as much of it, which is where the fleet is.
  if (k.model('pirate/ship-medium', ...offshore(36, 4.6), { rot: 0.5 })) {
    // The drawn fleet: a tall ship out in the right band, a small one off the
    // left, rowing boats about the pier. The block boats below are the fleet
    // of a room with no pirate kit.
    k.model('pirate/ship-small', ...offshore(-45, 3.6), { rot: 2.2 })
    k.model('pirate/boat-row-small', ...offshore(-13, 1.6), { rot: 0.4 })
    k.model('pirate/boat-row-large', ...offshore(-23, 1.8), { rot: 1.1 })
    k.model('pirate/boat-row-small', ...offshore(8, 1.4), { rot: -0.7 })
    k.model('pirate/boat-row-large', ...offshore(31, 1.6), { rot: 0.2 })
    k.model('pirate/boat-row-small', ...offshore(40, 1.5), { rot: 2.9 })
  } else {
  boat(-25, 2.0, 0.2, 0xd94c4c, { sail: true })
  boat(-21.5, 1.2, 1.0, 0x2f8fbf, { cabin: true })
  boat(-13, 1.0, 2.2, 0xf0a34c, { cabin: true })
  boat(-5, 0.9, 0.9, 0x2b2b2b, { cabin: true, len: 5.4 })
  boat(6, 0.9, 0.4, 0x62b58a, { cabin: true })
  boat(14, 1.1, -1.1, 0xf5f0e6, { cabin: true })
  boat(23, 1.8, 0.3, 0x2f8fbf, { sail: true })
  boat(30, 2.4, -0.6, 0xf4d35e, { sail: true })
  }
  for (let i = 0; i < 12; i++) {
    const px = rng.range(-50, 50)
    const [x, z] = offshore(px, 0.7 + rng.range(0, 1.8))
    k.sphere(x, -0.55, z, 0.45, i % 2 ? 0xd94c4c : 0xf5f0e6, { seg: 7 })
    k.sphere(x, 0.1, z, 0.13, on ? 0xffd23c : 0x8a8f99, { glow: on, seg: 4, outline: false })
  }

  // ─── The lighthouse, on its rocks, out in the left band ────────────────
  // Sixteen tiles tall it was a ring of boulders with the whole tower above the
  // frame: the shore sits high on the screen and anything standing in the water
  // has only the few tiles between it and the top edge. Nine and a half fits.
  // It stands out to the left for two reasons — the top right corner is the
  // chip row, and the plaza's rim has dropped back towards the quay wall by
  // here, so the water is at its deepest. On a phone the frame is barely 18
  // tiles wide and this is outside it, like the fair and the beach opposite:
  // that band is where a monitor's landmarks live.
  {
    const [lx, lz] = offshore(-31, 1)
    // The island is the kit's rocks; the lighthouse itself is ours, because
    // the pirate kit's towers are castle keeps and a harbour has a lighthouse.
    const drawnRocks = k.model('pirate/rocks-a', lx, lz, { y: -0.9, scale: 1.7, collide: false })
    if (drawnRocks) {
      k.model('pirate/rocks-b', lx + 3.4, lz - 2.6, { y: -0.7, scale: 0.9, collide: false })
      k.model('pirate/rocks-c', lx - 3.6, lz + 2.0, { y: -0.7, scale: 0.9, collide: false })
      k.model('pirate/palm-bend', lx + 3.0, lz + 2.4, { y: 0.6, rot: 1.0, scale: 0.8, collide: false })
    } else
    for (let i = 0; i < 11; i++) {
      const t = (i / 11) * Math.PI * 2
      k.rock(lx + Math.cos(t) * 3.6, lz + Math.sin(t) * 3.6, rng.range(0.7, 1.4), 0x6f6a62)
    }
    {
    if (!drawnRocks) k.cyl(lx, -0.7, lz, 3, 1.8, 0x6f6a62, { seg: 12 })
    for (let i = 0; i < 3; i++) k.cyl(lx, 1.1 + i * 1.25, lz, 1.55 - i * 0.12, 1.25, i % 2 ? 0xd94c4c : 0xf5f0e6, { seg: 12, cap: false })
    k.cyl(lx, 4.85, lz, 1.55, 0.25, 0x2a2f3a, { seg: 12 })
    k.fence(lx - 1.6, lz - 1.6, lx + 1.6, lz - 1.6, 0x2a2f3a, 0.6)
    k.fence(lx + 1.6, lz - 1.6, lx + 1.6, lz + 1.6, 0x2a2f3a, 0.6)
    k.cyl(lx, 5.1, lz, 0.9, 1.15, on ? 0xfff0b0 : 0xbfe3f0, { seg: 10, glow: on })
    k.cone(lx, 6.25, lz, 1.2, 0.85, 0xd94c4c, { seg: 10 })
    if (on) {
      k.halo(lx, 5.7, lz, 3, 0xfff0b0, 0.45, false)
      k.halo(lx, 5.7, lz, 6, 0xfff0b0, 0.2, false)
    }
    }
    // The keeper's house, on its own rock clear of the ring above: built at
    // 3.4 tiles out it stood inside the boulders, which is the one thing on
    // this island that is meant to look built.
    const [hx, hz] = offshore(-37.5, 1.2)
    k.cyl(hx, -0.7, hz, 2.4, 1.5, 0x6f6a62, { seg: 10 })
    if (!k.model('suburb/building-type-h', hx, hz, { y: 0.8, rot: 0.3, scale: 0.85, collide: false })) {
      k.box(hx, 0.8, hz, 3, 2.2, 2.6, 0xf5f0e6, { rot: 0.3 })
      k.prism(hx, 3.0, hz, 3.6, 1.2, 3.2, 0xd94c4c, { rot: 0.3 })
    }
  }

  // ─── The town behind the quay: blocks of painted houses along canals ───
  const paints = [0xf0a34c, 0x5aa0d8, 0xe85c5c, 0xf4d35e, 0x62b58a, 0xd9a4c8, 0xf5f0e6]
  /**
   * One house of a terrace. Every detail is solved from `w` and `d`: written as
   * fixed offsets they were sized for a house half again as wide, so the
   * windows sat on the corners, the door hung off the end of the façade and the
   * awning overhung its own shop by half a tile at each end. The roof took the
   * same treatment — a prism's `w` is its ridge, so adding `π/2` to the
   * rotation without swapping `w` and `d` put a roof across the house it
   * belonged to.
   */
  const HOUSES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u'].map((c) => `suburb/building-type-${c}`)
  const rowHouse = (x: number, z: number, w: number, d: number, rot: number) => {
    // A drawn house, facing the street the block house faced, on the same lot;
    // the placer says whether it fits beside its neighbours.
    if (k.has(HOUSES[0])) {
      const [fx, fz] = [x + (d / 2 - 2.0) * Math.sin(rot), z + (d / 2 - 2.0) * Math.cos(rot)]
      k.model(rng.pick(HOUSES), fx, fz, { rot, scale: 0.9, margin: 0 })
      return
    }
    const h = rng.range(4.5, 8)
    const c = rng.pick(paints)
    k.box(x, 0, z, w, h, d, c, { rot })
    const face = (t: number, out: number): [number, number] => [
      x + t * Math.cos(rot) + out * Math.sin(rot),
      z - t * Math.sin(rot) + out * Math.cos(rot),
    ]
    const cols = Math.max(1, Math.round(w / 1.4))
    const doorCol = 0
    const shutter = rng.pick([0x2f8fbf, 0x2fa07a, 0xf5f0e6, 0x3f4a5c, 0xd94c4c])
    const rows = Math.floor((h - 0.7) / 1.7)
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < cols; i++) {
        if (r === 0 && i === doorCol) continue
        const t = -w / 2 + (i + 0.5) * (w / cols)
        const ww = Math.min(0.55, w / cols - 0.5)
        const wy = 0.55 + r * 1.7
        const [wx, wz] = face(t, d / 2 + 0.03)
        k.window(wx, wy, wz, ww, 0.66, 'z', 0xffe2a8, { rot, frame: 0xf5f0e6 })
        // Shutters either side of every upstairs window, in the house's own
        // second colour: the one detail that makes a painted terrace read as
        // a harbour town rather than as a row of boxes with holes in them.
        if (r > 0) {
          for (const side of [-1, 1]) {
            const [sx2, sz2] = face(t + side * (ww / 2 + 0.2), d / 2 + 0.06)
            k.box(sx2, wy - 0.02, sz2, 0.22, 0.7, 0.05, shutter, { rot, outline: false, cap: false })
          }
        }
      }
      // A balcony along the first floor, with a railing.
      if (r === 1 && rng.chance(0.55)) {
        const [bx, bz] = face(0, d / 2 + 0.35)
        k.box(bx, 0.55 + r * 1.7 - 0.22, bz, w - 0.4, 0.14, 0.7, scale(c, 0.8), { rot, cap: false })
        for (let i = 0; i <= 5; i++) {
          const [px2, pz2] = face(-w / 2 + 0.3 + (i / 5) * (w - 0.6), d / 2 + 0.65)
          k.box(px2, 0.55 + r * 1.7 - 0.08, pz2, 0.06, 0.55, 0.06, 0x2a2f3a, { rot, outline: false, cap: false })
        }
        const [rx2, rz2] = face(0, d / 2 + 0.65)
        k.box(rx2, 0.55 + r * 1.7 + 0.42, rz2, w - 0.4, 0.06, 0.06, 0x2a2f3a, { rot, outline: false, cap: false })
      }
    }
    // A band at every floor, the way a painted terrace is drawn.
    for (let r = 1; r < Math.floor((h - 0.7) / 1.7); r++) {
      k.box(x, 0.2 + r * 1.7, z, w + 0.06, 0.06, d + 0.06, scale(c, 0.85), { rot, outline: false, cap: false })
    }
    // The ridge runs across the façade, so `w` and `d` swap with the extra π/2.
    k.prism(x, h, z, d + 0.3, 2, w + 0.3, rng.pick([0x8b3a2a, 0x3f4a5c, 0x6b4a2b]), { rot: rot + Math.PI / 2 })
    // A chimney on the ridge, and a dormer in the front slope now and then.
    if (rng.chance(0.6)) k.box(x + (w * 0.3) * Math.cos(rot), h + 1.2, z - (w * 0.3) * Math.sin(rot), 0.4, 1.4, 0.4, 0x6f6a62, { rot })
    if (rng.chance(0.45) && w > 3) {
      const [mx2, mz2] = face(-w * 0.15, d / 2 - 0.5)
      k.box(mx2, h + 0.3, mz2, 1.0, 0.9, 0.9, c, { rot })
      const [dwx, dwz] = face(-w * 0.15, d / 2 - 0.02)
      k.window(dwx, h + 0.45, dwz, 0.4, 0.5, 'z', 0xffe2a8, { rot, frame: 0xf5f0e6, sill: false })
      k.prism(mx2, h + 1.2, mz2, 1.2, 0.5, 1.1, rng.pick([0x8b3a2a, 0x3f4a5c, 0x6b4a2b]), { rot })
    }
    const [dx2, dz2] = face(-w / 2 + (0.5 * w) / cols, d / 2 + 0.05)
    k.door(dx2, 0, dz2, Math.min(0.8, w * 0.36), 1.7, scale(c, 0.5), { rot, frame: 0xf5f0e6 })
    if (rng.chance(0.4)) k.planter(dx2 + 0.7 * Math.cos(rot) + 0.5 * Math.sin(rot), dz2 - 0.7 * Math.sin(rot) + 0.5 * Math.cos(rot), { r: 0.26 })
    if (rng.chance(0.5)) {
      const [ax, az] = face(0, d / 2)
      k.awning(ax, az, rot, w - 0.3, rng.pick([0xd94c4c, 0x2f8fbf, 0xf5f0e6]), { y: 2.3 })
    }
  }
  // Out in the front corner, clear of the terraces: a wheel twelve tiles
  // across standing behind a row of houses is a row of houses with cabins
  // floating over their roofs, which is what a correct render of that looks
  // like. Nothing is built within fourteen tiles of it.
  const wheelSpot = { sx: sx + a + 12, sy: sy - b - 7 }
  const beachSpot = { sx: sx - a - 8, sy: sy - b - 5 }
  const near = (c: { sx: number; sy: number }, p: { sx: number; sy: number }, r: number) => Math.hypot(c.sx - p.sx, (c.sy - p.sy) / 0.53) < r

  const plan = cityGrid(k, {
    block: 13,
    road: 3.2,
    roadColor: 0x5c6070,
    sidewalk: 0xd9d2c2,
    dashes: true,
    crossings: true,
    cars: CARS,
    carDensity: 0.3,
    lamp: { h: 2.8, color: 0xffe1a1, post: 0x2a2f3a },
    people: 0.5,
    maxHeight: 10,
    water: { line: 1, axis: 'x', color: sea, bank: 0x6b6660, bridge: 0x8a847a },
    plaza,
    land: (c) => !atSea(c.x, c.z) && c.sy < shoreAt(c.sx) - 7,
    fill: (c) => {
      // The fair keeps a wide clearing, and a deeper one in front of the wheel:
      // a terrace standing between the camera and it hid the whole frame.
      if (near(c, wheelSpot, 14) || near(c, beachSpot, 8)) return
      if (c.front) {
        // The market: stalls, crates and umbrellas, nothing over a storey.
        for (const l of lots(c, 2, 2, 1)) {
          const r = rng.next()
          if (r < 0.4) k.stall(l.x, l.z, rng.pick([0, Math.PI / 2, Math.PI]), 0x2f8fbf, 0xf5f0e6)
          else if (r < 0.7) {
            k.crate(l.x, l.z, 0.7, 0xbfe3f0)
            k.crate(l.x + 1, l.z + 0.6, 0.55, 0xbfe3f0)
            k.barrel(l.x - 1, l.z + 0.8)
          } else {
            k.cyl(l.x, 0.05, l.z, 0.05, 2.2, 0xf5f0e6, { seg: 4, cap: false, outline: false })
            k.cone(l.x, 1.9, l.z, 1.2, 0.55, rng.pick([0xd94c4c, 0x2f8fbf, 0xf4d35e]), { seg: 8, cap: false })
            // Clear of the parasol's own 1.2-tile reach, or the bench is under it.
            k.bench(l.x + 2.3, l.z, 0, 0x6b4a2b)
          }
        }
        return
      }
      // Row houses shoulder to shoulder along the block's camera-facing sides.
      // The side row stops one short: its last house and the front row's last
      // house are the same corner of the block, and built by both they stood
      // inside one another — two roofs crossing at right angles, which is what
      // the whole top-left of the harbour was made of.
      const n = 3
      for (let i = 0; i < n; i++) {
        const t = -c.w / 2 + (i + 0.5) * (c.w / n)
        rowHouse(c.x + t, c.z + c.d / 2 - 2.2, c.w / n - 0.3, 4.4, 0)
        if (i < n - 1) rowHouse(c.x + c.w / 2 - 2.2, c.z - c.d / 2 + (i + 0.5) * (c.d / n), 4.4, c.d / n - 0.3, Math.PI / 2)
      }
      // The block's back corner is a garden: a tree, a bed of flowers, a bench.
      const [g] = lots(c, 2, 2, 0)
      k.tree(g.x - 0.8, g.z - 0.8, { kind: rng.chance(0.6) ? 'round' : 'palm', h: rng.range(1.6, 2.4), r: rng.range(1.0, 1.3), leaf: rng.pick([0x4bb35d, 0x3fa04f, 0x6cc46a]) })
      if (rng.chance(0.7)) k.flowerbed(g.x + 1.6, g.z + 0.4, 2.2, 1.4, { kerb: 0xd9d2c2 })
      if (rng.chance(0.4)) k.bench(g.x - 0.6, g.z + 1.8, 0, 0x6b4a2b)
    },
  })

  // ─── The fish market, the fair, the beach ──────────────────────────────
  const [cx, cz] = at(sx, sy)
  for (const [dsx, dsy] of [[-a - 5, 4], [-a - 8, -1]] as const) {
    const [x, z] = at(sx + dsx, sy + dsy)
    k.stall(x, z, Math.atan2(cx - x, cz - z) + Math.PI, 0x2f8fbf, 0xf5f0e6)
  }
  k.crate(...at(sx - a - 6, sy + 1), 0.6, 0xbfe3f0)
  k.crate(...at(sx - a - 5.4, sy + 1.6), 0.5, 0xbfe3f0)
  // The wheel stands still, whole, in the render. It turned for an afternoon:
  // its spokes and cabins were sprites spinning about the hub, and a sprite
  // is drawn over everything — so the twelve cabins rode their circle across
  // the roofs of the terrace standing in front of the fair, as pale cubes
  // floating on the houses. What moves has to move where nothing stands
  // between it and the camera, and a wheel twelve tiles across in a street
  // of houses is not that.
  {
    const [wx, wz] = at(wheelSpot.sx, wheelSpot.sy), r = 6
    k.box(wx - 2.6, 0, wz, 0.45, 7.2, 0.45, 0x2a2f3a, { tilt: 0.36, rot: Math.PI / 4 })
    k.box(wx + 2.6, 0, wz, 0.45, 7.2, 0.45, 0x2a2f3a, { tilt: -0.36, rot: Math.PI / 4 })
    k.cyl(wx, 7, wz, 0.55, 1.1, 0xd94c4c, { axis: 'z', rot: Math.PI / 4, seg: 10 })
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * Math.PI * 2
      k.box(wx, 7, wz, r, 0.18, 0.18, 0x9aa3b5, { tilt: t, rot: Math.PI / 4, outline: false, cap: false })
      const px = wx + Math.cos(t) * r * Math.SQRT1_2, pz = wz - Math.cos(t) * r * Math.SQRT1_2, py = 7 + Math.sin(t) * r
      k.box(px, py - 0.4, pz, 0.8, 0.8, 0.8, rng.pick(paints), { cap: false })
      if (on) k.sphere(px, py + 0.2, pz, 0.11, rng.pick([0xffd23c, 0xff3d68, 0x4fd6ff]), { glow: true, seg: 4, outline: false })
    }
    for (let i = 0; i < 28; i++) {
      const t = (i / 28) * Math.PI * 2
      k.sphere(wx + Math.cos(t) * (r + 0.55) * Math.SQRT1_2, 7 + Math.sin(t) * (r + 0.55), wz - Math.cos(t) * (r + 0.55) * Math.SQRT1_2, 0.11, on ? 0xfff0c0 : 0x9aa3b5, { glow: on, seg: 4, outline: false })
    }
    if (on) k.halo(wx + 0.5, 7, wz + 0.5, r + 1.2, 0xffd23c, 0.2, false)
    k.box(...at(wheelSpot.sx, wheelSpot.sy - 4), 0, 2.4, 1.3, 1.3, 0xf4d35e, { rot: Math.PI / 4 })
    k.person(...at(wheelSpot.sx + 1.5, wheelSpot.sy - 4), -Math.PI / 4, { hat: 0xd94c4c })
    const [mx, mz] = at(wheelSpot.sx - 8, wheelSpot.sy - 3)
    k.cyl(mx, 0, mz, 4, 0.5, 0xf5f0e6, { seg: 14 })
    k.cyl(mx, 0.5, mz, 0.3, 3, 0xd94c4c, { seg: 6, cap: false })
    k.cone(mx, 3.5, mz, 4.6, 1.6, 0xd94c4c, { seg: 14 })
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2
      k.cyl(mx + Math.cos(t) * 2.8, 0.5, mz + Math.sin(t) * 2.8, 0.06, 3, 0xe0b45a, { seg: 4, cap: false, outline: false })
      k.box(mx + Math.cos(t) * 2.8, 1.2, mz + Math.sin(t) * 2.8, 0.9, 0.7, 0.5, rng.pick(paints), { cap: false })
    }
    if (on) k.halo(mx, 0.55, mz, 5, 0xffe2a8, 0.25)
  }
  {
    // An oval of paler sand, not a rotated box: a box at 45° draws a perfectly
    // horizontal ink line across the frame, and a beach whose top edge lands a
    // few centimetres above the paving showed nothing of itself but that line.
    const [bx, bz] = at(beachSpot.sx, beachSpot.sy)
    k.oval(bx, -0.04, bz, 13, 15, 0.1, k.ground(0xe8d6a8), { rot: Math.PI / 4, outline: false, cap: false })
    const spots: [number, number][] = []
    const clear = (px: number, py: number, r: number) => {
      if (spots.some(([qx, qy]) => Math.hypot(qx - px, (qy - py) / 0.53) < r)) return false
      spots.push([px, py])
      return true
    }
    for (let i = 0; i < 14 && spots.length < 8; i++) {
      const px = beachSpot.sx - 7 + rng.range(0, 14)
      const py = beachSpot.sy + 2 - rng.range(0, 6)
      if (!clear(px, py, 2.6)) continue
      const [x, z] = at(px, py)
      if (!k.model(rng.chance(0.5) ? 'city/detail-parasol-a' : 'city/detail-parasol-b', x, z, { rot: rng.range(0, 6.3), scale: 1.3, margin: 0.4 })) {
        k.cyl(x, 0.05, z, 0.05, 2.2, 0xf5f0e6, { seg: 4, cap: false, outline: false })
        k.cone(x, 1.9, z, 1.2, 0.55, rng.pick([0xd94c4c, 0x2f8fbf, 0xf4d35e, 0xff3d68]), { seg: 8, cap: false })
      }
      k.slab(x + 0.9, z + 0.7, 1.7, 0.9, rng.pick(paints), { y: 0.06, h: 0.03, rot: rng.range(-0.4, 0.4) })
    }
    const [lx, lz] = at(beachSpot.sx + 4, beachSpot.sy + 3)
    k.box(lx - 0.5, 0, lz, 0.2, 2.8, 0.2, 0xf5f0e6, { cap: false })
    k.box(lx + 0.5, 0, lz, 0.2, 2.8, 0.2, 0xf5f0e6, { cap: false })
    k.box(lx, 2.6, lz, 1.5, 0.5, 1.3, 0xd94c4c)
    k.person(lx, lz - 0.1, Math.PI, { shirt: 0xd94c4c, hat: 0xf5f0e6 })
    k.tree(...at(beachSpot.sx + 2, beachSpot.sy + 5), { kind: 'palm', h: 2.6 })
    k.tree(...at(beachSpot.sx - 7, beachSpot.sy + 3), { kind: 'palm', h: 3 })
    for (let i = 0; i < 5; i++) k.person(...at(beachSpot.sx - 6 + rng.range(0, 12), beachSpot.sy + 1 - rng.range(0, 5)), rng.range(0, 6.3))
  }
  for (let i = 0; i < 10; i++) {
    const t = (i / 10) * Math.PI * 2
    const px = sx + Math.cos(t) * (a + 7)
    const py = sy + Math.sin(t) * (b + 4.5)
    if (py > shoreAt(px) - 3) continue
    const [x, z] = at(px, py)
    if (i % 2) k.lamp(x, z, { h: 2.6, color: 0xffe1a1, post: 0x2a2f3a })
    else k.bench(x, z, Math.atan2(cx - x, cz - z) + Math.PI, 0x6b4a2b)
  }
  crowd(k, 10)

  // ─── What moves: the harbour is the room with the most to move ─────────
  const life: Actor[] = []
  // The ferry follows the shore, so it clears the plaza's bulge in the middle
  // of the frame, and comes through every couple of minutes — **east of the
  // pier only**. A sprite passes in front of everything, so a ferry sailing
  // the whole width sailed through the lighthouse island and over the pier
  // head; from the pier eastward the water is open, and it fades in there.
  const shoreline = (n: number, from: number, to: number, step = 8): ScreenPt[] => {
    const pts: ScreenPt[] = []
    for (let x = from; x <= to; x += step) pts.push([x, shoreAt(x) + n])
    return pts
  }
  life.push(vessel(k, 'ferry', { path: shoreline(4.2, -12, 52), hull: 0x2a3550, len: 9, duration: 60_000, every: 140_000, fade: true }))
  // Gulls, three of them, on wide arcs over the water.
  for (let i = 0; i < 3; i++) {
    const y0 = QUAY + 4 + i * 1.3
    life.push(bird(k, `gull-${i}`, { path: [[-50, y0], [-20, y0 + 2], [10, y0 - 1], [50, y0 + 1.5]], duration: 30_000 + i * 6000, delay: i * 9000 }))
  }
  // Over the water, where nothing stands under it.
  life.push(balloon(k, 'balloon', { at: [10, shoreAt(10) + 1.5], colors: [0xd94c4c, 0xf5f0e6], y: 6 }))
  if (k.rig.weather === 'clear' || k.rig.weather === 'cloudy') {
    life.push(cloud(k, 'cloud-0', { sy: 19, size: 1.2, duration: 170_000 }))
    life.push(cloud(k, 'cloud-1', { sy: 16, size: 0.8, duration: 210_000, delay: 70_000, from: 50, to: -50 }))
  }
  life.push(...pacers(k, 4, (t) => [-40 + 80 * t, shoreAt(-40 + 80 * t) - 1.5]))
  life.push(...strollers(k, 3))
  life.push(...streetWalkers(k, plan, 3), ...traffic(k, plan, CARS, 2))
  return life
}
