// End-to-end test: serves the fixtures on localhost, runs the extractor on each,
// and checks that the known choreography in fixture/animations.js is recovered.
import http from 'node:http';
import { readFile, copyFile } from 'node:fs/promises';
import { chromium } from 'playwright';
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
const opts = { out: path.join(dir, 'out'), maxScroll: 10000, pause: 1800, intro: 3000, quiet: true };

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
for (const page of ['bundled', 'sourcemap', 'global', 'virtual']) {
  results[page] = await extract(`${base}/${page}.html`, opts);
  console.log(`  ${page}: ${results[page].outDir}`);
}
// Round trip: the kit extracted from the bundled page animates a different page; extracting
// that page again must give back the same motion.
await copyFile(path.join(results.bundled.outDir, 'motion-kit.js'), path.join(dist, 'motion-kit.js'));
const consoleMessages = [];
{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', (m) => consoleMessages.push(`${m.type()}: ${m.text()}`));
  await page.goto(`${base}/user-page.html`);
  await page.waitForTimeout(1500);
  await browser.close();
}
const roundTrip = await extract(`${base}/user-page.html`, opts);
console.log(`  user-page: ${roundTrip.outDir}`);
server.close();
const mainResults = () => Object.entries(results).filter(([p]) => p !== 'virtual');

