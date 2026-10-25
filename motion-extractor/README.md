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

## Siti unici: catalogo, mix, verifica

Usare il DNA di un solo sito per un cliente vuol dire copiarlo. Con tanti siti estratti puoi creare
un DNA **nuovo**:

```bash
node src/dna.mjs catalog out                                   # out/catalog.html: tutti i DNA con la loro impronta
node src/dna.mjs blend --mood elegante --name studio --seed 7  # blends/studio/: motion-kit.js, per-ia.md, provenienza.md
node src/dna.mjs verify http://localhost:8080 --kit blends/studio/kit.json   # il sito finito si muove come il DNA?
```

- **Catalogo**: per ogni sito un'impronta numerica (durata, nitidezza dell'easing, distanze, stagger,
  passo, sovrapposizione, parallax, quota di scroll, pin, loop, tipi di reveal), filtrabile per mood.
- **Mix**: linguaggio del movimento da un sito, casting e coreografia da un secondo, regia dello scroll
  da un terzo, poi ogni valore variato. Il mix controlla la distanza dal sito più simile del catalogo e
  rigenera finché non è sopra la soglia (`--min-distance`, default 0.08). Mood: `elegante`, `energico`,
  `minimale`, `editoriale`, `giocoso`, `cinematografico`. Stesso `--seed` = stesso DNA.
- **Verifica**: misura il sito animato e confronta ogni animazione con i preset del DNA, i ritardi
  nelle scene, parallax, pin e marquee → `verifica.md` con ✓/✗ e punteggio (fallisce sotto l'80%).
- **Token per codice su misura**: `motionKit.tokens`, `motionKit.timeline()`, `motionKit.from(el, 'preset')`,
  `motionKit.offset('heading', 'media')` — così un momento firma scritto a mano (con le skill GSAP)
  resta nello stesso linguaggio.

### Con le skill AI di GSAP

```bash
npx skills add https://github.com/greensock/gsap-skills      # API GSAP corretta (ufficiale)
npx skills add https://github.com/sebastianrossi883-ux/123   # skills/motion-dna: come deve muoversi il sito
```

(oppure copia `skills/motion-dna/` nella cartella delle skill del tuo agente, es. `.claude/skills/`).
La skill `motion-dna` guida l'IA: DNA nuovo con `blend` → tag dell'HTML con il kit → un solo momento
firma scritto con GSAP usando i token → `verify` ≥ 80% → checklist di scenografia.

## Tanti siti (centinaia)

```bash
node src/collect-links.mjs https://gsap.com/showcase/ --out urls.txt
node src/cli.mjs --file urls.txt --parallel 4 --fast --no-video
```

- `out/index.csv`: una riga per sito con esito (`ok`, `vuoto`, `errore`), secondi, scene, preset e cartella.
- Se lo interrompi, rilancia lo stesso comando: i siti `ok` vengono saltati (`--force` per rifarli);
  quelli `vuoto` (pagina caricata ma niente movimento: protezione anti-bot, muro dei cookie) ed
  `errore` vengono ritentati.
- `--timeout 300`: secondi massimi per sito, poi passa al successivo.
- I banner dei cookie vengono chiusi da soli (bottoni "Accetta", "Accept all", "OK"…).
- `--parallel` al massimo pari ai core del computer meno uno: oltre, i fotogrammi rallentano e i tempi
  misurati peggiorano.

Tempi misurati su una pagina di 9,7 schermate (computer a 4 core):

| modalità | per sito | 500 siti |
|---|---|---|
| normale | 56s | ~8–10 ore |
| `--fast --no-video` | 33s | ~5 ore |
| `--fast --no-video --parallel 4` | 33–35s ciascuno, 4 insieme | **~1,5–2 ore** |

Un sito più lungo ci mette di più (≈5s per schermata in modalità normale, ≈2,2s in `--fast`).
In `--fast` coreografia, easing, durate, stagger, pin e parallax restano precisi; lo **scrub** invece
viene sottostimato (non c'è tempo di aspettare che l'elemento raggiunga lo scroll): per i siti che
vuoi replicare davvero, rilanciali senza `--fast`.

## Cosa ottieni (in `out/<sito>-<data>/`)

| File | Contenuto |
|---|---|
| `per-ia.md` + `motion-kit.js` | **Da dare all'IA che anima il tuo sito.** `motion-kit.js` contiene i preset misurati (easing, durate, distanze, stagger, ritardi tra titolo/testo/media, parallax, pin, marquee, cursore, hover) e anima qualsiasi HTML taggato con `data-motion`, `data-scene`, `data-parallax`…; `per-ia.md` dice all'IA quale attributo mettere su ogni tipo di elemento. L'IA non scrive animazioni, quindi non può inventare numeri |
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

## Flusso con un'altra IA

1. `node src/cli.mjs https://sito-di-riferimento.com`
2. Copia `motion-kit.js` accanto al tuo `index.html`.
3. Dai all'IA il tuo HTML + `per-ia.md` (+ `spec.md` se vuoi i valori esatti) e chiedile di
   aggiungere gli attributi secondo le istruzioni.
4. Apri la pagina: in console `[motion-kit] N elementi in M scene`, senza avvisi.

## Cosa registra

`transform` (x, y, scala, rotazione), `opacity`, `clip-path`, `filter`, `width`/`height`,
`background-color`, `color`, `border-radius`, `stroke-dashoffset` (linee SVG che si disegnano),
`letter-spacing` — sia quando li cambia GSAP sia con transizioni/animazioni CSS attivate da
classi (`.is-visible`), fino a 400 elementi (testi divisi in lettere inclusi), su pagine fino a
40000px, anche su siti che scorrono un contenitore invece della finestra (Locomotive & co.).

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

Il test più importante è l'**andata e ritorno**: il kit estratto dalla pagina di prova anima una
pagina diversa (`test/fixture/user-page.html`, taggata solo con attributi come farebbe l'IA);
quella pagina viene ri-estratta e deve dare la stessa regia, gli stessi easing e durate, gli
stessi ritardi, parallax, pin, marquee, hover e cursore.

Inoltre il test costruisce la stessa pagina in tre versioni (GSAP+Lenis nel bundle minificato,
bundle con source map, GSAP da `<script>`) e verifica che vengano ritrovati easing, durate,
stagger, scrub, clip-path, loop, il codice nel bundle e il sorgente originale, e il DNA:
la scena titolo → testo → media con i suoi offset, il pin da 150vh, il cursore, l'hover CSS,
la palette, la tipografia e i livelli di parallax.
