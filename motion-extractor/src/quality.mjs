// How much to trust one site's DNA. The extractor checks its own measurements against what the
// site reveals about itself (live ScrollTriggers, GSAP calls, CSS animations) and against what it
// knows it cannot see (WebGL, page errors, limits reached), so a wrong or partial DNA is flagged
// instead of silently ending up in the catalog.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

// Ease names and durations written in the site's own code (what I checked by hand on the first
// real sites): `ease: "power4.out"`, `duration: .8`, `transition: … cubic-bezier(…)`.
export function codeTimings(texts) {
  const eases = new Set();
  const durations = new Set();
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(/\bease\s*:\s*["'`]([\w.]+(?:\([\d.,\s]*\))?)["'`]/g)) eases.add(m[1]);
    for (const m of t.matchAll(/\bduration\s*:\s*(\d*\.?\d+)/g)) durations.add(+m[1]);
  }
  return { eases, durations };
}

export function assess({ run, dump, result, dna, kit, codeTexts = [] }) {
  const issues = [];
  const add = (severity, text) => issues.push({ severity, text });
  const libs = dump.libs;
  const anims = result.animations;
  const entrances = anims.filter((a) => a.kind === 'time' && !a.scrubbed && (a.phase === 'intro' || a.phase === 'scroll'));
  const exact = entrances.filter((a) => a.ease && a.ease.exact);
  const fitted = entrances.filter((a) => a.ease && !a.ease.exact);
  const fitErr = median(fitted.map((a) => a.ease.best.err));

  // what could not be done
  if (!anims.length && dump.docHeight <= dump.viewport.h * 1.2) add('alta', `pagina ferma su una schermata d'ingresso o di caricamento${run.gate ? ` (cliccato "${run.gate}")` : ''}: nella copia scaricata mancano file, oppure serve --headed`);
  else if (!anims.length) add('alta', 'nessuna animazione registrata: protezione anti-bot, muro dei cookie o sito senza animazioni (prova --headed)');
  if (!run.reachedEnd) add('alta', `pagina non scorsa fino in fondo (fermata a ${run.scrolled}px): alza --max-scroll`);
  if (run.scriptFailures.length) add('alta', `${run.scriptFailures.length} script non caricati: parte del codice delle animazioni manca (${run.scriptFailures.slice(0, 2).join(', ')})`);
  if (run.pageErrors.length) add('media', `${run.pageErrors.length} errori JavaScript nella pagina: alcune animazioni potrebbero non essere partite («${run.pageErrors[0].slice(0, 90)}»)`);
  if (run.otherFailures > 0) add('info', `${run.otherFailures} risorse non caricate (immagini, font, video): l'aspetto può differire dal sito online`);

  // limits of the recorder
  if (dump.tracked.length >= 400) add('media', 'raggiunto il limite di 400 elementi seguiti: gli ultimi elementi animati non sono misurati');
  if ((dump.cssAnimations || []).length >= 5000) add('media', 'raggiunto il limite di 5000 animazioni CSS registrate');
  if ((dump.calls || []).length >= 3000) add('media', 'raggiunto il limite di 3000 chiamate GSAP registrate');

  // what it cannot see
  const webgl = (libs.contexts || []).filter((c) => /webgl/i.test(c.type)).length;
  const canvas2d = (libs.contexts || []).filter((c) => c.type === '2d').length;
  if (webgl) add('media', `${webgl} contesti WebGL${libs.threeRevision ? ` (Three.js r${libs.threeRevision})` : ''}: quegli effetti non sono misurati, solo il movimento HTML intorno`);
  if (canvas2d) add('info', `${canvas2d} canvas 2D disegnati a mano: non misurati`);

  // checks against the site's own truth
  const live = dump.scrollTriggers || null;
  if (live) {
    const livePins = live.filter((s) => s.pin).length;
    if (livePins !== dna.pins.length) add('alta', `il sito ha ${livePins} pin (ScrollTrigger dal vivo), ne ho trovati ${dna.pins.length}`);
    const liveScrub = live.filter((s) => s.scrub && s.animation).length;
    const foundScroll = anims.filter((a) => a.kind === 'scroll' || a.scrubbed).length;
    if (liveScrub > 0 && foundScroll === 0) add('alta', `il sito ha ${liveScrub} animazioni con scrub, non ne ho misurata nessuna`);
  }
  if (entrances.length) {
    if (exact.length === entrances.length) {
      add('info', `easing e durate esatti, letti dal codice del sito, per tutte le ${entrances.length} entrate`);
    } else if (libs.gsapVersions && !libs.gsapGlobal && !exact.length) {
      add('info', `GSAP è nel bundle del sito: easing stimati dal movimento per ${fitted.length} entrate (scarto mediano ${Math.round(fitErr * 1000) / 10}%)`);
    } else {
      add('info', `${exact.length}/${entrances.length} entrate con easing esatto dal codice, le altre stimate dal movimento (scarto mediano ${Math.round((fitErr ?? 0) * 1000) / 10}%)`);
    }
    if (fitErr != null && fitErr > 0.04) add('media', `le curve stimate hanno uno scarto alto (${Math.round(fitErr * 1000) / 10}%): nel kit diventano CustomEase misurate, controlla il video`);
  }
  // cross-check with the site's own code: every named ease the kit uses should be written there
  const code = codeTimings(codeTexts);
  const kitEases = kit ? [...new Set(Object.values(kit.presets).map((p) => p.ease).filter((e) => !/^kit-/.test(e)))] : [];
  let crossCheck = null;
  if (code.eases.size >= 2 && kitEases.length) {
    const base = (e) => String(e).replace(/\(.*$/, '');
    const inCode = kitEases.filter((e) => code.eases.has(e) || [...code.eases].some((c) => base(c) === base(e)));
    const missing = kitEases.filter((e) => !inCode.includes(e));
    crossCheck = { codeEases: [...code.eases], kitEases, confirmed: inCode, notInCode: missing };
    if (missing.length > kitEases.length / 2) add('media', `easing del kit non presenti nel codice del sito: ${missing.join(', ')} (stimati male o animazioni CSS)`);
    else add('info', `confronto col codice del sito: ${inCode.length}/${kitEases.length} easing del kit sono scritti nel codice (${inCode.join(', ')})`);
  } else if (code.eases.size < 2 && libs.gsapVersions) {
    add('info', 'codice delle animazioni non leggibile (minificato a fondo o caricato a parte): nessun confronto col codice possibile');
  }
  if ((libs.lenisVersion || libs.lenisHtmlClass) && run.lenisOptions === 0) add('info', 'Lenis presente ma le sue opzioni non sono nel codice leggibile: nel kit uso i valori di default');
  if (!run.hoveredKinds) add('info', 'nessun link o bottone trovato per il test di hover');

  const score = Math.max(0, 100 - 30 * issues.filter((i) => i.severity === 'alta').length - 10 * issues.filter((i) => i.severity === 'media').length);
  const level = score >= 80 ? 'alta' : score >= 55 ? 'media' : 'bassa';
  return {
    level,
    score,
    issues,
    facts: {
      entrances: entrances.length,
      exact: exact.length,
      fitErrorMedian: fitErr,
      scrollLinked: anims.filter((a) => a.kind === 'scroll').length,
      scrubbedPieces: anims.filter((a) => a.scrubbed).length,
      loops: dna.loops.length,
      pins: dna.pins.length,
      liveScrollTriggers: live ? live.length : null,
      hoveredKinds: run.hoveredKinds,
      pageErrors: run.pageErrors.length,
      reachedEnd: run.reachedEnd,
      crossCheck,
      gate: run.gate || null,
    },
  };
}

export async function writeQuality(outDir, q, url) {
  const icon = { alta: '🔴', media: '🟠', info: 'ℹ️' };
  const L = [
    `# Affidabilità del DNA — ${url}`,
    '',
    `**${q.level.toUpperCase()}** (${q.score}/100) — ${q.level === 'alta' ? 'si può usare nei mix' : q.level === 'media' ? 'usabile, ma leggi gli avvisi' : 'non usarlo nei mix finché non è risolto'}`,
    '',
    ...q.issues.map((i) => `- ${icon[i.severity]} ${i.text}`),
    '',
    '```json',
    JSON.stringify(q.facts, null, 2),
    '```',
  ];
  await writeFile(path.join(outDir, 'affidabilita.md'), L.join('\n') + '\n');
  await writeFile(path.join(outDir, 'quality.json'), JSON.stringify(q, null, 2));
}
