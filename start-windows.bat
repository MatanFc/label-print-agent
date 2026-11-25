@echo off
rem Runs the agent in this window (for testing). For automatic start at logon, use
rem scripts\install-windows-autostart.ps1 instead.
cd /d "%~dp0"
node --env-file=.env src\server.js
pause
