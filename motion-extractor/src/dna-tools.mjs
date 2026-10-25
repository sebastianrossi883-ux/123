// Working with many DNAs: a catalog with a numeric fingerprint per site, a blend that makes a
// NEW motion DNA from several sites (so no site is copied), and a verify step that measures a
// finished site and checks it really moves like its DNA.
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { tokensOf, kitScript, aiInstructions } from './kit.mjs';
import { revealType } from './choreography.mjs';

const clamp = (v) => Math.max(0, Math.min(1, v));
const round = (v, d = 2) => +(+v).toFixed(d);

const EASE_SHARPNESS = { none: 0, linear: 0, sine: 0.15, power1: 0.25, quad: 0.25, power2: 0.45, cubic: 0.45, power3: 0.65, quart: 0.65, back: 0.6, circ: 0.7, power4: 0.8, quint: 0.8, expo: 0.95, elastic: 0.7, bounce: 0.5 };
const sharpness = (ease) => EASE_SHARPNESS[String(ease).split('.')[0]] ?? 0.5;
const REVEAL_DIMS = { mask: /mask/, fade: /^fade/, clip: /clip/, scale: /scale/, other: /blur|rotate|slide|draw|grow|color/ };

// ---------- fingerprint ----------
export function fingerprint(kit, extras = {}) {
  const t = kit.tokens || tokensOf(kit);
  const weights = Object.values(kit.presets).map((p) => [p.type, p.groups || p.measuredOn || 1]);
  const total = weights.reduce((a, [, w]) => a + w, 0) || 1;
  const reveal = Object.fromEntries(
    Object.entries(REVEAL_DIMS).map(([k, re]) => [k, round(weights.filter(([type]) => re.test(type)).reduce((a, [, w]) => a + w, 0) / total)]),
  );
  return {
    dur: round(clamp((t.duration.base - 0.3) / 1.7)),
    stagger: round(clamp(t.stagger / 0.2)),
    dist: round(clamp((t.distanceY || 0) / 150)),
    sharp: round(sharpness(t.ease.primary)),
    step: round(clamp(t.step / 1)),
    overlap: round(clamp(((extras.overlap ?? 1.2) - 0.5) / 2)),
    parallax: round(extras.parallaxLayers === 0 ? 0 : clamp((100 - kit.parallax.speed) / 50)),
    scroll: round(clamp(extras.scrollShare ?? 0.2)),
    pins: round(clamp((extras.pins ?? 0) / 3)),
    loops: round(clamp((extras.loops ?? 0) / 3)),
    ...Object.fromEntries(Object.entries(reveal).map(([k, v]) => ['r_' + k, v])),
  };
}

export function distance(a, b, keys = Object.keys(a)) {
  const ks = keys.filter((k) => k in a && k in b);
  if (!ks.length) return 1;
  return round(Math.sqrt(ks.reduce((acc, k) => acc + (a[k] - b[k]) ** 2, 0) / ks.length), 3);
}

// Moods: partial fingerprints a brand can ask for.
export const MOODS = {
  elegante: { dur: 0.6, sharp: 0.9, dist: 0.25, stagger: 0.4, r_mask: 0.5 },
  energico: { dur: 0.15, sharp: 0.5, dist: 0.7, scroll: 0.5, stagger: 0.25 },
  minimale: { dur: 0.4, sharp: 0.4, dist: 0.15, parallax: 0, pins: 0, r_fade: 0.8 },
  editoriale: { r_mask: 0.6, r_clip: 0.3, pins: 0.33, dur: 0.5, sharp: 0.8 },
  giocoso: { sharp: 0.6, r_scale: 0.4, stagger: 0.2, dur: 0.25 },
  cinematografico: { dur: 0.8, pins: 0.66, parallax: 0.6, scroll: 0.6, overlap: 0.7 },
};

// ---------- catalog ----------
async function* walk(dir, depth = 0) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 3) yield* walk(p, depth + 1);
    else if (e.name === 'kit.json') yield p;
  }
}

