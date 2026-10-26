import { captureVisualState } from '../src/visual-evidence.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const fixturePath = path.join(here, 'fixture', 'visual-test.html');
  await fs.mkdir(path.dirname(fixturePath), { recursive: true });
  await fs.writeFile(fixturePath, `
    <!DOCTYPE html>
    <style>
      .box { width: 100px; height: 100px; background: red; position: absolute; left: 0; top: 0; }
      #box1 { top: 50px; }
      #box2 { top: 200px; }
    </style>
    <div id="box1" class="box"></div>
    <div id="box2" class="box"></div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
    <script>
      // Due animazioni con stessa posa finale (x: 300)
      // ma diversa durata/curva
      function trigger() {
        gsap.to('#box1', { x: 300, duration: 1, ease: 'linear' });
        gsap.to('#box2', { x: 300, duration: 2, ease: 'power2.inOut' });
      }
    </script>
  `);

  console.log('Testing visual evidence module...');

  const injectScriptPath = path.join(here, '../src/inject.js');

  const evidence = await captureVisualState({
    url: 'file://' + fixturePath,
    viewport: { width: 800, height: 600 },
    outDir: path.join(here, '../out/evidence-test'),
    triggerFn: async (page) => {
      await page.evaluate(() => trigger());
    },
    timestamps: [500, 1000, 2000],
    sceneName: 'two-boxes-different-timing',
    injectScript: injectScriptPath
  });

  console.log('Test completed in', evidence.costMs, 'ms');
  console.log('Evidence snapshots collected:', evidence.evidence.length);

  // Verifica che al timestamp 500ms i due box siano in posizioni diverse
  const state500 = evidence.evidence.find(e => e.targetTimestamp === 500).domState;
  const box1 = state500.find(el => el.id === 'box1');
  const box2 = state500.find(el => el.id === 'box2');

  if (box1.rect.x !== box2.rect.x) {
    console.log('Success: Dataset distinguishes different timings/curves (Box1 X:', box1.rect.x, 'Box2 X:', box2.rect.x, ')');
  } else {
    console.error('Failed: Both boxes have same X at 500ms despite different durations.');
  }

  // Verifica che a 2000ms abbiano la stessa posa finale
  const state2000 = evidence.evidence.find(e => e.targetTimestamp === 2000).domState;
  const box1_end = state2000.find(el => el.id === 'box1');
  const box2_end = state2000.find(el => el.id === 'box2');

  if (Math.abs(box1_end.rect.x - box2_end.rect.x) < 5) {
    console.log('Success: Both boxes reach same final pose (X ~300).');
  } else {
    console.error('Failed: Final poses differ.', box1_end.rect.x, box2_end.rect.x);
  }
}

main().catch(console.error);
