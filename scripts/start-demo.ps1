# SCM Solution demo startup (Windows PowerShell)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "=== SCM Solution Demo Setup ===" -ForegroundColor Cyan

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Warning "Docker not found. Ensure PostgreSQL is running on localhost:5432"
} else {
    docker compose up postgres -d
    Start-Sleep -Seconds 3
}

Set-Location "$root\backend"
if (-not (Test-Path "node_modules")) { npm install }
npx prisma db push --skip-generate 2>$null
npx prisma generate 2>$null
npm run db:seed

$apiRunning = $false
try {
    $null = Invoke-WebRequest -Uri "http://localhost:4000/health" -UseBasicParsing -TimeoutSec 2
    $apiRunning = $true
} catch {}

if (-not $apiRunning) {
    Write-Host "Starting API on port 4000..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; npm run dev"
} else {
    Write-Host "API already running on port 4000" -ForegroundColor Yellow
}

Set-Location "$root\frontend"
if (-not (Test-Path "node_modules")) { npm install }
if (-not (Test-Path ".env.local")) {
    Copy-Item ".env.local" -ErrorAction SilentlyContinue
    "NEXT_PUBLIC_API_URL=http://localhost:4000/api" | Out-File ".env.local" -Encoding utf8
}

Write-Host "Starting frontend..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\frontend'; npm run dev"

Write-Host ""
Write-Host "Demo ready!" -ForegroundColor Cyan
Write-Host "  Web:  http://localhost:3000 (or next free port)"
Write-Host "  API:  http://localhost:4000"
Write-Host "  Login: pharmacist@hc001.local / password123"
Write-Host "  Transfer code: TRF-DEMO01 (receive at Hillview / pharmacist@hc002.local)"
