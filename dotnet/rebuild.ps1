param(
    [Parameter(Mandatory)][string]$AppName,
    [Parameter(Mandatory)][string]$ExePath,
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$FrontendDir,
    [Parameter(Mandatory)][string]$BuildTarget,
    [string]$PackageManager = "npm",
    [string[]]$ExtraKill = @(),
    [string[]]$LinkedPackages = @(),
    [switch]$SkipFrontend,
    [switch]$SkipBackend,
    [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"

# ── Stop ──
Write-Host "=== Stopping $AppName ===" -ForegroundColor Cyan
$procName = $AppName -replace '\.exe$',''
$procs = Get-Process -Name $procName -ErrorAction SilentlyContinue
if ($procs) {
    # Graceful close first (WPF OnExit runs, child processes cleaned up)
    $procs | ForEach-Object { $_.CloseMainWindow() | Out-Null }
    $graceful = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $graceful) {
        $alive = Get-Process -Name $procName -ErrorAction SilentlyContinue
        if (-not $alive) { break }
        Start-Sleep -Milliseconds 250
    }
    # Force-kill anything that survived
    Get-Process -Name $procName -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
}

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

# ── Build linked packages ──
if (-not $SkipFrontend -and $LinkedPackages.Count -gt 0) {
    $packagesRoot = "$PSScriptRoot\..\packages"
    foreach ($pkg in $LinkedPackages) {
        Write-Host "=== Building @redbamboo/$pkg ===" -ForegroundColor Cyan
        Push-Location "$packagesRoot\$pkg"
        try {
            $ErrorActionPreference = "Continue"
            # cmd /c "...2>&1" merges pnpm's stderr banner into stdout at the cmd.exe
            # level, so PowerShell 5.1 never wraps it as a red NativeCommandError.
            # Do NOT change to "& $PackageManager run build" -- that regresses (see a7a5586).
            cmd /c "$PackageManager run build 2>&1"
            $ErrorActionPreference = "Stop"
            if ($LASTEXITCODE -ne 0) { throw "Package @redbamboo/$pkg build failed" }
        } finally {
            $ErrorActionPreference = "Stop"
            Pop-Location
        }
    }
}

# ── Build frontend ──
if (-not $SkipFrontend) {
    Write-Host "=== Building frontend ===" -ForegroundColor Cyan
    Push-Location $FrontendDir
    try {
        $ErrorActionPreference = "Continue"
        # cmd /c "...2>&1" merges pnpm's stderr banner (e.g. "$ vite build" from the
        # "tsc -b && vite build" shell emulation) into stdout at the cmd.exe level, so
        # PowerShell 5.1 never wraps it as a red NativeCommandError. Exit code still
        # propagates, so real build failures are caught below.
        # Do NOT change to "& $PackageManager run build" -- that regresses (see a7a5586).
        cmd /c "$PackageManager run build 2>&1"
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