export async function buildCatalog(root) {
  const entries = [];
  for await (const kitPath of walk(root)) {
    const dir = path.dirname(kitPath);
    const kit = JSON.parse(await readFile(kitPath, 'utf8'));
    let dna = null;
    try { dna = JSON.parse(await readFile(path.join(dir, 'dna.json'), 'utf8')); } catch {}
    let quality = null;
    try { quality = JSON.parse(await readFile(path.join(dir, 'quality.json'), 'utf8')); } catch {}
    const sig = dna ? dna.signature : {};
    const extras = dna
      ? { overlap: sig.overlapMedian, scrollShare: sig.scrollLinkedShare, pins: dna.pins.length, loops: sig.loops, parallaxLayers: sig.parallaxLayers }
      : kit.extras || {};
    entries.push({
      url: kit.source,
      folder: path.relative(root, dir),
      blend: !!kit.blend,
      quality: quality ? { level: quality.level, score: quality.score } : null,
      fingerprint: fingerprint(kit, extras),
      extras,
      summary: {
        ease: kit.tokens ? kit.tokens.ease.primary : null,
        duration: kit.tokens ? kit.tokens.duration.base : null,
        presets: Object.keys(kit.presets),
        casting: Object.fromEntries(Object.entries(kit.roles).map(([r, v]) => [r, v.preset])),
        fonts: dna && dna.scene ? dna.scene.fonts.families.slice(0, 2).map((f) => f.family) : [],
        palette: dna && dna.scene ? dna.scene.colors.backgrounds.slice(0, 4).map((c) => c.color) : [],
      },
    });
  }
  entries.sort((a, b) => String(a.url).localeCompare(String(b.url)));
  return { root, count: entries.length, entries };
}

