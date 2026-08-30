// regift build (croft-pwa chassis): bundle the TS pages with esbuild, content-hash
// each entry, inject a build-time CSP + Subresource Integrity, generate a
// version-stamped service worker, vendor the ffmpeg.wasm core same-origin, and
// emit a self-contained static dist/. One command, mirrored by CI.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');

function computeVersion() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  let sha = 'nogit';
  try {
    sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root }).toString().trim();
  } catch {
    // No git (e.g. tarball build) — leave the sentinel.
  }
  return `v0 ${pkg.version}+${sha}`;
}
const version = computeVersion();

// Pre-paint theme init, byte-identical on every page so ONE CSP hash covers it.
// Keep in sync with src/theme.ts resolveTheme().
const THEME_INIT_JS =
  "(function(){try{var t=localStorage.getItem('regift-theme');" +
  "if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}" +
  "document.documentElement.setAttribute('data-theme',t);}catch(e){}})();";

const sha256base64 = (text) => createHash('sha256').update(text, 'utf8').digest('base64');
const sriFor = (bytes) => 'sha384-' + createHash('sha384').update(bytes).digest('base64');

const PAGES = [
  { html: 'index.html', entry: 'src/pages/index.ts', jsToken: '%INDEX_JS%', sriToken: '%INDEX_JS_SRI%' },
  { html: 'settings.html', entry: 'src/pages/settings.ts', jsToken: '%SETTINGS_JS%', sriToken: '%SETTINGS_JS_SRI%' },
];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 1. Bundle the page entries.
const result = await esbuild.build({
  entryPoints: PAGES.map((p) => join(root, p.entry)),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  entryNames: 'assets/[name]-[hash]',
  outdir: dist,
  metafile: true,
  define: { __CROFT_VERSION__: JSON.stringify(version) },
});
function entryHref(srcEntry) {
  const outputs = result.metafile.outputs;
  const match = Object.keys(outputs).find(
    (o) => o.endsWith('.js') && outputs[o].entryPoint && outputs[o].entryPoint.endsWith(srcEntry),
  );
  if (!match) throw new Error(`build: could not locate bundled entry for ${srcEntry}`);
  return match.replace(/^dist\//, '');
}
const pageHrefs = Object.fromEntries(PAGES.map((p) => [p.entry, entryHref(p.entry)]));

// 2. Stylesheet = tokens then components, one request.
const stylesCss = `${readFileSync(join(root, 'tokens.css'), 'utf8')}\n${readFileSync(join(root, 'styles.css'), 'utf8')}`;
writeFileSync(join(dist, 'styles.css'), stylesCss);
const stylesSri = sriFor(Buffer.from(stylesCss, 'utf8'));
const stylesHref = `styles.css?v=${encodeURIComponent(version)}`;

// 3. Static assets.
for (const asset of ['manifest.webmanifest', 'icons', 'LICENSE']) {
  const from = join(root, asset);
  if (existsSync(from)) cpSync(from, join(dist, asset), { recursive: true });
}
writeFileSync(join(dist, '.nojekyll'), '');

// 4. Vendor ffmpeg.wasm same-origin (CSP: no third-party origins, ever). The core
// JS + wasm are copied verbatim from the pinned package; the class worker is
// bundled so its relative imports resolve from one file. Not precached — it is
// ~31 MB and fetched on first mux; the SW's cache-first rule keeps it after.
const vendor = join(dist, 'vendor', 'ffmpeg');
mkdirSync(vendor, { recursive: true });
const core = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) cpSync(join(core, f), join(vendor, f));
await esbuild.build({
  entryPoints: [join(root, 'node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'esm', 'worker.js')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  outfile: join(vendor, 'worker.js'),
});

// 5. Precache manifest for this exact build (relative to the SW's own scope).
const precache = ['./', ...PAGES.map((p) => p.html), 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', stylesHref, ...PAGES.map((p) => pageHrefs[p.entry])];

// 6. Service worker (stable name).
await esbuild.build({
  entryPoints: [join(root, 'src/sw.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  outfile: join(dist, 'sw.js'),
  define: {
    __PRECACHE__: JSON.stringify(precache),
    __CACHE__: JSON.stringify(`regift-${version.replace(/[^\w.+-]/g, '_')}`),
  },
});

// 7. Per-page SRI.
const jsSri = Object.fromEntries(PAGES.map((p) => [p.entry, sriFor(readFileSync(join(dist, pageHrefs[p.entry])))]));

// 8. Build-time CSP. default-src 'none' + explicit allowlists. The only
// cross-origin connection is v.redd.it (the media CDN; CORS-open). wasm needs
// 'wasm-unsafe-eval' (the wasm runs in a same-origin worker; no eval anywhere).
// media-src blob: is the preview of the file we just produced.
const csp = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  // blob: for the previews of files the page itself produced.
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "style-src 'self'",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  // Decided 2026-08-30 with the multi-source slice: connect-src is any https origin. The
  // app's job is to fetch media from hosts the PERSON chose — a Mastodon instance, a
  // Bluesky PDS, a Tumblr CDN — which cannot be enumerated. The bytes are read by the
  // page and turned into a File; nothing is executed. script-src stays tight below.
  "connect-src 'self' https:",
  "worker-src 'self'",
  // Cross-origin SCRIPTS are the two legacy-read tricks and nothing else:
  //   https://www.reddit.com   the JSONP read of a post   (src/adapters/web/jsonp.ts)
  //   https://*.tumblr.com     `var tumblr_api_read = …`  (same file, loadScriptGlobal)
  `script-src 'self' 'wasm-unsafe-eval' https://www.reddit.com https://*.tumblr.com 'sha256-${sha256base64(THEME_INIT_JS)}'`,
].join('; ');

// 9. Render each page; relative paths only (works at a root or under a subpath).
const themeInitTag = `<script>${THEME_INIT_JS}</script>`;
for (const p of PAGES) {
  const html = readFileSync(join(root, p.html), 'utf8')
    .replaceAll('%CSP%', csp)
    .replaceAll('%THEME_INIT%', themeInitTag)
    .replaceAll('%STYLES%', stylesHref)
    .replaceAll('%STYLES_SRI%', stylesSri)
    .replaceAll(p.jsToken, pageHrefs[p.entry])
    .replaceAll(p.sriToken, jsSri[p.entry]);
  const absolute = html.match(/(?:href|src)="\/[^"]*"/g);
  if (absolute) throw new Error(`build: ${p.html} has absolute-root asset path(s) ${JSON.stringify(absolute)}`);
  writeFileSync(join(dist, p.html), html);
}

// 10. Bundle-size budget: a tripwire on accidental bloat, raised deliberately.
const PAGE_JS_GZ_BUDGET = 24 * 1024;
const CSS_GZ_BUDGET = 12 * 1024;
const gz = (file) => gzipSync(readFileSync(file)).length;
const sizes = PAGES.map((p) => ({ page: p.html, gz: gz(join(dist, pageHrefs[p.entry])) }));
const cssGz = gz(join(dist, 'styles.css'));
const kb = (n) => `${(n / 1024).toFixed(1)}K`;
console.log('sizes(gz): ' + sizes.map((s) => `${s.page.replace('.html', '')} ${kb(s.gz)}`).join(' · ') + ` · styles.css ${kb(cssGz)}`);
const over = sizes.filter((s) => s.gz > PAGE_JS_GZ_BUDGET);
if (over.length > 0) throw new Error(`build: bundle-size budget exceeded (${kb(PAGE_JS_GZ_BUDGET)} gz/page): ${over.map((s) => `${s.page} ${kb(s.gz)}`).join(', ')}`);
if (cssGz > CSS_GZ_BUDGET) throw new Error(`build: styles.css ${kb(cssGz)} gz exceeds the ${kb(CSS_GZ_BUDGET)} budget.`);
console.log(`built ${version} -> dist/  (${PAGES.length} pages, sw + precache ${precache.length}, ffmpeg core vendored, CSP+SRI on, budget ok)`);
