# Instalar Lintaya

[English](SETUP.md) | Español

Esta guía inicia Lintaya en una computadora para desarrollo o un despliegue
privado por LAN/VPN. No despliega un servicio público multi-tenant. Lee
[SECURITY.es.md](SECURITY.es.md) antes de agregar credenciales reales.

## Requisitos previos

| Requisito | Por qué se necesita |
|---|---|
| Git | Obtener y actualizar el código fuente. |
| Node.js 22 o 24 | Ejecutar el servidor y CLI; Node 24 es preferido. |
| npm | Instalar las dependencias incluidas del servidor. |
| Docker (opcional) | Ejecutar un servicio Bitwarden autoalojado. |
| Acceso de red (opcional) | Llegar a sistemas configurados mediante conectores. |

En Windows, better-sqlite3 puede requerir Visual Studio Build Tools si no hay un
binario precompilado. Usa una versión LTS de Node.js soportada y ejecuta npm ci
antes de diagnosticar un problema de herramientas de compilación.

## Iniciar un servidor local de desarrollo

```powershell
git clone <repository-url> lintaya
Set-Location lintaya\server
npm ci
npm run check
npm run dev
```

Abre http://localhost:3000. Este comando inyecta valores locales de demostración.
Solo es apropiado para desarrollo y no debe usarse como configuración compartida
o de producción.

## Crear una configuración local

Copia el ejemplo sin hacer commit del archivo resultante:

```powershell
Copy-Item start-dev.example.js start-dev.js
```

Define LINTAYA_TOKEN como un valor robusto y único en start-dev.js, luego inicia el
servidor:

```powershell
node .\start-dev.js
```

En el navegador, ingresa ese token en Settings cuando se solicite. El
almacenamiento del navegador es por origen: http://localhost:3000 y
http://localhost:3001 lo solicitan una vez para el mismo token de servidor. El
endpoint sin autenticación GET /api/health sirve para comprobar que el servidor
está activo; las rutas API autenticadas requieren Authorization: Bearer
<LINTAYA_TOKEN>.

No hagas commit de start-dev.js, personal-hq.db, exportaciones de vault, archivos
de respaldo, tokens o claves privadas.

## Configurar secretos de conectores

La configuración de conectores usa LINTAYA_SECRET_STORE. Conserva secretos fuera
del repositorio en todos los modos.

| Modo | Uso | Requisito |
|---|---|---|
| legacy | Compatibilidad con datos locales existentes. | Los secretos permanecen en KV local del conector. |
| local | Cifrar localmente campos secretos de conectores. | Define un LINTAYA_SECRET_KEY robusto. |
| bitwarden | Guardar secretos de conectores en una Secure Note de Bitwarden. | Usa VAULT_MODE=bitwarden y desbloquea el vault. |

Para local, define ambos valores antes de iniciar el servidor:

```powershell
$env:LINTAYA_SECRET_STORE = "local"
$env:LINTAYA_SECRET_KEY = "<strong-secret-kept-outside-git>"
node .\start-dev.js
```

La primera lectura de una conexión existente puede migrar sus campos secretos al
almacén configurado. Eliminar una conexión también borra sus secretos almacenados.
Un vault Bitwarden bloqueado impide las operaciones que necesitan esos secretos
hasta que se desbloquea.

## Opcional: Bitwarden

Bitwarden es opcional. El ejemplo predeterminado se ejecuta con VAULT_MODE=demo;
todas las demás funciones locales se pueden desarrollar sin un vault.

Para un vault autoalojado, configura el directorio separado bitwarden/ con su
archivo de entorno de ejemplo y sigue la guía oficial de hosting de Bitwarden.
Luego define VAULT_MODE=bitwarden, BW_CLIENTID y BW_CLIENTSECRET en start-dev.js,
que está ignorado por Git. Nunca pongas esos valores en control de código fuente
o un issue público.

## Respaldar y mover una instancia local

Usa **Settings → Backups** para crear un respaldo cifrado .lhq y restaurarlo en
el servidor destino. El respaldo puede contener datos de Lintaya y valores de
conectores configurados, por lo que solo debe transferirse por un canal cifrado
confiable y conservar su contraseña por separado.

No copies manualmente una base SQLite activa, sus archivos -wal/-shm, ni un
volumen Bitwarden activo. Detén primero el servicio relevante o usa el proceso
lógico de exportar/importar del producto. Un respaldo .lhq no incluye una
contraseña maestra de Bitwarden, una sesión de vault desbloqueada, clones locales
de repositorios ni material de recuperación de cuentas de terceros.

## Verificar y solucionar problemas

```powershell
Invoke-WebRequest http://localhost:3000/api/health | Select-Object -Expand Content
Set-Location ..\cli
node bin/lintaya.js health --url http://localhost:3000
```

Si un conector no puede llegar a un proveedor, verifica su URL, credenciales,
acceso de red o VPN y estado en la app. Si una operación reporta vault-locked,
desbloquea Bitwarden en el módulo Passwords e inténtalo de nuevo. No pegues
tokens, hostnames privados ni respuestas completas de diagnóstico en issues
públicos.