export function catalogHtml(cat) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const dims = ['dur', 'sharp', 'dist', 'stagger', 'step', 'overlap', 'parallax', 'scroll', 'pins', 'loops', 'r_mask', 'r_fade', 'r_clip', 'r_scale'];
  const moodOf = (fp) => Object.entries(MOODS).map(([m, target]) => [m, distance(fp, target, Object.keys(target))]).sort((a, b) => a[1] - b[1])[0][0];
  const rows = cat.entries
    .map((e) => `<tr data-mood="${moodOf(e.fingerprint)}">
      <td><a href="${esc(e.folder)}/dna.html">${esc(e.url)}</a>${e.blend ? ' <em>mix</em>' : ''}<br><small>${esc(e.summary.fonts.join(', '))}</small></td>
      <td>${e.summary.palette.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</td>
      <td><code>${esc(e.summary.ease)}</code><br><small>${e.summary.duration}s</small></td>
      <td><small>${esc(Object.entries(e.summary.casting).map(([r, p]) => `${r}: ${p}`).join(' · '))}</small></td>
      <td>${moodOf(e.fingerprint)}</td>
      <td class="fp">${dims.map((d) => `<b title="${d} ${e.fingerprint[d]}" style="--v:${e.fingerprint[d] ?? 0}"></b>`).join('')}</td>
    </tr>`)
    .join('');
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Catalogo DNA</title>
<style>
:root{--bg:#f6f5f2;--fg:#1b1b1b;--muted:#6b6b6b;--line:#dedbd4;--accent:#e4572e}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eceae6;--muted:#9a9790;--line:#2c2b29}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 ui-sans-serif,system-ui,sans-serif}
main{max-width:1280px;margin:0 auto;padding:40px 16px}
h1{font-size:32px;margin:0 0 6px;letter-spacing:-.02em}
.filters{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}
.filters button{border:1px solid var(--line);background:none;color:inherit;border-radius:99px;padding:5px 12px;cursor:pointer}
.filters button.on{background:var(--fg);color:var(--bg)}
.wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:900px}
td,th{border-bottom:1px solid var(--line);padding:10px 8px;text-align:left;vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.08em}
small{color:var(--muted)} a{color:inherit}
td i{display:inline-block;width:18px;height:18px;border-radius:4px;margin-right:3px;border:1px solid var(--line)}
.fp{display:flex;gap:2px;align-items:flex-end;height:34px}
.fp b{width:8px;height:calc(4px + var(--v) * 28px);background:var(--accent);border-radius:2px;opacity:calc(.35 + var(--v) * .65)}
em{font-style:normal;font-size:11px;background:var(--accent);color:#fff;padding:1px 6px;border-radius:99px}
</style></head><body><main>
<h1>Catalogo DNA</h1><p style="color:var(--muted)">${cat.count} siti · impronta: durata, nitidezza easing, distanza, stagger, passo, sovrapposizione, parallax, scroll, pin, loop, maschera, fade, clip, scala</p>
<div class="filters"><button class="on" data-f="">tutti</button>${Object.keys(MOODS).map((m) => `<button data-f="${m}">${m}</button>`).join('')}</div>
<div class="wrap"><table><thead><tr><th>Sito</th><th>Palette</th><th>Easing</th><th>Casting</th><th>Mood</th><th>Impronta</th></tr></thead><tbody>${rows}</tbody></table></div>
</main><script>
document.querySelectorAll('.filters button').forEach((b)=>b.onclick=()=>{
  document.querySelectorAll('.filters button').forEach((x)=>x.classList.toggle('on',x===b));
  document.querySelectorAll('tbody tr').forEach((r)=>r.hidden=!!b.dataset.f&&r.dataset.mood!==b.dataset.f);
});
</script></body></html>`;
}

// ---------- blend ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clone = (o) => JSON.parse(JSON.stringify(o));

async function loadKit(root, entry) {
  return JSON.parse(await readFile(path.join(root, entry.folder, 'kit.json'), 'utf8'));
}

function mutate(kit, rand, amp) {
  const j = (v, r, d = 2) => round(v * (1 + (rand() * 2 - 1) * r * amp), d);
  for (const p of Object.values(kit.presets)) {
    p.duration = j(p.duration, 0.1);
    p.stagger = j(p.stagger, 0.15, 3);
    for (const k of ['x', 'y', 'rotation']) if (typeof p.from[k] === 'number') p.from[k] = Math.round(j(p.from[k], 0.2, 1));
    if (typeof p.from.scale === 'number') p.from.scale = round(1 + (p.from.scale - 1) * (1 + (rand() * 2 - 1) * 0.2 * amp), 3);
  }
  kit.scene.step = j(kit.scene.step, 0.15);
  for (const k of Object.keys(kit.scene.pairOffsets)) kit.scene.pairOffsets[k] = j(kit.scene.pairOffsets[k], 0.15);
  kit.parallax.speed = Math.round(Math.min(98, Math.max(50, kit.parallax.speed + (rand() * 2 - 1) * 6 * amp)));
  kit.marquee.speed = j(kit.marquee.speed, 0.2, 1);
  if (kit.lenis) kit.lenis.lerp = Math.min(0.2, Math.max(0.04, j(kit.lenis.lerp, 0.2, 3)));
  return kit;
}

export async function blend({ catalogPath, mood, seed = Date.now() % 100000, from = [], name = 'mix', minDistance = 0.08, includeLow = false }) {
  const cat = JSON.parse(await readFile(catalogPath, 'utf8'));
  const root = path.dirname(catalogPath);
  // DNAs flagged as unreliable never feed a mix, unless asked
  const sources = cat.entries.filter((e) => !e.blend && (includeLow || !e.quality || e.quality.level !== 'bassa'));
  if (sources.length < 2) throw new Error('servono almeno 2 siti nel catalogo');
  const rand = rng(seed);
  const target = mood ? MOODS[mood] : null;
  if (mood && !target) throw new Error(`mood "${mood}" sconosciuto: ${Object.keys(MOODS).join(', ')}`);

  let parents;
  if (from.length) {
    parents = from.map((u) => sources.find((e) => e.url === u || e.folder === u || String(e.url).includes(u)));
    if (parents.some((p) => !p)) throw new Error('sito non trovato nel catalogo: ' + from.filter((_, i) => !parents[i]).join(', '));
  } else {
    const ranked = [...sources].sort((a, b) => (target ? distance(a.fingerprint, target, Object.keys(target)) - distance(b.fingerprint, target, Object.keys(target)) : rand() - 0.5));
    const pool = ranked.slice(0, Math.max(3, Math.ceil(ranked.length * 0.2)));
    parents = [];
    while (parents.length < Math.min(3, pool.length)) {
      const pick = pool[Math.floor(rand() * pool.length)];
      if (!parents.includes(pick) && (parents.length === 0 || parents.every((p) => distance(p.fingerprint, pick.fingerprint) > 0.03) || pool.length <= 3)) parents.push(pick);
      if (parents.length < 3 && pool.every((p) => parents.includes(p))) break;
    }
  }
  while (parents.length < 3) parents.push(parents[parents.length - 1]);
  const [A, B, C] = await Promise.all(parents.map((p) => loadKit(root, p)));

  let child;
  let fp;
  let nearest;
  let amp = 1;
  for (let attempt = 0; attempt < 8; attempt++) {
    // Motion language from A, casting + choreography from B, scroll staging from C.
    child = clone(A);
    child.roles = {};
    for (const [role, r] of Object.entries(B.roles)) {
      const bp = B.presets[r.preset];
      let name = child.presets[r.preset] ? r.preset : Object.keys(child.presets).find((n) => child.presets[n].type === (bp && bp.type));
      if (!name && bp) {
        name = r.preset;
        child.presets[name] = clone(bp);
        if (B.customEases && B.customEases[bp.ease]) child.customEases[bp.ease] = B.customEases[bp.ease];
      }
      if (name) child.roles[role] = { ...r, preset: name };
    }
    for (const [role, r] of Object.entries(A.roles)) if (!child.roles[role]) child.roles[role] = r;
    Object.assign(child, { scene: clone(B.scene), single: clone(B.single), intro: clone(B.intro) });
    Object.assign(child, { parallax: clone(C.parallax), pin: clone(C.pin), marquee: clone(C.marquee), cursor: clone(C.cursor), lenis: clone(C.lenis || A.lenis) });
    child.hovers = clone(C.hovers.length ? C.hovers : A.hovers);
    child.letterHovers = clone((C.letterHovers || []).length ? C.letterHovers : A.letterHovers || []);
    for (const h of child.hovers) {
      const src = (C.hovers.length ? C : A).customEases || {};
      if (src[h.ease]) child.customEases[h.ease] = src[h.ease];
    }
    mutate(child, rand, amp);
    child.tokens = tokensOf(child);
    child.source = `mix di ${parents.map((p) => p.url).join(' + ')} (seed ${seed})`;
    child.blend = { seed, mood: mood || null, parents: parents.map((p) => p.url), genes: { movimento: parents[0].url, coreografia: parents[1].url, scroll: parents[2].url } };
    const extras = { overlap: parents[1].extras.overlap, scrollShare: parents[2].extras.scrollShare, pins: parents[2].extras.pins, loops: parents[2].extras.loops, parallaxLayers: parents[2].extras.parallaxLayers };
    child.extras = extras;
    fp = fingerprint(child, extras);
    nearest = sources.map((e) => ({ url: e.url, d: distance(fp, e.fingerprint) })).sort((a, b) => a.d - b.d).slice(0, 3);
    if (nearest[0].d >= minDistance) break;
    amp *= 1.5;
  }
  child.blend.nearest = nearest;
  child.blend.unique = nearest[0].d >= minDistance;
  child.blend.moodDistance = target ? distance(fp, target, Object.keys(target)) : null;
  return { kit: child, fingerprint: fp, parents, nearest };
}

export async function writeBlend(outDir, { kit, fingerprint: fp, parents, nearest }, name) {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'kit.json'), JSON.stringify(kit, null, 2));
  await writeFile(path.join(outDir, 'motion-kit.js'), kitScript(kit));
  await writeFile(path.join(outDir, 'per-ia.md'), aiInstructions(kit, { title: name, url: kit.source }));
  const L = [
    `# DNA "${name}" — provenienza`,
    '',
    `Seed ${kit.blend.seed}${kit.blend.mood ? ` · mood ${kit.blend.mood} (distanza dal mood ${kit.blend.moodDistance})` : ''}`,
    '',
    '| gene | preso da |',
    '|---|---|',
    `| linguaggio del movimento (preset, easing, durate) | ${kit.blend.genes.movimento} |`,
    `| casting e coreografia (chi entra, ritardi, trigger) | ${kit.blend.genes.coreografia} |`,
    `| regia dello scroll (parallax, pin, marquee, cursore, hover, Lenis) | ${kit.blend.genes.scroll} |`,
    '',
    'Poi ogni valore è stato variato (durate ±10%, stagger ±15%, distanze ±20%, ritardi ±15%, parallax ±6).',
    '',
    '## Quanto è unico',
    '',
    `Distanza dal sito più simile del catalogo: **${nearest[0].d}** ${kit.blend.unique ? '(sopra la soglia: non è una copia di nessuno)' : '(SOTTO la soglia: rigenera con un altro seed)'}`,
    '',
    ...nearest.map((n) => `- ${n.url}: ${n.d}`),
    '',
    '## Impronta',
    '',
    '```json',
    JSON.stringify(fp),
    '```',
  ];
  await writeFile(path.join(outDir, 'provenienza.md'), L.join('\n') + '\n');
}

