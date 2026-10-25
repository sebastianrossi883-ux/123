@echo off
rem Windows: doppio clic. Installa tutto la prima volta, poi analizza i siti in urls.txt (uno per riga).
cd /d "%~dp0"
where node >nul 2>nul || (echo Installa prima Node.js 22 da https://nodejs.org e rilancia. & pause & exit /b 1)
if not exist node_modules call npm install
call npx playwright install chromium
if not exist urls.txt echo https://hyperspeed.agency/> urls.txt
node src\cli.mjs --file urls.txt --parallel 3 --record-har-dir har
node src\dna.mjs catalog out
echo.
echo Fatto. Apri out\riepilogo-lotto.md e out\catalog.html
start "" out\catalog.html
pause
