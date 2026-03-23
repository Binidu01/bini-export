# bini-export

<div align="center">

[![npm version](https://img.shields.io/npm/v/bini-export?color=00CFFF&labelColor=0a0a0a&style=flat-square)](https://www.npmjs.com/package/bini-export)
[![license](https://img.shields.io/badge/license-MIT-00CFFF?labelColor=0a0a0a&style=flat-square)](./LICENSE)
[![vite](https://img.shields.io/badge/vite-7%2B%20%7C%208%2B-646cff?labelColor=0a0a0a&style=flat-square)](https://vitejs.dev)
[![bini-router](https://img.shields.io/badge/bini--router-compatible-00CFFF?labelColor=0a0a0a&style=flat-square)](https://www.npmjs.com/package/bini-router)
[![typescript](https://img.shields.io/badge/typescript-ready-3178c6?labelColor=0a0a0a&style=flat-square)](https://www.typescriptlang.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-00CFFF?labelColor=0a0a0a&style=flat-square)](https://github.com/binidu/bini-export/pulls)

**Pure static SPA export for [`bini-router`](https://www.npmjs.com/package/bini-router) projects.**  
Pre-renders every static route, generates the right `404.html`, and strips all platform server files — leaving `dist/` ready for GitHub Pages, Netlify static, Vercel, Cloudflare Pages, S3, and any other static host.

</div>

---

## Features

- 🗂️ **Per-route pre-rendering** — each static route gets its own `index.html` so any static host serves pages directly without client-side routing tricks
- 🔴 **Custom 404 support** — if `src/app/not-found.tsx` exists it's used as `404.html`; otherwise a smart redirect fallback is generated
- 🧹 **Platform file cleanup** — deletes all bini-router platform entries (Netlify, Vercel, Cloudflare, Node, Deno, Bun, AWS) after build, leaving a pure SPA `dist/`
- 📁 **Empty dir pruning** — leftover empty directories are removed automatically
- 🔇 **Zero effect on normal builds** — completely inert unless `--mode export` is passed
- ⚙️ **Configurable** — custom clean paths, mode name, and opt-in/out of each feature
- 🎨 **Vite-style output** — clean, coloured build logs matching Vite's style

---

## Install

```bash
npm install -D bini-export
```

---

## Setup

### 1. Add to `vite.config.ts`

```ts
import { defineConfig } from 'vite'
import react            from '@vitejs/plugin-react'
import { biniEnv }      from 'bini-env'
import { biniroute }    from 'bini-router'
import { biniExport }   from 'bini-export'

export default defineConfig({
  base: '/my-repo/', // required for GitHub Pages subpath deployments
  plugins: [
    react(),
    biniEnv(),
    biniroute({ platform: 'netlify' }), // keep your normal platform
    biniExport(),                        // 👈 add this
  ],
})
```

### 2. Add the `export` script to `package.json`

```json
{
  "scripts": {
    "dev"    : "vite --host --open",
    "build"  : "vite build",
    "export" : "vite build --mode export",
    "preview": "vite preview --host --open"
  }
}
```

---

## Usage

| Command | What happens |
|---|---|
| `pnpm build` | Normal build — platform entry generated as usual |
| `pnpm export` | Static export — routes pre-rendered, 404.html generated, platform files deleted |

### Normal build output
```
dist/
netlify/
  edge-functions/
    api.ts          ← bini-router platform entry (kept)
```

### Static export output
```
dist/
  index.html        ← SPA shell
  about/
    index.html      ← pre-rendered /about
  dashboard/
    index.html      ← pre-rendered /dashboard
  404.html          ← custom or default fallback
```

### Build log
```
  ß bini-export  static export mode

  ß bini-export  pre-rendering 4 route(s)
  ➜  /about → dist/about/index.html
  ➜  /dashboard → dist/dashboard/index.html
  ➜  /profile → dist/profile/index.html
  ➜  404.html ← redirect template dist/404.html
  ➜  removed netlify/edge-functions/api.ts

  ß bini-export  export complete — 1 file(s) removed
```

---

## 404 Handling

bini-export automatically picks the right `404.html` strategy based on your project:

| Situation | What gets generated |
|---|---|
| `src/app/not-found.tsx` exists | `404.html` is a copy of `index.html` — the host boots the SPA and React Router renders your custom page |
| No custom not-found | `404.html` uses a redirect script that saves the original path to `sessionStorage` and sends the user to `/`, where the SPA restores the URL via `history.replaceState` |

---

## Pre-rendering

On every `pnpm export`, bini-export reads your auto-generated `src/App.tsx` and extracts all static routes, skipping dynamic `:param` and `*` catch-all routes. For each route it copies `dist/index.html` into `dist/<route>/index.html`.

This means any static host can serve `/about` directly without needing a redirect, and your app loads instantly on any pre-rendered route.

**Dynamic routes** (e.g. `/blog/:slug`) are not pre-rendered — they are handled client-side as normal by React Router via the 404 redirect fallback.

---

## Works on any static host

| Host | Static routes | Dynamic routes |
|---|---|---|
| GitHub Pages | ✅ pre-rendered | ✅ via 404.html redirect |
| Netlify static | ✅ pre-rendered | ✅ via 404.html redirect |
| Vercel static | ✅ pre-rendered | ✅ via 404.html redirect |
| Cloudflare Pages | ✅ pre-rendered | ✅ via 404.html redirect |
| AWS S3 + CloudFront | ✅ pre-rendered | ✅ configure error page to 404.html |
| Firebase Hosting | ✅ pre-rendered | ✅ via 404.html redirect |
| Surge.sh | ✅ pre-rendered | ✅ via 404.html redirect |

---

## Options

```ts
biniExport({
  /**
   * Extra paths to delete after the static export build,
   * relative to the project root.
   * The plugin already covers all bini-router platform outputs by default.
   * @default []
   */
  cleanPaths: ['some/generated/file.ts'],

  /**
   * The Vite mode that activates this plugin.
   * Must match the --mode flag you pass to vite build.
   * @default 'export'
   */
  mode: 'export',

  /**
   * Generate a 404.html fallback.
   * Uses your custom not-found page if present, otherwise a redirect template.
   * @default true
   */
  copy404: true,

  /**
   * Pre-render each static route as its own index.html.
   * @default true
   */
  prerender: true,
})
```

---

## Default paths cleaned

The plugin removes whichever of these exist after the build:

| Platform | Generated file |
|---|---|
| Netlify | `netlify/edge-functions/api.ts` |
| Cloudflare Workers | `worker.ts` |
| Node / Deno / Bun | `server/index.ts` · `server/index.js` |
| AWS Lambda | `handler.ts` · `handler.js` |
| Vercel | `api/index.ts` · `api/index.js` |

Empty parent directories left behind are pruned automatically.

---

## How it works

`biniExport()` is a Vite plugin that hooks into `closeBundle` — the lifecycle event that fires after every file has been written to disk. When the build mode matches (default: `export`), it:

1. Reads `dist/index.html`
2. Scans `src/App.tsx` for static routes and copies `index.html` into each route directory
3. Injects a `sessionStorage` redirect receiver into every pre-rendered `index.html` so dynamic route fallbacks work correctly
4. Writes `404.html` — using your custom not-found page if one exists, or the redirect template otherwise
5. Deletes all known bini-router platform output files and prunes empty directories

In any other mode it is completely inert — zero effect on normal builds.

---

## License

MIT © [Binidu Ranasinghe](https://bini.js.org)