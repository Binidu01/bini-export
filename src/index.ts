// bini-export/src/index.ts
import fs from 'node:fs';
import path from 'node:path';
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

  // ─── Direct Puppeteer Prerenderer ──────────────────────────────────────

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

      cfg.logger.info(`  ${C.cyan('➜')}  launching browser...`);
      const browser = await puppeteer.default.launch({
        headless: puppeteerOptions.headless ?? true,
        args: puppeteerOptions.args ?? [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--window-size=1920,1080',
        ],
        timeout: puppeteerOptions.timeout ?? 60000,
        executablePath: puppeteerOptions.executablePath,
      });

      const page = await browser.newPage();
      let rendered = 0;
      let failed = 0;

      const baseUrl = `http://localhost:${port}`;

      for (const route of routes) {
        try {
          const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
          const url = `${baseUrl}${normalizedRoute}`;
          cfg.logger.info(`  ${C.cyan('➜')}  rendering ${normalizedRoute}...`);

          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: renderTimeoutMs,
          });

          await page.waitForSelector(waitForSelector, { timeout: 5000 });
          
          await page.evaluate(() => {
            return new Promise((resolve) => {
              const timeout = setTimeout(resolve, 3000);
              document.addEventListener('bini-render-ready', () => {
                clearTimeout(timeout);
                resolve(null);
              }, { once: true });
            });
          });

          // 💡 FIX: Get the rendered HTML content inside root with proper typing
          const rootContent = await page.evaluate((selector: string) => {
            const el = document.querySelector(selector);
            return el ? el.innerHTML : '';
          }, waitForSelector);

          // Use the original template and inject the rendered content
          let html = template;
          
          // Replace the root div content with rendered content
          html = html.replace(
            /<div id="root">.*?<\/div>/s,
            `<div id="root">${rootContent}</div>`
          );

          // Determine output path
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
          rendered++;
        } catch (error) {
          const msg = `Failed to render ${route}: ${(error as Error).message}`;
          cfg.logger.warn(`  ${C.yellow('⚠')}  ${msg}`);
          errors.push(msg);
          failed++;
        }
      }

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
        // Store the original template for later use
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

      // Read the final template (with redirect receiver injected)
      const template = fs.readFileSync(indexPath, 'utf8');

      cfg.logger.info(`\n  ${C.cyan('ß bini-export')} collecting routes...`);
      const routes = await collectAllRoutes(cfg.root);
      cfg.logger.info(`  ${C.green('➜')}  found ${C.green(String(routes.length))} route(s)`);

      let rendered = 0;
      let failed = 0;
      let usedSSG = false;

      if (ssg) {
        const result = await prerenderWithPuppeteer(routes, outDir, template);
        rendered = result.rendered;
        failed = result.failed;
        usedSSG = rendered > 0;
        
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