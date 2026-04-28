# Acceso Remoto y Despliegue desde Laptop

## 1) Preparar el servidor (una sola vez)

### 1.1 Instalar y habilitar OpenSSH Server (Windows)

Ejecutar en PowerShell **como administrador** en el servidor:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
New-NetFirewallRule -Name sshd -DisplayName "OpenSSH Server (sshd)" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
```

### 1.2 Verificar herramientas necesarias

```powershell
git --version
node --version
npm --version
```

### 1.3 Probar conexion SSH desde tu laptop

```powershell
ssh TU_USUARIO@IP_DEL_SERVIDOR
```

## 2) Uso rapido del script de despliegue

Desde tu laptop:

```powershell
ssh TU_USUARIO@IP_DEL_SERVIDOR
cd C:\ruta\sistema-agua-municipal
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\deploy_from_github.ps1
```

Ese comando hace:

1. `git fetch + git pull --ff-only` en `main`.
2. `npm --prefix client run build`.
3. reinicio backend (`ops/stop_backend.ps1 -Force` + `ops/start_backend.ps1`).
4. verificacion de healthcheck en `http://127.0.0.1:5000/health`.

Nota:
- Ese flujo actualiza codigo, pero no aplica cambios de datos en PostgreSQL.
- Si quieres reflejar pagos abril 2026 en reportes del servidor, usa la opcion especial de abajo.

## 3) Opciones utiles del script

### Simular sin ejecutar (dry-run)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\deploy_from_github.ps1 -DryRun
```

### Incluir instalacion de dependencias

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\deploy_from_github.ps1 -InstallDependencies
```

### Desplegar y aplicar pagos abril 2026

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\deploy_from_github.ps1 `
  -ApplyApril2026Payments `
  -AprilExcelPath "C:\ruta\real\MARZO.xlsx"
```

Ese modo hace:

1. `git pull`.
2. `npm --prefix client run build`.
3. `node server\scripts\importar_pagos_abril_2026.js <excel> --apply`.
4. reinicio backend.

Usar cuando el servidor siga mostrando `0.00` en caja para `01/04/2026` o `06/04/2026` despues del pull.

### Omitir pull/build/restart (segun necesidad)

```powershell
# solo restart
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\deploy_from_github.ps1 -SkipPull -SkipBuild

# solo build
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\deploy_from_github.ps1 -SkipPull -SkipRestart
```

### Si hay cambios locales en el servidor y quieres continuar

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\deploy_from_github.ps1 -Force
```

## 4) Recuperar acceso completo por URL remota (no solo campo)

En `server/.env` del servidor:

```env
CAMPO_PUBLIC_ONLY=0
CORS_ALLOW_TRYCLOUDFLARE=1
```

Luego reinicia backend para aplicar cambios.
