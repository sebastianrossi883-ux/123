// Self-contained HTML page that shows the site's DNA: scenography, page rhythm,
// motion signature and a timeline per scene (the choreography).
import { writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { gsap } from 'gsap';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ROLE_COLORS = { heading: '#e4572e', text: '#4c9f70', media: '#3b75c4', button: '#c79a1a', shape: '#8a6fd1' };
const ROLE_NAMES = { heading: 'titolo', text: 'testo', media: 'media', button: 'bottone', shape: 'forma' };

function easeCurve(name) {
  let fn;
  try { fn = gsap.parseEase(name); } catch { return ''; }
  if (!fn) return '';
  const pts = Array.from({ length: 41 }, (_, i) => {
    const u = i / 40;
    return `${(u * 100).toFixed(1)},${(100 - fn(u) * 70 - 15).toFixed(1)}`;
  });
  return `<svg viewBox="0 0 100 100" class="curve" aria-hidden="true"><polyline points="${pts.join(' ')}"/></svg>`;
}

function bars(list, label = (x) => x.name) {
  return list
    .map((x) => `<div class="bar"><span>${esc(label(x))}</span><i style="--w:${Math.round(x.share * 100)}%"></i><b>${x.count}</b></div>`)
    .join('');
}

function timeline(scene) {
  const span = Math.max(scene.spanMs, 200);
  const ticks = [];
  const step = span > 3000 ? 1000 : span > 1200 ? 500 : 250;
  for (let t = 0; t <= span; t += step) ticks.push(`<span style="left:${(t / span) * 100}%">${t / 1000}s</span>`);
  const rows = scene.beats
    .map((b) => {
      const left = (b.offset / span) * 100;
      const width = Math.max((b.span / span) * 100, 0.8);
      const color = ROLE_COLORS[b.role] || ROLE_COLORS.shape;
      const count = b.count > 1 ? ` ×${b.count} (stagger ${b.staggerEach}s)` : '';
      return `<div class="beat">
        <div class="beat-label"><em style="background:${color}">${esc(ROLE_NAMES[b.role] || b.role)}</em>${esc(b.label)}${esc(count)}</div>
        <div class="track"><div class="span" style="left:${left}%;width:${width}%;background:${color}" title="${esc(b.props)}"></div></div>
        <div class="beat-meta">${esc(b.reveal)} · ${esc(b.ease || '—')} · ${(b.duration / 1000).toFixed(2)}s · +${b.offset}ms</div>
      </div>`;
    })
    .join('');
  return `<article class="scene">
    <header><h3>Scena ${scene.id}</h3><p>${esc(scene.trigger)} · <code>${esc(scene.section)}</code></p>
    <p class="facts">ordine: <b>${esc(scene.roleOrder)}</b> · durata ${(scene.spanMs / 1000).toFixed(2)}s · sovrapposizione ${scene.overlap}×${scene.medianOffsetMs != null ? ` · passo ${scene.medianOffsetMs}ms` : ''}</p></header>
    <div class="ticks">${ticks.join('')}</div>${rows}
  </article>`;
}

function pageRhythm(scene, dna) {
  const total = scene.sections.reduce((a, s) => a + s.heightVh + s.pinnedForVh, 0) || 1;
  return scene.sections
    .map((s) => {
      const h = ((s.heightVh + s.pinnedForVh) / total) * 100;
      const scenes = dna.scenes.filter((sc) => sc.section === s.selector || sc.section.startsWith(s.selector)).length;
      return `<div class="sec${s.pinnedForVh ? ' pinned' : ''}" style="flex:${h} 0 0;background:${s.bg};color:${s.color || '#000'}">
        <span>${esc(s.firstHeading || s.selector.split(' > ').pop())}</span>
        <small>${s.heightVh}vh${s.pinnedForVh ? ` + pin ${s.pinnedForVh}vh` : ''}${scenes ? ` · ${scenes} scene` : ''}</small>
      </div>`;
    })
    .join('');
}

export async function writeVisualReport(outDir, { url, title, scene, dna }) {
  const sig = dna.signature;
  const shots = (await readdir(path.join(outDir, 'screens')).catch(() => [])).filter((f) => f.endsWith('.png')).sort();
  const swatch = (c, sub) => `<figure class="sw"><i style="background:${c}"></i><figcaption>${c}<small>${sub}</small></figcaption></figure>`;
  const bgTotal = scene.colors.backgrounds.reduce((a, c) => a + c.weight, 0) || 1;
  const txTotal = scene.colors.text.reduce((a, c) => a + c.weight, 0) || 1;

  const html = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>DNA · ${esc(title || url)}</title>
<style>
:root { --bg:#f6f5f2; --fg:#1b1b1b; --muted:#6b6b6b; --line:#dedbd4; --card:#fff; --accent:#e4572e; }
@media (prefers-color-scheme: dark) { :root { --bg:#141414; --fg:#eceae6; --muted:#9a9790; --line:#2c2b29; --card:#1c1c1b; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 ui-sans-serif, system-ui, sans-serif; }
main { max-width:1180px; margin:0 auto; padding:48px 20px 96px; }
h1 { font-size:clamp(28px,4vw,48px); line-height:1.05; margin:0 0 6px; letter-spacing:-.02em; }
h2 { font-size:13px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); margin:56px 0 16px; font-weight:600; }
h3 { margin:0; font-size:17px; }
a { color:inherit; }
code { font:12px ui-monospace, monospace; color:var(--muted); word-break:break-all; }
.chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:18px; }
.chip { border:1px solid var(--line); border-radius:99px; padding:4px 12px; font-size:13px; background:var(--card); }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:16px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; }
.card h4 { margin:0 0 10px; font-size:13px; color:var(--muted); font-weight:600; }
.big { font-size:30px; font-weight:650; letter-spacing:-.02em; }
.sw { display:inline-flex; flex-direction:column; margin:0 10px 10px 0; width:92px; }
.sw i { height:56px; border-radius:10px; border:1px solid var(--line); }
.sw figcaption { font:12px ui-monospace, monospace; margin-top:4px; }
.sw small { display:block; color:var(--muted); }
.type { border-top:1px solid var(--line); padding:12px 0; display:grid; grid-template-columns:minmax(0,1fr) 220px; gap:16px; align-items:baseline; }
.type .spec { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.type small { color:var(--muted); font-size:12px; }
.rhythm { display:flex; flex-direction:column; height:520px; border-radius:14px; overflow:hidden; border:1px solid var(--line); }
.sec { padding:8px 14px; display:flex; justify-content:space-between; gap:12px; align-items:flex-start; min-height:22px; border-bottom:1px solid rgba(128,128,128,.25); font-size:13px; }
.sec small { opacity:.7; white-space:nowrap; }
.sec.pinned { background-image:repeating-linear-gradient(45deg, rgba(128,128,128,.18) 0 8px, transparent 8px 16px) !important; }
.bar { display:grid; grid-template-columns:130px 1fr 28px; gap:8px; align-items:center; font-size:13px; margin:5px 0; }
.bar i { height:8px; border-radius:4px; background:linear-gradient(90deg,var(--accent) var(--w),var(--line) var(--w)); }
.bar b { font-weight:500; color:var(--muted); text-align:right; }
.curves { display:flex; gap:14px; flex-wrap:wrap; }
.curves figure { margin:0; text-align:center; font-size:12px; }
.curve { width:84px; height:84px; background:var(--bg); border-radius:10px; }
.curve polyline { fill:none; stroke:var(--accent); stroke-width:2.5; vector-effect:non-scaling-stroke; }
.scene { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; margin-bottom:16px; }
.scene header p { margin:4px 0 0; color:var(--muted); font-size:13px; }
.scene .facts { color:var(--fg); }
.ticks { position:relative; height:18px; margin:14px 0 4px 0; margin-left:var(--lab); font-size:11px; color:var(--muted); }
.ticks span { position:absolute; transform:translateX(-50%); }
.scene { --lab: 34%; }
.beat { display:grid; grid-template-columns:var(--lab) 1fr; align-items:center; gap:0 12px; padding:4px 0; }
.beat-label { font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.beat-label em { font-style:normal; color:#fff; font-size:11px; padding:1px 7px; border-radius:99px; margin-right:8px; }
.track { position:relative; height:14px; background:var(--bg); border-radius:7px; }
.span { position:absolute; top:0; bottom:0; border-radius:7px; }
.beat-meta { grid-column:2; font-size:12px; color:var(--muted); }
table { width:100%; border-collapse:collapse; font-size:13px; }
td, th { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-weight:600; }
.speed { display:inline-block; height:8px; border-radius:4px; background:var(--accent); vertical-align:middle; margin-right:6px; }
.shots { display:flex; gap:10px; overflow-x:auto; padding-bottom:8px; }
.shots img { flex:0 0 auto; height:180px; border-radius:10px; border:1px solid var(--line); }
.muted { color:var(--muted); }
@media (max-width:640px) {
  .scene { --lab: 100%; }
  .beat { grid-template-columns:1fr; }
  .beat-meta { grid-column:1; }
  .ticks { margin-left:0; }
  .type { grid-template-columns:1fr; }
  .bar { grid-template-columns:100px 1fr 24px; }
}
</style></head>
<body><main>
<p class="muted">Motion DNA</p>
<h1>${esc(title || url)}</h1>
<a href="${esc(url)}">${esc(url)}</a>
<div class="chips">
  <span class="chip">${dna.scenes.length} scene</span>
  <span class="chip">pagina ${sig.pageVh}vh</span>
  <span class="chip">${sig.parallaxLayers} livelli di parallax</span>
  <span class="chip">${dna.pins.length} pin${sig.pinnedVh ? ` (${sig.pinnedVh}vh)` : ''}</span>
  <span class="chip">${sig.loops} loop</span>
  <span class="chip">${Math.round(sig.scrollLinkedShare * 100)}% legato allo scroll</span>
  ${dna.interactions.cursor.length ? '<span class="chip">cursore personalizzato</span>' : ''}
</div>

<h2>Scenografia</h2>
<div class="grid">
  <div class="card"><h4>Sfondi (per superficie)</h4>${scene.colors.backgrounds.map((c) => swatch(c.color, Math.round((c.weight / bgTotal) * 100) + '%')).join('')}</div>
  <div class="card"><h4>Testo (per caratteri)</h4>${scene.colors.text.map((c) => swatch(c.color, Math.round((c.weight / txTotal) * 100) + '%')).join('')}</div>
  <div class="card"><h4>Layout ed effetti</h4>
    <p>Contenitore: ${scene.layout.containerWidths.map((w) => `${w.vw}vw`).join(', ') || '—'}<br>
    Griglie: ${scene.layout.gridColumns.map((g) => `${g.cols} colonne`).join(', ') || '—'}<br>
    Raggi: ${scene.layout.radii.map((r) => r.radius).join(', ') || '0'}<br>
    Media: ${scene.layout.mediaCount} (${scene.layout.mediaRatios.map((r) => r.ratio).join(', ') || '—'})<br>
    Blend: ${scene.effects.blendModes.map((b) => b.mode).join(', ') || '—'} · backdrop-filter: ${scene.effects.backdropFilters}<br>
    Overlay fissi (grana?): ${scene.effects.overlays.length} · maiuscolo: ${Math.round(scene.fonts.uppercaseShare * 100)}%</p></div>
</div>

<h2>Tipografia</h2>
<div class="card">
  <p class="muted">Famiglie: ${scene.fonts.families.map((f) => `${esc(f.family)} (${Math.round(f.share * 100)}%)`).join(' · ')}</p>
  ${scene.fonts.scale
    .map(
      (t) => `<div class="type"><div class="spec" style="font-family:'${esc(t.family)}';font-size:${Math.min(t.size, 72)}px;font-weight:${t.weight};letter-spacing:${t.letterSpacing}em;text-transform:${t.transform};${t.italic ? 'font-style:italic;' : ''}line-height:1.1">${esc(t.sample)}</div>
      <small>${esc(t.family)} · ${t.size}px (${t.vw}vw) · ${t.weight}<br>interlinea ${t.lineHeight} · tracking ${t.letterSpacing}em · &lt;${t.tag}&gt;</small></div>`,
    )
    .join('')}
</div>

<h2>Ritmo della pagina</h2>
<div class="rhythm">${pageRhythm(scene, dna)}</div>

<h2>DNA del movimento</h2>
<div class="grid">
  <div class="card"><h4>Easing dominanti</h4><div class="curves">${sig.eases
    .map((e) => `<figure>${e.name === 'custom' ? '<div class="curve" style="display:grid;place-items:center">custom</div>' : easeCurve(e.name)}<figcaption>${esc(e.name)} · ${Math.round(e.share * 100)}%</figcaption></figure>`)
    .join('')}</div></div>
  <div class="card"><h4>Tempi</h4><div class="big">${sig.durationS ? `${sig.durationS.median}s` : '—'}</div>
    <p class="muted">durata mediana${sig.durationS ? ` (${sig.durationS.min}–${sig.durationS.max}s)` : ''}<br>
    stagger: ${sig.staggersS.join('s, ') || '—'}${sig.staggersS.length ? 's' : ''}<br>
    passo tra elementi: ${sig.beatOffsetMedianMs ?? '—'}ms · sovrapposizione ${sig.overlapMedian ?? '—'}×</p></div>
  <div class="card"><h4>Distanze</h4><div class="big">${sig.distance.yPxMedian != null ? Math.round(sig.distance.yPxMedian) + 'px' : '—'}</div>
    <p class="muted">spostamento verticale mediano${sig.distance.yPercentOfElementMedian != null ? ` · ${sig.distance.yPercentOfElementMedian}% dell'altezza dell'elemento` : ''}<br>
    scrub mediano: ${sig.scrubMedian ?? '—'}</p></div>
  <div class="card"><h4>Vocabolario dei reveal</h4>${bars(sig.reveals)}</div>
  <div class="card"><h4>Chi entra per primo</h4>${bars(sig.rolesFirst, (x) => ROLE_NAMES[x.name] || x.name)}
    <h4 style="margin-top:14px">Sequenze</h4>${sig.roleOrders.map((r) => `<p style="margin:4px 0">${esc(r.name)} <span class="muted">×${r.count}</span></p>`).join('') || '<p class="muted">—</p>'}</div>
</div>

<h2>Coreografia</h2>
${dna.scenes.map(timeline).join('') || '<p class="muted">Nessuna scena a tempo registrata.</p>'}

<h2>Profondità e scroll</h2>
<div class="card">
${dna.layers.length ? `<table><tr><th>Elemento</th><th>Velocità a schermo</th><th>Corsa</th><th>Scrub</th></tr>${dna.layers
  .map((l) => `<tr><td><code>${esc(l.selector)}</code></td><td>${l.screenSpeed != null ? `<span class="speed" style="width:${Math.min(Math.abs(l.screenSpeed), 200) * 0.6}px"></span>${l.screenSpeed}%` : 'scorrimento orizzontale'}</td><td>${l.travelPx}px in ${l.overVh}vh</td><td>${l.scrub}</td></tr>`)
  .join('')}</table>` : '<p class="muted">Nessun parallax.</p>'}
${dna.scrollEffects.length ? `<table style="margin-top:16px"><tr><th>Effetto legato allo scroll</th><th>Proprietà</th><th>Valori</th><th>Durata</th></tr>${dna.scrollEffects
  .map((e) => `<tr><td><code>${esc(e.selector)}</code></td><td>${esc(e.property)}</td><td>${e.from} → ${e.to}</td><td>${e.overVh}vh · scrub ${e.scrub}</td></tr>`)
  .join('')}</table>` : ''}
${dna.pins.length ? `<table style="margin-top:16px"><tr><th>Sezione pinnata</th><th>Durata pin</th><th>Cosa si muove dentro</th></tr>${dna.pins
  .map((p) => `<tr><td><code>${esc(p.selector)}</code></td><td>${p.pinnedForVh}vh</td><td>${esc(p.scrubbedInside.join(', ') || '—')}</td></tr>`)
  .join('')}</table>` : ''}
</div>

<h2>Interazioni</h2>
<div class="grid">
  <div class="card"><h4>Cursore</h4>${dna.interactions.cursor.map((c) => `<p><code>${esc(c.selector)}</code><br>${c.w}×${c.h}px · ${esc(c.props)}</p>`).join('') || '<p class="muted">Nessun cursore personalizzato.</p>'}</div>
  <div class="card"><h4>Reagisce al mouse</h4>${dna.interactions.mouseParallax.map((c) => `<p><code>${esc(c.selector)}</code> · ${esc(c.props)}</p>`).join('') || '<p class="muted">—</p>'}</div>
  <div class="card"><h4>Hover</h4>${dna.interactions.hover.map((h) => `<p><code>${esc(h.target)}</code><br>${h.effects.map((e) => `${esc(e.props)} · ${e.duration}ms · ${esc(e.ease || '')} (${e.via})`).join('<br>')}</p>`).join('') || '<p class="muted">Nessun effetto hover registrato.</p>'}</div>
</div>

${dna.loops.length ? `<h2>Loop</h2><div class="card">${dna.loops.map((l) => `<p><code>${esc(l.selector)}</code> · ${l.property} ${l.speedPerSecond}/s</p>`).join('')}</div>` : ''}

<h2>Schermate</h2>
<div class="shots">${shots.map((s) => `<img src="screens/${esc(s)}" alt="${esc(s)}" loading="lazy">`).join('')}</div>
</main></body></html>`;
  await writeFile(path.join(outDir, 'dna.html'), html);
}
