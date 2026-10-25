// Technical spec: for every section, every element with position/size/typography in px,
// and for every animated element: trigger, timing, easing, start/end values and keyframes.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { propsFor, mergeScale, sameUnits, RAW, gsapEase } from './analyze.mjs';

const family = (ch) => ch.replace(/\d+$/, '');
const r1 = (v) => Math.round(v * 10) / 10;
const ROLE = { heading: 'titolo', text: 'testo', media: 'media', button: 'bottone', shape: 'forma' };
const PROP = {
  x: 'x (translateX)', y: 'y (translateY)', scaleX: 'scaleX', scaleY: 'scaleY', rotate: 'rotazione', opacity: 'opacity',
  clip: 'clip-path', filter: 'filter', width: 'width', height: 'height', bg: 'background-color', color: 'color',
  radius: 'border-radius', dash: 'stroke-dashoffset (linea che si disegna)', ls: 'letter-spacing',
};
const KEYFRAMES = [0, 10, 25, 50, 75, 90, 100];
const md = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function fmt(ch, v) {
  const f = family(ch);
  if (v == null || Number.isNaN(v)) return '—';
  if (f === 'x' || f === 'y' || f === 'width' || f === 'height' || f === 'ls') return `${r1(v)}px`;
  if (f === 'rotate') return `${r1(v)}°`;
  if (f === 'opacity') return (Math.round(v * 100) / 100).toString();
  if (f === 'scaleX' || f === 'scaleY') return (Math.round(v * 1000) / 1000).toString();
  return String(r1(v));
}

function valueAt(seg, t) {
  const pts = [[seg.start, seg.from, seg.before], ...seg.rows.map((r) => [r.t, r.ch[seg.ch], r])];
  if (t <= pts[0][0]) return { v: pts[0][1], row: pts[0][2] };
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, v0, row0] = pts[i - 1];
      const [t1, v1, row1] = pts[i];
      const k = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
      return { v: v0 + (v1 - v0) * k, row: k < 0.5 ? row0 : row1 };
    }
  }
  const last = pts[pts.length - 1];
  return { v: last[1], row: last[2] };
}

// One entry per visible property (clip-path / filter numbers collapse into the CSS string).
function properties(a) {
  const out = [];
  const seen = new Set();
  const h = a.element.meta && a.element.meta.h;
  for (const s of a.segs) {
    const f = family(s.ch);
    if (RAW.has(f)) {
      if (seen.has(f)) continue;
      seen.add(f);
      out.push({ prop: PROP[f], ch: s.ch, from: s.before[f], to: s.last[f], delta: null });
      continue;
    }
    const d = s.to - s.from;
    let delta = fmt(s.ch, d);
    if (f === 'y' && h) delta += ` (${Math.round((d / h) * 100)}% dell'altezza)`;
    if (f === 'x' && a.element.meta && a.element.meta.w) delta += ` (${Math.round((d / a.element.meta.w) * 100)}% della larghezza)`;
    out.push({ prop: PROP[f] || s.ch, ch: s.ch, from: fmt(s.ch, s.from), to: fmt(s.ch, s.to), delta });
  }
  return out;
}

function keyframes(a) {
  const cols = [];
  const seen = new Set();
  for (const s of a.segs) {
    const f = family(s.ch);
    if (RAW.has(f) && seen.has(f)) continue;
    seen.add(f);
    cols.push(s);
  }
  return {
    header: cols.map((s) => PROP[family(s.ch)] || s.ch),
    rows: KEYFRAMES.map((p) => {
      const t = a.start + (a.duration * p) / 100;
      return {
        p,
        t: Math.round((a.duration * p) / 100),
        values: cols.map((s) => {
          const f = family(s.ch);
          const { v, row } = valueAt(s, t);
          return RAW.has(f) ? row[f] : fmt(s.ch, v);
        }),
      };
    }),
  };
}

