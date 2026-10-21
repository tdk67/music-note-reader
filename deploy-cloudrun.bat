@echo off
REM Google Cloud Run 1-Click Deployment Script
echo ========================================================
echo Deploying MusicNoteReader to Google Cloud Run...
echo ========================================================

where gcloud >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Google Cloud SDK (gcloud) is not installed or not in PATH.
    echo Please install it via: winget install Google.CloudSDK
    echo Or deploy via GitHub + Google Cloud Console (see instructions).
    pause
    exit /b 1
)

echo.
echo Running Cloud Run build and deploy...
gcloud run deploy music-note-reader ^
    --source . ^
    --region us-central1 ^
    --memory 4Gi ^
    --cpu 2 ^
    --timeout 300 ^
    --allow-unauthenticated

if %ERRORLEVEL% equ 0 (
    echo.
    echo ========================================================
    echo Deployment complete! Open your Cloud Run URL to play.
    echo ========================================================
) else (
    echo.
    echo [ERROR] Deployment failed. Check the error message above.
)
pause
