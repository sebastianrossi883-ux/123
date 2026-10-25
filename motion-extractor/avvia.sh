#!/usr/bin/env bash
# Mac/Linux:  bash avvia.sh            → passata 1, veloce, tutti i siti di urls.txt (catalogo)
#             bash avvia.sh completo   → passata 2, completa (video + copia HAR), siti di migliori.txt
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Installa prima Node.js 22 da https://nodejs.org e rilancia."; exit 1; }
[ -d node_modules ] || npm install
npx playwright install chromium
P=$(( $(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4) - 1 )); [ "$P" -lt 1 ] && P=1
if [ "$1" = "completo" ]; then
  [ -s migliori.txt ] || { echo "Scrivi in migliori.txt i siti da rifare bene (uno per riga)."; exit 1; }
  node src/cli.mjs --file migliori.txt --out out-completo --parallel "$P" --record-har-dir har
  node src/dna.mjs catalog out-completo
  echo "Fatto: out-completo/riepilogo-lotto.md e out-completo/catalog.html"
else
  [ -s urls.txt ] || { echo "Scrivi i siti in urls.txt, uno per riga."; exit 1; }
  node src/cli.mjs --file urls.txt --parallel "$P" --fast --no-video
  node src/dna.mjs catalog out
  echo "Fatto: out/riepilogo-lotto.md e out/catalog.html (mandami il riepilogo)"
fi