const lit = (o) => '{ ' + Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'string' && !v.startsWith('§') ? JSON.stringify(v) : String(v).replace(/^§/, '')}`).join(', ') + ' }';

// Scene members share the section as trigger; their offset in the scene becomes the delay,
// so pasting all lines of a section reproduces its choreography.
function sectionTrigger(a, vh) {
  const meta = a.element.meta;
  if (!meta || meta.sectionTop == null) return null;
  const scroll = a.scene ? a.scene.scroll0 : a.scrollAtStart;
  return { trigger: meta.section, start: `top ${Math.round(((meta.sectionTop - scroll) / vh) * 100)}%` };
}

function gsapLine(a, vh) {
  if (a.kind === 'loop') {
    return `gsap.to(${JSON.stringify(a.element.selector)}, { ${a.ch === 'rotate' ? 'rotation' : a.ch}: "+=${Math.round(a.speedPerSecond * 10)}", duration: 10, ease: "none", repeat: -1 });`;
  }
  if (a.kind === 'scroll') {
    const from = mergeScale(propsFor(a.ch, a.from, a.fromRow));
    const to = mergeScale(propsFor(a.ch, a.to, a.toRow));
    sameUnits(from, to, a.fromRow);
    const st = lit({ trigger: a.element.selector, start: a.triggerStart, end: a.triggerEnd, scrub: '§' + a.scrub });
    return `gsap.fromTo(${JSON.stringify(a.element.selector)}, ${lit(from)}, ${lit({ ...to, ease: 'none', scrollTrigger: '§' + st })});`;
  }
  const from = {};
  const to = {};
  for (const s of a.segs) {
    Object.assign(from, propsFor(s.ch, s.from, s.before));
    Object.assign(to, propsFor(s.ch, s.to, s.last));
  }
  mergeScale(from);
  mergeScale(to);
  sameUnits(from, to, a.segs[0].before);
  const g = a.ease ? gsapEase(a.ease.best.name) : null;
  const ease = !a.ease
    ? 'power2.out'
    : g.path
      ? `CustomEase.create("css", "${g.path}")`
      : a.ease.best.err < 0.04
        ? g.ease
        : `CustomEase.create("misurata", "${a.ease.customEase}")`;
  const seconds = a.ease && a.ease.exactDuration ? a.ease.exactDuration : Math.round(a.duration / 10) / 100;
  const vars = { ...to, duration: '§' + seconds, ease: ease.startsWith('CustomEase') ? '§' + ease : ease };
  if (a.phase === 'intro') vars.delay = '§' + Math.round(a.start / 10) / 100;
  if (a.phase === 'scroll') {
    const st = sectionTrigger(a, vh) || { trigger: a.element.selector, start: a.triggerStart };
    if (a.scene && a.scene.offset) vars.delay = '§' + Math.round(a.scene.offset / 10) / 100;
    vars.scrollTrigger = '§' + lit(st);
  }
  return `gsap.fromTo(${JSON.stringify(a.element.selector)}, ${lit(from)}, ${lit(vars)});`;
}

function when(a, vh) {
  if (a.phase === 'intro') return `al caricamento, ${Math.round(a.start)}ms dopo l'apertura della pagina`;
  if (a.phase === 'mouse') return 'quando si muove il mouse';
  if (a.phase === 'hover') return `all'hover su \`${a.hoverTarget}\``;
  const st = sectionTrigger(a, vh);
  return `allo scroll: pagina scrollata di ${a.scrollAtStart}px · top dell'elemento a ${a.triggerStart.replace('top ', '')} del viewport${st ? ` · top della sezione a ${st.start.replace('top ', '')}` : ''}`;
}

