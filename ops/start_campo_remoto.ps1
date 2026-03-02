param(
  [switch]$ForceRestart
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$runtimeDir = Join-Path $scriptDir "runtime"
$stateFile = Join-Path $runtimeDir "campo_remote_state.json"
$backendOutLog = Join-Path $runtimeDir "backend.out.log"
$backendErrLog = Join-Path $runtimeDir "backend.err.log"
$tunnelOutLog = Join-Path $runtimeDir "tunnel.out.log"
$tunnelErrLog = Join-Path $runtimeDir "tunnel.err.log"
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

$existing = Read-State
if ($existing -and !$ForceRestart) {
  $backendPid = [int]($existing.backend_pid | ForEach-Object { $_ })
  $tunnelPid = [int]($existing.tunnel_pid | ForEach-Object { $_ })
  $backendManaged = To-Bool(($existing.backend_managed | ForEach-Object { $_ }))
  $existingHealthUrl = [string]($existing.backend_health_url | ForEach-Object { $_ })
  if ([string]::IsNullOrWhiteSpace($existingHealthUrl)) { $existingHealthUrl = $backendHealthUrl }
  $backendRunning = if ($backendManaged) { Is-Running $backendPid } else { Test-BackendHealth $existingHealthUrl }
  if ($backendRunning -and (Is-Running $tunnelPid)) {
    Write-Host "Ya existe una sesion activa."
    Write-Host "URL Campo: $($existing.campo_url)"
    Write-Host "Usa stop_campo_remoto.ps1 para detenerla, o ejecuta con -ForceRestart."
    exit 0
  }
}

if ($existing) {
  $existingManaged = To-Bool(($existing.backend_managed | ForEach-Object { $_ }))
  if ($existingManaged) {
    Stop-Safe ([int]($existing.backend_pid | ForEach-Object { $_ }))
  }
  Stop-Safe ([int]($existing.tunnel_pid | ForEach-Object { $_ }))
  Remove-Item -Path $stateFile -Force -ErrorAction SilentlyContinue
}

Remove-Item -Path $backendOutLog, $backendErrLog, $tunnelOutLog, $tunnelErrLog -Force -ErrorAction SilentlyContinue

$npmCmd = Resolve-CommandPath "npm.cmd"
if ([string]::IsNullOrWhiteSpace($npmCmd)) {
  throw "No se encontro npm.cmd en PATH."
}

$cloudflaredCmd = Resolve-CommandPath "cloudflared.exe"
if ([string]::IsNullOrWhiteSpace($cloudflaredCmd)) {
  $cloudflaredCmd = Resolve-CommandPath "cloudflared"
}
if ([string]::IsNullOrWhiteSpace($cloudflaredCmd)) {
  throw "No se encontro cloudflared en PATH."
}

Write-Host "Iniciando backend..."
$backendProc = $null
$backendManaged = $false
if (Test-BackendHealth $backendHealthUrl) {
  Write-Host "Backend ya estaba activo en $backendHealthUrl. Se reutilizara."
} else {
  $backendProc = Start-Process -FilePath $npmCmd `
    -ArgumentList @("--prefix", "server", "start") `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $backendOutLog `
    -RedirectStandardError $backendErrLog `
    -WindowStyle Hidden `
    -PassThru
  $backendManaged = $true

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
}

Write-Host "Iniciando Quick Tunnel..."
$tunnelProc = Start-Process -FilePath $cloudflaredCmd `
  -ArgumentList @("tunnel", "--url", "http://127.0.0.1:5000", "--protocol", "http2", "--edge-ip-version", "4") `
  -WorkingDirectory $repoRoot `
  -RedirectStandardOutput $tunnelOutLog `
  -RedirectStandardError $tunnelErrLog `
  -WindowStyle Hidden `
  -PassThru

$baseUrl = $null
$tunnelRegistered = $false
$urlRegex = "https://[a-z0-9-]+\.trycloudflare\.com"
for ($i = 0; $i -lt 180; $i++) {
  Start-Sleep -Milliseconds 500
  if (!(Is-Running $tunnelProc.Id)) {
    if ($backendManaged -and $backendProc) { Stop-Safe $backendProc.Id }
    throw "cloudflared termino inesperadamente. Revisa logs: $tunnelOutLog / $tunnelErrLog"
  }
  $logFiles = @($tunnelOutLog, $tunnelErrLog) | Where-Object { Test-Path $_ }
  if ($logFiles.Count -gt 0) {
    $matches = Select-String -Path $logFiles -Pattern $urlRegex -AllMatches -ErrorAction SilentlyContinue
    if ($matches) {
      $last = $matches | Select-Object -Last 1
      if ($last.Matches.Count -gt 0) {
        $baseUrl = $last.Matches[0].Value
      }
    }
    if (!$tunnelRegistered) {
      $ready = Select-String -Path $logFiles -Pattern "Registered tunnel connection" -ErrorAction SilentlyContinue
      if ($ready) { $tunnelRegistered = $true }
    }
  }
  if (($i + 1) % 20 -eq 0) {
    if ([string]::IsNullOrWhiteSpace($baseUrl)) {
      Write-Host "Esperando URL publica del tunnel..."
    } elseif (-not $tunnelRegistered) {
      Write-Host "URL detectada. Esperando confirmacion de conexion con Cloudflare..."
    }
  }
  if (!([string]::IsNullOrWhiteSpace($baseUrl)) -and $tunnelRegistered) {
    break
  }
}
if ([string]::IsNullOrWhiteSpace($baseUrl)) {
  Stop-Safe $tunnelProc.Id
  if ($backendManaged -and $backendProc) { Stop-Safe $backendProc.Id }
  throw "No se detecto URL de Quick Tunnel. Revisa logs: $tunnelOutLog / $tunnelErrLog"
}
if (-not $tunnelRegistered) {
  Stop-Safe $tunnelProc.Id
  if ($backendManaged -and $backendProc) { Stop-Safe $backendProc.Id }
  throw "No se confirmo conexion del tunnel con Cloudflare. Revisa logs: $tunnelOutLog / $tunnelErrLog"
}

$campoUrl = "$($baseUrl.TrimEnd('/'))/campo-app/"
$state = [pscustomobject]@{
  started_at = (Get-Date).ToString("o")
  repo_root = "$repoRoot"
  backend_pid = if ($backendProc) { $backendProc.Id } else { 0 }
  backend_managed = $backendManaged
  backend_health_url = $backendHealthUrl
  tunnel_pid = $tunnelProc.Id
  base_url = $baseUrl
  campo_url = $campoUrl
  backend_out_log = $backendOutLog
  backend_err_log = $backendErrLog
  tunnel_out_log = $tunnelOutLog
  tunnel_err_log = $tunnelErrLog
}
$state | ConvertTo-Json -Depth 4 | Set-Content -Path $stateFile -Encoding UTF8

try { Set-Clipboard -Value $campoUrl } catch {}

Write-Host ""
Write-Host "Sesion remota iniciada."
Write-Host "URL Campo: $campoUrl"
Write-Host "La URL ya fue copiada al portapapeles."
Write-Host "Estado guardado en: $stateFile"
Write-Host ""
Write-Host "Para detener: .\ops\stop_campo_remoto.ps1"
