$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeDir = Join-Path $scriptDir "runtime"
$stateFile = Join-Path $runtimeDir "campo_remote_state.json"

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

if (!(Test-Path $stateFile)) {
  Write-Host "No hay sesion remota activa registrada."
  exit 0
}

try {
  $state = Get-Content -Path $stateFile -Raw | ConvertFrom-Json
} catch {
  Remove-Item -Path $stateFile -Force -ErrorAction SilentlyContinue
  Write-Host "Estado invalido detectado. Archivo limpiado."
  exit 0
}

$backendPid = [int]($state.backend_pid | ForEach-Object { $_ })
$tunnelPid = [int]($state.tunnel_pid | ForEach-Object { $_ })

Stop-Safe $tunnelPid
Stop-Safe $backendPid

Remove-Item -Path $stateFile -Force -ErrorAction SilentlyContinue

Write-Host "Sesion remota detenida."
