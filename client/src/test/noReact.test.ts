/**
 * React is gone, and this is what keeps it gone.
 *
 * The migration to Svelte ended with every `.tsx` deleted and every React
 * package uninstalled, and neither of those states defends itself: a stray
 * `import { useState } from 'react'` in a new file installs nothing and fails
 * nowhere until the bundler is asked for a production build, and a dependency
 * added back "just for a test helper" reads as harmless in a diff.
 *
 * So the rule is asserted rather than remembered. It covers the three places
 * React could come back through: the manifest, the build configuration, and the
 * sources themselves.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const CLIENT = path.resolve(__dirname, '..', '..')

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) sources(full, out)
    else if (/\.(tsx?|jsx?|svelte|astro)$/.test(entry)) out.push(full)
  }
  return out
}

describe('the client carries no React', () => {
  it('depends on none of it', () => {
    const pkg = JSON.parse(readFileSync(path.join(CLIENT, 'package.json'), 'utf8'))
    const named = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ].filter((name) => /react|framer-motion/.test(name))
    expect(named, 'these belong to the framework this client left').toEqual([])
  })

  it('configures none of it', () => {
    // The integration and the Fast Refresh preamble were the two hooks React had
    // into the build, and the preamble in particular was custom code that would
    // survive a dependency removal without a word.
    for (const file of ['astro.config.mjs', 'eslint.config.js', 'vitest.config.ts']) {
      const src = readFileSync(path.join(CLIENT, file), 'utf8')
      expect(src, `${file} still wires React in`).not.toMatch(
        /@astrojs\/react|react-refresh|eslint-plugin-react|'react'/i,
      )
    }
  })

  it('imports none of it, anywhere', () => {
    // Tests included: a suite that mounts React is a suite testing something the
    // players never run.
    const offenders = sources(path.join(CLIENT, 'src'))
      .filter((f) => f !== __filename)
      .filter((f) =>
        // Imports, not mentions: a comment that says what left is allowed to
        // name it, and several of them earn their place.
        /from '(react|react-dom|@testing-library\/react|framer-motion)'/.test(
          readFileSync(f, 'utf8'),
        ),
      )
      .map((f) => path.relative(CLIENT, f))
    expect(offenders).toEqual([])
  })

  it('is written in no file extension React owns', () => {
    const jsx = sources(path.join(CLIENT, 'src')).filter((f) => /\.[jt]sx$/.test(f))
    expect(jsx.map((f) => path.relative(CLIENT, f))).toEqual([])
  })
})
