#!/usr/bin/env node
// Uso:
//   node src/cli.mjs https://sito.com [altri url…] [--out out] [--max-scroll 15000]
//        [--step 400] [--pause 2000] [--intro 4000] [--no-video] [--headed]
//   node src/cli.mjs --file urls.txt      (un URL per riga, # per i commenti)
//   --parallel 3                          analizza 3 siti alla volta
//   --fast                                step più lunghi e pause più brevi (≈1.7× più veloce)
//   --timeout 300                         secondi massimi per sito
//   --force                               rifà anche i siti già in out/index.csv
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { extract, DEFAULTS } from './extract.mjs';

const args = process.argv.slice(2);
const opts = {};
let parallel = 1;
let force = false;
const urls = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--no-video') opts.video = false;
  else if (a === '--no-interaction') opts.interaction = false;
  else if (a === '--headed') opts.headed = true;
  else if (a === '--force') force = true;
  else if (a === '--fast') Object.assign(opts, { step: 600, pause: 1300, minPause: 700, settle: 650, intro: 2500 });
  else if (a === '--parallel') parallel = Math.max(1, Number(args[++i]) || 1);
  else if (a === '--file') {
    const list = (await readFile(args[++i], 'utf8')).split('\n').map((l) => l.trim());
    urls.push(...list.filter((l) => l && !l.startsWith('#')));
  } else if (a.startsWith('--')) {
    const key = a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase());
    const val = args[++i];
    opts[key] = typeof DEFAULTS[key] === 'number' ? Number(val) : val;
  } else urls.push(a);
}

if (!urls.length) {
  console.log('Uso: node src/cli.mjs <url> [url…] | --file urls.txt  [--parallel 4] [--fast] [--no-video] [--timeout 300] [--force] [--out out]');
  process.exit(1);
}

// Batch bookkeeping: out/index.csv has one line per site; sites already done are skipped,
// so an interrupted batch of hundreds of sites resumes where it stopped (--force redoes them).
const outRoot = path.resolve(opts.out || DEFAULTS.out);
await mkdir(outRoot, { recursive: true });
const indexFile = path.join(outRoot, 'index.csv');
const done = new Set();
try {
  for (const line of (await readFile(indexFile, 'utf8')).split('\n').slice(1)) {
    const [u, status] = line.split(',');
    if (status === 'ok') done.add(u);
  }
} catch {
  await appendFile(indexFile, 'url,stato,secondi,scene,preset,animazioni,cartella,errore\n');
}
const todo = force ? urls : urls.filter((u) => !done.has(u));
if (todo.length < urls.length) console.log(`${urls.length - todo.length} siti già fatti (in ${indexFile}), li salto. --force per rifarli.`);

const csv = (v) => (/[,"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
let failed = 0;
let finished = 0;
const queue = [...todo];
const started = Date.now();
async function worker() {
  while (queue.length) {
    const url = queue.shift();
    const t0 = Date.now();
    try {
      const r = await extract(url, opts);
      // "vuoto" = loaded but nothing moved (bot protection, consent wall…): retried on the next run.
      const status = r.result.animations.length ? 'ok' : 'vuoto';
      if (status === 'vuoto') console.error(`⚠ ${url}: nessuna animazione registrata (prova --headed)`);
      await appendFile(indexFile, [url, status, r.seconds, r.dna.scenes.length, Object.keys(r.kit.presets).length, r.result.animations.length, path.relative(outRoot, r.outDir), ''].map(csv).join(',') + '\n');
    } catch (e) {
      failed++;
      console.error(`✗ ${url}: ${e.message}`);
      await appendFile(indexFile, [url, 'errore', Math.round((Date.now() - t0) / 1000), '', '', '', '', e.message.split('\n')[0].slice(0, 200)].map(csv).join(',') + '\n');
    }
    finished++;
    if (todo.length > 1) {
      const elapsed = (Date.now() - started) / 1000;
      const eta = Math.round(((elapsed / finished) * (todo.length - finished)) / 60);
      console.log(`  ${finished}/${todo.length} · ${Math.round(elapsed / 60)} min trascorsi · ~${eta} min rimanenti`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(parallel, todo.length) }, worker));
if (todo.length > 1) console.log(`${todo.length - failed}/${todo.length} siti in ${Math.round((Date.now() - started) / 1000)}s · riepilogo in ${indexFile}`);
process.exitCode = failed ? 1 : 0;
