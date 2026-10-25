@echo off
rem Windows: doppio clic = passata 1 veloce su urls.txt.  "avvia.bat completo" = passata 2 su migliori.txt
cd /d "%~dp0"
where node >nul 2>nul || (echo Installa prima Node.js 22 da https://nodejs.org e rilancia. & pause & exit /b 1)
if not exist node_modules call npm install
call npx playwright install chromium
set /a P=%NUMBER_OF_PROCESSORS%-1
if %P% LSS 1 set P=1
if "%1"=="completo" (
  node src\cli.mjs --file migliori.txt --out out-completo --parallel %P% --record-har-dir har
  node src\dna.mjs catalog out-completo
  echo Fatto: out-completo\riepilogo-lotto.md e out-completo\catalog.html
) else (
  node src\cli.mjs --file urls.txt --parallel %P% --fast --no-video
  node src\dna.mjs catalog out
  echo Fatto: out\riepilogo-lotto.md e out\catalog.html - mandami il riepilogo
)
pause
