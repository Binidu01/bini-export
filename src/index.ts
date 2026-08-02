// bini-export/src/index.ts
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Plugin, ResolvedConfig } from 'vite';
import { createServer } from 'vite';

export interface BiniExportOptions {
  /** Vite mode that activates this plugin. @default 'export' */
  mode?: string;
  /** Write dist/404.html. @default true */
  copy404?: boolean;
  /** Enable true SSG via headless-browser prerendering. @default true */
  ssg?: boolean;
  /** Routes to pre-render (auto-detected if not specified) */
  routes?: string[];
  /**
   * Selector that must exist in the DOM (and, if possible, be non-empty)
   * before the page is considered "rendered". @default '#root'
   */
  waitForSelector?: string;
  /** Max time (ms) to wait for a route to finish rendering. @default 15000 */
  renderTimeoutMs?: number;
  /**
   * Number of routes to render in parallel (separate tabs, one shared
   * browser). Rendering is mostly I/O/wait-bound, not CPU-bound, so this
   * can safely exceed your core count. @default min(8, cpus * 2)
   */
  concurrency?: number;
  /**
   * How long to wait for the 'bini-render-ready' event before giving up
   * and using whatever's in the DOM. If your app doesn't dispatch that
   * event, this fires on every single route — keep it small.
   * @default 300
   */
  readyEventTimeoutMs?: number;
  /**
   * Puppeteer's page.goto waitUntil condition. 'networkidle0' is safest
   * but can be very slow (waits for 500ms of zero in-flight requests,
   * reset by any analytics/websocket/polling call). 'load' or
   * 'domcontentloaded' are much faster and usually fine since we also
   * explicitly wait for waitForSelector + the ready event.
   * @default 'load'
   */
  navigationWaitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  /** Custom Puppeteer launch options */
  puppeteerOptions?: {
    headless?: boolean;
    args?: string[];
    executablePath?: string;
    timeout?: number;
  };
}

