---
name: motion-dna
description: Anima un sito statico con un DNA di movimento misurato da siti reali (Awwwards, GSAP showcase, Lenis showcase) invece di inventare animazioni generiche. Usare quando si deve animare un sito HTML con GSAP, ScrollTrigger e Lenis e c'è (o si vuole creare) un DNA in motion-extractor — kit.json, motion-kit.js, per-ia.md — oppure quando il risultato deve sembrare unico e da Awwwards. Da usare insieme alle skill ufficiali greensock/gsap-skills, che coprono l'API di GSAP.
---

# Motion DNA

Le skill ufficiali GSAP (`gsap-core`, `gsap-timeline`, `gsap-scrolltrigger`, `gsap-plugins`, …) ti
insegnano a usare GSAP correttamente. Questa skill ti dice **come deve muoversi questo sito**: il
movimento è misurato da siti reali dallo strumento `motion-extractor/` di questo repository, e tu
non devi inventarlo.

Un sito sembra generico quando tutto "sale e appare" con `power2.out` in 1 secondo. Sembra d'autore
quando ha **un solo linguaggio di movimento coerente**, una **regia** (chi entra prima, con che ritardo)
e **uno o due momenti firma**. Il DNA ti dà i primi due; il terzo lo costruisci tu, con i suoi token.

## Flusso

### 1. Procurati un DNA (non copiare un sito)

- C'è già una cartella con `kit.json`, `motion-kit.js`, `per-ia.md`? Usala.
- Altrimenti, se c'è un catalogo (`out/catalog.json`), **crea un DNA nuovo** mescolando più siti:
  ```bash
  cd motion-extractor
  node src/dna.mjs blend --mood <elegante|energico|minimale|editoriale|giocoso|cinematografico> --name <progetto> --seed <numero>
  ```
  Scegli il mood dal brand. Controlla in `blends/<progetto>/provenienza.md` che la distanza dal sito
  più simile sia sopra la soglia ("unico"); se no rigenera con un altro `--seed`.
- Se non c'è niente, estrai prima i siti di riferimento:
  `node src/cli.mjs --file urls.txt --parallel 4 --fast --no-video` e poi `node src/dna.mjs catalog out`.

Usare il DNA di **un solo** sito così com'è va bene per studio, non per un progetto: per un cliente
usa sempre `blend`.

### 2. Applica il kit (la maggior parte del sito)

Leggi `per-ia.md` del DNA scelto e seguilo alla lettera:

- copia `motion-kit.js` accanto all'HTML e aggiungi gli script (GSAP, ScrollTrigger, SplitText,
  CustomEase, Lenis, poi motion-kit.js);
- tagga l'HTML: `data-intro` sull'hero, `data-scene` su ogni sezione, `data-motion` (+ `data-split`)
  su titoli/testi/media secondo la tabella **Casting**, `data-parallax`, `data-pin-horizontal`
  + `data-track`, `data-marquee`, `data-cursor`, `data-hover`;
- **non** scrivere tween GSAP per ciò che il kit copre già. Il kit inizializza Lenis e lo sincronizza
  con ScrollTrigger: non crearne un secondo.

### 3. Un momento firma (qui servono le skill GSAP)

Scegli **un** momento per pagina che il kit non copre e che renda il progetto riconoscibile: un hero
con le parole che si ricompongono, una transizione tra sezioni, una galleria che si apre con lo scroll,
un testo che segue il cursore. Scrivilo con GSAP usando le skill ufficiali per l'API, ma **solo con
i token del DNA**:

```js
const { tokens } = motionKit;          // easing, durate, stagger, passo, distanza del DNA
const tl = motionKit.timeline({        // defaults = easing e durata principali del DNA
  scrollTrigger: { trigger: '.hero', start: 'top top', end: '+=120%', scrub: true, pin: true },
});
tl.add(motionKit.from('.hero .word', 'mask-slide'))                  // un preset come tween
  .to('.hero .media', { scale: 1, clipPath: 'inset(0% 0% 0% 0%)' }, `<${motionKit.offset('heading', 'media')}`)
  .to('.hero .word', { yPercent: -100, stagger: tokens.stagger, duration: tokens.duration.short });
```

Regole per il momento firma:
- easing solo da `motionKit.tokens.ease.all` (o i nomi dei preset); durate tra
  `tokens.duration.short` e `tokens.duration.long`; stagger `tokens.stagger`; ritardi
  `motionKit.offset(ruolo, ruolo)`;
- registra i plugin una volta sola, pulisci le istanze nei framework (vedi `gsap-react` /
  `gsap-frameworks`), anima solo `transform`, `opacity`, `clip-path` (vedi `gsap-performance`);
- rispetta `motionKit.reduced` (prefers-reduced-motion): se è `true` mostra lo stato finale.

### 4. Verifica (obbligatoria)

Servi il sito in locale e misuralo contro il suo DNA:

```bash
node src/dna.mjs verify http://localhost:8080 --kit blends/<progetto>/kit.json
```

Apri `verifica.md`: ogni animazione deve corrispondere a un preset (✓), i ritardi nelle scene e
parallax/pin/marquee devono tornare. Sotto l'80% il comando fallisce: correggi le righe ✗
(di solito un easing o una durata inventati nel momento firma, o un elemento con il preset sbagliato)
e rilancia. Il momento firma può comparire come ✗ se usa un tipo di movimento non presente nel DNA:
va bene, purché sia uno solo.

## Checklist "da Awwwards"

Il movimento da solo non basta. Prima di consegnare:

- **Scenografia**: tipografia display grande e caratterizzata, contrasto di scala forte con il testo,
  palette ristretta, griglia con respiro. Per ispirarti alla logica (non per copiarla) guarda
  `brief.md` e `dna.html` dei siti genitori.
- **Coerenza**: ogni tipo di elemento entra sempre nello stesso modo (casting); niente animazioni extra
  fuori dal DNA a parte il momento firma.
- **Ritmo**: sezioni di altezza diversa, almeno un cambio di passo (pin o sezione orizzontale) se il DNA
  lo prevede.
- **Dettagli**: hover sui bottoni, cursore se il DNA lo prevede, nessuno scatto al caricamento
  (stati iniziali impostati dal kit), font caricati prima dello split (il kit aspetta `document.fonts`).
- **Prestazioni e accessibilità**: 60fps su scroll, `prefers-reduced-motion` rispettato, contenuto
  leggibile anche senza JavaScript.
- **Verifica** ≥ 80%.
