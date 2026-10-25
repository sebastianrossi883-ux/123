import { chromium } from 'playwright';
import { mkdir, writeFile, rename, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { scanScript, findSourceMapUrl, animationSourcesFromMap } from './static-scan.mjs';
import { analyze, recreate } from './analyze.mjs';
import { writeReport } from './report.mjs';
import { choreography } from './choreography.mjs';
import { writeVisualReport } from './visual-report.mjs';
import { writeBrief } from './brief.mjs';

const INJECT = fileURLToPath(new URL('./inject.js', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const DEFAULTS = {
  out: 'out',
  maxScroll: 15000,
  step: 400,
  pause: 2000,
  intro: 4000,
  width: 1440,
  height: 900,
  video: true,
  headed: false,
  interaction: true,
  hoverTargets: 6,
};

function safeName(s) {
  return s.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_').replace(/_+$/, '').slice(0, 120);
}

export async function extract(url, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const host = new URL(url).hostname;
  const outDir = path.resolve(o.out, `${safeName(host)}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
  await mkdir(path.join(outDir, 'screens'), { recursive: true });
  const log = (...a) => o.quiet || console.log(`[${host}]`, ...a);

  const browser = await chromium.launch({
    headless: !o.headed,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const context = await browser.newContext({
    viewport: { width: o.width, height: o.height },
    reducedMotion: 'no-preference',
    recordVideo: o.video ? { dir: outDir, size: { width: o.width / 2, height: o.height / 2 } } : undefined,
  });
  await context.addInitScript({ path: INJECT });
  const page = await context.newPage();

  const scripts = new Map();
  page.on('response', (res) => {
    const type = res.request().resourceType();
    const ct = res.headers()['content-type'] || '';
    if (type === 'script' || /javascript|ecmascript/.test(ct)) {
      scripts.set(res.url(), res.text().catch(() => null));
    }
  });

  log('apro la pagina…');
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  } catch {
    log('load lento, continuo con quello che c’è');
  }
  await sleep(o.intro);
  await page.screenshot({ path: path.join(outDir, 'screens', '000-top.png') });

  if (o.interaction) {
    log('test mouse (cursore, parallax al mouse) e hover…');
    await page.evaluate(() => window.__motionMark('mouse'));
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      await page.mouse.move(o.width / 2 + Math.cos(a) * o.width * 0.3, o.height / 2 + Math.sin(a) * o.height * 0.3);
      await sleep(25);
    }
    await sleep(800);
    const targets = await page.evaluate((n) => window.__motionHoverTargets(n), o.hoverTargets);
    for (const h of targets) {
      await page.evaluate((sel) => window.__motionMark('hover', sel), h.selector);
      await page.mouse.move(h.x, h.y, { steps: 5 });
      await sleep(700);
    }
  }
  await page.evaluate(() => window.__motionMark('settle'));
  await page.mouse.move(o.width / 2, o.height / 2, { steps: 5 });
  await sleep(800);

  log('scroll a step (con rotella, così funziona anche con Lenis)…');
  await page.evaluate(() => window.__motionMark('scroll'));
  let scrolled = 0;
  let stuck = 0;
  let shot = 1;
  while (scrolled < o.maxScroll && stuck < 2) {
    const before = await page.evaluate(() => window.scrollY);
    for (let d = 0; d < o.step; d += 100) {
      await page.mouse.wheel(0, 100);
      await sleep(30);
    }
    await sleep(o.pause);
    const after = await page.evaluate(() => window.scrollY);
    stuck = after - before < 5 ? stuck + 1 : 0;
    scrolled += o.step;
    if (Math.floor(scrolled / o.height) >= shot) {
      await page.screenshot({ path: path.join(outDir, 'screens', `${String(shot).padStart(3, '0')}-scroll-${Math.round(after)}.png`) });
      shot++;
    }
  }

  log('raccolgo i dati registrati…');
  const dump = await page.evaluate(() => window.__motionDump());
  const scene = await page.evaluate(() => window.__motionScene());

  // Static analysis of every script + source maps (original code, when published).
  const snippets = [];
  const sourceFiles = [];
  const scriptList = [];
  const bodies = [...scripts.entries()];
  dump.inlineScripts.forEach((s, i) => bodies.push([`inline-script-${i + 1}`, Promise.resolve(s)]));
  for (const [src, p] of bodies) {
    const text = await p;
    if (!text) continue;
    const found = scanScript(text, src);
    snippets.push(...found);
    scriptList.push({ url: src, bytes: text.length, snippets: found.length });
    const mapUrl = findSourceMapUrl(text, src);
    if (!mapUrl) continue;
    try {
      const map = mapUrl.startsWith('data:')
        ? JSON.parse(Buffer.from(mapUrl.split(',')[1], 'base64').toString('utf8'))
        : await (await context.request.get(mapUrl, { timeout: 15000 })).json();
      for (const f of animationSourcesFromMap(map)) {
        const rel = safeName(f.path.replace(/^webpack:\/\/\/?|^\.\//, ''));
        await writeFile(path.join(await ensure(outDir, 'sources'), rel), f.body);
        sourceFiles.push({ map: mapUrl.startsWith('data:') ? `${src} (inline)` : mapUrl, path: f.path, saved: `sources/${rel}` });
      }
    } catch {
      // map not published or not JSON: nothing to recover
    }
  }
  const seen = new Set();
  const uniqueSnippets = snippets.filter((s) => (seen.has(s.code) ? false : seen.add(s.code)));

  await context.close();
  await browser.close();
  if (o.video) {
    const vid = (await readdir(outDir)).find((f) => f.endsWith('.webm'));
    if (vid) await rename(path.join(outDir, vid), path.join(outDir, 'recording.webm'));
  }

  log('analizzo i movimenti…');
  const result = analyze(dump);
  const code = recreate(result);
  const { inlineScripts, ...dumpRest } = dump;
  const dna = choreography(result, dumpRest, scene);
  await writeFile(path.join(outDir, 'dna.json'), JSON.stringify({ url, scene, ...dna }, null, 2));
  await writeVisualReport(outDir, { url, title: dump.title, scene, dna });
  await writeBrief(outDir, { url, title: dump.title, scene, dna });

  await writeFile(path.join(outDir, 'raw-dump.json'), JSON.stringify(dumpRest));
  await writeFile(path.join(outDir, 'recreated.js'), code);
  await writeFile(
    path.join(outDir, 'snippets.js'),
    uniqueSnippets.map((s) => `// ── ${s.source} @${s.offset} [${s.tags.join(', ')}]\n${s.code}\n`).join('\n'),
  );
  await writeReport(outDir, { url, opts: o, dump: dumpRest, result, snippets: uniqueSnippets, sourceFiles, scriptList });
  log(`fatto → ${path.join(outDir, 'report.md')}`);
  return { outDir, result, snippets: uniqueSnippets, sourceFiles, dump: dumpRest, scene, dna };
}

async function ensure(dir, sub) {
  const p = path.join(dir, sub);
  await mkdir(p, { recursive: true });
  return p;
}