// ---------- verify ----------
export function verify(kit, { result, dna }) {
  const time = result.animations.filter((a) => a.kind === 'time' && !a.scrubbed && (a.phase === 'intro' || a.phase === 'scroll'));
  const presets = Object.entries(kit.presets);
  const checks = [];
  const groupsSeen = new Set();
  for (const a of time) {
    if (a.stagger) {
      if (groupsSeen.has(a.stagger.group)) continue;
      groupsSeen.add(a.stagger.group);
    }
    const type = revealType(a);
    const ease = a.ease ? a.ease.best.name : null;
    const dur = a.duration / 1000;
    const candidates = presets.filter(([, p]) => p.type === type);
    // A measured custom ease ("kit-…") has no name to compare: only the duration is checked.
    const ok = candidates.find(([, p]) => (p.ease === ease || p.ease.startsWith('kit-')) && Math.abs(dur - p.duration) <= p.duration * 0.15);
    checks.push({
      element: a.element.selector,
      label: a.element.text ? a.element.text.slice(0, 30) : '',
      type,
      ease,
      duration: round(dur),
      match: ok ? ok[0] : null,
      expected: candidates.length ? candidates.map(([n, p]) => `${n}: ${p.ease} ${p.duration}s`).join(' | ') : 'nessun preset di questo tipo nel DNA',
    });
  }
  const offsets = [];
  for (const s of dna.scenes) {
    s.beats.forEach((b, i) => {
      if (!i) return;
      const key = `${s.beats[i - 1].role}>${b.role}`;
      const expected = kit.scene.pairOffsets[key] ?? kit.scene.step;
      const got = (b.offset - s.beats[i - 1].offset) / 1000;
      offsets.push({ scene: s.id, key, expected, got: round(got), ok: Math.abs(got - expected) <= 0.1 });
    });
  }
  const staging = [];
  for (const l of dna.layers.filter((x) => x.screenSpeed != null)) staging.push({ what: `parallax ${l.selector.split(' > ').pop()}`, expected: `${kit.parallax.speed}%`, got: `${l.screenSpeed}%`, ok: Math.abs(l.screenSpeed - kit.parallax.speed) <= 12 });
  for (const p of dna.pins) staging.push({ what: `pin ${p.selector.split(' > ').pop()}`, expected: `${kit.pin.lengthVh}vh`, got: `${p.pinnedForVh}vh`, ok: Math.abs(p.pinnedForVh - kit.pin.lengthVh) <= 10 });
  for (const l of dna.loops.filter((x) => x.property === 'x')) staging.push({ what: `marquee ${l.selector.split(' > ').pop()}`, expected: `${kit.marquee.speed}px/s`, got: `${Math.abs(l.speedPerSecond)}px/s`, ok: Math.abs(Math.abs(l.speedPerSecond) - kit.marquee.speed) <= kit.marquee.speed * 0.25 });
  const all = [...checks.map((c) => !!c.match), ...offsets.map((o) => o.ok), ...staging.map((s) => s.ok)];
  const score = all.length ? round(all.filter(Boolean).length / all.length) : 0;
  return { score, checks, offsets, staging };
}

