import { defineConfig } from 'tsup'

export default defineConfig({
  entry      : ['src/index.ts'],
  format     : ['esm', 'cjs'],
  dts        : true,
  sourcemap  : true,
  clean      : true,
  splitting  : false,
  treeshake  : true,
  target     : 'es2020',

  // Node built-ins and vite are never bundled
  external   : ['node:fs', 'node:path', 'fs', 'path', 'vite'],

  esbuildOptions(opts) {
    opts.platform   = 'node'
    opts.conditions = ['import', 'require']
  },

  // Prevents "named and default exports together" warning
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' }
  },
})