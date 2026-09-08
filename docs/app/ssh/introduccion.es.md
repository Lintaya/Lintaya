# SSH

[English](introduccion.md) | Español

Lintaya abre terminales SSH interactivas en el navegador y las mantiene
corriendo en el servidor. La terminal que ves es un cliente conectado a una
sesión que el servidor posee, no una conexión hecha por el navegador, así que
cerrar una pestaña no termina el trabajo que ocurre del otro lado.

## Abrir una sesión

SSH no es una entrada propia de la barra lateral. Una sesión se abre desde
aquello que estés mirando, y el espacio de trabajo aparece en cuanto existe la
primera:

| Se abre desde | Qué conecta |
|---|---|
| VMs | La máquina virtual, con la credencial mapeada a ella. |
| Dispositivos | El dispositivo, por su dirección de gestión. |
| Contenedores | La VM anfitriona del contenedor, y luego `docker exec` dentro de él. |

Cada sesión abierta se lista en la barra lateral bajo el módulo desde el que se
abrió, de modo que una terminal iniciada desde Contenedores queda visualmente
asociada a Contenedores. Seleccionar una enfoca su terminal en el espacio de
trabajo.

## Varias sesiones a la vez

Las sesiones son concurrentes por diseño. Puedes mantener terminales a máquinas
distintas al mismo tiempo y alternar entre ellas sin que ninguna se desconecte.

Dos reglas distintas evitan que eso se convierta en duplicados:

- **En la interfaz**, una máquina que ya tienes abierta no se abre dos veces.
  Pedirla otra vez enfoca la terminal existente.
- **En el servidor**, una petición para un host y usuario que ya tiene sesión
  viva se reconecta a ella en lugar de marcar una segunda. La respuesta lo dice
  explícitamente, y ambos clientes ven entonces la misma salida.

Esa segunda regla es la que permite observar la misma sesión desde más de un
lugar: otro navegador, o el mismo tras recargar. El servidor guarda los últimos
64 KB de salida y se los reproduce al cliente que se conecta tarde, así que una
terminal reconectada no aparece en blanco.

Una sesión sin clientes conectados sigue viva diez minutos y luego se cierra
sola. Recargar la página o perder la red un momento no te cuesta la sesión.

## De dónde sale la contraseña

No se te pide escribir una contraseña en cada conexión. El servidor resuelve
una, en este orden:

1. Una contraseña entregada directamente con la petición.
2. Un elemento del vault elegido para esa conexión.
3. El elemento del vault mapeado a la máquina, cuando la petición sólo
   identifica una VM.

El tercer caso es el habitual. El mapeo máquina-a-vault puede además llevar el
nombre de usuario, el puerto y un host de salto, de modo que una máquina que
necesita algo distinto a los valores por defecto conecta bien sin volver a
preguntar.

**El vault debe estar desbloqueado.** Las contraseñas se leen de él al momento
de conectar, y un vault bloqueado detiene el intento con un mensaje que te pide
desbloquearlo primero. Una consulta al vault que falla por cualquier otra razón
se reporta como fallo de consulta y no como contraseña incorrecta, para que un
problema pasajero no se confunda con una credencial mala.

## Hosts de salto

Una máquina que no es alcanzable directamente puede alcanzarse a través de un
host de salto. El host de salto tiene su propia entrada en el mapeo y su propio
elemento del vault, así que la credencial del bastión nunca se asume igual a la
del destino. Lintaya abre primero la conexión al host de salto y tuneliza la
sesión a través de él.

## Qué queda registrado

Cada sesión escribe una transcripción en el servidor, bajo `server/ssh-logs/`,
nombrada por fecha, dirección, usuario e identificador de sesión. Las secuencias
de control de la terminal se eliminan, de modo que el archivo se lee como texto
plano y no como una grabación de pantalla.

Esas transcripciones son lo que el módulo **Logs SSH** lista y muestra. Quedan
en disco después de que la sesión termina, lo que las convierte en el registro
de lo que se ejecutó; trátalas en consecuencia, porque todo lo que se escriba en
una terminal —incluida una contraseña tecleada en un prompt dentro de la
sesión— está ahí.

## Colores de conexión

| Indicador | Significado |
|---|---|
| Ámbar | Conectando al equipo. |
| Verde | Sesión conectada. |
| Rojo | Error de conexión o fallo de autenticación. |
| Gris | Sesión cerrada; en la terminal también se usa gris durante la carga inicial. |

La barra lateral muestra la carga inicial en ámbar. Estos colores describen la
sesión SSH, no el estado general del dispositivo. El botón de reconexión aparece
para sesiones cerradas o con error; un fallo de autenticación requiere revisar
las credenciales.

## Pestañas y ventanas múltiples

Usa **+ Add Session** para volver al inventario y abrir otro equipo. Con varias
sesiones puedes elegir una terminal por pestaña o la vista dividida en
cuadrícula, donde todas quedan visibles. Al quedar una sola sesión, vuelve a
pestañas. **Copy** copia la salida de la terminal activa. La cruz cierra una
sesión y **Close all** cierra todas.

## Broadcast: un comando en varias sesiones

1. Abre las sesiones de destino.
2. Activa **Broadcast**; el botón ámbar indica **Broadcast ON**.
3. Escribe el comando en la barra de broadcast y pulsa Enter o el botón de envío.
4. Desactiva Broadcast cuando termines.

El envío agrega un salto de línea y llega a todas las conexiones WebSocket
abiertas del espacio de terminales, incluidas las pestañas que no estás mirando.
No hay selección individual de destinatarios. La escritura normal en una
terminal sigue siendo individual: lo que se replica es el contenido enviado
desde la barra de broadcast. Comprueba los equipos abiertos antes de enviar,
pues el comando puede ejecutarse en todos ellos.
