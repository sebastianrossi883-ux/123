// Turns the measured DNA into something another AI can apply to a DIFFERENT site:
//   motion-kit.js — a runtime that animates any HTML tagged with data-attributes,
//                   using only the presets, eases, timings and offsets measured here;
//   per-ia.md     — instructions for the AI: setup, presets, how to tag each element.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { revealType } from './choreography.mjs';
import { propsFor, mergeScale } from './analyze.mjs';

const RUNTIME = readFileSync(fileURLToPath(new URL('./kit-runtime.js', import.meta.url)), 'utf8');
const family = (ch) => ch.replace(/\d+$/, '');
const round = (v, d = 2) => +(+v).toFixed(d);
const median = (xs) => {
  const s = xs.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const mode = (xs) => {
  const m = new Map();
  for (const x of xs) m.set(x, (m.get(x) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1])[0]?.[0];
};
const pctOf = (s) => +String(s).match(/-?\d+/)[0];
const ROLE_NAME = { heading: 'titoli', text: 'testi', media: 'immagini/video/blocchi visivi', button: 'bottoni/link', shape: 'forme/card/elementi decorativi' };

const DESCR = {
  'mask-slide': 'scorre fuori da una maschera (overflow hidden), ideale per righe di titolo',
  'fade-up': 'sale e appare',
  'fade-down': 'scende e appare',
  'fade-side': 'entra di lato sfumando',
  'scale-down': 'parte ingrandito e torna alla sua scala',
  'scale-down-fade': 'parte ingrandito e trasparente, torna alla sua scala',
  'scale-up': 'cresce fino alla sua scala',
  'scale-up-fade': 'cresce e appare',
  'clip-reveal': 'si scopre con clip-path',
  'blur-in': 'da sfocato a nitido',
  'draw-line': 'linea SVG che si disegna (stroke)',
  'slide-up': 'sale', 'slide-down': 'scende', 'slide-side': 'scorre di lato',
  'rotate-in': 'ruota in posizione', fade: 'dissolvenza',
};

function seg(a, f) {
  return a.segs.find((s) => family(s.ch) === f);
}

function presetFrom(name, type, list, customEases) {
  const dur = round(median(list.map((a) => a.duration)) / 1000);
  const goodEases = list.filter((a) => a.ease && a.ease.best.err < 0.04).map((a) => a.ease.best.name);
  let ease = goodEases.length >= list.length / 2 ? mode(goodEases) : null;
  if (!ease) {
    const sample = list.find((a) => a.ease);
    ease = sample ? `kit-${name}` : 'power2.out';
    if (sample) customEases[ease] = sample.ease.customEase;
  }
  const staggers = list.filter((a) => a.stagger).map((a) => a.stagger.each);
  const p = { type, duration: dur, ease, stagger: staggers.length ? round(median(staggers), 3) : 0.08, from: {}, to: {}, measuredOn: list.length };
  const op = list.map((a) => seg(a, 'opacity')).filter(Boolean);
  if (op.length) {
    p.from.opacity = round(median(op.map((s) => s.from)), 2);
    p.to.opacity = round(median(op.map((s) => s.to)), 2);
  }
  const ys = list.map((a) => [seg(a, 'y'), a.element.meta]).filter(([s]) => s);
  const xs = list.map((a) => seg(a, 'x')).filter(Boolean);
  if (type === 'mask-slide') {
    p.mask = true;
    p.from.yPercent = Math.round(median(ys.map(([s, m]) => (m && m.h ? ((s.from - s.to) / m.h) * 100 : 100))) / 10) * 10 || 100;
    p.to.yPercent = 0;
  } else if (/^(fade|slide)-(up|down)$/.test(type) && ys.length) {
    p.from.y = Math.round(median(ys.map(([s]) => s.from - s.to)));
    p.to.y = 0;
  } else if (/side$/.test(type) && xs.length) {
    p.from.x = Math.round(median(xs.map((s) => s.from - s.to)));
    p.to.x = 0;
  } else if (/^scale/.test(type)) {
    const sc = list.map((a) => seg(a, 'scaleX') || seg(a, 'scaleY')).filter(Boolean);
    p.from.scale = round(median(sc.map((s) => s.from)), 2);
    p.to.scale = round(median(sc.map((s) => s.to)), 2);
  } else if (type === 'clip-reveal') {
    const c = list.map((a) => seg(a, 'clip')).filter(Boolean);
    p.from.clipPath = mode(c.map((s) => propsFor(s.ch, s.from, s.before).clipPath));
    p.to.clipPath = mode(c.map((s) => propsFor(s.ch, s.to, s.last).clipPath));
  } else if (type === 'blur-in') {
    const c = list.map((a) => seg(a, 'filter')).filter(Boolean);
    p.from.filter = mode(c.map((s) => propsFor(s.ch, s.from, s.before).filter));
    p.to.filter = mode(c.map((s) => propsFor(s.ch, s.to, s.last).filter));
  } else if (type === 'draw-line') {
    p.draw = true;
  } else if (type === 'rotate-in') {
    const r = list.map((a) => seg(a, 'rotate')).filter(Boolean);
    p.from.rotation = Math.round(median(r.map((s) => s.from)));
    p.to.rotation = 0;
  }
  return p;
}

// cubic-bezier(a, b, c, d) from a CSS transition → CustomEase path.
const bezierPath = (css) => {
  const m = css && css.match(/cubic-bezier\(([^)]+)\)/);
  if (!m) return null;
  const [a, b, c, d] = m[1].split(',').map((v) => +v.trim());
  return `M0,0 C${a},${b} ${c},${d} 1,1`;
};
const CSS_EASES = { ease: 'M0,0 C0.25,0.1 0.25,1 1,1', 'ease-in': 'M0,0 C0.42,0 1,1 1,1', 'ease-out': 'M0,0 C0,0 0.58,1 1,1', 'ease-in-out': 'M0,0 C0.42,0 0.58,1 1,1', linear: null };

