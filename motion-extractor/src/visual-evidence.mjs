import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Modulo separato opzionale per l'osservazione visiva mirata.
 * Associa uno screenshot significativo a scena, trigger, viewport e timestamp,
 * rendendo l'evidenza accessibile all'IA senza modificare extract.mjs.
 */
export async function captureVisualState({
  url,
  viewport = { width: 1280, height: 720 },
  outDir = 'out/evidence',
  triggerFn = async (page) => {},
  timestamps = [500],
  sceneName = 'default',
  injectScript = null
}) {
  const started = performance.now();
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  if (injectScript) {
    await page.addInitScript({ path: injectScript });
  }

  await page.goto(url, { waitUntil: 'networkidle' });

  const evidence = [];

  // Esegue il trigger
  await triggerFn(page);

  // Playwright's page.evaluate is used to track time from inside the page
  // per una maggiore fedeltà con il clock della pagina.
  await page.evaluate(() => { window.__visualT0 = performance.now(); });

  for (const ts of timestamps) {
    // wait exactly until ts inside the page
    await page.waitForFunction((target) => {
      return performance.now() - window.__visualT0 >= target;
    }, ts);

    const actualTs = await page.evaluate(() => Math.round(performance.now() - window.__visualT0));

    const screenshotPath = path.join(outDir, `${sceneName}-${actualTs}ms.png`);
    await page.screenshot({ path: screenshotPath });

    // Also collect computed styles for comparison to distinguish visual errors from sample rates
    const domState = await page.evaluate(() => {
      const els = document.querySelectorAll('*');
      const moving = [];
      for (const el of els) {
        if (!el.getBoundingClientRect) continue;
        const cs = getComputedStyle(el);
        if (cs.transform !== 'none' || parseFloat(cs.opacity) < 1) {
          const rect = el.getBoundingClientRect();
          moving.push({
            tag: el.tagName,
            id: el.id,
            cls: el.className,
            transform: cs.transform,
            opacity: cs.opacity,
            rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
          });
        }
      }
      return moving;
    });

    evidence.push({
      scene: sceneName,
      viewport,
      targetTimestamp: ts,
      actualTimestamp: actualTs,
      screenshotPath,
      domState
    });
  }

  // Dump telemetry se inject.js era presente
  let telemetry = null;
  try {
    telemetry = await page.evaluate(() => window.__motionDump ? window.__motionDump() : null);
  } catch(e) {}

  await browser.close();

  const result = {
    url,
    scene: sceneName,
    costMs: Math.round(performance.now() - started),
    evidence,
    telemetry,
    limits: [
      'Screenshot is a single point in time, cannot prove full easing fidelity without multiple samples',
      'DOM state collection introduces slight overhead (measured costMs)',
      'Video/GIF not recorded by design'
    ]
  };

  await writeFile(path.join(outDir, `${sceneName}-evidence.json`), JSON.stringify(result, null, 2));
  return result;
}
