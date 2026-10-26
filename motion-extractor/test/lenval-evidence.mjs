import { captureVisualState } from '../src/visual-evidence.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('Running visual evidence on Lenval...');
  const injectScriptPath = path.join(here, '../src/inject.js');

  // Scena 1: Lenval intro (homepage loader)
  const evidence = await captureVisualState({
    url: 'https://lenvalproperties.com/',
    viewport: { width: 1280, height: 720 },
    outDir: path.join(here, '../out/lenval-evidence'),
    triggerFn: async (page) => {
      // Aspettiamo che appaia qualcosa
      await page.waitForTimeout(1000);
    },
    timestamps: [500, 1500, 3000, 5000],
    sceneName: 'lenval-intro',
    injectScript: injectScriptPath
  });

  console.log('Lenval Intro test completed in', evidence.costMs, 'ms');
  console.log('Evidence saved to', path.join(here, '../out/lenval-evidence/lenval-intro-evidence.json'));
}

main().catch(console.error);