export function buildKit({ url, result, dna, scene, snippets, libs }) {
  const anims = result.animations;
  const time = anims.filter((a) => a.kind === 'time' && (a.phase === 'intro' || a.phase === 'scroll'));
  const customEases = {};

  // 1. Presets. Animations are grouped by reveal type and variant (role, or "chars" for text
  // split in letters); a staggered group counts once. The biggest group of a type gets the plain
  // name ("fade-up"); another group that moves differently becomes "fade-up-<variant>".
  const isChars = (a) => a.stagger && a.stagger.size >= 10 && a.stagger.each < 0.05;
  const ROLE_ORDER = ['heading', 'text', 'media', 'button', 'shape', 'chars'];
  const groups = new Map();
  const seenStagger = new Set();
  for (const a of time) {
    const type = revealType(a);
    if (!DESCR[type]) continue;
    const role = (a.element.meta || {}).role || 'shape';
    const variant = isChars(a) ? 'chars' : role;
    const key = `${type}|${variant}`;
    if (!groups.has(key)) groups.set(key, { type, role, variant, members: [], units: 0 });
    const g = groups.get(key);
    g.members.push(a);
    if (!a.stagger || !seenStagger.has(a.stagger.group)) {
      g.units++;
      if (a.stagger) seenStagger.add(a.stagger.group);
    }
  }
  const similar = (p, q) =>
    p.ease === q.ease &&
    Math.abs(p.duration - q.duration) <= q.duration * 0.15 &&
    Object.keys({ ...p.from, ...q.from }).every((k) => {
      const a = p.from[k];
      const b = q.from[k];
      if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= Math.max(Math.abs(b) * 0.25, 0.05);
      return a === b;
    });
  const presets = {};
  const nameOf = new Map();
  const byType = new Map();
  for (const g of groups.values()) {
    if (!byType.has(g.type)) byType.set(g.type, []);
    byType.get(g.type).push(g);
  }
  for (const [type, list] of byType) {
    list.sort((a, b) => b.units - a.units || ROLE_ORDER.indexOf(a.variant) - ROLE_ORDER.indexOf(b.variant));
    list.forEach((g, i) => {
      const name = i === 0 ? type : `${type}-${g.variant}`;
      const p = presetFrom(name, type, g.members, customEases);
      p.groups = g.units;
      const base = presets[type];
      if (i > 0 && base && similar(p, base)) {
        base.measuredOn += p.measuredOn;
        base.groups += p.groups;
        nameOf.set(g, type);
      } else {
        presets[name] = p;
        nameOf.set(g, name);
      }
    });
  }

  // 2. Casting: which preset each kind of element uses, and whether its text is split.
  const roles = {};
  for (const role of ['heading', 'text', 'media', 'button', 'shape']) {
    const mine = [...groups.values()].filter((g) => g.role === role);
    if (!mine.length) continue;
    const total = mine.reduce((acc, g) => acc + g.units, 0);
    const best = mine.sort((a, b) => b.units - a.units || ROLE_ORDER.indexOf(a.variant) - ROLE_ORDER.indexOf(b.variant))[0];
    const split = best.variant === 'chars' ? 'chars' : best.type === 'mask-slide' && role === 'heading' ? 'lines' : null;
    roles[role] = { preset: nameOf.get(best), split, share: round(best.units / total) };
  }

  // 3. Choreography: delay between consecutive roles inside a scene, scene trigger.
  const pairs = new Map();
  for (const s of dna.scenes) {
    s.beats.forEach((b, i) => {
      if (!i) return;
      const k = `${s.beats[i - 1].role}>${b.role}`;
      if (!pairs.has(k)) pairs.set(k, []);
      pairs.get(k).push((b.offset - s.beats[i - 1].offset) / 1000);
    });
  }
  const pairOffsets = Object.fromEntries([...pairs].map(([k, v]) => [k, round(median(v), 2)]));
  const allSteps = [...pairs.values()].flat();
  const vh = scene.viewport.h;
  const sceneStarts = time
    .filter((a) => a.phase === 'scroll' && a.scene && a.scene.offset === 0 && a.element.meta && a.element.meta.sectionTop != null)
    .map((a) => Math.round(((a.element.meta.sectionTop - a.scene.scroll0) / vh) * 100))
    .filter((p) => p > -50 && p < 130);
  const elementStarts = time.filter((a) => a.phase === 'scroll').map((a) => pctOf(a.triggerStart)).filter((p) => p > 0 && p < 130);
  const intro = time.filter((a) => a.phase === 'intro');

  // 4. Scroll staging.
  const speeds = dna.layers.filter((l) => l.screenSpeed != null).map((l) => l.screenSpeed);
  const scrubs = anims.filter((a) => a.kind === 'scroll').map((a) => (a.scrub === true ? 0 : a.scrub));
  const loopSpeeds = dna.loops.filter((l) => l.property === 'x').map((l) => Math.abs(l.speedPerSecond));
  const horizontalPins = dna.pins.filter((p) => p.scrubbedInside.some((s) => / x$/.test(s)));

  // 5. Hover effects measured on the source buttons.
  const cursorSel = new Set(dna.interactions.cursor.map((c) => c.selector).concat(dna.interactions.mouseParallax.map((c) => c.selector)));
  const hovers = [];
  for (const h of dna.interactions.hover) {
    const moved = anims.filter((a) => a.kind === 'time' && a.phase === 'hover' && a.hoverTarget === h.target && !cursorSel.has(a.element.selector));
    const enter = moved.find((a) => a.element.selector === h.target) || moved[0];
    if (!enter) continue;
    const to = {};
    for (const s of enter.segs) Object.assign(to, propsFor(s.ch, s.to, s.last));
    mergeScale(to);
    const css = h.effects.find((e) => e.via === 'css');
    let ease = enter.ease && enter.ease.best.err < 0.04 ? enter.ease.best.name : 'power2.out';
    const pathCss = css && (bezierPath(css.ease) || CSS_EASES[css.ease]);
    if (pathCss) {
      ease = `kit-hover-${hovers.length + 1}`;
      customEases[ease] = pathCss;
    }
    hovers.push({ name: `hover-${hovers.length + 1}`, to, duration: round((css ? css.duration : enter.duration) / 1000), ease, source: h.target });
  }

  const lenisCode = snippets.map((s) => s.code).join('\n');
  const lerp = lenisCode.match(/\blerp\s*:\s*(\d*\.?\d+)/);
  const wheel = lenisCode.match(/\bwheelMultiplier\s*:\s*(\d*\.?\d+)/);
  const usesLenis = !!(libs && (libs.lenisVersion || libs.lenisHtmlClass)) || !!lerp;

  const kit = {
    source: url,
    presets,
    customEases,
    roles,
    scene: {
      start: `top ${median(sceneStarts) ?? 75}%`,
      step: round(median(allSteps) ?? 0.15, 2),
      pairOffsets,
    },
    single: { start: `top ${median(elementStarts) ?? 85}%` },
    intro: { delay: intro.length ? round(Math.min(...intro.map((a) => a.start)) / 1000) : 0.2 },
    parallax: { speed: median(speeds) ?? 85, scrub: median(scrubs) ?? 0.5, measured: speeds },
    pin: { lengthVh: median(dna.pins.map((p) => p.pinnedForVh)) ?? 150, horizontal: horizontalPins.length > 0, scrub: median(scrubs) ?? true },
    marquee: { speed: median(loopSpeeds) ?? 40 },
    cursor: dna.interactions.cursor.length ? { size: dna.interactions.cursor[0].w, duration: 0.4 } : null,
    hovers,
    lenis: usesLenis ? { lerp: lerp ? +lerp[1] : 0.1, wheelMultiplier: wheel ? +wheel[1] : 1 } : null,
  };
  return kit;
}

