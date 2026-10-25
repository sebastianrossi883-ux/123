# motion-extractor

Apre un sito in un browser automatico, lo scorre come una persona e ti restituisce
**come sono fatte le animazioni** (codice, valori misurati, easing, stagger, scrub,
una bozza GSAP) e soprattutto **il suo DNA**: coreografia, linguaggio del movimento e
scenografia, cioè quello che lo rende unico anche se la libreria è la stessa di tutti.

Funziona con GSAP, ScrollTrigger, Lenis e animazioni CSS, anche quando il codice è
minificato dentro un bundle (il caso più comune).

## Installazione

```bash
cd motion-extractor
npm install
npx playwright install chromium
```

## Perché è veloce

Un'IA (Antigravity, Cursor, Claude…) che "estrae" un'animazione la ricostruisce a mano:
legge il codice minificato, fa screenshot, ragiona, e ci mette minuti per sezione.
Questo strumento non ragiona: **misura**. Un browser automatico registra ogni fotogramma di
ogni elemento mentre la pagina viene scorsa, poi uno script calcola tutto. Una pagina intera,
con tutte le sezioni, richiede **~1–2 minuti**; con `--parallel 3` analizzi tre siti alla volta.
L'IA ti serve dopo, per lavorare sulla scheda già pronta.

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
`--no-video`, `--headed` (vedi il browser), `--out out`, `--no-interaction` (salta mouse e hover),
`--hover-targets 6`, `--parallel 3` (più siti alla volta), `--fast` (step 600px e pause 1.3s:
circa 2× più veloce, start/end meno precisi).

## Cosa ottieni (in `out/<sito>-<data>/`)

| File | Contenuto |
|---|---|
| `spec.md` | **Scheda tecnica completa**: per ogni sezione ogni elemento con x, y, larghezza, altezza (px e vw), font, colore, sfondo, raggio, z-index; per ogni elemento animato trigger (px di scroll e % del viewport), ritardo nella scena, durata, easing, valori di inizio/fine, keyframe in px al 0-10-25-50-75-90-100%, tabella scroll → valore per le animazioni con scrub, e la riga GSAP (agganciata alla sezione, con il ritardo come `delay`) |
| `dna.html` | **Il DNA del sito in una pagina**: palette, scala tipografica, ritmo delle sezioni, easing dominanti, vocabolario dei reveal, timeline di ogni scena, livelli di parallax, pin, cursore e hover |
| `brief.md` | Il DNA scritto come brief di art direction + **prompt pronto** per generare un sito *originale* con lo stesso stile |
| `dna.json` | Gli stessi dati in formato leggibile da script (per costruirti un catalogo) |
| `report.md` | Riepilogo tecnico: librerie, animazioni misurate, codice trovato |
| `recreated.js` | Bozza GSAP ricostruita (`fromTo`, easing, stagger, ScrollTrigger, CustomEase misurate) |
| `snippets.js` | Blocchi di codice di animazione trovati nel JS del sito, formattati |
| `sources/` | Codice **originale** non minificato, se il sito pubblica le source map |
| `recording.webm` | Video della sessione: guardalo a 0.25x per capire la regia |
| `screens/` | Uno screenshot per ogni schermata scorsa |
| `raw-dump.json` | Tutti i dati grezzi fotogramma per fotogramma |

## Cosa misura del DNA

**Coreografia** — le animazioni che partono insieme formano una *scena*. Per ogni scena:
chi entra per primo (titolo, testo, media, bottone), con che ritardo ciascuno (`+479ms`),
quanto si accavallano (sovrapposizione 1.7× = movimenti che si sovrappongono), stagger e
sequenze ricorrenti in tutto il sito (es. `titolo → testo → media`).

**Linguaggio del movimento** — easing dominanti con la loro curva, durate tipiche,
distanze (px e % dell'elemento), tipi di reveal (maschera, clip-path, fade-up,
scale-down, blur…), quota di animazioni legate allo scroll, livelli di parallax con la
velocità a schermo, sezioni pinnate e per quanti vh, loop, cursore personalizzato,
elementi che reagiscono al mouse, effetti hover (JS e CSS).

**Scenografia** — famiglie e scala tipografica (px e vw, peso, interlinea, tracking),
palette di sfondi (per superficie) e testo (per caratteri), altezza e colore di ogni
sezione, larghezza del contenitore, griglie, raggi, blend mode, backdrop-filter,
overlay a tutto schermo (grana).

## Come funziona

1. **Prima che il sito carichi** viene iniettato `src/inject.js`, che:
   - registra ogni elemento il cui `style` cambia e ne misura `transform`, `opacity`,
     `clip-path` e `filter` a ogni fotogramma, insieme alla posizione di scroll;
   - se GSAP è caricato come `<script>` (CDN), intercetta ogni `gsap.to/from/fromTo/timeline`
     e `ScrollTrigger.create` e alla fine legge `ScrollTrigger.getAll()`: valori esatti;
   - registra le animazioni CSS (`document.getAnimations()`) e i canvas WebGL.
2. **Fasi**: muove il mouse in cerchio (cursore, parallax al mouse), passa sopra i bottoni
   visibili (hover), poi **scorre a step con la rotella** (così funziona anche con Lenis).
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
stagger, scrub, clip-path, loop, il codice nel bundle e il sorgente originale, e il DNA:
la scena titolo → testo → media con i suoi offset, il pin da 150vh, il cursore, l'hover CSS,
la palette, la tipografia e i livelli di parallax.
