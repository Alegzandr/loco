/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config'

// getViteConfig loads astro.config.mjs and hands Vitest the same resolution,
// aliases and plugin set the app is built with. Configuring Vitest separately
// would let a test pass against a module graph production never sees.
export default getViteConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
