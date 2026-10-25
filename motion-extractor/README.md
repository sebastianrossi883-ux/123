# motion-extractor

Apre un sito in un browser automatico, lo scorre come una persona e ti restituisce
**come sono fatte le animazioni**: codice, valori misurati, easing, stagger, scrub
e una bozza GSAP già pronta da adattare.

Funziona con GSAP, ScrollTrigger, Lenis e animazioni CSS, anche quando il codice è
minificato dentro un bundle (il caso più comune).

## Installazione

```bash
cd motion-extractor
npm install
npx playwright install chromium
```

## Uso

```bash
# un sito
node src/cli.mjs https://sito-che-ti-piace.com

# più siti
node src/cli.mjs https://a.com https://b.com

# tutti i siti di uno showcase
node src/collect-links.mjs https://gsap.com/showcase/ --out urls.txt
node src/collect-links.mjs https://lenis.darkroom.engineering/ --out urls.txt
node src/cli.mjs --file urls.txt
```

Opzioni: `--max-scroll 15000` (px da scorrere), `--step 400` (px per step), `--pause 2000`
(ms di attesa dopo ogni step), `--intro 4000` (ms prima di iniziare a scorrere),
`--no-video`, `--headed` (vedi il browser), `--out out`.

## Cosa ottieni (in `out/<sito>-<data>/`)

| File | Contenuto |
|---|---|
| `report.md` | Riepilogo: librerie, animazioni misurate, codice trovato |
| `recreated.js` | Bozza GSAP ricostruita (`fromTo`, easing, stagger, ScrollTrigger, CustomEase misurate) |
| `snippets.js` | Blocchi di codice di animazione trovati nel JS del sito, formattati |
| `sources/` | Codice **originale** non minificato, se il sito pubblica le source map |
| `recording.webm` | Video della sessione: guardalo a 0.25x per capire la regia |
| `screens/` | Uno screenshot per ogni schermata scorsa |
| `raw-dump.json` | Tutti i dati grezzi fotogramma per fotogramma |

## Come funziona

1. **Prima che il sito carichi** viene iniettato `src/inject.js`, che:
   - registra ogni elemento il cui `style` cambia e ne misura `transform`, `opacity`,
     `clip-path` e `filter` a ogni fotogramma, insieme alla posizione di scroll;
   - se GSAP è caricato come `<script>` (CDN), intercetta ogni `gsap.to/from/fromTo/timeline`
     e `ScrollTrigger.create` e alla fine legge `ScrollTrigger.getAll()`: valori esatti;
   - registra le animazioni CSS (`document.getAnimations()`) e i canvas WebGL.
2. **Scroll a step con la rotella** (così funziona anche con Lenis), con pause tra gli step.
3. **Analisi statica del JS** (`src/static-scan.mjs`): la minificazione rinomina le variabili
   ma non le chiavi e le stringhe, quindi `{ease:"expo.out", scrollTrigger:{start:"top 80%"}}`
   si trova e si formatta. Se c'è una source map, recupera i file originali.
4. **Analisi dei movimenti** (`src/analyze.mjs`):
   - *a tempo* vs *legate allo scroll* vs *loop*;
   - easing confrontato con tutte le curve GSAP; se nessuna combacia, genera una `CustomEase`
     con la curva misurata;
   - stagger tra elementi simili, ritardo dello scrub, punto di start rispetto al viewport.

## Limiti

- **WebGL/shader** (`<canvas>`): il movimento non è nel DOM, quindi non viene misurato.
  Il report lo segnala e `snippets.js` estrae il codice GLSL che trova.
- Selettori, `start`/`end` e `scrub` nella bozza sono **approssimati** (la precisione dipende
  da `--step`). Easing, durate e stagger invece sono affidabili.
- Alcuni siti bloccano i browser automatici: prova `--headed`.
- Usalo per **studiare e ricreare** le tecniche, non per copiare codice o design di altri.

## Test

```bash
npm run build:fixture && npm test
```

Il test costruisce la stessa pagina in tre versioni (GSAP+Lenis nel bundle minificato,
bundle con source map, GSAP da `<script>`) e verifica che vengano ritrovati easing, durate,
stagger, scrub, clip-path, loop, il codice nel bundle e il sorgente originale.
