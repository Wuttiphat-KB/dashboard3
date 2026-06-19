@echo off
REM ─────────────────────────────────────────────────────────────────────────
REM  EV Backend auto-restart loop
REM
REM  Runs `npm run server` and respawns it every time it exits (e.g. when the
REM  in-process memory monitor exits at the soft heap limit, or on any crash).
REM  The 5-second wait keeps a tight crash-loop from hammering MQTT / Mongo
REM  reconnects.
REM
REM  Use INSTEAD of `npm run server`. Stop with Ctrl+C TWICE (once to kill
REM  node, again to break this batch loop).
REM ─────────────────────────────────────────────────────────────────────────

cd /d "%~dp0"

:loop
echo.
echo [server-loop] starting npm run server  (%DATE% %TIME%)
echo.
call npm run server
echo.
echo [server-loop] backend exited with code %ERRORLEVEL%  (%DATE% %TIME%)
echo [server-loop] restarting in 5 seconds... (Ctrl+C to abort)
timeout /t 5 /nobreak >nul
goto loop
