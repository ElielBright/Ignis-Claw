$ErrorActionPreference = "Stop"

# Use the absolute path or just run it via the local directory
$ExePath = "$PSScriptRoot\rust\target\release\claw.exe"

if (-Not (Test-Path $ExePath)) {
    Write-Host "Wait just a minute! The application is still compiling in the background." -ForegroundColor Yellow
    Write-Host "Please try again in about 2 minutes once the build completes." -ForegroundColor Yellow
    pause
    exit 1
}

# Set environment variables for Ollama
$env:OPENAI_API_KEY="5ca6aaf112c64a3b9bf62ea351dade35.WBa0EVz9xsC1N-EnHWehHF9N"
$env:OPENAI_BASE_URL="https://ollama.com/v1"
$env:HOME=$env:USERPROFILE

Write-Host "Starting Ignis Claw AI with Ollama..." -ForegroundColor Green
& $ExePath --model "qwen3-coder:480b"
