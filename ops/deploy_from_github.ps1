[CmdletBinding()]
param(
  [string]$Branch = "main",
  [string]$Remote = "origin",
  [switch]$SkipPull,
  [switch]$SkipBuild,
  [switch]$SkipRestart,
  [switch]$InstallDependencies,
  [switch]$Force,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$startBackendScript = Join-Path $scriptDir "start_backend.ps1"
$stopBackendScript = Join-Path $scriptDir "stop_backend.ps1"
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
    [string[]]$Args
  )
  & $Cmd @Args
  if ($LASTEXITCODE -ne 0) {
    $argText = ($Args -join " ")
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
      Invoke-OrFail -Cmd "git" -Args @("fetch", $Remote, $Branch)
      Invoke-OrFail -Cmd "git" -Args @("pull", "--ff-only", $Remote, $Branch)
    }
  } else {
    Write-Host ">> Omitiendo git pull por -SkipPull."
  }

  if ($InstallDependencies) {
    Run-OrFail "Instalando dependencias backend" {
      Invoke-OrFail -Cmd "npm" -Args @("--prefix", "server", "install", "--no-audit", "--no-fund")
    }
    Run-OrFail "Instalando dependencias frontend" {
      Invoke-OrFail -Cmd "npm" -Args @("--prefix", "client", "install", "--no-audit", "--no-fund")
    }
  } else {
    Write-Host ">> Omitiendo instalacion de dependencias (usa -InstallDependencies para incluirla)."
  }

  if (-not $SkipBuild) {
    Run-OrFail "Build frontend" {
      Invoke-OrFail -Cmd "npm" -Args @("--prefix", "client", "run", "build")
    }
  } else {
    Write-Host ">> Omitiendo build por -SkipBuild."
  }

  if (-not $SkipRestart) {
    if (!(Test-Path $stopBackendScript)) {
      throw "No se encontro script: $stopBackendScript"
    }
    if (!(Test-Path $startBackendScript)) {
      throw "No se encontro script: $startBackendScript"
    }
    Run-OrFail "Deteniendo backend" {
      Invoke-OrFail -Cmd "powershell" -Args @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $stopBackendScript, "-Force")
    }
    Run-OrFail "Iniciando backend" {
      Invoke-OrFail -Cmd "powershell" -Args @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $startBackendScript)
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

