param(
  [string]$EnvPath = ""
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
if ([string]::IsNullOrWhiteSpace($EnvPath)) {
  $EnvPath = Join-Path $repoRoot "server\.env"
}
if (!(Test-Path -LiteralPath $EnvPath)) {
  throw "No existe $EnvPath. Copia server/.env.example y configura las bases de datos antes de desplegar."
}

$lines = [System.Collections.Generic.List[string]]::new()
Get-Content -LiteralPath $EnvPath | ForEach-Object { [void]$lines.Add([string]$_) }

function Get-EnvValue([string]$Name) {
  foreach ($line in $lines) {
    if ($line -match "^\s*$([regex]::Escape($Name))\s*=(.*)$") { return $Matches[1].Trim() }
  }
  return ""
}

function Set-EnvValue([string]$Name, [string]$Value) {
  for ($i = 0; $i -lt $lines.Count; $i += 1) {
    if ($lines[$i] -match "^\s*$([regex]::Escape($Name))\s*=") {
      $lines[$i] = "$Name=$Value"
      return
    }
  }
  [void]$lines.Add("$Name=$Value")
}

$jwtSecret = Get-EnvValue "JWT_SECRET"
$weakJwt = [string]::IsNullOrWhiteSpace($jwtSecret) `
  -or $jwtSecret.Length -lt 32 `
  -or $jwtSecret -match "(?i)CAMBIAR|cambia_esto|password|secret"
if ($weakJwt) {
  $bytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $jwtSecret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  Set-EnvValue "JWT_SECRET" $jwtSecret
  Write-Host "JWT_SECRET debil reemplazado por una clave criptografica (las sesiones anteriores quedaran cerradas)."
}

Set-EnvValue "NODE_ENV" "production"
Set-EnvValue "SECURITY_STRICT_STARTUP" "1"
if ((Get-EnvValue "CORS_ALLOW_TRYCLOUDFLARE") -eq "1") {
  Set-EnvValue "CAMPO_PUBLIC_ONLY" "1"
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines((Resolve-Path -LiteralPath $EnvPath), $lines, $utf8NoBom)
Write-Host "Configuracion segura validada en $EnvPath"
