# Devices

[English](introduccion.md) | Español

Devices es el inventario de equipos de red del core de Lintaya. Puedes registrar
equipos manualmente sin configurar un conector de inventario.

## Registrar y administrar equipos

Guarda nombre, tipo y dirección de gestión; completa fabricante, modelo,
sistema operativo, ubicación, número de serie, etiquetas y notas. Configura
también usuario y puerto SSH. Puedes editar y eliminar los equipos guardados.
El estado del inventario no equivale al estado de una sesión SSH ni confirma
que el equipo esté respondiendo en tiempo real.

## Agregar un dispositivo paso a paso

1. Abre **Devices** y pulsa el botón para agregar un dispositivo.
2. Completa **Hostname / Name**, selecciona **Device type** y escribe **Management IP**.
3. Revisa **SSH User** y **SSH Port** antes de conectar.
4. Si usarás Bitwarden, selecciona el elemento en **SSH Credential (from vault, optional)**. También puedes dejarlo vacío.
5. Completa ubicación, número de serie y etiquetas si los necesitas, y guarda.
6. Abre SSH desde el equipo guardado para iniciar la conexión.

| Campo | Obligatorio | Qué escribir |
|---|---|---|
| Hostname / Name | Sí | Nombre para identificar el equipo, por ejemplo `switch-oficina`. No reemplaza la dirección de gestión. |
| Device type | Sí | Selecciona el tipo de equipo del listado. |
| Management IP | Sí | Dirección a la que se conectará Lintaya, por ejemplo `10.0.0.25`. El formulario acepta texto: si usas un nombre DNS, debe resolverse desde el servidor de Lintaya. |
| SSH User | Tiene valor predeterminado | Usuario del equipo remoto; por defecto `admin`. |
| SSH Port | Tiene valor predeterminado | Por defecto `22`; usa el puerto real del servicio SSH, entre 1 y 65535. |
| SSH Credential | No | Elemento del vault cuya contraseña se usará para conectar. |
| Location, Serial Number, Tags | No | Datos de inventario; separa las etiquetas con comas. |

**Nombre y dirección son dos campos distintos.** Puedes llamar al equipo
`switch-oficina` y conectarte a `10.0.0.25`. No escribas una URL como
`https://10.0.0.25` en Management IP ni agregues el puerto allí: tiene su propio campo.

## Contraseña manual o Bitwarden

**Sin Bitwarden:** deja SSH Credential sin seleccionar. Al conectar, la terminal
solicitará la contraseña. No hay un campo de contraseña en el formulario de alta;
puedes guardar el inventario sin una credencial y conectar después.

**Con Bitwarden:** configura su conexión en Connectors, desbloquea el vault y
comprueba que el elemento de contraseña esté disponible en Passwords. Después
selecciónalo en SSH Credential al crear el dispositivo, o usa la asociación de
credencial del dispositivo ya guardado. Lintaya guarda la referencia al elemento
y recupera su contraseña cuando conecta.

El **SSH User del dispositivo sigue siendo el usuario de conexión**, aunque el
elemento de Bitwarden muestre otro usuario. Por ejemplo: nombre
`switch-oficina`, IP `10.0.0.25`, usuario `operador`, puerto `22` y elemento
`Switch oficina` del vault. La contraseña sale de ese elemento, pero el acceso
se intenta como `operador`.

Si el selector está vacío, revisa que haya credenciales disponibles en el vault.
Si no conecta, comprueba acceso de red/VPN, dirección, puerto, usuario y contraseña;
si usas Bitwarden, comprueba también que esté desbloqueado.

## Acceso SSH

Abre SSH desde el equipo. La conexión necesita acceso de red y credenciales
válidas. Puedes asociar un elemento del vault; leer su contraseña requiere que
el vault esté configurado y desbloqueado.

Puedes mantener varias sesiones y verlas en pestañas o en cuadrícula. Los
indicadores de conexión, la reconexión, la copia de salida y el envío de un
comando a varias sesiones se explican en [SSH](../ssh/introduccion.es.md), dentro
del mismo apartado Lintaya.

## Dónde está implementado

- `app/devices.jsx`: inventario, edición y asociación de credenciales.
- `server/routes/devices.js`: API y persistencia del inventario y del mapa al vault.
- `app/vms.jsx`: componentes compartidos de terminal y espacio de sesiones SSH.
- `server/routes/ssh.js`: sesiones SSH del servidor.
- `app/app.jsx`: navegación e indicadores de las sesiones en la barra lateral.

Aunque los componentes SSH compartidos estén en `vms.jsx`, también se usan para
Devices. Esa ubicación del código no convierte Devices en un conector VMware.
