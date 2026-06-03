# ╔══════════════════════════════════════════════════════════════╗
# ║               Signacare EMR — Windows Installation Script        ║
# ║                                                              ║
# ║  Run as Administrator in PowerShell:                         ║
# ║    Set-ExecutionPolicy Bypass -Scope Process                 ║
# ║    .\install.ps1                                             ║
# ╚══════════════════════════════════════════════════════════════╝

$ErrorActionPreference = "Stop"

$SIGNACARE_HOME = "$env:USERPROFILE\signacare"
$DB_NAME = "signacareemr"
$DB_USER = "signacare"
$DB_PASS = [System.Guid]::NewGuid().ToString("N").Substring(0, 16)

function Log($msg) { Write-Host "[SIGNACARE] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

Write-Host ""
Write-Host "  Signacare EMR Installer v1.0 — Windows" -ForegroundColor Cyan
Write-Host "  Mental Health Electronic Medical Record System" -ForegroundColor Cyan
Write-Host ""

# ── Check if running as admin ──
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Warn "Not running as Administrator. Some steps may fail. Right-click PowerShell and 'Run as Administrator'." }

# ── Chocolatey (package manager) ──
Step "1/8 — Installing Package Manager (Chocolatey)"
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Log "Installing Chocolatey..."
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
} else { Log "Chocolatey — OK" }

# ── Node.js ──
Step "2/8 — Installing Node.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    choco install nodejs-lts -y
    refreshenv
} else { Log "Node.js $(node -v) — OK" }

# ── Python ──
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    choco install python3 -y
    refreshenv
} else { Log "Python $(python --version) — OK" }

# ── PostgreSQL ──
Step "3/8 — Installing PostgreSQL"
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    choco install postgresql16 -y --params '/Password:postgres'
    refreshenv
} else { Log "PostgreSQL — OK" }

# ── Redis ──
if (-not (Get-Command redis-cli -ErrorAction SilentlyContinue)) {
    choco install redis-64 -y
} else { Log "Redis — OK" }

# ── Ollama ──
Step "4/8 — Installing Ollama"
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Log "Downloading Ollama..."
    $ollamaUrl = "https://ollama.com/download/OllamaSetup.exe"
    $ollamaInstaller = "$env:TEMP\OllamaSetup.exe"
    Invoke-WebRequest -Uri $ollamaUrl -OutFile $ollamaInstaller
    Start-Process -FilePath $ollamaInstaller -Args "/S" -Wait
    Log "Ollama installed"
} else { Log "Ollama — OK" }

# ── Download AI Models ──
Step "5/8 — Downloading AI Models"
Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Log "Downloading qwen2.5:14b (may take 10-20 minutes)..."
ollama pull "qwen2.5:14b"
Log "Downloading llama3.2..."
ollama pull "llama3.2"

# ── Whisper Server ──
Step "6/8 — Setting Up Whisper Transcription"
$whisperDir = "$SIGNACARE_HOME\whisper-server"
New-Item -ItemType Directory -Force -Path $whisperDir | Out-Null
python -m venv "$whisperDir\venv"
& "$whisperDir\venv\Scripts\pip" install flask flask-cors faster-whisper torch numpy
Log "Whisper server configured"

# ── Signacare Application ──
Step "7/8 — Installing Signacare EMR"
New-Item -ItemType Directory -Force -Path $SIGNACARE_HOME | Out-Null
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Copy-Item -Recurse -Force "$scriptDir\..\*" "$SIGNACARE_HOME\app\" -Exclude @("node_modules", ".git")
Set-Location "$SIGNACARE_HOME\app"
npm install --production
Set-Location "apps\web"
npm run build
Set-Location "$SIGNACARE_HOME\app"
Log "Application installed"

# ── Configuration ──
Step "8/8 — Creating Configuration"
$jwtSecret = [System.Guid]::NewGuid().ToString("N")
$envContent = @"
NODE_ENV=production
PORT=4000
DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
REDIS_URL=redis://localhost:6379
JWT_SECRET=$jwtSecret
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:14b
WHISPER_API_URL=http://localhost:8080
LLM_RATE_LIMIT=30
"@
Set-Content -Path "$SIGNACARE_HOME\app\apps\api\.env" -Value $envContent

# ── Create database ──
$env:PGPASSWORD = "postgres"
psql -U postgres -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>$null
psql -U postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>$null
Log "Database created"

# ── Start script ──
$startScript = @"
@echo off
echo Starting Signacare EMR...
start /B redis-server
start /B ollama serve
timeout /t 3 >nul
cd "$SIGNACARE_HOME\whisper-server"
start /B venv\Scripts\python server.py --port 8080
cd "$SIGNACARE_HOME\app\apps\api"
start /B node -r dotenv/config dist/index.js
cd "$SIGNACARE_HOME\app\apps\web"
start /B npx serve -s dist -l 5173
echo.
echo Signacare EMR is running!
echo   Web: http://localhost:5173
echo   API: http://localhost:4000
echo.
"@
Set-Content -Path "$SIGNACARE_HOME\start.bat" -Value $startScript

Write-Host ""
Write-Host "  Signacare EMR installed successfully!" -ForegroundColor Green
Write-Host "  Location: $SIGNACARE_HOME" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Cyan
Write-Host "    1. Activate license:  node $SIGNACARE_HOME\app\installer\activate.js --generate-demo"
Write-Host "    2. Start services:    $SIGNACARE_HOME\start.bat"
Write-Host "    3. Open browser:      http://localhost:5173"
Write-Host ""