for (const [page, r] of mainResults()) {
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

for (const [page, r] of mainResults()) {
  const { dna, scene } = r;
  await check(`${page}: scena con regia titolo → testo → media e offset sovrapposti`, () => {
    const sc = dna.scenes.find((s) => s.section.includes('story'));
    assert.ok(sc, 'scena .story non trovata: ' + dna.scenes.map((s) => s.section).join(' | '));
    assert.equal(sc.roleOrder, 'heading → text → media', sc.roleOrder);
    const [h, p, m] = sc.beats;
    assert.ok(h.count === 2 && h.reveal === 'mask-slide', `titolo: ${h.count} ${h.reveal}`);
    // timeline: p starts at 1.08 - 0.6 = 0.48s, media 0.15s after p
    assert.ok(Math.abs(p.offset - 480) < 90, `offset testo ${p.offset}`);
    assert.ok(Math.abs(m.offset - p.offset - 150) < 60, `offset media ${m.offset}`);
    assert.ok(/scale-down/.test(m.reveal), `reveal media ${m.reveal}`);
    assert.ok(sc.overlap > 1, `overlap ${sc.overlap}`);
  });
  await check(`${page}: pin rilevato con la sua durata e cosa si muove dentro`, () => {
    assert.ok(dna.pins.length === 1, `${dna.pins.length} pin`);
    assert.ok(Math.abs(dna.pins[0].pinnedForVh - 150) < 10, `pin ${dna.pins[0].pinnedForVh}vh`);
    assert.ok(dna.pins[0].scrubbedInside.length, 'niente scrub dentro il pin');
  });
  await check(`${page}: cursore personalizzato e hover CSS`, () => {
    assert.ok(dna.interactions.cursor.some((c) => c.selector.includes('cursor')), 'cursore non rilevato');
    assert.ok(dna.interactions.hover.some((h) => h.target.includes('btn') && h.effects.some((e) => e.via === 'css')), 'hover non rilevato');
    assert.ok(dna.interactions.hover.every((h) => h.effects.every((e) => !String(e.element).includes('cursor'))), 'il cursore è finito tra gli hover');
  });
  await check(`${page}: scenografia (palette, tipografia, sezioni, parallax)`, () => {
    assert.ok(scene.colors.backgrounds.some((c) => c.color === '#111111'), 'sfondo #111 mancante');
    assert.ok(scene.colors.backgrounds.some((c) => c.color === '#ece6da'), 'sfondo .story mancante');
    assert.ok(scene.fonts.scale[0].size > 100, 'titolo display non rilevato');
    assert.ok(scene.sections.length >= 7, `${scene.sections.length} sezioni`);
    assert.ok(dna.layers.some((l) => l.selector.includes('bg') && l.screenSpeed < 100), 'parallax .bg non tra i livelli (più lento dello scroll)');
    assert.ok(dna.signature.eases.length && dna.signature.reveals.length, 'firma vuota');
  });
}

for (const [page, r] of mainResults()) {
  const spec = await readFile(path.join(r.outDir, 'spec.md'), 'utf8');
  await check(`${page}: scheda tecnica con ogni sezione, elemento e keyframe in px`, () => {
    const sections = spec.split('\n## Sezione ').length - 1;
    assert.equal(sections, r.scene.sections.length, `${sections} sezioni nella scheda`);
    const start = spec.indexOf('— `html > body > section.story');
    const story = spec.slice(start, spec.indexOf('\n## Sezione', start));
    assert.ok(/\| `h2` \|/.test(story), 'h2 della scena non nella tabella elementi');
    assert.ok(/\| `p` \| “Prima il titolo/.test(story), 'paragrafo non nella tabella elementi');
    assert.ok(/✦\d+ ⏱️ a tempo — titolo “Una scena”/.test(story), 'animazione del titolo mancante');
    assert.ok(/`expo\.out`/.test(story), 'easing del titolo mancante');
    assert.ok(/\| 0% \| 0ms \| 72px \|/.test(story) && /\| 100% \| \d+ms \| 0px \|/.test(story), 'keyframe in px mancanti');
    assert.ok(/scena \d+, parte a \+4\d\dms/.test(story), 'offset del testo nella scena mancante');
    assert.ok(/\*\*pinnata\*\* per 150vh/.test(spec), 'pin mancante nella scheda');
    assert.ok(/\| \d+px \| -?\d+(\.\d)?px \|/.test(spec), 'tabella scroll → valore mancante');
    assert.ok(/position fixed/.test(spec), 'cursore fuori sezione mancante');
    const starts = [...story.matchAll(/trigger: "html > body > section\.story[^"]*", start: "(top -?\d+%)"/g)].map((m) => m[1]);
    assert.ok(starts.length >= 4 && new Set(starts).size === 1, 'start diversi nella stessa scena: ' + starts.join(', '));
  });
  await check(`${page}: tempo di estrazione sotto i 90s`, () => assert.ok(r.seconds < 90, `${r.seconds}s`));
}

for (const [page, r] of mainResults()) {
  const anims = r.result.animations;
  const by = (sel) => anims.filter((a) => a.element.selector.includes(sel));
  await check(`${page}: linea SVG che si disegna, cambio colore, lettere, transizione CSS da classe`, () => {
    const line = by('line-draw').find((a) => a.kind === 'time' && a.segs.some((s) => s.ch === 'dash'));
    assert.ok(line, 'stroke-dashoffset non misurato');
    assert.ok(/power2\.inOut|sine\.inOut|power1\.inOut/.test(line.ease.best.name), `ease linea ${line.ease.best.name}`);
    const badge = by('badge').find((a) => a.segs.some((s) => s.ch.startsWith('bg')));
    assert.ok(badge, 'background-color non misurato');
    const chars = by('chars').filter((a) => a.kind === 'time');
    assert.ok(chars.length >= 25, `solo ${chars.length} lettere`);
    assert.ok(chars[0].stagger && Math.abs(chars[0].stagger.each - 0.03) < 0.01, `stagger lettere ${chars[0].stagger && chars[0].stagger.each}`);
    const css = by('css-in').find((a) => a.kind === 'time' && a.segs.some((s) => s.ch === 'y'));
    assert.ok(css, 'transizione CSS da classe non misurata');
    assert.ok(Math.abs(css.duration - 900) < 120, `durata transizione ${css.duration}`);
  });
}
await check('virtual: scroll di un contenitore (senza window.scrollY)', () => {
  const r = results.virtual;
  assert.ok(r.result.virtualScroll, 'scroll virtuale non attivato');
  const anims = r.result.animations;
  const card = anims.find((a) => a.element.selector.includes('card') && a.kind === 'time');
  assert.ok(card && card.phase === 'scroll', 'card non legata allo scroll: ' + (card && card.phase));
  assert.ok(/expo\.out|power4\.out/.test(card.ease.best.name), `ease card ${card && card.ease.best.name}`);
  assert.ok(anims.some((a) => a.element.selector.includes('float') && a.kind === 'scroll'), 'parallax virtuale non rilevato');
});

{
  const kit = results.bundled.kit;
  const { dna, result } = roundTrip;
  await check('kit: preset e casting estratti dal sito d’origine', () => {
    for (const p of ['mask-slide', 'fade-up', 'scale-down-fade']) assert.ok(kit.presets[p], `preset ${p} mancante`);
    assert.equal(kit.roles.heading.preset, 'mask-slide');
    assert.equal(kit.roles.heading.split, 'lines');
    assert.ok(kit.hovers.length && kit.cursor && kit.pin.horizontal && kit.lenis, 'hover/cursore/pin/lenis mancanti nel kit');
    assert.equal(kit.lenis.lerp, 0.08);
    // The paragraph (y 30, power2.out, 0.8s) must not be averaged with the 28 letters (back.out).
    assert.equal(kit.roles.text.preset, 'fade-up');
    assert.equal(kit.presets['fade-up'].ease, 'power2.out');
    // texts in the source: the paragraph (30px) and the CSS-transition block (60px)
    assert.ok([30, 60].some((y) => Math.abs(kit.presets['fade-up'].from.y - y) < 6), `fade-up y ${kit.presets['fade-up'].from.y}`);
    const chars = Object.entries(kit.presets).find(([n]) => n.endsWith('-chars'));
    assert.ok(chars && /back\.out/.test(chars[1].ease), 'variante per le lettere mancante');
    const cards = Object.entries(kit.presets).find(([n]) => n.endsWith('-shape'));
    assert.ok(cards && cards[1].ease === 'expo.out', 'variante per le card mancante');
  });
  await check('kit: gira senza errori sul sito nuovo', () => {
    assert.ok(consoleMessages.some((m) => m.startsWith('info: [motion-kit]') && !/avvisi/.test(m)), consoleMessages.join(' | '));
    assert.ok(!consoleMessages.some((m) => /^(error|warning)/.test(m)), consoleMessages.join(' | '));
  });
  await check('andata e ritorno: la scena del sito nuovo ha la stessa regia', () => {
    const sc = dna.scenes.find((s) => s.section.includes('about'));
    assert.ok(sc, 'scena .about non trovata: ' + dna.scenes.map((s) => s.section).join(' | '));
    assert.equal(sc.roleOrder, 'heading → text → media');
    const [h, p, m] = sc.beats;
    const ms = kit.presets['mask-slide'];
    assert.equal(h.reveal, 'mask-slide');
    assert.equal(h.ease, ms.ease, `ease titolo ${h.ease} invece di ${ms.ease}`);
    assert.ok(Math.abs(h.duration / 1000 - ms.duration) < ms.duration * 0.12, `durata titolo ${h.duration}`);
    assert.ok(Math.abs(p.offset - kit.scene.pairOffsets['heading>text'] * 1000) < 90, `offset testo ${p.offset} vs ${kit.scene.pairOffsets['heading>text']}`);
    assert.ok(Math.abs(m.offset - p.offset - kit.scene.pairOffsets['text>media'] * 1000) < 90, `offset media ${m.offset - p.offset}`);
    assert.ok(/scale-down/.test(m.reveal), m.reveal);
  });
  await check('andata e ritorno: intro, parallax, pin, marquee, hover, cursore', () => {
    assert.ok(result.animations.some((a) => a.phase === 'intro' && a.element.selector.includes('h1')), 'intro del titolo mancante');
    const layer = dna.layers.find((l) => l.selector.includes('cover-img'));
    assert.ok(layer && Math.abs(layer.screenSpeed - kit.parallax.speed) < 12, `parallax ${layer && layer.screenSpeed} vs ${kit.parallax.speed}`);
    assert.ok(dna.pins.length === 1 && Math.abs(dna.pins[0].pinnedForVh - kit.pin.lengthVh) < 10, `pin ${dna.pins.map((p) => p.pinnedForVh)}`);
    const loop = dna.loops.find((l) => l.selector.includes('ticker'));
    assert.ok(loop && Math.abs(Math.abs(loop.speedPerSecond) - kit.marquee.speed) < kit.marquee.speed * 0.25, `marquee ${loop && loop.speedPerSecond} vs ${kit.marquee.speed}`);
    assert.ok(dna.interactions.hover.some((h) => h.target.includes('btn')), 'hover mancante');
    assert.ok(dna.interactions.cursor.length, 'cursore mancante');
  });
}

{
  const { buildCatalog, blend, verify } = await import('../src/dna-tools.mjs');
  const { writeFile: wf } = await import('node:fs/promises');
  const root = opts.out;
  const cat = await buildCatalog(root);
  await wf(path.join(root, 'catalog.json'), JSON.stringify(cat));
  await check('catalogo: un DNA con impronta per ogni sito estratto', () => {
    assert.ok(cat.count >= 5, `${cat.count} DNA`);
    assert.ok(cat.entries.every((e) => typeof e.fingerprint.dur === 'number' && e.summary.ease), 'impronte incomplete');
  });
  const a = await blend({ catalogPath: path.join(root, 'catalog.json'), mood: 'elegante', seed: 11 });
  const b = await blend({ catalogPath: path.join(root, 'catalog.json'), mood: 'elegante', seed: 11 });
  const c = await blend({ catalogPath: path.join(root, 'catalog.json'), mood: 'elegante', seed: 12 });
  await check('mix: stesso seed → stesso DNA, seed diverso → DNA diverso, e mai una copia', () => {
    assert.deepEqual(a.kit.presets, b.kit.presets);
    assert.notDeepEqual(a.kit.presets, c.kit.presets);
    assert.ok(a.kit.blend.unique && a.nearest[0].d >= 0.08, `distanza ${a.nearest[0].d}`);
    for (const [role, r] of Object.entries(a.kit.roles)) assert.ok(a.kit.presets[r.preset], `il casting di ${role} punta a un preset mancante`);
  });
  await check('verifica: il sito animato col suo DNA passa, con un DNA diverso no', () => {
    const good = verify(results.bundled.kit, roundTrip);
    const bad = verify(results.virtual.kit, roundTrip);
    assert.ok(good.score >= 0.8, `col suo DNA ${good.score}`);
    assert.ok(bad.score < 0.6, `con un DNA diverso ${bad.score}`);
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
