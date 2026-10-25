// Builds three versions of the same page into test/fixture/dist:
//   bundled.html   — GSAP + Lenis minified inside one bundle, no source map (the common case)
//   sourcemap.html — same bundle, but the .map file is published
//   global.html    — GSAP/Lenis loaded with <script> tags (CDN style), app code minified
import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const fx = path.join(dir, 'fixture');
const dist = path.join(fx, 'dist');
const nm = path.join(dir, '..', 'node_modules');
await mkdir(dist, { recursive: true });

const page = await readFile(path.join(fx, 'page.html'), 'utf8');
const html = (name, scripts) => page.replace('__NAME__', name).replace('__SCRIPTS__', scripts);

const common = { bundle: true, minify: true, format: 'iife', target: 'es2019', logLevel: 'error' };
await build({ ...common, entryPoints: [path.join(fx, 'bundled-entry.js')], outfile: path.join(dist, 'bundle.js') });
await build({ ...common, entryPoints: [path.join(fx, 'bundled-entry.js')], outfile: path.join(dist, 'bundle-map.js'), sourcemap: true });

await writeFile(path.join(fx, 'global-entry.js'), [
  "import { run } from './animations.js';",
  'run({ gsap: window.gsap, ScrollTrigger: window.ScrollTrigger, CustomEase: window.CustomEase, Lenis: window.Lenis });',
].join('\n'));
await build({ ...common, entryPoints: [path.join(fx, 'global-entry.js')], outfile: path.join(dist, 'app-global.js') });
for (const f of ['gsap.min.js', 'ScrollTrigger.min.js', 'CustomEase.min.js']) {
  await copyFile(path.join(nm, 'gsap', 'dist', f), path.join(dist, f));
}
await copyFile(path.join(nm, 'lenis', 'dist', 'lenis.min.js'), path.join(dist, 'lenis.min.js'));

await writeFile(path.join(dist, 'bundled.html'), html('bundled', '<script src="bundle.js"></script>'));
await writeFile(path.join(dist, 'sourcemap.html'), html('sourcemap', '<script src="bundle-map.js"></script>'));
await writeFile(path.join(dist, 'global.html'), html('global', [
  'gsap.min.js', 'ScrollTrigger.min.js', 'CustomEase.min.js', 'lenis.min.js', 'app-global.js',
].map((s) => `<script src="${s}"></script>`).join('\n  ')));
console.log('fixture pronta in', dist);
