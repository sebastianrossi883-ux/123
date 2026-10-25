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
import { writeSpec } from './spec.mjs';
import { writeKit } from './kit.mjs';
import { assess, writeQuality } from './quality.mjs';

const INJECT = fileURLToPath(new URL('./inject.js', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const DEFAULTS = {
  out: 'out',
  maxScroll: 40000,
  step: 400,
  pause: 2000, // max wait after a step; it stops earlier once nothing moves for `settle` ms
  minPause: 900,
  settle: 800, // ms without any motion that end a step early
  intro: 4000,
  width: 1440,
  height: 900,
  video: true,
  headed: false,
  interaction: true,
  timeout: 300,
  gateWait: 15000, // ms to wait for an "Enter / Sound off" intro screen to become clickable
  hoverTargets: 6,
};

function safeName(s) {
  return s.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_').replace(/_+$/, '').slice(0, 120);
}

export async function extract(url, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const browser = await chromium.launch({
    headless: !o.headed,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  // A site that hangs must not block a batch: closing the browser makes every pending step fail.
  let timedOut = false;
  const killer = setTimeout(() => {
    timedOut = true;
    browser.close().catch(() => {});
  }, o.timeout * 1000);
  try {
    return await extractWith(browser, url, o);
  } catch (e) {
    throw timedOut ? new Error(`timeout dopo ${o.timeout}s`) : e;
  } finally {
    clearTimeout(killer);
    await browser.close().catch(() => {});
  }
}

async function extractWith(browser, url, o) {
  const started = Date.now();
  const host = new URL(url).hostname;
  // Unique folder even for the same site analysed twice in the same second (parallel runs).
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.resolve(o.out, `${safeName(url).slice(0, 80)}-${stamp}-${Math.random().toString(36).slice(2, 6)}`);
  await mkdir(path.join(outDir, 'screens'), { recursive: true });
  const log = (...a) => o.quiet || console.log(`[${host}]`, ...a);

  // HAR: --record-har saves every response of the visit (scripts loaded later, CMS data, CDN media)
  // into one file; --from-har replays it offline, identical. A complete copy, unlike "save page".
  const harOut = o.recordHar || (o.recordHarDir ? path.join(o.recordHarDir, `${safeName(url).slice(0, 80)}.har.zip`) : null);
  if (harOut) await mkdir(path.dirname(path.resolve(harOut)), { recursive: true });
  const context = await browser.newContext({
    viewport: { width: o.width, height: o.height },
    reducedMotion: 'no-preference',
    recordVideo: o.video ? { dir: outDir, size: { width: o.width / 2, height: o.height / 2 } } : undefined,
    recordHar: harOut ? { path: path.resolve(harOut), mode: 'full', content: 'attach' } : undefined,
  });
  if (o.fromHar) await context.routeFromHAR(path.resolve(o.fromHar), { notFound: 'abort' });
  await context.addInitScript({ path: INJECT });
  const page = await context.newPage();

  const run = { pageErrors: [], scriptFailures: [], otherFailures: 0, reachedEnd: false, scrolled: 0, hoveredKinds: 0, lenisOptions: 0 };
  page.on('pageerror', (e) => run.pageErrors.push(String(e.message || e)));
  page.on('requestfailed', (req) => {
    if (['script', 'stylesheet'].includes(req.resourceType())) run.scriptFailures.push(req.url().split('?')[0].slice(-60));
    else run.otherFailures++;
  });
  const scripts = new Map();
  page.on('response', (res) => {
    const type = res.request().resourceType();
    const ct = res.headers()['content-type'] || '';
    if (type === 'script' || /javascript|ecmascript/.test(ct)) {
      scripts.set(res.url(), res.text().catch(() => null));
    }
  });

  log('apro la pagina…');
  let response = null;
  try {
    response = await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  } catch (e) {
    const net = e.message.match(/net::[A-Z_]+/);
    if (net) throw new Error(`sito non raggiungibile (${net[0]})`);
    log('load lento, continuo con quello che c’è');
  }
  if (response && response.status() >= 400) throw new Error(`HTTP ${response.status()}`);
  await sleep(o.intro);
  const consent = await dismissConsent(page);
  if (consent) log(`banner cookie chiuso ("${consent}")`);
  run.gate = await passGate(page, o.gateWait);
  if (run.gate) {
    log(`schermata d'ingresso superata ("${run.gate}")`);
    await sleep(Math.min(o.intro, 2500)); // the real intro plays after the gate
  }
  await page.screenshot({ path: path.join(outDir, 'screens', '000-top.png') });

  const hoveredKinds = [];
  if (o.interaction) {
    log('test mouse (cursore, parallax al mouse) e hover…');
    await page.evaluate(() => window.__motionMark('mouse'));
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      await page.mouse.move(o.width / 2 + Math.cos(a) * o.width * 0.3, o.height / 2 + Math.sin(a) * o.height * 0.3);
      await sleep(25);
    }
    await sleep(800);
    const targets = await page.evaluate(([n, skip]) => window.__motionHoverTargets(n, skip), [o.hoverTargets, hoveredKinds]);
    await hoverAll(page, targets, hoveredKinds);
  }
  await page.evaluate(() => window.__motionMark('settle'));
  await page.mouse.move(o.width / 2, o.height / 2, { steps: 5 });
  await sleep(800);

  // Whatever still moves now, with the page at rest, is a loop/ambient motion (marquee, floating
  // shapes): ignored when deciding that a step has settled. Decided once, before scrolling, so a
  // scrub still catching up after a step is never mistaken for it.
  const ambient = await page.evaluate(() => window.__motionMovingIds(500));
  await page.evaluate((ids) => window.__motionMark('ambient', ids), ambient);
  log('scroll a step (con rotella, così funziona anche con Lenis)…');
  await page.evaluate(() => window.__motionMark('scroll'));
  let scrolled = 0;
  let stuck = 0;
  let shot = 1;
  // scrollY plus the position of a few elements picked once: also moves on sites that scroll a
  // transformed container (Locomotive…). Picking them once keeps each step cheap on big pages.
  await page.evaluate(() => {
    const all = [...document.body.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().height > 0);
    window.__motionProbeEls = [all[Math.floor(all.length / 2)], ...all.slice(-2)].filter(Boolean);
  });
  const probe = () =>
    page.evaluate(() => [Math.round(window.scrollY), ...window.__motionProbeEls.map((e) => Math.round(e.getBoundingClientRect().top))].join(','));
  // Constant step size: a bigger step would cross a pinned/scrubbed section with too few samples.
  // Time is saved on the pauses instead (they end as soon as the page is still).
  const stepSize = o.step;
  let emptySteps = 0;
  let stepIndex = 0;
  while (scrolled < o.maxScroll && stuck < 2) {
    const before = await probe();
    const stepStart = await page.evaluate(() => window.__motionNow());
    await page.evaluate((c) => window.__motionMark('step', c), scrolled + stepSize);
    await page.mouse.wheel(0, stepSize); // one event: several small ones cost up to 0.6s on heavy pages
    const waitStart = Date.now();
    let active = 0;
    while (Date.now() - waitStart < o.pause) {
      await sleep(100);
      const st = await page.evaluate(([ids, since]) => ({ quiet: window.__motionQuiet(ids), active: window.__motionActivity(ids, since) }), [ambient, stepStart]);
      active = st.active;
      const elapsed = Date.now() - waitStart;
      // only the scroll moved, and it stopped (every third step still waits fully: loops are told
      // apart from scroll-driven motion in those still moments)
      if (!active && elapsed >= 300 && st.quiet >= 300 && emptySteps % 3 !== 2) break;
      if (elapsed >= o.minPause && st.quiet >= o.settle) break;
    }
    const after = await probe();
    stuck = after === before ? stuck + 1 : 0;
    scrolled += stepSize;
    emptySteps = active ? 0 : emptySteps + 1;
    // Hover also further down the page (footer links, cards…): two new kinds every three steps.
    if (o.interaction && stepIndex++ % 3 === 2) {
      const more = await page.evaluate(([skip]) => window.__motionHoverTargets(2, skip), [hoveredKinds]);
      if (more.length) {
        await hoverAll(page, more, hoveredKinds);
        await page.mouse.move(o.width / 2, o.height / 2, { steps: 4 });
        await sleep(400);
        await page.evaluate(() => window.__motionMark('scroll'));
      }
    }
    if (Math.floor(scrolled / o.height) >= shot) {
      await page.screenshot({ path: path.join(outDir, 'screens', `${String(shot).padStart(3, '0')}-scroll-${scrolled}.png`) });
      shot++;
    }
  }

  run.reachedEnd = stuck >= 2;
  run.scrolled = scrolled;
  run.hoveredKinds = hoveredKinds.length;
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
        sourceFiles.push({ map: mapUrl.startsWith('data:') ? `${src} (inline)` : mapUrl, path: f.path, saved: `sources/${rel}`, body: f.body });
      }
    } catch {
      // map not published or not JSON: nothing to recover
    }
  }
  const seen = new Set();
  const uniqueSnippets = snippets.filter((s) => (seen.has(s.code) ? false : seen.add(s.code)));

  await context.close();
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
  await writeSpec(outDir, { url, title: dump.title, dump: dumpRest, scene, result });
  const kit = await writeKit(outDir, { url, title: dump.title, result, dna, scene, snippets: uniqueSnippets, libs: dump.libs, hoverDiffs: dump.hovers });
  run.lenisOptions = kit.lenisFromCode;
  const codeTexts = [...uniqueSnippets.map((s) => s.code), ...dump.inlineScripts, ...sourceFiles.map((f) => f.body || '')];
  const quality = assess({ run, dump: dumpRest, result, dna, kit, codeTexts });
  await writeQuality(outDir, quality, url);

  await writeFile(path.join(outDir, 'raw-dump.json'), JSON.stringify(dumpRest));
  await writeFile(path.join(outDir, 'recreated.js'), code);
  await writeFile(
    path.join(outDir, 'snippets.js'),
    uniqueSnippets.map((s) => `// ── ${s.source} @${s.offset} [${s.tags.join(', ')}]\n${s.code}\n`).join('\n'),
  );
  await writeReport(outDir, { url, opts: o, dump: dumpRest, result, snippets: uniqueSnippets, sourceFiles, scriptList });
  const seconds = Math.round((Date.now() - started) / 1000);
  log(`fatto in ${seconds}s · affidabilità ${quality.level} (${quality.score}/100) → ${path.join(outDir, 'spec.md')}`);
  for (const i of quality.issues.filter((x) => x.severity !== 'info')) log(`  ${i.severity === 'alta' ? '✗' : '⚠'} ${i.text}`);
  return { seconds, kit, quality, outDir, result, snippets: uniqueSnippets, sourceFiles, dump: dumpRest, scene, dna };
}

