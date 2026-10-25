// The DNA written as an art-direction brief, plus a ready prompt to build an
// ORIGINAL site with the same feel (not a copy of the content or the brand).
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROLE = { heading: 'titolo', text: 'testo', media: 'media', button: 'bottone', shape: 'forma' };
const REVEAL = {
  'mask-slide': 'scorre fuori da una maschera (overflow hidden)',
  'clip-reveal': 'si apre con clip-path',
  'fade-up': 'sale e appare',
  'fade-down': 'scende e appare',
  'fade-side': 'entra di lato sfumando',
  'scale-down': 'parte ingrandito e si ridimensiona',
  'scale-down-fade': 'parte ingrandito, si ridimensiona e appare',
  'scale-up': 'cresce',
  'scale-up-fade': 'cresce e appare',
  'blur-in': 'passa da sfocato a nitido',
  'rotate-in': 'ruota in posizione',
  'slide-up': 'sale',
  'slide-down': 'scende',
  'slide-side': 'scorre di lato',
  fade: 'appare in dissolvenza',
  other: 'altro',
};
const pctStr = (x) => `${Math.round(x * 100)}%`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const roleOrder = (s) => s.split(' → ').map((r) => ROLE[r] || r).join(' → ');

export function briefText({ url, title, scene, dna }) {
  const sig = dna.signature;
  const f = scene.fonts;
  const display = f.scale[0];
  const body = [...f.scale].sort((a, b) => b.chars - a.chars)[0];
  const bg = scene.colors.backgrounds.map((c) => c.color);
  const bgTotal = scene.colors.backgrounds.reduce((a, c) => a + c.weight, 0) || 1;
  const main = scene.colors.backgrounds.filter((c) => c.weight / bgTotal > 0.05);
  const tx = scene.colors.text.map((c) => c.color);
  const L = [];

  L.push(`# Brief di art direction e motion — ${title || url}`, '', `Fonte: ${url}`, '');
  L.push('## Scenografia', '');
  if (display) {
    L.push(`- **Titoli**: ${display.family}, ${display.size}px (${display.vw}vw), peso ${display.weight}, interlinea ${display.lineHeight}, tracking ${display.letterSpacing}em${display.transform !== 'none' ? `, ${display.transform}` : ''}.`);
  }
  if (body && body !== display) L.push(`- **Testo**: ${body.family}, ${body.size}px, peso ${body.weight}, interlinea ${body.lineHeight}.`);
  L.push(`- **Contrasto di scala**: il titolo più grande è ${display && body ? (display.size / body.size).toFixed(1) : '?'}× il testo corrente. Maiuscolo: ${pctStr(f.uppercaseShare)} del testo.`);
  L.push(`- **Palette**: sfondi ${bg.slice(0, 4).join(', ')} · testo ${tx.slice(0, 3).join(', ')}.`);
  const cw = scene.layout.containerWidths[0];
  const grid = scene.layout.gridColumns[0];
  L.push(`- **Layout**: ${cw ? `contenitore ~${cw.vw}vw` : 'contenuto a tutta larghezza'}${grid ? `, griglie a ${grid.cols} colonne` : ''}; raggi ${scene.layout.radii.map((r) => r.radius).join(', ') || '0 (spigoli vivi)'}; ${scene.layout.mediaCount} immagini/video.`);
  const fx = [];
  if (scene.effects.blendModes.length) fx.push(`mix-blend-mode ${scene.effects.blendModes.map((b) => b.mode).join(', ')}`);
  if (scene.effects.backdropFilters) fx.push('backdrop-filter');
  if (scene.effects.overlays.length) fx.push('overlay fisso a tutto schermo (grana/texture)');
  if (dna.interactions.cursor.length) fx.push('cursore personalizzato');
  if (fx.length) L.push(`- **Effetti**: ${fx.join(', ')}.`);
  L.push(
    `- **Ritmo delle sezioni**: ${scene.sections.map((s) => `${s.heightVh}vh${s.pinnedForVh ? `+pin ${s.pinnedForVh}vh` : ''}`).join(' · ')} (pagina totale ${sig.pageVh}vh).`,
    '',
  );

  L.push('## Linguaggio del movimento', '');
  if (sig.eases.length) L.push(`- **Easing**: ${sig.eases.map((e) => `${e.name} (${pctStr(e.share)})`).join(', ')}.`);
  if (sig.durationS) L.push(`- **Durate**: mediana ${sig.durationS.median}s (da ${sig.durationS.min}s a ${sig.durationS.max}s).`);
  if (sig.staggersS.length) L.push(`- **Stagger**: ${sig.staggersS.join('s, ')}s.`);
  if (sig.distance.yPxMedian != null) {
    L.push(`- **Distanze**: spostamento verticale mediano ${Math.round(sig.distance.yPxMedian)}px${sig.distance.yPercentOfElementMedian != null ? ` (${sig.distance.yPercentOfElementMedian}% dell'altezza dell'elemento)` : ''}.`);
  }
  if (sig.reveals.length) L.push(`- **Reveal**: ${sig.reveals.map((r) => `${REVEAL[r.name] || r.name} (${pctStr(r.share)})`).join('; ')}.`);
  L.push(`- **Scroll**: ${pctStr(sig.scrollLinkedShare)} delle animazioni è legato allo scroll${sig.scrubMedian != null ? `, scrub tipico ${sig.scrubMedian}` : ''}; ${plural(sig.parallaxLayers, 'livello', 'livelli')} di parallax; ${plural(dna.pins.length, 'sezione pinnata', 'sezioni pinnate')}${sig.pinnedVh ? ` per ${sig.pinnedVh}vh in totale` : ''}; ${plural(sig.loops, 'loop continuo', 'loop continui')}.`);
  L.push('');

  L.push('## Coreografia', '');
  if (sig.rolesFirst.length) L.push(`- **Chi apre la scena**: ${sig.rolesFirst.map((r) => `${ROLE[r.name] || r.name} (${pctStr(r.share)})`).join(', ')}.`);
  if (sig.roleOrders.length) L.push(`- **Sequenze ricorrenti**: ${sig.roleOrders.map((r) => `${roleOrder(r.name)} (×${r.count})`).join('; ')}.`);
  if (sig.beatOffsetMedianMs != null) L.push(`- **Passo**: ogni elemento parte ~${sig.beatOffsetMedianMs}ms dopo il precedente; sovrapposizione mediana ${sig.overlapMedian}× (sopra 1 = i movimenti si accavallano).`);
  L.push('');
  for (const s of dna.scenes) {
    L.push(`**Scena ${s.id}** — ${s.trigger} — \`${s.section}\``);
    for (const b of s.beats) {
      L.push(`  - +${b.offset}ms · ${ROLE[b.role] || b.role} “${b.label}”${b.count > 1 ? ` ×${b.count} (stagger ${b.staggerEach}s)` : ''}: ${REVEAL[b.reveal] || b.reveal}, ${(b.duration / 1000).toFixed(2)}s, ${b.ease || '—'} — ${b.props}`);
    }
    L.push('');
  }
  if (dna.layers.length) {
    L.push('## Profondità', '');
    for (const l of dna.layers) L.push(`- \`${l.selector}\` (${ROLE[l.role] || l.role}): ${l.screenSpeed != null ? `velocità a schermo ${l.screenSpeed}%` : 'scorrimento orizzontale'}, corsa ${l.travelPx}px in ${l.overVh}vh, scrub ${l.scrub}`);
    L.push('');
  }
  const inter = dna.interactions;
  if (inter.cursor.length || inter.mouseParallax.length || inter.hover.length) {
    L.push('## Interazioni', '');
    for (const c of inter.cursor) L.push(`- Cursore: \`${c.selector}\` ${c.w}×${c.h}px`);
    for (const m of inter.mouseParallax) L.push(`- Reagisce al mouse: \`${m.selector}\` (${m.props})`);
    for (const h of inter.hover) L.push(`- Hover su \`${h.target}\`: ${h.effects.map((e) => `${e.props}${e.count > 1 ? ` ×${e.count} (stagger ${e.stagger}s)` : ''} ${e.duration}ms ${e.ease || ''}`).join('; ')}`);
    L.push('');
  }

  L.push('## Prompt per creare un sito originale con questo DNA', '', '```text');
  L.push(
    'Crea un sito statico ORIGINALE (HTML + CSS + GSAP + ScrollTrigger + Lenis) per [IL MIO PROGETTO: descrivi brand, contenuti, sezioni].',
    'Non copiare testi, immagini, marchio o layout del sito di riferimento: riprendi solo il suo DNA di art direction e movimento, descritto qui sotto.',
    '',
    'SCENOGRAFIA',
    `- Titoli enormi e caratterizzati (${display ? `~${display.vw}vw, peso ${display.weight}, interlinea ${display.lineHeight}, tracking ${display.letterSpacing}em` : 'grandi'}), contrasto di scala forte con il testo.`,
    `- Palette ristretta: ${main.length} sfondi principali, ${tx.slice(0, 2).length} colori di testo; scegli colori miei con la stessa logica di contrasto.`,
    `- Ritmo delle sezioni simile: ${scene.sections.slice(0, 8).map((s) => `${s.heightVh}vh${s.pinnedForVh ? '+pin' : ''}`).join(', ')}.`,
    '',
    'MOVIMENTO (un solo linguaggio coerente in tutto il sito)',
    sig.eases.length ? `- Easing principale: ${sig.eases[0].name}${sig.eases[1] ? `, secondario ${sig.eases[1].name}` : ''}. Definiscilo una volta (CustomEase se serve) e usalo ovunque.` : '- Un solo easing morbido usato ovunque.',
    sig.durationS ? `- Durate ${sig.durationS.min}–${sig.durationS.max}s, mediana ${sig.durationS.median}s.` : '',
    sig.reveals.length ? `- Reveal: soprattutto ${sig.reveals.slice(0, 3).map((r) => REVEAL[r.name] || r.name).join(', ')}.` : '',
    sig.staggersS.length ? `- Stagger ${sig.staggersS[0]}s tra elementi fratelli; testi divisi in righe con SplitText.` : '',
    sig.roleOrders.length ? `- Coreografia per sezione: ${roleOrder(sig.roleOrders[0].name)}, passo ~${sig.beatOffsetMedianMs ?? 150}ms, movimenti che si accavallano (sovrapposizione ~${sig.overlapMedian ?? 1.5}×).` : '',
    sig.parallaxLayers ? `- ${plural(sig.parallaxLayers, 'livello', 'livelli')} di profondità in parallax con scrub ~${sig.scrubMedian ?? 1}.` : '',
    dna.pins.length ? `- ${plural(dna.pins.length, 'sezione pinnata', 'sezioni pinnate')} con una timeline legata allo scroll dentro.` : '',
    sig.loops ? '- Un elemento in loop continuo (es. marquee).' : '',
    inter.cursor.length ? '- Cursore personalizzato che segue il mouse con un leggero ritardo (gsap.quickTo).' : '',
    '- Lenis per lo scroll fluido, sincronizzato con ScrollTrigger. Rispetta prefers-reduced-motion.',
    '```',
  );
  return L.filter((l) => l !== '').join('\n').replace(/\n(#+ )/g, '\n\n$1').replace(/\n(\*\*Scena)/g, '\n\n$1') + '\n';
}

export async function writeBrief(outDir, data) {
  await writeFile(path.join(outDir, 'brief.md'), briefText(data));
}
