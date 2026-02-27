$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeDir = Join-Path $scriptDir "runtime"
$stateFile = Join-Path $runtimeDir "campo_remote_state.json"

function Is-Running([int]$ProcessId) {
  if ($ProcessId -le 0) { return $false }
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
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
$backendRunning = Is-Running $backendPid
$tunnelRunning = Is-Running $tunnelPid

Write-Host "URL Campo: $($state.campo_url)"
Write-Host "Backend PID: $backendPid (running=$backendRunning)"
Write-Host "Tunnel  PID: $tunnelPid (running=$tunnelRunning)"
Write-Host "Inicio: $($state.started_at)"
