#!/usr/bin/env bash
# Mac/Linux: doppio clic (o `bash avvia.sh`). Installa tutto la prima volta, poi analizza i siti
# scritti in urls.txt (uno per riga) e apre il riepilogo.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Installa prima Node.js 22 da https://nodejs.org e rilancia."; exit 1; }
[ -d node_modules ] || npm install
npx playwright install chromium
[ -s urls.txt ] || { echo "https://hyperspeed.agency/" > urls.txt; echo "Creato urls.txt con un sito di esempio: aggiungi i tuoi, uno per riga."; }
node src/cli.mjs --file urls.txt --parallel 3 --record-har-dir har
node src/dna.mjs catalog out
echo; echo "Fatto. Apri out/riepilogo-lotto.md e out/catalog.html"
(command -v open >/dev/null && open out/catalog.html) || (command -v xdg-open >/dev/null && xdg-open out/catalog.html) || true
