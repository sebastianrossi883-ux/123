import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const fmt = (v) => (typeof v === 'number' ? +v.toFixed(2) : v);
const block = (lang, s) => '```' + lang + '\n' + s + '\n```';
const yes = (b) => (b ? 'sì' : 'no');

function libsSection(libs) {
  const webgl = libs.contexts.filter((c) => /webgl/i.test(c.type)).length;
  const rows = [
    ['GSAP', libs.gsapVersions ? `sì (v${libs.gsapVersions.join(', ')})` : 'non rilevato'],
    ['GSAP globale (window.gsap)', yes(libs.gsapGlobal) + (libs.gsapGlobal ? ' → chiamate registrate dal vivo' : ' → probabilmente nel bundle')],
    ['Plugin registrati', libs.plugins.length ? libs.plugins.join(', ') : '—'],
    ['Lenis', libs.lenisVersion ? `sì (v${libs.lenisVersion})` : libs.lenisHtmlClass ? 'sì (classe .lenis)' : 'non rilevato'],
    ['Pin (ScrollTrigger)', libs.pinSpacers ? `${libs.pinSpacers} sezioni pinnate` : '—'],
    ['WebGL / canvas', webgl ? `${webgl} contesti WebGL${libs.threeRevision ? ` (Three.js r${libs.threeRevision})` : ''} → effetti shader` : libs.canvases ? `${libs.canvases} canvas` : '—'],
    ['Transizioni pagina', [libs.barba && 'Barba.js', libs.swup && 'Swup'].filter(Boolean).join(', ') || '—'],
    ['Locomotive Scroll', yes(libs.locomotive)],
  ];
  return '| Cosa | Risultato |\n|---|---|\n' + rows.map(([a, b]) => `| ${a} | ${b} |`).join('\n');
}

function describe(a) {
  const el = `\`${a.element.selector}\`${a.element.text ? ` — “${a.element.text.slice(0, 50)}”` : ''}`;
  if (a.kind === 'loop') return `- 🔁 **Loop continuo** ${el}: \`${a.ch}\` a ${a.speedPerSecond}/s`;
  if (a.kind === 'scroll') {
    return `- 🖱️ **Legata allo scroll** ${el}: \`${a.ch}\` ${fmt(a.from)} → ${fmt(a.to)}, da scroll ${a.scrollStart}px a ${a.scrollEnd}px (≈ start \`${a.triggerStart}\`, end \`${a.triggerEnd}\`), scrub ≈ \`${a.scrub}\` (ritardo ${a.scrubLagMs}ms)`;
  }
  const props = a.segs.map((s) => `\`${s.ch}\` ${fmt(s.from)} → ${fmt(s.to)}`).join(', ');
  const ease = a.ease
    ? `easing **${a.ease.best.name}** (err ${a.ease.best.err}; poi ${a.ease.alternatives.map((x) => x.name).join(', ')})`
    : '';
  const when = a.onLoad ? `al caricamento dopo ${(a.start / 1000).toFixed(2)}s` : `allo scroll (elemento a ≈ \`${a.triggerStart}\`)`;
  const stagger = a.stagger ? ` · stagger ${a.stagger.each}s (${a.stagger.index + 1}/${a.stagger.size})` : '';
  return `- ⏱️ **A tempo** ${el}: ${props} in ${(a.duration / 1000).toFixed(2)}s, ${when}, ${ease}${stagger}`;
}

export async function writeReport(outDir, { url, dump, result, snippets, sourceFiles, scriptList }) {
  const anims = result.animations;
  const count = (k) => anims.filter((a) => a.kind === k).length;
  const md = [];
  md.push(`# Motion report — ${dump.title || url}`, '', `URL: ${url}  `, `Viewport: ${dump.viewport.w}×${dump.viewport.h} · altezza pagina ${dump.docHeight}px · ${result.bursts} step di scroll`, '');
  md.push('## Librerie', '', libsSection(dump.libs), '');
  md.push(
    '## Riepilogo',
    '',
    `- ${dump.tracked.length} elementi animati via style inline`,
    `- ${count('time')} animazioni a tempo, ${count('scroll')} legate allo scroll, ${count('loop')} loop`,
    `- ${dump.cssAnimations.length} animazioni/transizioni CSS`,
    `- ${snippets.length} blocchi di codice di animazione trovati nel JS`,
    `- ${sourceFiles.length} file sorgente originali recuperati dalle source map`,
    '',
    'File: `recreated.js` (bozza GSAP), `snippets.js` (codice trovato), `recording.webm` (rivedilo a 0.25x), `screens/`, `raw-dump.json`.',
    '',
  );

  if (dump.scrollTriggers && dump.scrollTriggers.length) {
    md.push('## ScrollTrigger dal vivo (dati esatti)', '', block('json', JSON.stringify(dump.scrollTriggers, null, 2).slice(0, 20000)), '');
  }
  if (dump.calls.length) {
    md.push(`## Chiamate GSAP registrate (${dump.calls.length})`, '', block('json', JSON.stringify(dump.calls.slice(0, 80), null, 2).slice(0, 20000)), '');
  }

  md.push('## Animazioni misurate', '');
  md.push(anims.length ? anims.map(describe).join('\n') : '_Nessun movimento registrato (prova con `--pause` più lungo o `--headed`)._', '');

  if (dump.cssAnimations.length) {
    md.push('## Animazioni CSS', '', '| Tipo | Nome | Elemento | Durata | Easing | Scroll-driven |', '|---|---|---|---|---|---|');
    for (const c of dump.cssAnimations.slice(0, 60)) {
      md.push(`| ${c.kind} | ${c.name} | \`${c.target}\` | ${c.duration}ms | \`${c.easing}\` | ${yes(c.scrollDriven)} |`);
    }
    md.push('');
  }

  if (sourceFiles.length) {
    md.push('## Codice originale dalle source map', '', ...sourceFiles.map((f) => `- \`${f.path}\` → \`${f.saved}\``), '');
  }

  md.push('## Codice di animazione trovato nel JS', '');
  if (!snippets.length) md.push('_Niente trovato: animazioni probabilmente in WebGL, CSS, o codice offuscato in modo aggressivo._', '');
  for (const s of snippets.slice(0, 40)) {
    md.push(`**${s.tags.join(', ')}** — \`${s.source.split('?')[0].slice(-80)}\``, '', block(s.tags.includes('Shader') ? 'glsl' : 'js', s.code), '');
  }
  if (snippets.length > 40) md.push(`_…altri ${snippets.length - 40} in \`snippets.js\`._`, '');

  md.push('## Script analizzati', '', ...scriptList.map((s) => `- ${s.url.slice(0, 120)} (${Math.round(s.bytes / 1024)} KB, ${s.snippets} blocchi)`), '');
  await writeFile(path.join(outDir, 'report.md'), md.join('\n'));
}
