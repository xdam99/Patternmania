@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo   Construction de l'installateur Windows
echo ==========================================
echo.

where node >nul 2>nul || (
  echo ERREUR : Node.js est introuvable.
  pause
  exit /b 1
)

call npm config set registry https://registry.npmjs.org/ --location=project >nul 2>nul

where cargo >nul 2>nul || (
  echo ERREUR : Rust/Cargo est introuvable.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installation des dependances npm...
  call npm install || goto :error
)

call npm run tauri build || goto :error

echo.
echo Construction terminee.
echo Consulte : src-tauri\target\release\bundle\nsis\
pause
exit /b 0

:error
echo.
echo La construction a echoue. Copie le message affiche ci-dessus.
pause
exit /b 1
