@echo off
rem GQA installer and updater for Windows. Double-click to install or update.
rem Works from inside a GQA folder, or on its own: it then clones GQA into
rem %USERPROFILE%\GQA (or updates that copy) and continues from there.
setlocal EnableExtensions
title GQA setup

set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
set "REPO=%HERE%"
if exist "%REPO%\scripts\gqa-setup.ps1" goto run

set "REPO=%USERPROFILE%\GQA"
if exist "%REPO%\scripts\gqa-setup.ps1" goto run

where git >nul 2>nul
if errorlevel 1 goto nogit
if not exist "%REPO%\.git" goto clone
echo Updating the existing GQA copy in "%REPO%" ...
git -C "%REPO%" pull --ff-only
if errorlevel 1 goto fail
if exist "%REPO%\scripts\gqa-setup.ps1" goto run
goto fail

:clone
echo Downloading GQA into "%REPO%" ...
git clone https://github.com/khoryik96-creator/GQA.git "%REPO%"
if errorlevel 1 goto fail
if not exist "%REPO%\scripts\gqa-setup.ps1" goto fail

:run
where powershell >nul 2>nul
if errorlevel 1 goto nopowershell
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO%\scripts\gqa-setup.ps1" -RepoDir "%REPO%" %*
set "RC=%ERRORLEVEL%"
goto done

:nogit
echo Git is required to download GQA.
echo Install it from https://git-scm.com/download/win or run:  winget install --exact --id Git.Git
set "RC=1"
goto done

:nopowershell
echo Windows PowerShell was not found. It is part of Windows; check your PATH.
set "RC=1"
goto done

:fail
echo Could not download or update GQA in "%REPO%".
set "RC=1"

:done
echo.
if "%RC%"=="0" (echo GQA setup finished.) else (echo GQA setup did not finish. Exit code %RC%.)
pause
exit /b %RC%
