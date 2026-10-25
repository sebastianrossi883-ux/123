# Motion DNA

Strumenti per animare siti statici con GSAP + Lenis prendendo il movimento da siti reali
(Awwwards, GSAP showcase, Lenis showcase) e rendendo ogni progetto unico.

- [`motion-extractor/`](motion-extractor/README.md) — misura un sito (o 500) e produce scheda tecnica,
  DNA, kit di movimento per un'altra IA; catalogo, mix di DNA nuovi e verifica.
- [`skills/motion-dna/`](skills/motion-dna/SKILL.md) — skill per agenti IA (formato Agent Skills, da usare con
  [greensock/gsap-skills](https://github.com/greensock/gsap-skills)).

```bash
cd motion-extractor && npm install && npx playwright install chromium
node src/cli.mjs --file urls.txt --parallel 4 --fast --no-video   # estrai
node src/dna.mjs catalog out                                      # cataloga
node src/dna.mjs blend --mood elegante --name progetto            # crea un DNA unico
node src/dna.mjs verify http://localhost:8080 --kit blends/progetto/kit.json
```
