/// <reference types="vitest/config" />
import { defineConfig, mergeConfig } from 'vite'
import viteConfig from './vite.config'

// The app's own Vite config, `sveltekit()` plugin and all, with the test run's
// two needs on top. Configuring Vitest separately would let a test pass against
// a module graph production never sees.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
    },
    resolve: {
      // Svelte ships a `browser` export condition and a server one. Under jsdom
      // Vite resolves the server build by default, whose components render to a
      // string and never mount, so `@testing-library/svelte` finds an empty
      // container and every query fails on a component that works in the browser.
      conditions: ['browser'],
    },
  }),
)
