// End-to-end test: serves the fixtures on localhost, runs the extractor on each,
// and checks that the known choreography in fixture/animations.js is recovered.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { extract } from '../src/extract.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(dir, 'fixture', 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json' };

const server = http.createServer(async (req, res) => {
  try {
    const file = path.join(dist, path.normalize(decodeURIComponent(req.url.split('?')[0])));
    if (!file.startsWith(dist)) throw new Error('outside');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const opts = { out: path.join(dir, 'out'), maxScroll: 6000, pause: 1800, intro: 3000, quiet: true };

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`);
  }
}

const results = {};
for (const page of ['bundled', 'sourcemap', 'global']) {
  results[page] = await extract(`${base}/${page}.html`, opts);
  console.log(`  ${page}: ${results[page].outDir}`);
}
server.close();

for (const [page, r] of Object.entries(results)) {
  const anims = r.result.animations;
  const by = (sel, kind) => anims.filter((a) => a.element.selector.includes(sel) && (!kind || a.kind === kind));

  await check(`${page}: rileva GSAP e Lenis`, () => {
    assert.ok(r.dump.libs.gsapVersions, 'gsapVersions mancante');
    assert.ok(r.dump.libs.lenisVersion, 'lenisVersion mancante');
  });
  await check(`${page}: intro titolo a tempo con stagger ~0.1s e power3.out`, () => {
    const lines = by('line', 'time').filter((a) => a.onLoad);
    assert.ok(lines.length >= 3, `trovate ${lines.length} righe`);
    assert.ok(lines.every((a) => a.stagger), 'stagger non rilevato');
    assert.ok(Math.abs(lines[0].stagger.each - 0.1) < 0.03, `stagger ${lines[0].stagger.each}`);
    assert.ok(Math.abs(lines[0].duration - 1200) < 150, `durata ${lines[0].duration}`);
    assert.ok(/power3\.out|power2\.out|power4\.out/.test(lines[0].ease.best.name), `ease ${lines[0].ease.best.name}`);
  });
  await check(`${page}: card allo scroll con expo.out e stagger ~0.12s`, () => {
    const cards = by('card', 'time').filter((a) => !a.onLoad);
    assert.ok(cards.length >= 4, `trovate ${cards.length} card`);
    assert.ok(cards.every((a) => a.stagger), 'stagger non rilevato');
    assert.ok(Math.abs(cards[0].stagger.each - 0.12) < 0.03, `stagger ${cards[0].stagger.each}`);
    assert.ok(/expo\.out|power4\.out|circ\.out/.test(cards[0].ease.best.name), `ease ${cards[0].ease.best.name}`);
  });
  await check(`${page}: parallax riconosciuto come scroll-linked con scrub`, () => {
    const p = by('bg', 'scroll');
    assert.ok(p.length, 'parallax non classificato come scroll: ' + JSON.stringify(by('bg').map((a) => a.kind)));
    assert.ok(p[0].scrub !== true, 'scrub numerico atteso');
  });
  await check(`${page}: reveal con clip-path`, () => {
    const rv = by('reveal', 'time');
    assert.ok(rv.length && rv[0].segs.some((s) => s.ch.startsWith('clip')), 'clip-path non misurato');
  });
  await check(`${page}: marquee come loop`, () => {
    assert.ok(by('marquee', 'loop').length, 'loop non rilevato: ' + JSON.stringify(by('marquee').map((a) => a.kind)));
  });
}

await check('bundled: snippet leggibili dal bundle minificato', () => {
  const code = results.bundled.snippets.map((s) => s.code).join('\n');
  for (const needle of ['scrollTrigger', '"expo.out"', 'scrub: 1', 'M0,0 C0.7,0 0.2,1 1,1', 'lerp: .08']) {
    assert.ok(code.includes(needle), `manca ${needle}`);
  }
  const lib = results.bundled.snippets.filter((s) => /_pt\b|GreenSock/.test(s.code));
  assert.equal(lib.length, 0, 'snippet della libreria non filtrati');
});
await check('sourcemap: recupera il sorgente originale', () => {
  const f = results.sourcemap.sourceFiles.map((s) => s.path);
  assert.ok(f.some((p) => p.includes('animations.js')), 'animations.js non recuperato: ' + f.join(', '));
});
await check('global: ScrollTrigger e chiamate registrate dal vivo', () => {
  const r = results.global;
  assert.ok(r.dump.calls.some((c) => c.kind === 'gsap.from' && c.vars.ease === 'expo.out'), 'chiamata gsap.from non registrata');
  assert.ok(r.dump.scrollTriggers && r.dump.scrollTriggers.length >= 3, 'ScrollTrigger.getAll vuoto');
});

console.log(failures ? `\n${failures} controlli falliti` : '\nTutti i controlli passati');
process.exit(failures ? 1 : 0);
