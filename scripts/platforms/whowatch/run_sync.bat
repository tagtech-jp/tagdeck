@echo off
chcp 65001 > nul
cd /d D:\tagdeck
set LOGFILE=D:\tagdeck\logs\whowatch_sync_%date:~0,4%%date:~5,2%%date:~8,2%.log
echo [%date% %time%] sync start >> "%LOGFILE%"
"C:\Users\tagme\AppData\Local\Programs\Python\Python311\python.exe" scripts\platforms\whowatch\run_sync_wrapper.py >> "%LOGFILE%" 2>&1
echo [%date% %time%] sync end (exit=%ERRORLEVEL%) >> "%LOGFILE%"
exit /b %ERRORLEVEL%
