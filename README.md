# bini-export

<div align="center">

[![npm version](https://img.shields.io/npm/v/bini-export?color=00CFFF&labelColor=0a0a0a&style=flat-square)](https://www.npmjs.com/package/bini-export)
[![license](https://img.shields.io/badge/license-MIT-00CFFF?labelColor=0a0a0a&style=flat-square)](./LICENSE)
[![vite](https://img.shields.io/badge/vite-7%2B%20%7C%208%2B-646cff?labelColor=0a0a0a&style=flat-square)](https://vitejs.dev)
[![bini-router](https://img.shields.io/badge/bini--router-compatible-00CFFF?labelColor=0a0a0a&style=flat-square)](https://www.npmjs.com/package/bini-router)
[![typescript](https://img.shields.io/badge/typescript-ready-3178c6?labelColor=0a0a0a&style=flat-square)](https://www.typescriptlang.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-00CFFF?labelColor=0a0a0a&style=flat-square)](https://github.com/binidu/bini-export/pulls)

**Pure static SPA export for [`bini-router`](https://www.npmjs.com/package/bini-router) projects.**  
Pre-renders every static route, generates the right `404.html`, and strips all platform server files — leaving `dist/` ready for GitHub Pages, S3, Firebase, Surge, and any other fully static host.

</div>

---

## Install

```bash
npm install -D bini-export
```

---

## Setup

### 1. `vite.config.ts`

```ts
import { defineConfig } from 'vite'
import react            from '@vitejs/plugin-react'
import { biniroute }    from 'bini-router'
import { biniExport }   from 'bini-export'

export default defineConfig({
  base: '/your-repo-name/', // 👈 see note below
  plugins: [
    react(),
    biniroute({ platform: 'node' }),
    biniExport(),
  ],
})
```

> **Do you need `base`?**
>
> | Situation | `base` |
> |---|---|
> | GitHub Pages **without** a custom domain | `'/your-repo-name/'` |
> | GitHub Pages **with** a custom domain | not needed — remove it |
> | S3, Firebase, Surge, or any other static host | not needed — remove it |

If you use the function form of `defineConfig`, `base` goes at the top level of the returned object:

```ts
export default defineConfig(({ command, mode }) => {
  return {
    base: '/your-repo-name/', // top-level, same level as plugins and build
    plugins: [ ... ],
    build: { ... },
  }
})
```

### 2. `package.json`

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

| Command | When to use |
|---|---|
| `npm run build` | Node servers, Netlify, Vercel, Cloudflare — any platform with server support |
| `npm run export` | Fully static hosts — GitHub Pages, S3, Firebase, Surge, etc. |

### Export output

```
dist/
  index.html
  about/
    index.html
  dashboard/
    index.html
  404.html
```

---

## 404 Handling

| Situation | What gets written to `404.html` |
|---|---|
| `src/app/not-found.tsx` exists (also `.jsx` / `.ts` / `.js`) | A copy of `index.html` — React Router renders your custom not-found page |
| No custom not-found file | A redirect script that saves the original URL and sends the user to the repo root, where the SPA restores it automatically |

---

## Options

```ts
biniExport({
  cleanPaths: ['some/generated/file.ts'], // extra files to delete after export (default: [])
  mode      : 'export',                   // vite --mode flag that activates this plugin (default: 'export')
  copy404   : true,                       // write 404.html (default: true)
  prerender : true,                       // copy index.html into each route folder (default: true)
})
```

---

## Files cleaned after export

| Platform | File(s) removed |
|---|---|
| Netlify | `netlify/edge-functions/api.ts` · `api.js` |
| Cloudflare Workers | `worker.ts` · `worker.js` |
| Node / Deno / Bun | `server/index.ts` · `server/index.js` |
| AWS Lambda | `handler.ts` · `handler.js` |
| Vercel | `api/index.ts` · `api/index.js` |

Empty parent directories are pruned automatically.

---

## Works on any fully static host

| Host | Static routes | Dynamic routes |
|---|---|---|
| GitHub Pages | ✅ | ✅ via `404.html` |
| AWS S3 + CloudFront | ✅ | ✅ set error page to `404.html` |
| Firebase Hosting | ✅ | ✅ via `404.html` |
| Surge.sh | ✅ | ✅ via `404.html` |

---

## License

MIT © [Binidu Ranasinghe](https://bini.js.org)