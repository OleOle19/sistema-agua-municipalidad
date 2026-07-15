[CmdletBinding()]
param(
  [string]$Branch = "main",
  [string]$Remote = "origin",
  [switch]$SkipPull,
  [switch]$SkipBuild,
  [switch]$SkipRestart,
  [switch]$InstallDependencies,
  [switch]$ApplyApril2026Payments,
  [string]$AprilExcelPath = "",
  [switch]$ApplyPagosActaTxt,
  [string]$PagosActaTxtPath = "",
  [string]$PagosActaMaxPeriod = "2026-04",
  [string]$PagosActaIgnorePeriod = "",
  [switch]$Force,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$startBackendScript = Join-Path $scriptDir "start_backend.ps1"
$stopBackendScript = Join-Path $scriptDir "stop_backend.ps1"
$securityConfigScript = Join-Path $scriptDir "ensure_security_config.ps1"
$aprilImportScript = Join-Path $repoRoot "server\scripts\importar_pagos_abril_2026.js"
$pagosActaImportScript = Join-Path $repoRoot "server\scripts\importar_pagos_acta_txt.js"
$healthUrl = "http://127.0.0.1:5000/health"

function Run-OrFail {
  param(
    [string]$Label,
    [scriptblock]$Action
  )
  Write-Host ">> $Label"
  if ($DryRun) {
    Write-Host "   (dry-run)"
    return
  }
  & $Action
}

function Invoke-OrFail {
  param(
    [string]$Cmd,
    [string[]]$CommandArgs
  )
  & $Cmd @CommandArgs
  if ($LASTEXITCODE -ne 0) {
    $argText = ($CommandArgs -join " ")
    throw "Fallo comando: $Cmd $argText"
  }
}

function Wait-BackendHealth {
  param(
    [string]$Url,
    [int]$Retries = 20
  )
  for ($i = 0; $i -lt $Retries; $i++) {
    try {
      $res = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($res.StatusCode -eq 200) {
        return $true
      }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  return $false
}

Push-Location $repoRoot
try {
  if ($ApplyApril2026Payments -and $ApplyPagosActaTxt) {
    throw "Usa solo una importacion especial por despliegue: abril o PAGOSACTA.TXT."
  }

  if ($ApplyApril2026Payments) {
    if ([string]::IsNullOrWhiteSpace($AprilExcelPath)) {
      throw "Debe indicar -AprilExcelPath cuando usa -ApplyApril2026Payments."
    }
    if (!(Test-Path $aprilImportScript)) {
      throw "No se encontro script de importacion abril: $aprilImportScript"
    }
    if (!(Test-Path $AprilExcelPath)) {
      throw "No se encontro archivo Excel indicado: $AprilExcelPath"
    }
  }

  if ($ApplyPagosActaTxt) {
    if ([string]::IsNullOrWhiteSpace($PagosActaTxtPath)) {
      throw "Debe indicar -PagosActaTxtPath cuando usa -ApplyPagosActaTxt."
    }
    if (!(Test-Path $pagosActaImportScript)) {
      throw "No se encontro script de importacion PAGOSACTA: $pagosActaImportScript"
    }
    if (!(Test-Path $PagosActaTxtPath)) {
      throw "No se encontro TXT indicado: $PagosActaTxtPath"
    }
  }

  if (-not $SkipPull) {
    $status = (& git status --porcelain)
    if ($LASTEXITCODE -ne 0) {
      throw "No se pudo consultar git status."
    }
    if ($status -and -not $Force) {
      throw "Hay cambios locales sin commit. Confirma/stash antes de desplegar o usa -Force."
    }
    if ($status -and $Force) {
      Write-Warning "Se detectaron cambios locales. Se continuara por -Force."
    }

    $currentBranch = ((& git rev-parse --abbrev-ref HEAD) | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
      throw "No se pudo obtener rama actual."
    }
    if ($currentBranch -ne $Branch -and -not $Force) {
      throw "Rama actual '$currentBranch' distinta de '$Branch'. Cambia de rama o usa -Force."
    }
    if ($currentBranch -ne $Branch -and $Force) {
      Write-Warning "Rama actual '$currentBranch' distinta de '$Branch'. Se continuara por -Force."
    }

    Run-OrFail "Git fetch/pull ($Remote/$Branch)" {
      Invoke-OrFail -Cmd "git" -CommandArgs @("fetch", $Remote, $Branch)
      Invoke-OrFail -Cmd "git" -CommandArgs @("pull", "--ff-only", $Remote, $Branch)
    }
  } else {
    Write-Host ">> Omitiendo git pull por -SkipPull."
  }

  if ($InstallDependencies) {
    Run-OrFail "Instalando dependencias backend" {
      Invoke-OrFail -Cmd "npm" -CommandArgs @("--prefix", "server", "install", "--no-audit", "--no-fund")
    }
    Run-OrFail "Instalando dependencias frontend" {
      Invoke-OrFail -Cmd "npm" -CommandArgs @("--prefix", "client", "install", "--no-audit", "--no-fund")
    }
  } else {
    Write-Host ">> Omitiendo instalacion de dependencias (usa -InstallDependencies para incluirla)."
  }

  Run-OrFail "Validando configuracion segura" {
    & $securityConfigScript
    if ($LASTEXITCODE -ne 0) { throw "No se pudo asegurar server/.env." }
  }

  Run-OrFail "Aplicando migraciones de Agua" {
    Invoke-OrFail -Cmd "npm" -CommandArgs @("--prefix", "server", "run", "migrate")
  }
  Run-OrFail "Aplicando migraciones de Luz" {
    Invoke-OrFail -Cmd "npm" -CommandArgs @("--prefix", "server", "run", "migrate:luz")
  }

  if (-not $SkipBuild) {
    Run-OrFail "Build frontend" {
      Invoke-OrFail -Cmd "npm" -CommandArgs @("--prefix", "client", "run", "build")
    }
  } else {
    Write-Host ">> Omitiendo build por -SkipBuild."
  }

  if ($ApplyApril2026Payments) {
    $resolvedAprilExcelPath = (Resolve-Path $AprilExcelPath).Path
    Run-OrFail "Aplicando importacion abril 2026" {
      Invoke-OrFail -Cmd "node" -CommandArgs @($aprilImportScript, $resolvedAprilExcelPath, "--apply")
    }
  } else {
    Write-Host ">> Omitiendo importacion abril 2026."
  }

  if ($ApplyPagosActaTxt) {
    $resolvedPagosActaTxtPath = (Resolve-Path $PagosActaTxtPath).Path
    $pagosActaArgs = @($pagosActaImportScript, $resolvedPagosActaTxtPath, "--apply")
    if (-not [string]::IsNullOrWhiteSpace($PagosActaMaxPeriod)) {
      $pagosActaArgs += "--max-period=$PagosActaMaxPeriod"
    }
    if (-not [string]::IsNullOrWhiteSpace($PagosActaIgnorePeriod)) {
      $pagosActaArgs += "--ignore-period=$PagosActaIgnorePeriod"
    }
    Run-OrFail "Aplicando importacion PAGOSACTA.TXT" {
      Invoke-OrFail -Cmd "node" -CommandArgs $pagosActaArgs
    }
  } else {
    Write-Host ">> Omitiendo importacion PAGOSACTA.TXT."
  }

  if (-not $SkipRestart) {
    if (!(Test-Path $stopBackendScript)) {
      throw "No se encontro script: $stopBackendScript"
    }
    if (!(Test-Path $startBackendScript)) {
      throw "No se encontro script: $startBackendScript"
    }
    Run-OrFail "Deteniendo backend" {
      Invoke-OrFail -Cmd "powershell" -CommandArgs @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $stopBackendScript, "-Force")
    }
    Run-OrFail "Iniciando backend" {
      Invoke-OrFail -Cmd "powershell" -CommandArgs @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $startBackendScript)
    }
    Run-OrFail "Verificando healthcheck backend" {
      $ok = Wait-BackendHealth -Url $healthUrl -Retries 24
      if (-not $ok) {
        throw "Backend no respondio OK en $healthUrl"
      }
    }
  } else {
    Write-Host ">> Omitiendo reinicio por -SkipRestart."
  }

  Write-Host ""
  Write-Host "Despliegue finalizado correctamente."
  Write-Host "Repositorio: $repoRoot"
  Write-Host "Rama objetivo: $Branch"
  if (-not $SkipRestart) {
    Write-Host "Health: $healthUrl"
  }
} finally {
  Pop-Location
}
