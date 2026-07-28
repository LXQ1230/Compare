@echo off
echo ========================================
echo   Compare — Document Comparison Tool
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] Building frontend...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo Frontend build failed!
    pause
    exit /b 1
)

echo.
echo [2/2] Starting server...
echo Open http://127.0.0.1:17890 in your browser
echo.

python -m uvicorn src_backend.main:app --host 127.0.0.1 --port 17890

pause
