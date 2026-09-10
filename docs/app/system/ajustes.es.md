# Ajustes

Abre **Ajustes** con el botón de engranaje al pie de la barra lateral. La página
agrupa preferencias de cuenta, comportamiento de la aplicación,
sincronización del servidor, respaldos e información de la instancia.

## Cuenta

### Perfil

Configura el nombre y el rol que aparecen al pie de la barra lateral. El
**token de API** se usa en este navegador como `Authorization: Bearer` para las
solicitudes protegidas. El servidor no devuelve el token. **Cerrar sesión** lo
elimina de este navegador; no borra datos del servidor.

### Asistente IA

Configura el proveedor que usa el Asistente. Según el proveedor, el formulario
puede incluir clave de API, URL base, modelo y credenciales opcionales. El
servidor puede resolver la configuración mediante LiteLLM, un endpoint
compatible con OpenAI, Ollama, opencode u otro proveedor compatible. Guardar
aplica la configuración de inmediato; quitar elimina la configuración guardada.

## Aplicación

### Apariencia

Elige modo oscuro, color de acento, tipografía y barra lateral amplia o
compacta. Estas preferencias se guardan en este navegador y se aplican de
inmediato.

### Idioma

Selecciona el idioma de la interfaz. Cambia etiquetas de menú, controles y
mensajes integrados; la documentación proporcionada por cada conector puede
tener una disponibilidad de traducción distinta.

### Navegación

Muestra u oculta enlaces de la barra lateral y cambia su orden. Los enlaces
siguen disponibles desde Ajustes aunque estén ocultos en la barra principal.
Los controles de grupo expanden o pliegan un grupo; mover un elemento cambia su
orden dentro de la aplicación.

### Vistas

Selecciona el diseño predeterminado de la lista de VMs: tabla, tarjetas o
cuadrícula compacta. Solo cambia la presentación; no modifica el inventario
guardado.

## Sistema

### Sincronización

La sincronización automática se ejecuta en el servidor, no en el navegador.
Puedes activarla o desactivarla y definir el intervalo rápido para la mayoría
de conectores o el intervalo lento para la sincronización pesada de vCenter.
Un conector puede definir su intervalo efectivo desde su panel de detalle.

### Respaldos

Exporta un respaldo cifrado `.lhq` con los datos principales, la configuración
de conectores y los ajustes de repositorios. La contraseña debe tener al menos
12 caracteres y Lintaya nunca la guarda. La contraseña maestra y la sesión de
Bitwarden no se exportan.

Restaurar reemplaza los datos actuales. Antes de restaurar, Lintaya crea un
punto de recuperación cifrado en el servidor y bloquea el vault. Escribe
`RESTAURAR` para confirmar el reemplazo irreversible y reinicia Lintaya después
de restaurar correctamente.

## Información

### Acerca de

Muestra la versión activa de Lintaya, la capacidad del protocolo remoto y la
información sobre conexiones remotas. Al probar una instancia remota, compara
su versión con la esperada antes de enviar cambios.

## Qué hace cada control

### Acciones de Perfil

- **Nombre** cambia el nombre y las iniciales del avatar que aparecen en la
  barra lateral.
- **Rol** cambia el texto que aparece debajo del nombre.
- **Cerrar sesión** borra el token de API de este navegador y recarga el acceso.
  No borra datos del servidor; tendrás que escribir el token otra vez.

### Detalles del Asistente IA

Los proveedores compatibles son **Anthropic (Claude)**, **OpenAI**,
**opencode**, **Ollama**, **OpenAI-compatible** y **LiteLLM proxy**. Anthropic
ofrece actualmente `claude-haiku-4-5` y `claude-sonnet-4-5`; OpenAI ofrece
`gpt-4o-mini` y `gpt-4o`. Ollama, opencode, LiteLLM y los endpoints compatibles
obtienen sus modelos del servidor: escribe una URL base y pulsa **Buscar
modelos**, o escribe manualmente el identificador.

Usa la clave de API correspondiente para Anthropic u OpenAI. Ollama usa por
defecto `http://127.0.0.1:11434/v1`; opencode normalmente usa
`http://127.0.0.1:4096` y puede requerir usuario/contraseña. LiteLLM y otros
servicios compatibles necesitan su propia URL base y credenciales. Las claves
guardadas se ocultan y nunca se devuelven al navegador. **Guardar** aplica la
selección; **Quitar** elimina la configuración guardada.

### Acciones de Apariencia, Navegación y Vistas

Puedes elegir Azul, Cian, Violeta, Naranja, Verde o Rojo; Geist, IBM Plex o
System UI; y una barra lateral amplia o compacta. Activa o desactiva cada
enlace, usa arriba/abajo para ordenarlo o pliega un grupo completo. Ocultar un
enlace no elimina su ruta ni sus datos. Para las VMs elige **Tabla**,
**Tarjetas** o **Cuadrícula**; solo cambia la presentación.

### Acciones de Sincronización

Usa **Activada** para pausar la sincronización programada sin impedir la manual.
El intervalo rápido acepta de 1 a 180 minutos y el intervalo lento de vCenter de
1 a 360 minutos. La pantalla muestra el intervalo efectivo de cada conector y
si tiene una excepción propia.

### Acciones de Respaldos

Para exportar, escribe una contraseña de al menos 12 caracteres y pulsa
**Descargar `.lhq`**. Para restaurar, selecciona el archivo `.lhq`, introduce su
contraseña, escribe `RESTAURAR` y pulsa **Restaurar datos**. Restaurar reemplaza
los datos actuales, crea primero un punto de recuperación y bloquea el vault;
trátalo como una operación destructiva.