export function biniExport(opts: BiniExportOptions = {}): Plugin {
  const {
    mode: targetMode = 'export',
    copy404 = true,
    ssg = true,
    routes: userRoutes,
    waitForSelector = '#root',
    renderTimeoutMs = 15000,
    concurrency = Math.max(2, Math.min(8, os.cpus().length * 2)),
    readyEventTimeoutMs = 300,
    navigationWaitUntil = 'load',
    puppeteerOptions = {},
  } = opts;

  const C = {
    cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
    green: (s: string) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
    dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
    red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  };

  let cfg!: ResolvedConfig;
  let isExport = false;
  let originalTemplate: string = '';

  // ─── Helpers ────────────────────────────────────────────────────────────

  function normBase(base: string): string {
    const b = base.startsWith('/') ? base : `/${base}`;
    return b === '/' ? '' : b.replace(/\/$/, '');
  }

  /**
   * Rewrite relative href/src asset paths (e.g. "./assets/x.css",
   * "assets/x.js") to absolute ones anchored at `base`. Without this, a
   * route written to dist/about/index.html resolves relative asset paths
   * against /about/ instead of /, silently 404ing the CSS/JS bundle.
   */
  function absolutizeAssetPaths(html: string, base: string): string {
    const cleanBase = normBase(base); // '' or '/some-base'
    return html.replace(
      /(href|src)=(["'])(?!https?:\/\/|\/\/|data:|mailto:|#)([^"']+)\2/gi,
      (match, attr, quote, url) => {
        if (url.startsWith('/')) return match; // already absolute
        const stripped = url.replace(/^\.\//, '');
        return `${attr}=${quote}${cleanBase}/${stripped}${quote}`;
      }
    );
  }

  // ─── Route Collector for src/app/ ──────────────────────────────────────

  async function collectAllRoutes(root: string): Promise<string[]> {
    if (userRoutes) return userRoutes;

    const routes = new Set<string>(['/']);
    const appDir = path.join(root, 'src/app');

    if (!fs.existsSync(appDir)) {
      return ['/'];
    }

    await collectRoutesFromDir(appDir, '', routes);

    const filtered = [...routes].filter(r => {
      const parts = r.split('/').filter(Boolean);
      if (parts.length === 0) return true;
      const lastPart = parts[parts.length - 1];
      return !['layout', 'loading', 'error', 'not-found', 'api', '_components', '_lib', '_hooks'].includes(lastPart) &&
             !lastPart.startsWith('_') &&
             !r.includes(':') &&
             !r.includes('*');
    });

    return filtered.map(r => r.startsWith('/') ? r : `/${r}`);
  }

  async function collectRoutesFromDir(
    dir: string,
    basePath: string,
    routes: Set<string>
  ): Promise<void> {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('(') && entry.name.endsWith(')')) {
          await collectRoutesFromDir(fullPath, basePath, routes);
          continue;
        }
        if (entry.name === 'api') continue;
        if (entry.name.startsWith('_')) continue;
        if (entry.name.startsWith('[') && entry.name.endsWith(']')) {
          continue;
        }

        const newPath = basePath ? `${basePath}/${entry.name}` : `/${entry.name}`;
        await collectRoutesFromDir(fullPath, newPath, routes);
      } else if (entry.name === 'page.jsx' || entry.name === 'page.tsx') {
        const routePath = basePath || '/';
        routes.add(routePath);
      } else if (entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) {
        const name = entry.name.replace(/\.(mdx|md)$/, '');
        if (name !== 'page') {
          const routePath = basePath ? `${basePath}/${name}` : `/${name}`;
          routes.add(routePath);
        }
      } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx')) {
        const name = entry.name.replace(/\.(tsx|jsx)$/, '');
        if (name !== 'page' && name !== 'layout' && name !== 'loading' &&
            name !== 'error' && name !== 'not-found') {
          const routePath = basePath ? `${basePath}/${name}` : `/${name}`;
          routes.add(routePath);
        }
      }
    }
  }

  // ─── Parallel Puppeteer Prerenderer ────────────────────────────────────

  async function prerenderWithPuppeteer(
    routes: string[],
    outDir: string,
    template: string
  ): Promise<{ rendered: number; failed: number; errors: string[] }> {
    let puppeteer: any;
    let server: any;
    let port: number;

    try {
      puppeteer = await import('puppeteer');
    } catch {
      cfg.logger.warn(`  ${C.yellow('⚠')}  puppeteer not installed`);
      cfg.logger.warn(`  ${C.yellow('⚠')}  run "pnpm add puppeteer" to enable SSG`);
      return { rendered: 0, failed: 0, errors: ['puppeteer not installed'] };
    }

    const errors: string[] = [];

    try {
      cfg.logger.info(`  ${C.cyan('➜')}  starting preview server...`);

      server = await createServer({
        server: {
          port: 0,
          open: false,
        },
        build: {
          outDir: outDir,
          rollupOptions: {
            input: 'index.html'
          }
        },
      });

      await server.listen();
      const address = server.httpServer?.address();
      if (typeof address === 'string') {
        port = parseInt(address.split(':').pop() || '4173', 10);
      } else if (address && typeof address === 'object') {
        port = address.port;
      } else {
        port = 4173;
      }

      cfg.logger.info(`  ${C.green('➜')}  server running on port ${port}`);
      cfg.logger.info(`  ${C.cyan('➜')}  launching browser (concurrency: ${concurrency})...`);

      const browser = await puppeteer.default.launch({
        headless: puppeteerOptions.headless ?? true,
        args: puppeteerOptions.args ?? [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--window-size=1920,1080',
          // These don't affect render correctness, only save time we don't need to spend:
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-ipc-flooding-protection',
          '--disable-extensions',
          '--disable-component-extensions-with-background-pages',
          '--disable-default-apps',
          '--disable-background-networking',
          '--disable-sync',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-default-browser-check',
          '--no-first-run',
        ],
        timeout: puppeteerOptions.timeout ?? 60000,
        executablePath: puppeteerOptions.executablePath,
      });

      let rendered = 0;
      let failed = 0;
      const baseUrl = `http://localhost:${port}`;

      // Shared work queue — each worker (tab) pulls the next route until
      // the queue is empty. This is what actually parallelizes rendering.
      const queue = [...routes];

      async function renderOne(page: any, route: string): Promise<void> {
        const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
        const url = `${baseUrl}${normalizedRoute}`;
        cfg.logger.info(`  ${C.cyan('➜')}  rendering ${normalizedRoute}...`);

        const response = await page.goto(url, {
          waitUntil: navigationWaitUntil,
          timeout: renderTimeoutMs,
        });

        if (!response || !response.ok()) {
          throw new Error(`HTTP ${response ? response.status() : 'no response'}`);
        }

        await page.waitForSelector(waitForSelector, { timeout: 5000 });

        await page.evaluate((readyTimeout: number) => {
          return new Promise((resolve) => {
            const timeout = setTimeout(resolve, readyTimeout);
            document.addEventListener('bini-render-ready', () => {
              clearTimeout(timeout);
              resolve(null);
            }, { once: true });
          });
        }, readyEventTimeoutMs);

        const rootContent = await page.evaluate((selector: string) => {
          const el = document.querySelector(selector);
          return el ? el.innerHTML : '';
        }, waitForSelector);

        // Capture any <style>/<link rel="stylesheet"> tags that ended up in
        // <head> at runtime (e.g. CSS-in-JS libs like styled-components,
        // emotion, vanilla-extract, or dynamically-injected route chunks).
        // If we only grab #root's innerHTML, these never make it into the
        // written file — the page paints unstyled until JS hydrates and
        // re-injects them client-side. So we pull them out here and bake
        // them into the static head instead.
        const extraHeadTags: string[] = await page.evaluate((existingHtml: string) => {
          const tags = Array.from(
            document.head.querySelectorAll('style, link[rel="stylesheet"]')
          ) as (HTMLStyleElement | HTMLLinkElement)[];
          return tags
            .map((el) => el.outerHTML)
            .filter((outerHtml) => !existingHtml.includes(outerHtml));
        }, template);

        let html = template;
        html = html.replace(
          /<div id="root">.*?<\/div>/s,
          `<div id="root">${rootContent}</div>`
        );

        if (extraHeadTags.length > 0) {
          html = html.replace('</head>', `${extraHeadTags.join('\n    ')}\n  </head>`);
        }

        let outputPath: string;
        if (normalizedRoute === '/') {
          outputPath = path.join(outDir, 'index.html');
        } else {
          const dir = path.join(outDir, normalizedRoute.replace(/^\//, ''));
          fs.mkdirSync(dir, { recursive: true });
          outputPath = path.join(dir, 'index.html');
        }

        fs.writeFileSync(outputPath, html, 'utf8');
        cfg.logger.info(`  ${C.green('➜')}  ${normalizedRoute} ${C.dim('→')} ${C.cyan(path.relative(cfg.root, outputPath))}`);
      }

      async function worker(): Promise<void> {
        const page = await browser.newPage();
        // Block heavy, unnecessary resources at the network layer via CDP.
        // Cheaper than page.setRequestInterception, which round-trips
        // every single request through the CDP protocol to decide whether
        // to abort it. setBlockedURLs does the filtering on the browser
        // side instead.
        try {
          const client = await page.target().createCDPSession();
          await client.send('Network.setBlockedURLs', {
            urls: [
              '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.avif', '*.svg',
              '*.mp4', '*.webm', '*.mp3', '*.wav',
              '*.woff', '*.woff2', '*.ttf', '*.otf', '*.eot',
            ],
          });
          await client.send('Network.enable');
        } catch {
          // If this fails on an older Chrome build, just proceed without it.
        }

        while (queue.length > 0) {
          const route = queue.shift();
          if (!route) break;
          try {
            await renderOne(page, route);
            rendered++;
          } catch (error) {
            const msg = `Failed to render ${route}: ${(error as Error).message}`;
            cfg.logger.warn(`  ${C.yellow('⚠')}  ${msg}`);
            errors.push(msg);
            failed++;
          }
        }

        await page.close();
      }

      const workerCount = Math.min(concurrency, routes.length) || 1;
      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      await browser.close();
      cfg.logger.info(`  ${C.cyan('➜')}  browser closed`);

      return { rendered, failed, errors };

    } catch (error) {
      const msg = `Prerenderer error: ${(error as Error).message}`;
      cfg.logger.warn(`  ${C.yellow('⚠')}  ${msg}`);
      errors.push(msg);
      return { rendered: 0, failed: 1, errors };
    } finally {
      if (server) {
        try {
          await server.close();
          cfg.logger.info(`  ${C.cyan('➜')}  server closed`);
        } catch {
          // Ignore close errors
        }
      }
    }
  }

  // ─── 404 redirect ───────────────────────────────────────────────────────

  function generate404(base: string): string {
    const cleanBase = normBase(base);
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Redirecting\u2026</title>
<script>
sessionStorage.setItem('__bini_spa_redirect', location.pathname + location.search + location.hash);
location.replace('${cleanBase}/');
</script>
</head>
<body></body>
</html>`;
  }

  const REDIRECT_RECEIVER = `<script>
(function () {
  var redirect = sessionStorage.getItem('__bini_spa_redirect');
  if (redirect) {
    sessionStorage.removeItem('__bini_spa_redirect');
    history.replaceState(null, '', redirect);
  }
})();
</script>`;

  // ─── Plugin ─────────────────────────────────────────────────────────────

  return {
    name: 'vite-plugin-bini-export',
    enforce: 'post',

    configResolved(resolved: ResolvedConfig) {
      cfg = resolved;
      isExport = resolved.mode === targetMode;
      if (isExport) {
        cfg.logger.info(`\n  ${C.cyan('ß bini-export')} static export mode\n`);
        cfg.logger.info(
          ssg
            ? `  ${C.cyan('➜')}  SSG enabled: prerendering pages via headless browser`
            : `  ${C.cyan('➜')}  SPA mode: copying shell to routes`
        );
      }
    },

    transformIndexHtml: {
      order: 'pre',
      handler(html: string) {
        if (!isExport) return html;
        originalTemplate = html;

        let result = html.replace(/<head([^>]*)>/i, (match: string) => {
          if (match.includes('__bini_spa_redirect')) return match;
          return match + '\n    ' + REDIRECT_RECEIVER;
        });
        return result;
      },
    },

    async closeBundle() {
      if (!isExport || cfg.command !== 'build') return;

      const base = cfg.base || '/';
      const outDir = path.resolve(cfg.root, cfg.build.outDir);

      const indexPath = path.join(outDir, 'index.html');
      if (!fs.existsSync(indexPath)) {
        cfg.logger.warn(`  ${C.yellow('⚠')}  dist/index.html not found — build may have failed`);
        return;
      }

      // Read the final template (with redirect receiver injected), then
      // absolutize asset paths so nested route folders don't lose CSS/JS.
      let template = fs.readFileSync(indexPath, 'utf8');
      template = absolutizeAssetPaths(template, base);

      cfg.logger.info(`\n  ${C.cyan('ß bini-export')} collecting routes...`);
      const routes = await collectAllRoutes(cfg.root);
      cfg.logger.info(`  ${C.green('➜')}  found ${C.green(String(routes.length))} route(s)`);

      let rendered = 0;
      let failed = 0;
      let usedSSG = false;

      if (ssg) {
        const t0 = Date.now();
        const result = await prerenderWithPuppeteer(routes, outDir, template);
        rendered = result.rendered;
        failed = result.failed;
        usedSSG = rendered > 0;
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        cfg.logger.info(`  ${C.cyan('➜')}  prerendering took ${elapsed}s`);

        if (result.errors.length > 0) {
          cfg.logger.warn(`\n  ${C.yellow('⚠')}  ${result.errors.length} error(s) during prerendering:`);
          for (const err of result.errors) {
            cfg.logger.warn(`     ${C.dim(err)}`);
          }
        }
      }

      // Shell fallback for any routes that weren't prerendered
      for (const route of routes) {
        const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
        const dir = normalizedRoute === '/' ? outDir : path.join(outDir, normalizedRoute.replace(/^\//, ''));
        const file = path.join(dir, 'index.html');
        if (fs.existsSync(file)) continue;
        if (normalizedRoute === '/') continue;

        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, template, 'utf8');
        cfg.logger.info(
          `  ${C.dim('➜')}  ${normalizedRoute} ${C.dim('→')} shell fallback (not rendered)`
        );
      }

      // ── WRITE 404.HTML ─────────────────────────────────────────────────

      if (copy404) {
        const dest = path.join(outDir, '404.html');
        const hasCustom =
          fs.existsSync(path.join(cfg.root, 'src/app/not-found.jsx')) ||
          fs.existsSync(path.join(cfg.root, 'src/app/not-found.tsx'));

        try {
          if (hasCustom) {
            fs.writeFileSync(dest, template, 'utf8');
            cfg.logger.info(`  ${C.green('➜')}  404.html ${C.dim('←')} custom not-found page`);
          } else {
            fs.writeFileSync(dest, generate404(base), 'utf8');
            cfg.logger.info(`  ${C.green('➜')}  404.html ${C.dim('←')} redirect handler`);
          }
        } catch (error) {
          cfg.logger.warn(`  ${C.yellow('⚠')}  failed to write 404.html: ${(error as Error).message}`);
        }
      }

      // ── SUMMARY ─────────────────────────────────────────────────────────

      const status = usedSSG ? C.cyan('SSG') : C.dim('SPA fallback');
      cfg.logger.info(
        `\n  ${C.cyan('ß bini-export')} export complete ${C.green('✓')}\n` +
          `  ${C.green('➜')}  ${rendered} route(s) prerendered` +
          (failed > 0 ? `, ${C.yellow(String(failed))} failed` : '') +
          `\n  ${C.green('➜')}  mode: ${status}` +
          `\n  ${C.green('➜')}  output: ${C.cyan(path.relative(cfg.root, outDir))}/\n`
      );
    },
  };
}