function animSpec(a, n, vh) {
  const el = a.element;
  const meta = el.meta || {};
  const head = `#### ✦${n} ${a.kind === 'scroll' ? '🖱️ legata allo scroll' : a.kind === 'loop' ? '🔁 loop' : '⏱️ a tempo'} — ${ROLE[meta.role] || meta.role || 'elemento'}${el.text ? ` “${md(el.text.slice(0, 40))}”` : ''}`;
  const L = [head, '', `Selettore: \`${el.selector}\`${meta.masked ? ' · dentro una maschera (genitore con overflow hidden)' : ''}`, ''];

  if (a.kind === 'time' && a.phase === 'mouse') {
    const range = (f) => {
      const vals = a.segs.filter((s) => family(s.ch) === f).flatMap((s) => [s.from, s.to, ...s.rows.map((r) => r.ch[s.ch])]);
      return vals.length ? `${fmt(f, Math.min(...vals))} … ${fmt(f, Math.max(...vals))}` : null;
    };
    L.push(`- **Comportamento**: segue il mouse${a.element.meta && a.element.meta.fixed ? ' (position fixed: è un cursore personalizzato)' : ''}`);
    for (const f of ['x', 'y']) if (range(f)) L.push(`- **${PROP[f]}**: ${range(f)} durante il test (il test muove il mouse in cerchio)`);
    L.push(`- **Ricetta tipica**: \`gsap.quickTo(el, "x", { duration: 0.4, ease: "power3" })\` + \`quickTo(el, "y", …)\` su mousemove`);
    return L.join('\n');
  }
  if (a.kind === 'loop') {
    L.push(`- **Movimento**: ${PROP[family(a.ch)] || a.ch} continuo a ${a.speedPerSecond} ${family(a.ch) === 'rotate' ? '°' : 'px'}/s, senza fine`);
  } else if (a.kind === 'scroll') {
    const f = family(a.ch);
    const isRaw = RAW.has(f);
    L.push(
      `- **Intervallo di scroll**: da ${a.scrollStart}px a ${a.scrollEnd}px (${a.scrollEnd - a.scrollStart}px di scroll) · start ≈ \`${a.triggerStart}\` · end ≈ \`${a.triggerEnd}\``,
      `- **Scrub**: ${a.scrub === true ? 'true (segue lo scroll senza ritardo)' : `${a.scrub} (l'elemento raggiunge lo scroll ${a.scrubLagMs}ms dopo che ti fermi)`}`,
      `- **Proprietà**: ${PROP[f] || a.ch} da ${isRaw ? a.fromRow[f] : fmt(a.ch, a.from)} a ${isRaw ? a.toRow[f] : fmt(a.ch, a.to)}${!isRaw ? ` (variazione ${fmt(a.ch, a.to - a.from)}, ${r1(((a.to - a.from) / Math.max(1, a.scrollEnd - a.scrollStart)) * 100) / 100}px per px di scroll)` : ''}`,
      '',
      `| scroll | ${PROP[f] || a.ch} |`,
      '|---|---|',
      ...a.samples.map((s) => `| ${s.scroll}px | ${md(isRaw ? s[f] : fmt(a.ch, s.value))} |`),
    );
  } else {
    if (a.scrubbed) L.push('- **Nota**: è un pezzo di una **timeline legata allo scroll (scrub)** del sito: si muove a strappi mentre scorri, i tempi qui sotto dipendono dalla velocità dello scroll, non sono un easing da copiare');
    L.push(`- **Quando**: ${when(a, vh)}${a.scene ? ` · scena ${a.scene.id}, parte a +${a.scene.offset}ms` : ''}`);
    L.push(`- **Durata**: ${Math.round(a.duration)}ms`);
    if (a.ease && a.ease.exact) {
      L.push(`- **Easing**: \`${a.ease.best.name}\` — **esatto**, letto ${a.ease.exact === 'gsap' ? 'dalla chiamata GSAP del sito' : 'dal CSS del sito'} (durata dichiarata ${a.ease.exactDuration}s)`);
    } else if (a.ease) {
      const e = a.ease.best;
      L.push(
        `- **Easing**: ${e.err < 0.04 ? `\`${e.name}\`` : `curva personalizzata (la più vicina è \`${e.name}\`)`} · scarto ${(e.err * 100).toFixed(1)}% · alternative ${a.ease.alternatives.map((x) => `\`${x.name}\``).join(', ')}`,
      );
      if (e.err >= 0.04) L.push(`- **CustomEase misurata**: \`${a.ease.customEase}\``);
    }
    if (a.stagger) L.push(`- **Stagger**: ${a.stagger.each}s tra elementi uguali (questo è il ${a.stagger.index + 1}° di ${a.stagger.size})`);
    L.push('', '| proprietà | inizio | fine | variazione |', '|---|---|---|---|');
    for (const p of properties(a)) L.push(`| ${p.prop} | ${md(p.from)} | ${md(p.to)} | ${md(p.delta ?? '—')} |`);
    const kf = keyframes(a);
    L.push('', `| progresso | tempo | ${kf.header.join(' | ')} |`, `|---|---|${kf.header.map(() => '---').join('|')}|`);
    for (const r of kf.rows) L.push(`| ${r.p}% | ${r.t}ms | ${r.values.map(md).join(' | ')} |`);
  }
  if (a.phase !== 'mouse' && a.phase !== 'hover') L.push('', '```js', gsapLine(a, vh), '```');
  return L.join('\n');
}

function elementRow(e, refs) {
  const notes = [];
  if (refs.length) notes.push(refs.map((n) => `✦${n}`).join(' '));
  if (e.position) notes.push(e.position);
  if (e.z) notes.push(`z ${e.z}`);
  if (e.overflowHidden) notes.push('overflow hidden');
  if (e.radius) notes.push(`raggio ${e.radius}`);
  if (e.bg) notes.push(`sfondo ${e.bg}`);
  if (e.src) notes.push(`src ${e.src.split('/').pop().slice(0, 40)}`);
  const label = e.text ? `“${e.text.slice(0, 32)}”` : '';
  return `| \`${e.tag}\` | ${md(label)} | ${e.x}px (${e.xVw}vw) | ${e.y}px | ${e.w}×${e.h}px (${e.wVw}vw) | ${md(e.font || '—')} | ${e.color || '—'} | ${md(notes.join(' · '))} |`;
}

