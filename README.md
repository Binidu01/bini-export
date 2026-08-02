# bini-export

<div align="center">

[![npm version](https://img.shields.io/npm/v/bini-export?color=00CFFF&labelColor=0a0a0a&style=flat-square)](https://www.npmjs.com/package/bini-export)
[![license](https://img.shields.io/badge/license-MIT-00CFFF?labelColor=0a0a0a&style=flat-square)](./LICENSE)
[![vite](https://img.shields.io/badge/vite-5%2B%20%7C%206%2B%20%7C%207%2B%20%7C%208%2B-646cff?labelColor=0a0a0a&style=flat-square)](https://vitejs.dev)
[![bini-router](https://img.shields.io/badge/bini--router-compatible-00CFFF?labelColor=0a0a0a&style=flat-square)](https://www.npmjs.com/package/bini-router)
[![typescript](https://img.shields.io/badge/typescript-ready-3178c6?labelColor=0a0a0a&style=flat-square)](https://www.typescriptlang.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-00CFFF?labelColor=0a0a0a&style=flat-square)](https://github.com/Binidu01/bini-export/pulls)

**Static Site Generator for Bini.js projects, with optional true SSG via headless-browser pre-rendering.**
Discovers routes from `src/app/`, pre-renders them to static HTML with a pool of parallel headless Chrome tabs, generates `404.html`, and leaves `dist/` ready for GitHub Pages, S3, Firebase, Surge, and any other static host.

</div>

---

## 📦 Install

```bash
npm install -D bini-export
```

---

## 🚀 Quick Start

### 1. Add to `vite.config.ts`

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { biniroute } from 'bini-router';
import { biniExport } from 'bini-export';

export default defineConfig({
  plugins: [
    react(),
    biniroute(),
    biniExport(), // SSG enabled by default (puppeteer installs automatically)
  ],
});
```

### 2. Add export script to `package.json`

```json
{
  "scripts": {
    "export": "vite build --mode export"
  }
}
```

### 3. Run export

```bash
npm run export
```

Your static site is now in `dist/`.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **True SSG** | Pre-renders every discovered route to fully static HTML via a headless-Chrome pool, not just an SPA shell |
| **Parallel rendering** | Routes render concurrently across multiple tabs sharing one browser instance (tunable via `concurrency`) |
| **SEO Ready** | Rendered content is present in the HTML for search engines and AI crawlers |
| **File-based Routing** | Automatically discovers routes from `src/app/` (`page.tsx` / `page.jsx`) |
| **Route Groups** | Ignores `(folder)` segments in the URL path |
| **Private Folders** | Skips any `_folder` (and files starting with `_`) during route collection |
| **MDX/Markdown pages** | Treats `.mdx`/`.md` files under `src/app/` as routes (rendering itself is handled by your MDX loader, not this plugin) |
| **Runtime CSS capture** | Captures `<style>`/`<link rel="stylesheet">` tags injected into `<head>` at runtime (e.g. CSS-in-JS) so pages are styled on first paint, not just after hydration |
| **Asset path normalization** | Rewrites relative `href`/`src` paths to absolute so nested route pages (e.g. `/about/index.html`) don't lose CSS/JS |
| **404 Handling** | Generates `404.html` — either a copy of your custom not-found page, or a redirect-and-restore script for SPA routing on static hosts |
| **Graceful fallback** | Since `puppeteer` ships as a dependency, this mainly guards against edge cases (corrupted install, unsupported platform, a route erroring out mid-render) — any route that fails to pre-render falls back to your built SPA shell instead of failing the whole build |

**Not currently supported** (despite sometimes being assumed for SSG tools like this): dynamic routes with bracket segments (`[slug]`) are **skipped automatically** during route collection — there's no `getStaticPaths` mechanism. If you need a dynamic route pre-rendered, pass its concrete paths explicitly via the `routes` option.

---

## 📁 How It Works

1. **Build** — Vite builds your app normally for the `export` mode
2. **Collect Routes** — Discovers static routes from `src/app/` (or uses `routes` if you passed it explicitly)
3. **Normalize the template** — Reads the built `dist/index.html` and rewrites relative asset paths to absolute
4. **Launch Browser** — Starts a local Vite preview server and one headless Chrome instance
5. **Pre-render in parallel** — A pool of tabs (default up to `min(8, cpus × 2)`) pulls routes from a shared queue; each tab navigates, waits for your content and any runtime-injected styles, then extracts the rendered HTML
6. **Save** — Writes each route's HTML to its matching output path (`/about` → `dist/about/index.html`)
7. **Shell fallback** — Any route that wasn't successfully pre-rendered (puppeteer missing, or that route errored) gets the plain built shell instead
8. **404.html** — Written last, either from your custom not-found page or as a redirect-and-restore script

---

## ⚙️ Options

```ts
biniExport({
  // Vite mode that activates this plugin
  mode?: string; // @default 'export'

  // Write dist/404.html
  copy404?: boolean; // @default true

  // Enable true SSG via headless-browser prerendering.
  // If false (or puppeteer is missing), routes get the plain SPA shell.
  ssg?: boolean; // @default true

  // Routes to pre-render. Auto-detected from src/app/ if not specified.
  // Required if you need dynamic ([slug]) routes rendered, since those
  // are skipped by auto-detection.
  routes?: string[];

  // Selector that must exist in the DOM before a route is considered rendered
  waitForSelector?: string; // @default '#root'

  // Max time (ms) to wait for a single route to finish rendering
  renderTimeoutMs?: number; // @default 15000

  // Number of routes rendered in parallel (separate tabs, one shared browser)
  concurrency?: number; // @default min(8, cpus() * 2)

  // How long to wait for a 'bini-render-ready' custom event before giving up
  // and using whatever's currently in the DOM
  readyEventTimeoutMs?: number; // @default 300

  // Puppeteer's page.goto waitUntil condition.
  // 'load'/'domcontentloaded' are fast; 'networkidle0'/'networkidle2' wait
  // longer but are safer if your content depends on requests firing after load.
  navigationWaitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2'; // @default 'load'

  // Custom Puppeteer launch options (merged over internal defaults tuned
  // for headless batch rendering — background throttling, extensions, etc.
  // are disabled by default)
  puppeteerOptions?: {
    headless?: boolean;
    args?: string[];
    executablePath?: string;
    timeout?: number;
  };
})
```

### A note on `navigationWaitUntil` and dynamic content

If your page fetches data *after* the `load` event fires (e.g. inside a `useEffect`), the default `'load'` may snapshot before that data resolves. Either:
- make sure your app dispatches a `bini-render-ready` `CustomEvent` on `document` once it's actually done rendering, or
- set `navigationWaitUntil: 'networkidle0'` for slower-but-safer behavior.

### A note on blocked resources during rendering

To speed up pre-rendering, image/font/media requests are blocked at the network layer (via CDP `Network.setBlockedURLs`) while Chrome renders each route. This only affects what Puppeteer fetches during the render step — it has no effect on your shipped `dist/` output or what real visitors' browsers load. If your app does font-based layout measurement (e.g. canvas text-fitting) during initial render, be aware fallback fonts will be in effect at snapshot time.

---

## 🗂️ Output Structure

Actual structure depends on your Vite build config, but a typical output looks like:

```
dist/
├── index.html          ✅ Pre-rendered home page
├── 404.html            ✅ Custom not-found copy, or redirect handler
├── about/
│   └── index.html      ✅ Pre-rendered about page
├── docs/
│   ├── index.html      ✅ Pre-rendered docs landing
│   └── api-cors/
│       └── index.html  ✅ Pre-rendered nested page
└── assets/              ✅ Hashed JS/CSS/image bundles (Vite's default output)
```

Any route that failed to pre-render (or if `puppeteer`/`ssg` isn't enabled) still gets an `index.html` at the correct path — it's just your built SPA shell rather than pre-rendered content.

---

## 🛠️ 404 Handling

| Situation | What gets written to `404.html` |
|-----------|----------------------------------|
| `src/app/not-found.tsx` or `not-found.jsx` exists | A copy of the built `index.html` template — your client-side router renders the custom not-found UI |
| No custom not-found file | A small redirect script: saves the requested path to `sessionStorage`, redirects to the site root, and a receiver script on every page restores the URL via `history.replaceState` |

---

## 🌐 Works on Any Static Host

Pre-rendered static routes work anywhere. For paths not known at build time (e.g. you rely on client-side routing for something not in your route list), point your host's error/fallback page at `404.html`:

| Host | Static Routes | Client-side Fallback Routes |
|------|---------------|------------------------------|
| GitHub Pages | ✅ | ✅ via `404.html` |
| AWS S3 + CloudFront | ✅ | ✅ set the error document to `404.html` |
| Firebase Hosting | ✅ | ✅ via `404.html` rewrite |
| Surge.sh | ✅ | ✅ via `404.html` |
| Netlify (static) | ✅ | ✅ via `404.html` |
| Vercel (static) | ✅ | ✅ via `404.html` |

---

## 📚 Related Packages

- [bini-router](https://www.npmjs.com/package/bini-router) — File-based routing for Bini.js
- [create-bini-app](https://www.npmjs.com/package/create-bini-app) — Create a new Bini.js app
- [bini-server](https://www.npmjs.com/package/bini-server) — Production server for Bini.js
- [bini-deploy](https://www.npmjs.com/package/bini-deploy) — Deploy Bini.js apps anywhere

---

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](https://github.com/Binidu01/bini-export/blob/main/CONTRIBUTING.md) first.

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

## 📄 License

MIT © [Binidu Ranasinghe](https://bini.js.org)

---

<div align="center">
  <sub>Built with ❤️ for the Bini.js ecosystem</sub>
</div>