#!/usr/bin/env node
// Uso:
//   node src/cli.mjs https://sito.com [altri url…] [--out out] [--max-scroll 15000]
//        [--step 400] [--pause 2000] [--intro 4000] [--no-video] [--headed]
//   node src/cli.mjs --file urls.txt      (un URL per riga, # per i commenti)
import { readFile } from 'node:fs/promises';
import { extract, DEFAULTS } from './extract.mjs';

const args = process.argv.slice(2);
const opts = {};
const urls = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--no-video') opts.video = false;
  else if (a === '--headed') opts.headed = true;
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
  console.log('Uso: node src/cli.mjs <url> [url…] | --file urls.txt  [--out out] [--max-scroll 15000] [--pause 2000] [--no-video] [--headed]');
  process.exit(1);
}

let failed = 0;
for (const url of urls) {
  try {
    await extract(url, opts);
  } catch (e) {
    failed++;
    console.error(`✗ ${url}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