async function hoverAll(page, targets, hoveredKinds) {
  for (const h of targets) {
    hoveredKinds.push(h.kind);
    await page.evaluate((sel) => window.__motionTrack(sel), h.selector);
    await sleep(80);
    await page.evaluate((sel) => window.__motionHoverBegin(sel), h.selector);
    await page.evaluate((sel) => window.__motionMark('hover', sel), h.selector);
    await page.mouse.move(h.x, h.y, { steps: 5 });
    // wait for the hover transition to finish (some last 1.4s), up to 2s
    const t0 = Date.now();
    await sleep(500);
    while (Date.now() - t0 < 2000 && (await page.evaluate(() => window.__motionQuiet([]))) < 400) await sleep(100);
    await page.evaluate(() => window.__motionHoverEnd());
  }
}

// Cookie/consent banners cover the page or block the scroll: click their accept button.
async function dismissConsent(page) {
  const clicked = await page
    .evaluate(() => {
      const re = /^(accetta|accetto|accept|accept all|allow all|agree|i agree|ok|got it|consenti|accetta tutti|tout accepter|alle akzeptieren|aceptar)\b/i;
      const btn = [...document.querySelectorAll('button, a, [role="button"]')].find((b) => {
        const r = b.getBoundingClientRect();
        const text = (b.innerText || '').trim();
        return r.width > 0 && r.height > 0 && text.length < 40 && re.test(text);
      });
      if (!btn) return null;
      btn.click();
      return btn.innerText.trim();
    })
    .catch(() => null);
  if (clicked) await sleep(800);
  return clicked;
}