export function kitScript(kit) {
  return `/*! motion-kit — movimento estratto da ${kit.source}
 * Generato da motion-extractor. Uso: vedi per-ia.md.
 * Richiede gsap, ScrollTrigger (+ SplitText, CustomEase, Lenis se usati) caricati prima di questo file.
 */
window.MOTION_DNA = ${JSON.stringify(kit, null, 2)};
${RUNTIME}`;
}

function table(rows) {
  return rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
}

export function aiInstructions(kit, { title, url }) {
  const P = kit.presets;
  const L = [];
  L.push(
    `# Istruzioni per l'IA che anima il sito — DNA di movimento da ${title || url}`,
    '',
    'Devi animare un sito statico **che non è quello di origine**, usando **solo** il movimento misurato su',
    `${url}. Il movimento è già tutto in \`motion-kit.js\`: tu non scrivi animazioni, **aggiungi attributi \`data-*\` all'HTML**.`,
    '',
    '## Regole',
    '',
    '1. Non scrivere altro codice GSAP e non cambiare durate, easing o distanze: sono misurati, e il risultato deve sembrare dello stesso autore.',
    "2. Usa il casting qui sotto: ogni tipo di elemento entra sempre nello stesso modo. La coerenza è ciò che rende unico il sito d'origine.",
    '3. Raggruppa gli elementi di ogni sezione in una **scena** (`data-scene`): il kit li fa entrare nell’ordine del DOM con i ritardi misurati.',
    '4. Non animare tutto: niente `data-motion` su paragrafi lunghi interi, footer, menu, form.',
    '5. Il kit rispetta `prefers-reduced-motion` da solo. Non toccare `window.MOTION_DNA`.',
    '',
    '## 1. Setup (prima di `</body>`)',
    '',
    '```html',
    '<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/ScrollTrigger.min.js"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/SplitText.min.js"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/CustomEase.min.js"></script>',
    kit.lenis ? '<script src="https://cdn.jsdelivr.net/npm/lenis@1.3.27/dist/lenis.min.js"></script>' : '',
    '<script src="motion-kit.js"></script>',
    '```',
    '',
    '## 2. Casting: come entra ogni tipo di elemento',
    '',
    table([
      ['tipo di elemento', 'attributi da mettere', 'cosa succede'],
      ['---', '---', '---'],
      ...Object.entries(kit.roles).map(([role, r]) => [
        ROLE_NAME[role] || role,
        `\`data-motion="${r.preset}"\`${r.split ? ` \`data-split="${r.split}"\`` : ''}`,
        `${DESCR[(P[r.preset] || {}).type] || r.preset}${r.split === 'lines' ? ', riga per riga' : r.split === 'chars' ? ', lettera per lettera' : ''} (${Math.round(r.share * 100)}% dei casi nel sito d'origine)`,
      ]),
    ]),
    '',
    '## 3. Preset misurati',
    '',
    table([
      ['preset', 'effetto', 'da', 'a', 'durata', 'easing', 'stagger', 'misurato su'],
      ['---', '---', '---', '---', '---', '---', '---', '---'],
      ...Object.entries(P).map(([name, p]) => [
        `\`${name}\``,
        DESCR[p.type] || p.type,
        p.draw ? 'linea nascosta' : `\`${JSON.stringify(p.from)}\``,
        p.draw ? 'linea intera' : `\`${JSON.stringify(p.to)}\``,
        `${p.duration}s`,
        `\`${p.ease}\``,
        `${p.stagger}s`,
        `${p.measuredOn} elementi${p.groups && p.groups !== p.measuredOn ? ` (${p.groups} gruppi)` : ''}`,
      ]),
    ]),
    '',
    'Puoi forzare un valore solo se un elemento è molto diverso (es. un titolo enorme): `data-duration="1.2"`, `data-ease="expo.out"`, `data-stagger="0.05"`.',
    '',
    '## 4. Coreografia delle sezioni',
    '',
    `- Metti \`data-scene\` sul contenitore della sezione: la scena parte quando il suo top arriva a \`${kit.scene.start}\` del viewport.`,
    '- Dentro, gli elementi con `data-motion` entrano **nell’ordine del DOM**. Il ritardo tra uno e il successivo dipende da chi segue chi (misurato):',
    '',
    table([
      ['dopo', 'entra', 'ritardo'],
      ['---', '---', '---'],
      ...Object.entries(kit.scene.pairOffsets).map(([k, v]) => {
        const [a, b] = k.split('>');
        return [ROLE_NAME[a] || a, ROLE_NAME[b] || b, `${v}s`];
      }),
      ['(altri casi)', '', `${kit.scene.step}s`],
    ]),
    '',
    '- Il ruolo lo deduce il kit dal tag (h1–h6 → titolo, p → testo, img/video/picture/figure → media, a/button → bottone); per un `<div>` che è un’immagine o una card metti `data-role="media"` o `data-role="shape"`.',
    '- Per spostare un elemento nel tempo: `data-at="0.4"` (secondi dall’inizio della scena).',
    `- Hero/primo schermo: usa \`data-intro\` al posto di \`data-scene\` → parte al caricamento dopo ${kit.intro.delay}s.`,
    `- Elementi isolati fuori da una scena: \`data-motion\` da solo, partono a \`${kit.single.start}\`.`,
    '',
    '## 5. Scroll',
    '',
    `- **Parallax**: \`data-parallax\` su un’immagine dentro un contenitore con \`overflow:hidden\` (l’immagine deve essere ~20% più alta del contenitore). Velocità misurata: ${kit.parallax.speed}% della velocità dello scroll${kit.parallax.measured.length > 1 ? ` (livelli misurati: ${kit.parallax.measured.join('%, ')}%)` : ''}; per livelli diversi \`data-parallax="70"\`.`,
    kit.pin.horizontal
      ? `- **Sezione orizzontale pinnata**: \`data-pin-horizontal\` sulla sezione e \`data-track\` sul contenitore largo (flex in riga). Resta ferma per ${kit.pin.lengthVh}vh di scroll.`
      : `- **Pin**: \`data-pin\` su una sezione la tiene ferma per ${kit.pin.lengthVh}vh (\`data-pin="200"\` per cambiarlo).`,
    `- **Marquee**: \`data-marquee\` su una riga con il testo ripetuto 2 volte dentro → scorre a ${kit.marquee.speed}px/s.`,
    kit.cursor ? `- **Cursore**: aggiungi \`<div data-cursor></div>\` in fondo al body: cerchio di ${kit.cursor.size}px che segue il mouse.` : '',
    ...kit.hovers.map((h) => `- **Hover**: \`data-hover="${h.name}"\` sui bottoni → \`${JSON.stringify(h.to)}\` in ${h.duration}s (misurato su \`${h.source}\`).`),
    '',
    '## 6. Esempio',
    '',
    '```html',
    '<section data-intro>',
    `  <h1 ${attrs(kit, 'heading')}>Studio di architettura<br>a Milano</h1>`,
    `  <p ${attrs(kit, 'text')}>Progettiamo spazi che durano.</p>`,
    '</section>',
    '',
    '<section data-scene>',
    `  <h2 ${attrs(kit, 'heading')}>Il nostro metodo</h2>`,
    `  <p ${attrs(kit, 'text')}>Tre fasi, un solo team.</p>`,
    `  <div class="foto" data-role="media" ${attrs(kit, 'media')}><img src="foto.jpg" alt=""></div>`,
    '</section>',
    '',
    '<div class="cover" style="overflow:hidden;height:80vh"><img data-parallax src="cover.jpg" style="height:120%"></div>',
    '```',
    '',
    '## 7. Controllo finale',
    '',
    '- Apri la console: il kit stampa `[motion-kit]` con il numero di elementi animati e avvisa per preset inesistenti.',
    '- Ogni sezione importante ha `data-scene` (o `data-intro`), ogni titolo/testo/media principale ha il suo `data-motion` secondo il casting.',
    '- Per i valori esatti del sito d’origine (posizioni, keyframe, ritardi) vedi `spec.md`.',
  );
  return L.filter((l) => l !== '').join('\n').replace(/\n(#+ )/g, '\n\n$1') + '\n';
}

function attrs(kit, role) {
  const r = kit.roles[role];
  const preset = r ? r.preset : Object.keys(kit.presets)[0] || 'fade-up';
  return `data-motion="${preset}"${r && r.split ? ` data-split="${r.split}"` : ''}`;
}

export async function writeKit(outDir, data) {
  const kit = buildKit(data);
  await writeFile(path.join(outDir, 'motion-kit.js'), kitScript(kit));
  await writeFile(path.join(outDir, 'per-ia.md'), aiInstructions(kit, data));
  return kit;
}
