#!/usr/bin/env node
// Raccoglie i link ai siti esterni da una pagina showcase (es. gsap.com/showcase,
// lenis.darkroom.engineering) e li scrive in urls.txt, pronti per `--file urls.txt`.
// Uso: node src/collect-links.mjs <url-showcase> [--out urls.txt] [--scrolls 30]
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const showcase = args.find((a) => !a.startsWith('--'));
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
if (!showcase) {
  console.log('Uso: node src/collect-links.mjs <url-showcase> [--out urls.txt] [--scrolls 30]');
  process.exit(1);
}
const out = flag('--out', 'urls.txt');
const scrolls = Number(flag('--scrolls', 30));

// Domains that are never showcase entries.
const SKIP = /(^|\.)(twitter|x|instagram|linkedin|facebook|youtube|github|codepen|vimeo|dribbble|behance|discord|tiktok|awwwards|webflow|greensock|gsap|darkroom)\.(com|io|engineering|gg)$/;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(showcase, { waitUntil: 'load', timeout: 60000 });
const ownHost = new URL(showcase).hostname;
for (let i = 0; i < scrolls; i++) {
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(400);
}
const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.href));
await browser.close();

const sites = [...new Set(
  hrefs
    .filter((h) => /^https?:/.test(h))
    .map((h) => new URL(h))
    .filter((u) => u.hostname !== ownHost && !u.hostname.endsWith('.' + ownHost) && !SKIP.test(u.hostname))
    .map((u) => u.origin + u.pathname.replace(/\/$/, '')),
)];
await writeFile(out, `# da ${showcase}\n` + sites.join('\n') + '\n');
console.log(`${sites.length} siti → ${out}`);
