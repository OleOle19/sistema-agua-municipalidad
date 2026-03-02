$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeDir = Join-Path $scriptDir "runtime"
$stateFile = Join-Path $runtimeDir "campo_remote_state.json"

function Is-Running([int]$ProcessId) {
  if ($ProcessId -le 0) { return $false }
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function To-Bool($Value) {
  if ($Value -is [bool]) { return $Value }
  $text = ([string]$Value).Trim().ToLower()
  return $text -eq "1" -or $text -eq "true"
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
$backendManaged = To-Bool(($state.backend_managed | ForEach-Object { $_ }))

Stop-Safe $tunnelPid
if ($backendManaged) {
  Stop-Safe $backendPid
} else {
  Write-Host "Backend externo detectado; no se detendra."
}

Remove-Item -Path $stateFile -Force -ErrorAction SilentlyContinue

Write-Host "Sesion remota detenida."
