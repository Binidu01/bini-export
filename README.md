# bini-export

<div align="center">

[![npm version](https://img.shields.io/npm/v/bini-export?color=00CFFF&labelColor=0a0a0a&style=flat-square)](https://www.npmjs.com/package/bini-export)
[![license](https://img.shields.io/badge/license-MIT-00CFFF?labelColor=0a0a0a&style=flat-square)](./LICENSE)
[![vite](https://img.shields.io/badge/vite-5%2B%20%7C%206%2B%20%7C%207%2B%20%7C%208%2B-646cff?labelColor=0a0a0a&style=flat-square)](https://vitejs.dev)
[![bini-router](https://img.shields.io/badge/bini--router-compatible-00CFFF?labelColor=0a0a0a&style=flat-square)](https://www.npmjs.com/package/bini-router)
[![typescript](https://img.shields.io/badge/typescript-ready-3178c6?labelColor=0a0a0a&style=flat-square)](https://www.typescriptlang.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-00CFFF?labelColor=0a0a0a&style=flat-square)](https://github.com/Binidu01/bini-export/pulls)

**Static Site Generator for Bini.js projects with true SSG.**  
Pre-renders every static route to full HTML for SEO, generates `404.html`, and strips platform server files — leaving `dist/` ready for GitHub Pages, S3, Firebase, Surge, and any other static host.

</div>

---

## 📦 Install

```bash
npm install -D bini-export
```

> **Note:** `puppeteer` is a dependency of `bini-export` and will be installed automatically. It is required for headless browser pre-rendering.

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
    biniroute({ platform: 'node' }),
    biniExport(), // SSG enabled by default
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

Your fully static site is now in `dist/`!

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **True SSG** | Pre-renders every route to fully static HTML — not just an SPA shell |
| **SEO Ready** | All content is rendered in HTML for search engines and AI crawlers |
| **File-based Routing** | Automatically discovers routes from `src/app/` |
| **Dynamic Routes** | Supports `getStaticPaths` for pre-rendering dynamic routes |
| **Route Groups** | Ignores `(folder)` in paths |
| **Private Folders** | Skips `_folder` in routing |
| **MDX Support** | Pre-renders MDX and Markdown pages |
| **Clean Output** | Removes platform-specific server files automatically |
| **404 Handling** | Generates `404.html` with redirect for GitHub Pages |
| **Works Anywhere** | GitHub Pages, Netlify, Vercel, S3, Firebase, Surge |

---

## 📁 How It Works

1. **Build** — Vite builds your app
2. **Collect Routes** — Discovers all static routes from `src/app/`
3. **Launch Browser** — Starts a preview server and launches Puppeteer
4. **Pre-render** — Navigates to each route and captures the fully rendered HTML
5. **Save** — Writes the HTML to the correct output path
6. **Cleanup** — Removes platform-specific server files

### Dynamic Routes Example

```tsx
// src/app/blog/[slug]/page.tsx
export default function BlogPost({ params }) {
  return <h1>Blog: {params.slug}</h1>;
}

export async function getStaticPaths() {
  const posts = await fetch('https://api.example.com/posts').then(r => r.json());
  return posts.map(post => ({ params: { slug: post.slug } }));
}
```

---

## ⚙️ Options

```ts
biniExport({
  // Vite mode that activates this plugin
  mode?: string; // @default 'export'
  
  // Write dist/404.html
  copy404?: boolean; // @default true
  
  // Enable true SSG via headless-browser prerendering
  ssg?: boolean; // @default true
  
  // Routes to pre-render (auto-detected if not specified)
  routes?: string[];
  
  // Selector that must exist before capturing HTML
  waitForSelector?: string; // @default '#root'
  
  // Max time per route in ms
  renderTimeoutMs?: number; // @default 15000
  
  // Custom Puppeteer launch options
  puppeteerOptions?: {
    headless?: boolean;
    args?: string[];
    executablePath?: string;
    timeout?: number;
  };
})
```

---

## 🗂️ Output Structure

```
dist/
├── index.html          ✅ Fully rendered home page
├── 404.html            ✅ Redirect handler
├── about/
│   └── index.html      ✅ Fully rendered about page
├── docs/
│   ├── index.html      ✅ Fully rendered docs landing
│   └── api-cors/
│       └── index.html  ✅ Fully rendered nested page
├── js/                 ✅ Hydration scripts (preserved)
├── css/                ✅ Styles
└── assets/             ✅ Images, fonts, etc.
```

---

## 🧹 Files Cleaned After Export

| Platform | Files Removed |
|----------|---------------|
| Netlify | `netlify/edge-functions/api.ts`, `api.js` |
| Cloudflare Workers | `worker.ts`, `worker.js` |
| Node / Deno / Bun | `server/index.ts`, `server/index.js` |
| Vercel | `api/index.ts`, `api/index.js` |

Empty parent directories are pruned automatically.

---

## 🛠️ 404 Handling

| Situation | What gets written to `404.html` |
|-----------|----------------------------------|
| `src/app/not-found.tsx` exists | Copy of `index.html` — React Router renders your custom not-found |
| No custom not-found file | Redirect script that saves the original URL and sends to root |

---

## 🌐 Works on Any Static Host

| Host | Static Routes | Dynamic Routes |
|------|---------------|----------------|
| GitHub Pages | ✅ | ✅ via `404.html` |
| AWS S3 + CloudFront | ✅ | ✅ set error page to `404.html` |
| Firebase Hosting | ✅ | ✅ via `404.html` |
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
