[CmdletBinding()]
param(
  [switch]$Force,
  [int]$Port = 5000,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ExtraArgs
)

$ErrorActionPreference = "Stop"

if ($ExtraArgs) {
  if ($ExtraArgs -contains "--force") {
    $Force = $true
  }
  foreach ($arg in $ExtraArgs) {
    if ($arg -match "^--port=(\d+)$") {
      $parsedPort = [int]$Matches[1]
      if ($parsedPort -gt 0 -and $parsedPort -lt 65536) {
        $Port = $parsedPort
      }
    }
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeDir = Join-Path $scriptDir "runtime"
$stateFile = Join-Path $runtimeDir "backend_state.json"
$backendHealthUrl = "http://127.0.0.1:$Port/health"

function Is-Running([int]$ProcessId) {
  if ($ProcessId -le 0) { return $false }
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Stop-Safe([int]$ProcessId) {
  if (!(Is-Running $ProcessId)) { return $false }
  try {
    Stop-Process -Id $ProcessId -Force -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

function Test-BackendHealth([string]$Url) {
  try {
    $res = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $res.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-ListeningPidsByPort([int]$LocalPort) {
  try {
    $items = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction Stop
    return @($items | Select-Object -ExpandProperty OwningProcess -Unique)
  } catch {
    return @()
  }
}

function Stop-ByPort([int]$LocalPort) {
  $pids = Get-ListeningPidsByPort -LocalPort $LocalPort
  if ($pids.Count -eq 0) {
    Write-Host "No se encontro proceso escuchando en puerto $LocalPort."
    return 0
  }
  $stopped = 0
  foreach ($pid in $pids) {
    if (Stop-Safe ([int]$pid)) {
      Write-Host "Backend detenido por puerto $LocalPort (PID $pid)."
      $stopped += 1
    }
  }
  if ($stopped -eq 0) {
    Write-Host "No se pudo detener ningun proceso por puerto $LocalPort."
  }
  return $stopped
}

if (!(Test-Path $stateFile)) {
  if (Test-BackendHealth $backendHealthUrl) {
    if ($Force) {
      $killed = Stop-ByPort -LocalPort $Port
      if ($killed -eq 0) {
        Write-Host "Backend responde en $backendHealthUrl, pero no se pudo detener en modo --force."
      }
    } else {
      Write-Host "Backend responde en $backendHealthUrl, pero no esta gestionado por este script."
      Write-Host "Usa --force para cerrar por puerto."
    }
  } else {
    Write-Host "No hay backend gestionado activo."
  }
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
$stopped = Stop-Safe $backendPid
Remove-Item -Path $stateFile -Force -ErrorAction SilentlyContinue

if ($stopped) {
  Write-Host "Backend detenido (PID $backendPid)."
} else {
  if ($Force) {
    $killed = Stop-ByPort -LocalPort $Port
    if ($killed -eq 0) {
      Write-Host "No se encontro proceso activo para el PID registrado ($backendPid)."
    }
  } else {
    Write-Host "No se encontro proceso activo para el PID registrado ($backendPid)."
  }
}
