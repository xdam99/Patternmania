@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo   Pattern Writer - Developpement
echo ==========================================
echo.

where node >nul 2>nul || (
  echo ERREUR : Node.js est introuvable.
  echo Installe Node.js LTS puis redemarre ce terminal.
  pause
  exit /b 1
)

call npm config set registry https://registry.npmjs.org/ --location=project >nul 2>nul

where cargo >nul 2>nul || (
  echo ERREUR : Rust/Cargo est introuvable.
  echo Execute : winget install --id Rustlang.Rustup
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installation des dependances npm...
  call npm install || goto :error
)

echo Lancement de l'application...
call npm run tauri dev || goto :error
exit /b 0

:error
echo.
echo Une erreur est survenue. Copie le message affiche ci-dessus.
pause
exit /b 1
