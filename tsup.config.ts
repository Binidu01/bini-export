// tsup.config.ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: 'es2022',

  // All peer dependencies and Node built-ins should be external
  external: [
    'node:fs',
    'node:path',
    'fs',
    'path',
    'vite',
    'puppeteer',
  ],

  esbuildOptions(opts) {
    opts.platform = 'node'
    opts.conditions = ['import', 'require']
    opts.mainFields = ['module', 'main']
    opts.target = 'es2022'
  },

  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' }
  },

  banner: {
    js: `/**
 * bini-export v1.0.2
 * Static export for Bini.js with true SSG
 * 
 * Pre-renders React routes to static HTML via headless browser.
 * Optimized for GitHub Pages, Netlify, Vercel, and other static hosts.
 * 
 * @author Binidu Ranasinghe
 * @license MIT
 */`
  }
})