// Intro screens of award-style sites ("Enter", "Sound off", "Skip"…), often shown only once their
// loader reaches 100%. Only clicked while the page is locked behind them, never a normal nav link;
// "without sound" is preferred.
async function passGate(page, maxWait) {
  const t0 = Date.now();
  let clicked = null;
  while (Date.now() - t0 < maxWait) {
    const res = await page
      .evaluate(() => {
        const vh = innerHeight;
        const html = document.documentElement;
        const locked =
          html.scrollHeight <= vh * 1.2 ||
          /hidden|clip/.test(getComputedStyle(html).overflow + getComputedStyle(document.body).overflow);
        const quiet = /^(sound\s*off|no\s*sound|without\s*sound|mute|senza\s*(audio|suono)|audio\s*off|continue\s*without\s*sound|enter\s*without\s*sound)\b/i;
        const enter = /^(enter|entra|explore|start|begin|skip|continue|discover|let'?s\s*go|view\s*(the\s*)?site|open|click\s*to\s*enter|sound\s*on|play)\b/i;
        const inOverlay = (el) => {
          for (let a = el; a && a !== document.body; a = a.parentElement) {
            const cs = getComputedStyle(a);
            const r = a.getBoundingClientRect();
            if (a.matches('[role="dialog"], [aria-modal="true"], [id*="intro" i], [class*="intro" i], [class*="loader" i], [class*="preload" i], [class*="enter" i]')) return true;
            if ((cs.position === 'fixed' || cs.position === 'absolute') && r.width >= innerWidth * 0.8 && r.height >= vh * 0.8) return true;
          }
          return false;
        };
        const cands = [...document.querySelectorAll('button, [role="button"], a[href^="#"], a:not([href])')].filter((b) => {
          const r = b.getBoundingClientRect();
          const cs = getComputedStyle(b);
          const text = (b.innerText || b.getAttribute('aria-label') || '').trim();
          return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && +cs.opacity > 0.1 && text.length < 40 && (quiet.test(text) || enter.test(text));
        });
        const gate = cands.filter((b) => locked || inOverlay(b));
        const pick = gate.find((b) => quiet.test((b.innerText || '').trim())) || gate.find((b) => !/sound\s*on|play/i.test(b.innerText || '')) || gate[0];
        // a loader/intro overlay on screen (otherwise a short page is simply short: don't wait)
        const overlay = [...document.querySelectorAll('body *')].some((el) => {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.1) return false;
          if (el.matches('[role="dialog"], [aria-modal="true"], [id*="intro" i], [class*="loader" i], [class*="preload" i], [id*="loader" i], [id*="preload" i]')) return true;
          const r = el.getBoundingClientRect();
          return cs.position === 'fixed' && r.width >= innerWidth * 0.9 && r.height >= vh * 0.9 && cs.pointerEvents !== 'none' && +cs.zIndex > 0;
        });
        if (!pick) return { locked: locked && overlay, clicked: null };
        pick.click();
        return { locked, clicked: (pick.innerText || pick.getAttribute('aria-label') || '').trim() };
      })
      .catch(() => ({ locked: false, clicked: null }));
    if (res.clicked) {
      clicked = res.clicked;
      await sleep(1200);
      continue; // a second screen may follow
    }
    if (!res.locked || clicked) break; // nothing in the way
    await sleep(400); // locked: the loader may still be counting to 100%
  }
  return clicked;
}

async function ensure(dir, sub) {
  const p = path.join(dir, sub);
  await mkdir(p, { recursive: true });
  return p;
}
