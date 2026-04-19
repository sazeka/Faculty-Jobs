@echo off
schtasks /delete /tn "FacultyAtlas-DailyUpdate" /f 2>nul
schtasks /create ^
  /tn "FacultyAtlas-DailyUpdate" ^
  /tr "powershell.exe -NonInteractive -ExecutionPolicy Bypass -File \"C:\Users\StevenAzeka\OneDrive\Documents\GitHub\Faculty-Jobs\daily-update.ps1\"" ^
  /sc DAILY ^
  /st 02:00 ^
  /f
if %ERRORLEVEL% EQU 0 (
    echo.
    echo Task "FacultyAtlas-DailyUpdate" registered. Runs daily at 02:00.
    echo To test now: schtasks /run /tn "FacultyAtlas-DailyUpdate"
) else (
    echo Failed to register task.
)
