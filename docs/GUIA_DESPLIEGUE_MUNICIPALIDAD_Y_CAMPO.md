# Guia de despliegue: Municipalidad + Campo

## 1) Objetivo

Esta guia deja un flujo simple para operacion municipal:

- Oficina usa el sistema en la red local.
- Brigadas usan `campo-app` en LAN y modo offline.
- Cuando se necesita acceso externo temporal, se usa Quick Tunnel.

## 2) Como esta montado el sistema

- Backend/API: `server/index.js` (Node + Express).
- Frontend oficina: servido por el backend desde `client/dist`.
- App campo: servida por el backend desde `campo-app/`.
- Todo sale por el mismo servidor (mismo proceso Node).

## 3) Requisitos de la PC principal

- Windows 10/11.
- Node.js LTS (20+ recomendado).
- PostgreSQL operativo.
- Git.
- Usuario con permisos para firewall/tareas programadas.

## 4) Instalacion inicial (una sola vez)

### 4.1 Clonar

```powershell
cd C:\Sistemas
git clone <URL_DEL_REPO> sistema-agua-municipal
cd sistema-agua-municipal
```

### 4.2 Instalar dependencias

```powershell
npm --prefix server ci
npm --prefix client ci
```

### 4.3 Configurar `server/.env` (minimo recomendado)

Primero copiar plantilla:

```powershell
Copy-Item server/.env.example server/.env
```

Luego ajustar valores:

```env
DB_USER=postgres
DB_PASSWORD=CAMBIAR_ESTA_CLAVE
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=db_agua_pueblonuevo

JWT_SECRET=CAMBIAR_ESTA_CLAVE_LARGA
JWT_EXPIRES_IN=30d
AUTH_OPTIONAL_DEV=0

SERVER_HOST=0.0.0.0
SERVER_PORT=5000

# Permitir quick tunnels temporales
CORS_ALLOW_TRYCLOUDFLARE=1
CAMPO_PUBLIC_ONLY=1
CAMPO_PUBLIC_HOST_PATTERN=\.trycloudflare\.com$

# Agregar origenes propios si aplica
# CORS_ALLOWED_ORIGINS=http://192.168.1.50:5000,https://agua-campo.tudominio.com
```

### 4.4 Compilar frontend de oficina

```powershell
npm --prefix client run build
```

### 4.5 Levantar backend

```powershell
npm --prefix server start
```

Prueba minima:

```powershell
Invoke-WebRequest http://127.0.0.1:5000/health
```

## 5) Uso en red municipal (LAN)

### 5.1 Abrir firewall (puerto 5000, perfil privado)

```powershell
netsh advfirewall firewall add rule name="Sistema Agua Municipal 5000" dir=in action=allow protocol=TCP localport=5000 profile=private
```

### 5.2 URLs internas

- Oficina: `http://IP_SERVIDOR:5000/`
- Campo: `http://IP_SERVIDOR:5000/campo-app/`

Nota: no usar `localhost` desde otros equipos/moviles.

## 6) Acceso remoto temporal para brigadas (Quick Tunnel)

Se agregaron accesos directos `.bat` en la raiz del proyecto para no escribir comandos:

- `INICIAR_CAMPO_REMOTO.bat`
- `ESTADO_CAMPO_REMOTO.bat`
- `DETENER_CAMPO_REMOTO.bat`

### Flujo recomendado

1. Ejecutar `INICIAR_CAMPO_REMOTO.bat`.
2. Tomar la URL `https://xxxx.trycloudflare.com/campo-app/` que muestra el script.
3. Compartir esa URL a la brigada.
4. Ejecutar `ESTADO_CAMPO_REMOTO.bat` para verificar estado.
5. Ejecutar `DETENER_CAMPO_REMOTO.bat` al cerrar jornada.

Si hay error, revisar:

- `ops/runtime/tunnel.out.log`
- `ops/runtime/tunnel.err.log`
- `ops/runtime/backend.out.log`
- `ops/runtime/backend.err.log`

## 7) Acceso remoto estable con dominio (opcional)

Si quieren URL fija (sin cambio diario), configurar HTTPS con dominio propio:

- Abrir puerto 443 en router/firewall.
- Configurar `HTTPS_ENABLED=1`, `HTTPS_PORT=443`, `HTTPS_KEY_FILE`, `HTTPS_CERT_FILE`.
- Publicar `https://TU_DOMINIO/campo-app/`.

## 8) Pregunta clave: "Hay que desplegar frontend aparte?"

No, no hace falta desplegar frontend como servicio separado.

- El backend ya sirve:
  - `client/dist` para oficina.
  - `campo-app/` para brigadas.
- Solo debes ejecutar `npm --prefix client run build` cuando cambies codigo de `client`.
- `campo-app` no requiere `build` adicional en su estado actual (archivos estaticos).

## 9) Checklist corto de puesta en marcha

1. Base de datos operativa.
2. `server/.env` correcto (`AUTH_OPTIONAL_DEV=0`, `SERVER_HOST=0.0.0.0`).
3. `npm --prefix client run build` (solo cuando cambia `client`).
4. `npm --prefix server start`.
5. Probar LAN: `/` y `/campo-app/`.
6. Si hay salida remota temporal: ejecutar `INICIAR_CAMPO_REMOTO.bat`.

## 10) Backup (obligatorio)

- Backup diario automatico con `pg_dump`.
- Retencion sugerida: 30 diarios + 12 mensuales.
- Restauracion de prueba al menos 1 vez por mes.