export function verifyMarkdown(v, { url, kitPath }) {
  const L = [
    `# Verifica DNA — ${url}`,
    '',
    `DNA: \`${kitPath}\``,
    '',
    `**Punteggio: ${Math.round(v.score * 100)}%** ${v.score >= 0.8 ? '✅ il sito si muove come il suo DNA' : '❌ il sito si discosta dal DNA: correggi le righe ✗'}`,
    '',
    '## Animazioni',
    '',
    '| | elemento | tipo | easing | durata | preset del DNA |',
    '|---|---|---|---|---|---|',
    ...v.checks.map((c) => `| ${c.match ? '✓' : '✗'} | \`${c.element.split(' > ').slice(-2).join(' > ')}\` ${c.label ? `“${c.label}”` : ''} | ${c.type} | ${c.ease} | ${c.duration}s | ${c.match ? c.match : c.expected} |`),
    '',
    '## Ritardi nelle scene',
    '',
    '| | scena | sequenza | atteso | misurato |',
    '|---|---|---|---|---|',
    ...v.offsets.map((o) => `| ${o.ok ? '✓' : '✗'} | ${o.scene} | ${o.key} | ${o.expected}s | ${o.got}s |`),
    '',
    '## Scroll',
    '',
    '| | cosa | atteso | misurato |',
    '|---|---|---|---|',
    ...v.staging.map((s) => `| ${s.ok ? '✓' : '✗'} | ${s.what} | ${s.expected} | ${s.got} |`),
  ];
  return L.join('\n') + '\n';
}

export async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}
