// bini-export/src/index.ts
// Static SPA export for GitHub Pages.
//
// WHAT IT DOES (and nothing more)
// ──────────────────────────────────────────────────────────────────────────────
// 1. Patches BrowserRouter basename in the generated App.tsx to match
//    Vite's `base` config before the build runs, then restores it after.
//    (bini-router always writes basename="/" — this is the root cause of
//    the blank page on GitHub Pages when base is set to a repo sub-path)
//
// 2. Copies dist/index.html into dist/<route>/index.html for every static
//    route found in the generated App.tsx, so GitHub Pages serves them
//    directly without needing a redirect round-trip.
//
// 3. Writes a dist/404.html that saves the full original URL to
//    sessionStorage and redirects to the repo root. The receiver script
//    (injected into index.html) restores the full URL before React boots
//    so BrowserRouter can strip the basename and match the correct route.
//    NOTE: the full URL including the basename prefix must be stored and
//    restored — restoring only the path suffix breaks BrowserRouter.
//
// 4. Removes any platform entry files bini-router generated (server/,
//    worker.ts, netlify/, etc.) that have no place in a static export.
//
// SETUP
// ──────────────────────────────────────────────────────────────────────────────
//   vite.config.ts
//     base: '/your-repo-name/'
//     plugins: [react(), biniroute({ platform: 'node' }), biniExport()]
//
//   package.json
//     "export": "vite build --mode export"
//
// USAGE
//   pnpm export  →  builds dist/ ready to push to GitHub Pages