export function buildSpec({ url, title, dump, scene, result }) {
  const anims = result.animations;
  const byMotionId = new Map();
  for (const a of anims) {
    const id = a.element.id;
    if (!byMotionId.has(id)) byMotionId.set(id, []);
    byMotionId.get(id).push(a);
  }
  const placed = new Set();
  const L = [];
  L.push(
    `# Scheda tecnica — ${title || url}`,
    '',
    `Fonte: ${url} · viewport ${scene.viewport.w}×${scene.viewport.h}px · pagina ${dump.docHeight}px`,
    '',
    'Come leggerla: le posizioni `x`/`y` sono in px dall’angolo in alto a sinistra della sezione, misurate a questo viewport',
    '(tra parentesi in vw, per adattarle ad altri schermi). Le animazioni sono numerate ✦ e richiamate nella tabella degli elementi.',
    'I tempi sono misurati dal vivo; start/end dello scroll hanno la precisione di uno step di scroll.',
    '',
    '## Sommario',
    '',
    '| # | sezione | top | altezza | sfondo | elementi | animazioni |',
    '|---|---|---|---|---|---|---|',
  );
  const sectionBlocks = [];
  let n = 0;
  scene.sections.forEach((sec, i) => {
    const B = [];
    const animsHere = [];
    for (const e of sec.elements) {
      if (e.motionId && byMotionId.has(e.motionId)) {
        for (const a of byMotionId.get(e.motionId)) {
          if (placed.has(a)) continue;
          placed.add(a);
          animsHere.push({ a, n: ++n, e });
        }
      }
    }
    L.push(`| ${i + 1} | \`${md(sec.selector.split(' > ').pop())}\` ${sec.firstHeading ? `“${md(sec.firstHeading.slice(0, 30))}”` : ''} | ${sec.top}px | ${sec.heightPx}px (${sec.heightVh}vh)${sec.pinnedForVh ? ` + pin ${sec.pinnedForVh}vh` : ''} | ${sec.bg} | ${sec.elements.length} | ${animsHere.length} |`);
    B.push(
      `## Sezione ${i + 1} — \`${sec.selector}\`${sec.firstHeading ? ` — “${md(sec.firstHeading)}”` : ''}`,
      '',
      `- **Posizione**: top ${sec.top}px nella pagina · ${sec.widthPx}×${sec.heightPx}px (${sec.heightVh}vh)${sec.pinnedForVh ? ` · **pinnata** per ${sec.pinnedForVh}vh di scroll` : ''}`,
      `- **Stile**: sfondo ${sec.bg} · testo ${sec.color} · display ${sec.display}${sec.gridColumns ? ` · colonne \`${sec.gridColumns}\`` : ''} · padding ${sec.paddingX}vw orizzontale, ${sec.paddingY}vh verticale`,
      '',
      '### Elementi',
      '',
      '| tag | testo | x | y | dimensioni | font | colore | note |',
      '|---|---|---|---|---|---|---|---|',
    );
    for (const e of sec.elements) {
      const refs = animsHere.filter((x) => x.e === e).map((x) => x.n);
      B.push(elementRow(e, refs));
    }
    if (animsHere.length) {
      B.push('', '### Animazioni', '');
      animsHere
        .sort((x, y) => (x.a.start ?? 0) - (y.a.start ?? 0))
        .forEach(({ a, n: k }) => B.push(animSpec(a, k, scene.viewport.h), ''));
    }
    sectionBlocks.push(B.join('\n'));
  });
  // Outside the sections: show each element/phase once (a cursor produces many small moves).
  const restSeen = new Map();
  for (const a of anims.filter((x) => !placed.has(x))) {
    const k = a.element.selector + '|' + a.kind + '|' + (a.phase || '');
    if (!restSeen.has(k)) restSeen.set(k, { a, count: 0 });
    restSeen.get(k).count++;
  }
  const rest = [...restSeen.values()].map((r) => Object.assign(r.a, { repeats: r.count }));
  L.push('', ...sectionBlocks);
  if (rest.length) {
    L.push('', '## Elementi animati fuori dalle sezioni (fissi, cursore, overlay)', '');
    for (const a of rest) {
      const m = a.element.meta || {};
      L.push(animSpec(a, ++n, scene.viewport.h), '', `Dimensioni ${m.w}×${m.h}px${m.fixed ? ' · position fixed' : ''}${a.repeats > 1 ? ` · ${a.repeats} movimenti registrati in questa fase` : ''}`, '');
    }
  }
  return L.join('\n') + '\n';
}

export async function writeSpec(outDir, data) {
  await writeFile(path.join(outDir, 'spec.md'), buildSpec(data));
}
