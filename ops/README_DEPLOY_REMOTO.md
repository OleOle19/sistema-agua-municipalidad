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

### 1.3 Probar conexión SSH desde tu laptop

```powershell
ssh TU_USUARIO@IP_DEL_SERVIDOR
```

## 2) Uso rápido del script de despliegue

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
4. verificación de healthcheck en `http://127.0.0.1:5000/health`.

## 3) Opciones útiles del script

### Simular sin ejecutar (dry-run)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\deploy_from_github.ps1 -DryRun
```

### Incluir instalación de dependencias

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\deploy_from_github.ps1 -InstallDependencies
```

### Omitir pull/build/restart (según necesidad)

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

