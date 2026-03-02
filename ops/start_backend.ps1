$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$runtimeDir = Join-Path $scriptDir "runtime"
$stateFile = Join-Path $runtimeDir "backend_state.json"
$backendOutLog = Join-Path $runtimeDir "backend_manual.out.log"
$backendErrLog = Join-Path $runtimeDir "backend_manual.err.log"
$backendHealthUrl = "http://127.0.0.1:5000/health"

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

function Read-State {
  if (!(Test-Path $stateFile)) { return $null }
  try {
    return Get-Content -Path $stateFile -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Is-Running([int]$ProcessId) {
  if ($ProcessId -le 0) { return $false }
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Stop-Safe([int]$ProcessId) {
  if (!(Is-Running $ProcessId)) { return }
  try {
    Stop-Process -Id $ProcessId -Force -ErrorAction Stop
  } catch {}
}

function Test-BackendHealth([string]$Url) {
  try {
    $res = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $res.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Resolve-CommandPath([string]$Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $cmd) { return $null }
  return $cmd.Source
}

$state = Read-State
if ($state) {
  $existingPid = [int]($state.backend_pid | ForEach-Object { $_ })
  if (Is-Running $existingPid) {
    Write-Host "Backend ya esta iniciado (PID $existingPid)."
    Write-Host "Health: $backendHealthUrl"
    exit 0
  }
  Remove-Item -Path $stateFile -Force -ErrorAction SilentlyContinue
}

if (Test-BackendHealth $backendHealthUrl) {
  Write-Host "Backend ya esta activo en $backendHealthUrl (no gestionado por este script)."
  exit 0
}

Remove-Item -Path $backendOutLog, $backendErrLog -Force -ErrorAction SilentlyContinue

$npmCmd = Resolve-CommandPath "npm.cmd"
if ([string]::IsNullOrWhiteSpace($npmCmd)) {
  throw "No se encontro npm.cmd en PATH."
}

Write-Host "Iniciando backend..."
$backendProc = Start-Process -FilePath $npmCmd `
  -ArgumentList @("--prefix", "server", "start") `
  -WorkingDirectory $repoRoot `
  -RedirectStandardOutput $backendOutLog `
  -RedirectStandardError $backendErrLog `
  -WindowStyle Hidden `
  -PassThru

$backendReady = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  if (!(Is-Running $backendProc.Id)) {
    throw "Backend termino inesperadamente. Revisa logs: $backendOutLog / $backendErrLog"
  }
  if (Test-BackendHealth $backendHealthUrl) {
    $backendReady = $true
    break
  }
}

if (-not $backendReady) {
  Stop-Safe $backendProc.Id
  throw "Backend no quedo listo. Revisa logs: $backendOutLog / $backendErrLog"
}

$statePayload = [pscustomobject]@{
  started_at = (Get-Date).ToString("o")
  repo_root = "$repoRoot"
  backend_pid = $backendProc.Id
  backend_managed = $true
  backend_health_url = $backendHealthUrl
  backend_out_log = $backendOutLog
  backend_err_log = $backendErrLog
}
$statePayload | ConvertTo-Json -Depth 4 | Set-Content -Path $stateFile -Encoding UTF8

Write-Host "Backend iniciado correctamente."
Write-Host "PID: $($backendProc.Id)"
Write-Host "Health: $backendHealthUrl"
Write-Host "Logs: $backendOutLog / $backendErrLog"
