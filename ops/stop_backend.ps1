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

function Get-ProcessNameSafe([int]$ProcessId) {
  if ($ProcessId -le 0) { return "" }
  try {
    return String((Get-Process -Id $ProcessId -ErrorAction Stop).ProcessName)
  } catch {
    return ""
  }
}

function Is-BackendProcessCandidate([int]$ProcessId) {
  $name = (Get-ProcessNameSafe $ProcessId).ToLowerInvariant()
  return @("node", "npm", "powershell", "pwsh", "cmd") -contains $name
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
  foreach ($procId in $pids) {
    if (Stop-Safe ([int]$procId)) {
      Write-Host "Backend detenido por puerto $LocalPort (PID $procId)."
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
$backendManagerPid = [int]($state.backend_manager_pid | ForEach-Object { $_ })
$statePort = [int]($state.backend_port | ForEach-Object { $_ })
if ($statePort -gt 0 -and $statePort -lt 65536) {
  $Port = $statePort
}

$stopped = $false
if ((Is-Running $backendPid) -and (Is-BackendProcessCandidate $backendPid)) {
  $stopped = Stop-Safe $backendPid
}
if (-not $stopped -and $backendManagerPid -gt 0 -and $backendManagerPid -ne $backendPid -and (Is-Running $backendManagerPid) -and (Is-BackendProcessCandidate $backendManagerPid)) {
  $stopped = Stop-Safe $backendManagerPid
}
Remove-Item -Path $stateFile -Force -ErrorAction SilentlyContinue

if ($stopped) {
  if ($backendManagerPid -gt 0 -and $backendManagerPid -ne $backendPid) {
    Write-Host "Backend detenido (PID backend $backendPid | PID manager $backendManagerPid)."
  } else {
    Write-Host "Backend detenido (PID $backendPid)."
  }
} else {
  if ($Force) {
    $killed = Stop-ByPort -LocalPort $Port
    if ($killed -eq 0) {
      if ($backendManagerPid -gt 0 -and $backendManagerPid -ne $backendPid) {
        Write-Host "No se encontro proceso activo para los PID registrados ($backendPid, $backendManagerPid)."
      } else {
        Write-Host "No se encontro proceso activo para el PID registrado ($backendPid)."
      }
    }
  } else {
    if ($backendManagerPid -gt 0 -and $backendManagerPid -ne $backendPid) {
      Write-Host "No se encontro proceso activo para los PID registrados ($backendPid, $backendManagerPid)."
    } else {
      Write-Host "No se encontro proceso activo para el PID registrado ($backendPid)."
    }
  }
}
