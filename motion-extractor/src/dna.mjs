#!/usr/bin/env node
// DNA tools for many sites:
//   node src/dna.mjs catalog [out]                         → out/catalog.json + out/catalog.html
//   node src/dna.mjs blend --mood elegante --name studio   → blends/studio/ (motion-kit.js, per-ia.md, provenienza.md)
//        [--seed 42] [--from sitoA,sitoB,sitoC] [--catalog out/catalog.json] [--out blends] [--min-distance 0.08]
//   node src/dna.mjs verify <url> --kit blends/studio/kit.json [--fast]
//        → misura il sito animato e controlla che si muova come il suo DNA (exit 1 sotto l'80%)
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildCatalog, catalogHtml, blend, writeBlend, verify, verifyMarkdown, MOODS } from './dna-tools.mjs';
import { extract } from './extract.mjs';

const [cmd, ...args] = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--fast'].includes(args[i - 1])));

if (cmd === 'catalog') {
  const root = path.resolve(positional[0] || 'out');
  const cat = await buildCatalog(root);
  await writeFile(path.join(root, 'catalog.json'), JSON.stringify(cat, null, 2));
  await writeFile(path.join(root, 'catalog.html'), catalogHtml(cat));
  console.log(`${cat.count} DNA nel catalogo → ${path.join(root, 'catalog.html')}`);
} else if (cmd === 'blend') {
  const name = flag('--name', 'mix');
  const catalogPath = path.resolve(flag('--catalog', 'out/catalog.json'));
  const seed = Number(flag('--seed', Math.floor(Math.random() * 100000)));
  const res = await blend({
    catalogPath,
    mood: flag('--mood'),
    seed,
    from: (flag('--from', '') || '').split(',').filter(Boolean),
    minDistance: Number(flag('--min-distance', 0.08)),
    includeLow: args.includes('--include-low'),
  });
  const outDir = path.resolve(flag('--out', 'blends'), name);
  await writeBlend(outDir, res, name);
  console.log(`DNA "${name}" (seed ${seed}) da: ${res.parents.map((p) => p.url).join(' + ')}`);
  console.log(`distanza dal sito più simile: ${res.nearest[0].d} ${res.kit.blend.unique ? '✓ unico' : '✗ troppo simile, prova un altro --seed'}`);
  console.log(`→ ${outDir}/motion-kit.js + per-ia.md + provenienza.md`);
} else if (cmd === 'verify') {
  const url = positional[0];
  const kitPath = flag('--kit');
  if (!url || !kitPath) {
    console.log('Uso: node src/dna.mjs verify <url> --kit percorso/kit.json [--fast]');
    process.exit(1);
  }
  const kit = JSON.parse(await readFile(kitPath, 'utf8'));
  const fast = args.includes('--fast') ? { step: 600, pause: 1300, minPause: 700, settle: 650, intro: 2500 } : {};
  const r = await extract(url, { out: flag('--out', 'out-verify'), video: false, ...fast });
  const v = verify(kit, r);
  await writeFile(path.join(r.outDir, 'verifica.md'), verifyMarkdown(v, { url, kitPath }));
  console.log(`punteggio ${Math.round(v.score * 100)}% ${v.score >= 0.8 ? '✓' : '✗'} → ${path.join(r.outDir, 'verifica.md')}`);
  process.exit(v.score >= 0.8 ? 0 : 1);
} else {
  console.log('Comandi: catalog [out] | blend --mood <' + Object.keys(MOODS).join('|') + '> --name <nome> | verify <url> --kit <kit.json>');
  process.exit(1);
}