import fs   from 'node:fs'
import path from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BiniExportOptions {
  /** Extra paths to delete after build, relative to project root. @default [] */
  cleanPaths?: string[]
  /** Vite mode that activates this plugin. @default 'export' */
  mode?: string
  /** Write dist/404.html. @default true */
  copy404?: boolean
  /** Copy index.html into each route folder. @default true */
  prerender?: boolean
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BINI_ROUTER_GENERATED = [
  'netlify/edge-functions/api.ts',
  'netlify/edge-functions/api.js',
  'worker.ts',
  'worker.js',
  'server/index.ts',
  'server/index.js',
  'handler.ts',
  'handler.js',
  'api/index.ts',
  'api/index.js',
]

const APP_CANDIDATES    = ['src/App.tsx', 'src/App.jsx'] as const
const NOT_FOUND_EXTS    = ['.tsx', '.jsx', '.ts', '.js'] as const

const C = {
  cyan  : (s: string) => `\x1b[36m${s}\x1b[0m`,
  green : (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim   : (s: string) => `\x1b[2m${s}\x1b[0m`,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** '/repo/'  → '/repo'   |   '/' → '' */
function normBase(base: string): string {
  const b = base.startsWith('/') ? base : `/${base}`
  return b === '/' ? '' : b.replace(/\/$/, '')
}

function findAppFile(root: string): string | null {
  for (const r of APP_CANDIDATES) {
    const abs = path.join(root, r)
    if (fs.existsSync(abs)) return abs
  }
  return null
}

function findNotFoundFile(root: string): boolean {
  for (const ext of NOT_FOUND_EXTS) {
    if (fs.existsSync(path.join(root, `src/app/not-found${ext}`))) return true
  }
  return false
}

/**
 * Replace basename={"/"} in the bini-router generated App file.
 * Returns the original content so the caller can restore it, or null
 * if the pattern was not found or the value was already correct.
 */
function patchBasename(appFile: string, base: string): string | null {
  let original: string
  try { original = fs.readFileSync(appFile, 'utf8') } catch { return null }

  const re = /basename=\{("[^"]*")\}/
  if (!re.test(original)) return null

  const patched = original.replace(re, `basename={${JSON.stringify(base)}}`)
  if (patched === original) return null          // already the right value

  try { fs.writeFileSync(appFile, patched, 'utf8') } catch { return null }
  return original
}

/**
 * Read static route paths from the generated App.tsx.
 * Skips dynamic (:param) and catch-all (*) routes.
 */
function scanRoutes(root: string): string[] {
  let src = ''
  for (const r of APP_CANDIDATES) {
    const f = path.join(root, r)
    if (fs.existsSync(f)) { src = fs.readFileSync(f, 'utf8'); break }
  }
  if (!src) return ['/']

  const routes = new Set<string>(['/'])
  const re     = /\bpath=["']([^"']+)["']/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const p = m[1]?.trim()
    if (!p || p === '/' || p === '*') continue
    if (p.includes(':') || p.includes('*')) continue
    routes.add(p.startsWith('/') ? p : `/${p}`)
  }
  return [...routes].sort()
}

// ─── 404 redirect ─────────────────────────────────────────────────────────────
//
// GitHub Pages SPA routing with a basename works like this:
//
//   Direct visit to /repo/about
//     → GitHub has no file there → serves 404.html
//     → 404.html stores the FULL pathname (/repo/about) in sessionStorage
//     → redirects to /repo/
//     → index.html loads, receiver restores /repo/about via replaceState
//     → BrowserRouter(basename="/repo/") sees /repo/about, strips prefix → /about ✓
//
//   WRONG approach (old bug): store only the suffix (/about), restore /about
//     → BrowserRouter sees /about which doesn't start with /repo/
//     → can't strip basename → falls through to * route → shows 404 page ✗
//
// Rule: always store and restore the FULL pathname including the basename.

function generate404(base: string): string {
  const cleanBase = normBase(base)   // e.g. '/testing-static-servers'
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Redirecting\u2026</title>
<script>
// bini-export: GitHub Pages SPA 404 handler
// Store the FULL original pathname (including basename prefix) so that
// BrowserRouter can strip the prefix and match the correct route after load.
sessionStorage.setItem('__bini_spa_redirect', location.pathname + location.search + location.hash);
location.replace('${cleanBase}/');
</script>
</head>
<body></body>
</html>`
}

// Injected as the first thing in <head> of every HTML file.
// Runs synchronously before any JS bundle, so BrowserRouter reads the
// already-correct URL on its very first render.
const REDIRECT_RECEIVER = `<script>
// bini-export: restore path after GitHub Pages 404 redirect
(function () {
  var redirect = sessionStorage.getItem('__bini_spa_redirect');
  if (redirect) {
    sessionStorage.removeItem('__bini_spa_redirect');
    // Restore FULL pathname — BrowserRouter needs the basename prefix present
    history.replaceState(null, '', redirect);
  }
})();
</script>`

// ─── Prune empty dirs ─────────────────────────────────────────────────────────

function pruneEmptyDirs(root: string, rel: string, log: ResolvedConfig['logger']): void {
  let cur = path.resolve(root, path.dirname(rel))
  while (cur !== root && cur !== path.dirname(cur)) {
    try {
      if (!fs.existsSync(cur) || fs.readdirSync(cur).length > 0) break
      fs.rmdirSync(cur)
      log.info(`  ${C.green('➜')}  removed empty dir ${C.dim(path.relative(root, cur))}`)
      cur = path.dirname(cur)
    } catch { break }
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export function biniExport(opts: BiniExportOptions = {}): Plugin {
  const {
    cleanPaths: extraPaths = [],
    mode: targetMode = 'export',
    copy404   = true,
    prerender = true,
  } = opts

  const pathsToClean = [...BINI_ROUTER_GENERATED, ...extraPaths]

  let cfg      : ResolvedConfig
  let isExport = false

  // Saved so we can restore App.tsx after the build completes
  let savedOriginal : string | null = null
  let savedAppPath  : string | null = null

  function restoreApp(log: ResolvedConfig['logger']): void {
    if (savedAppPath && savedOriginal !== null) {
      try {
        fs.writeFileSync(savedAppPath, savedOriginal, 'utf8')
        log.info(`  ${C.green('➜')}  restored ${C.dim(path.relative(cfg.root, savedAppPath))}`)
      } catch (e) {
        log.warn(`  ${C.yellow('⚠')}  could not restore App file: ${(e as Error).message}`)
      }
      savedOriginal = null
      savedAppPath  = null
    }
  }

  function tryRemove(abs: string, rel: string): boolean {
    try {
      if (!fs.existsSync(abs)) return false
      fs.rmSync(abs, { recursive: true, force: true })
      cfg.logger.info(`  ${C.green('➜')}  removed ${C.dim(rel)}`)
      return true
    } catch (e) {
      cfg.logger.warn(`  ${C.yellow('⚠')}  could not remove ${rel}: ${(e as Error).message}`)
      return false
    }
  }

  return {
    name   : 'vite-plugin-bini-export',
    enforce: 'post',

    configResolved(resolved) {
      cfg      = resolved
      isExport = resolved.mode === targetMode
      if (isExport) cfg.logger.info(`\n  ${C.cyan('ß bini-export')} static export mode\n`)
    },

    // ── FIX 1: patch basename BEFORE Vite compiles any modules ────────────────
    // bini-router's config() hook runs first and writes App.tsx with
    // basename="/". Our buildStart (enforce:'post') runs after all other
    // plugins' buildStart, so App.tsx is already on disk by this point.
    buildStart() {
      if (!isExport) return

      const base    = cfg.base || '/'
      const appFile = findAppFile(cfg.root)

      if (!appFile) {
        cfg.logger.warn(`  ${C.yellow('⚠')}  bini-export: App.tsx/App.jsx not found`)
        return
      }

      const original = patchBasename(appFile, base)

      if (original === null) {
        // Either pattern missing (user-customised App) or already correct
        cfg.logger.info(
          `  ${C.cyan('ß bini-export')} basename already correct in ` +
          C.dim(path.relative(cfg.root, appFile))
        )
        return
      }

      savedAppPath  = appFile
      savedOriginal = original

      cfg.logger.info(
        `  ${C.cyan('ß bini-export')} patched BrowserRouter basename → ` +
        `${C.green(base)} in ${C.dim(path.relative(cfg.root, appFile))}`
      )
    },

    // ── Inject 404 redirect receiver into every HTML file ─────────────────────
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!isExport) return html
        // First child of <head> → runs before any deferred script,
        // before React, before BrowserRouter reads window.location
        return html.replace(/<head([^>]*)>/i, m => m + '\n    ' + REDIRECT_RECEIVER)
      },
    },

    // ── Post-build: copy routes, write 404.html, clean up ─────────────────────
    async closeBundle() {
      if (!isExport || cfg.command !== 'build') {
        restoreApp(cfg.logger)
        return
      }

      const base   = cfg.base || '/'
      const outDir = path.resolve(cfg.root, cfg.build.outDir)

      // Restore App.tsx first — dist/ is fully written by now
      restoreApp(cfg.logger)

      const indexPath = path.join(outDir, 'index.html')
      if (!fs.existsSync(indexPath)) {
        cfg.logger.warn(`  ${C.yellow('⚠')}  dist/index.html not found — build may have failed`)
        return
      }

      const indexHtml = fs.readFileSync(indexPath, 'utf8')

      // ── Copy index.html into each route folder ─────────────────────────────
      if (prerender) {
        const routes = scanRoutes(cfg.root)
        cfg.logger.info(
          `\n  ${C.cyan('ß bini-export')} copying index.html to ${C.green(String(routes.length))} route(s)`
        )

        for (const route of routes) {
          if (route === '/') continue                 // root already exists

          const dir  = path.join(outDir, route.replace(/^\//, ''))
          const file = path.join(dir, 'index.html')

          try {
            fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(file, indexHtml, 'utf8')
            cfg.logger.info(
              `  ${C.green('➜')}  ${route} ${C.dim('→')} ${C.cyan(path.relative(cfg.root, file))}`
            )
          } catch (e) {
            cfg.logger.warn(`  ${C.yellow('⚠')}  failed to copy to ${route}: ${(e as Error).message}`)
          }
        }
      }

      // ── Write 404.html ─────────────────────────────────────────────────────
      if (copy404) {
        const dest      = path.join(outDir, '404.html')
        const hasCustom = findNotFoundFile(cfg.root)

        try {
          if (hasCustom) {
            // Custom not-found page: serve the SPA shell so React Router can
            // render the user's not-found component via the * route client-side
            fs.writeFileSync(dest, indexHtml, 'utf8')
            cfg.logger.info(
              `  ${C.green('➜')}  404.html ${C.dim('←')} custom not-found ` +
              C.cyan(path.relative(cfg.root, dest))
            )
          } else {
            // Default: JS redirect that stores the full URL and bounces to root
            fs.writeFileSync(dest, generate404(base), 'utf8')
            cfg.logger.info(
              `  ${C.green('➜')}  404.html ${C.dim('←')} redirect template ` +
              C.cyan(path.relative(cfg.root, dest))
            )
          }
        } catch (e) {
          cfg.logger.warn(`  ${C.yellow('⚠')}  failed to write 404.html: ${(e as Error).message}`)
        }
      }

      // ── Remove bini-router platform entry files ────────────────────────────
      let removed = 0
      for (const rel of pathsToClean) {
        const abs = path.resolve(cfg.root, rel)
        if (tryRemove(abs, rel)) {
          pruneEmptyDirs(cfg.root, rel, cfg.logger)
          removed++
        }
      }

      cfg.logger.info(
        removed === 0
          ? `\n  ${C.cyan('ß bini-export')} dist/ is already clean\n`
          : `\n  ${C.cyan('ß bini-export')} export complete — ${C.green(String(removed))} file(s) removed\n`
      )
    },

    // Safety net — always restore App.tsx even if the build throws
    buildEnd(error) {
      if (error) restoreApp(cfg.logger)
    },
  }
}