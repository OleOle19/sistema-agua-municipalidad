$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeDir = Join-Path $scriptDir "runtime"
$stateFile = Join-Path $runtimeDir "campo_remote_state.json"
$defaultHealthUrl = "http://127.0.0.1:5000/health"

function Is-Running([int]$ProcessId) {
  if ($ProcessId -le 0) { return $false }
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function To-Bool($Value) {
  if ($Value -is [bool]) { return $Value }
  $text = ([string]$Value).Trim().ToLower()
  return $text -eq "1" -or $text -eq "true"
}

function Test-BackendHealth([string]$Url) {
  try {
    $res = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $res.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (!(Test-Path $stateFile)) {
  Write-Host "Sin sesion remota activa."
  exit 0
}

try {
  $state = Get-Content -Path $stateFile -Raw | ConvertFrom-Json
} catch {
  Write-Host "Estado invalido."
  exit 1
}

$backendPid = [int]($state.backend_pid | ForEach-Object { $_ })
$tunnelPid = [int]($state.tunnel_pid | ForEach-Object { $_ })
$backendManaged = To-Bool(($state.backend_managed | ForEach-Object { $_ }))
$healthUrl = [string]($state.backend_health_url | ForEach-Object { $_ })
if ([string]::IsNullOrWhiteSpace($healthUrl)) { $healthUrl = $defaultHealthUrl }
$backendRunning = if ($backendManaged) { Is-Running $backendPid } else { Test-BackendHealth $healthUrl }
$tunnelRunning = Is-Running $tunnelPid

Write-Host "URL Campo: $($state.campo_url)"
if ($backendManaged) {
  Write-Host "Backend PID: $backendPid (running=$backendRunning, managed=true)"
} else {
  Write-Host "Backend PID: externo (running=$backendRunning, managed=false, health=$healthUrl)"
}
Write-Host "Tunnel  PID: $tunnelPid (running=$tunnelRunning)"
Write-Host "Inicio: $($state.started_at)"
