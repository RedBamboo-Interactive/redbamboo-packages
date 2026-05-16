param(
    [Parameter(Mandatory)][string]$AppName,
    [Parameter(Mandatory)][string]$ExePath,
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$FrontendDir,
    [Parameter(Mandatory)][string]$BuildTarget,
    [string]$PackageManager = "npm",
    [string[]]$ExtraKill = @(),
    [switch]$SkipFrontend,
    [switch]$SkipBackend,
    [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"

# ── Stop ──
Write-Host "=== Stopping $AppName ===" -ForegroundColor Cyan
Get-Process -Name ($AppName -replace '\.exe$','') -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

foreach ($extra in $ExtraKill) {
    Invoke-Expression $extra 2>$null
}

# Wait for port to free up
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $listener) { break }
    Start-Sleep -Milliseconds 500
}

# ── Build frontend ──
if (-not $SkipFrontend) {
    Write-Host "=== Building frontend ===" -ForegroundColor Cyan
    Push-Location $FrontendDir
    try {
        $ErrorActionPreference = "Continue"
        Invoke-Expression "$PackageManager run build"
        $ErrorActionPreference = "Stop"
        if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
    } finally {
        $ErrorActionPreference = "Stop"
        Pop-Location
    }
}

# ── Build backend ──
if (-not $SkipBackend) {
    Write-Host "=== Building backend ===" -ForegroundColor Cyan
    & dotnet build $BuildTarget -c Release
    if ($LASTEXITCODE -ne 0) { throw "Backend build failed" }
}

# ── Launch ──
if (-not $NoLaunch) {
    Write-Host "=== Starting $AppName ===" -ForegroundColor Cyan
    Start-Process $ExePath
    Write-Host "=== Done ===" -ForegroundColor Green
}
