// Separate per-instance evidence from the statistical/adapted motion kit.
// No source is evaluated and no absent timing is replaced with a preset.
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const sha = text => createHash('sha256').update(text).digest('hex');

export function buildSceneArchive({url, dump, result, dna, scene}) {
  const actors = new Map();
  const motions = (result.animations || []).map((animation, i) => {
    const {element, ...movement} = animation;
    const actorId = String(element.id);
    if (!actors.has(actorId)) actors.set(actorId, element);
    return {id: 'movimento-' + String(i + 1).padStart(5, '0'), actorId, ...movement};
  });
  // Include tracked actors that did not pass the analyzer's motion thresholds.
  for (const el of dump.tracked || []) if (!actors.has(String(el.id))) actors.set(String(el.id), el);
  const timelines = new Map();
  for (const call of dump.calls || []) {
    if (call.timeline == null) continue;
    if (!timelines.has(call.timeline)) timelines.set(call.timeline, {id: call.timeline, calls: []});
    timelines.get(call.timeline).calls.push(call);
  }
  return {
    format: 'scene-instances-v1', url, viewport: dump.viewport,
    clock: {unit: 'ms', origin: 'document-start recorder; call.t is construction time, not playback time'},
    actors: [...actors].map(([id, original]) => ({id, original})),
    movements: motions,
    capturedTimelines: [...timelines.values()],
    standaloneCalls: (dump.calls || []).filter(c => c.timeline == null),
    observedScrollTriggers: dump.scrollTriggers ?? null,
    cssAnimations: dump.cssAnimations || [],
    observedScroll: dump.scroll || [], inputMarks: dump.marks || [],
    inferredSceneGroups: dna.scenes || [],
    observedLayout: scene,
    limits: [
      'Per-instance measurements and analyzer results, not byte-identical extracted controllers or executable standalone scenes.',
      'Scene groups, motion classes, fitted curves and inferred geometry remain inferences; no median or fallback from the kit is used here.',
      'Observed durations can be shorter or longer than declared GSAP durations when frames are sparse. Captured GSAP configuration and original source remain separate evidence and are not replaced by the measured duration.',
      'GSAP calls are available when exposed to the recorder. Call time records construction; timeline position is retained separately. Nested relationships and playback events may be absent.',
      'The existing recorder can truncate functions/arrays and has tracking limits. This export preserves its available data without restoring missing parts.',
      'Pixel samples describe this viewport and input path. Responsive formulas, callbacks, canvas effects and absent states require their original sources and relevant observation.',
      'One assigned URL and observed states, not automatic coverage of every page of the site.',
    ],
  };
}

export async function writeSceneArchive(outDir, data, sources, {sharedSources} = {}) {
  const originalDir = path.join(outDir, 'originali');
  await mkdir(originalDir, {recursive: true});
  const sourceIndex = [];
  for (const source of sources) {
    // Response.text() has already decoded the body. Preserve the decoded text,
    // and describe the hash accordingly instead of claiming wire-byte identity.
    const hash = sha(source.text);
    const extension = source.type === 'stylesheet' ? 'css' : source.type === 'document' ? 'html' : 'js';
    const directory = sharedSources ? path.resolve(sharedSources) : originalDir;
    await mkdir(directory, {recursive:true});
    const target = path.join(directory, hash + '.' + extension);
    const file = path.relative(outDir,target).split(path.sep).join('/');
    try {await writeFile(target, source.text, {flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
    const {text, ...meta} = source;
    sourceIndex.push({...meta, file, sha256_decoded_utf8: hash});
  }
  await writeFile(path.join(outDir, 'originali/INDICE.json'), JSON.stringify(sourceIndex, null, 2));
  const archive = buildSceneArchive(data);
  archive.sources = sourceIndex;
  await writeFile(path.join(outDir, 'scene-istanze.json'), JSON.stringify(archive));
  await writeFile(path.join(outDir, 'per-ia.md'), `# Scene e movimenti per istanza

Fonte: ${data.url}

L'ingresso è **scene-istanze.json**. Conserva ciascun movimento e ogni attore
con i suoi valori, campioni, metadati geometrici e collegamenti disponibili.
Le chiamate GSAP sono raggruppate per timeline registrata, mantenendo la
posizione originale e distinguendo costruzione della timeline da esecuzione.
I gruppi inferiti dall'analizzatore sono indicati come tali.
Durate e curve dichiarate nelle chiamate e nel codice hanno una provenienza
diversa dalle stime sui campioni: la durata misurata può essere incompleta
quando mancano fotogrammi. Entrambi i dati restano disponibili, senza sostituire
automaticamente il valore della fonte con quello stimato.

**originali/INDICE.json** collega JS, CSS e HTML acquisiti ai rispettivi URL.
I testi sono quelli decodificati dalle risposte del browser, senza formattazione
o taglio. **DOM-OSSERVATO.html** è il DOM alla fine della visita, distinto
dall'HTML delle risposte originali e dagli stati precedenti.

Per l'integrazione seleziona le istanze della scena, associa gli attori al DOM
destinatario e segui le funzioni originali per geometria, condizioni e raccordi.
L'esportazione offre il materiale della scena; non ha ancora risolto tutte le
dipendenze né trasformato ogni controller in un componente autonomo.

**motion-kit.js**, **kit.json** e **per-ia-preset.md** restano disponibili come
adattamento statistico: famiglie, mediane e valori di ripiego possono differire
dalle singole istanze. Non sono una copia esatta della coreografia sorgente.

Viewport acquisito: ${data.dump.viewport.w} × ${data.dump.viewport.h}.
Scene complete del sito e varianti responsive non osservate non sono dedotte
dal numero dei movimenti, delle funzioni o dei preset.
`);
  return {movements: archive.movements.length, actors: archive.actors.length, sources: sourceIndex.length};
}