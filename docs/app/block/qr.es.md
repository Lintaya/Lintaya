# Códigos QR

[English](qr.md) | Español

Un block QR convierte un contenido en un código que un teléfono puede escanear.
Además de un enlace, puede conectar a una red Wi-Fi, guardar un contacto, abrir
un correo, una llamada o un SMS, mostrar una ubicación o añadir un evento al
calendario. Rellenas campos normales y Lintaya escribe el texto que espera cada
teléfono. Para los blocks en general, consulta [Blocks](introduccion.es.md).

## Estático y dinámico

Un código **estático** guarda el contenido dentro del símbolo. Funciona sin
conexión y nunca depende de Lintaya, pero cambiar el contenido obliga a imprimir
un código nuevo. Todos los tipos de contenido de esta página son estáticos.

Un código **dinámico** guarda un enlace corto que sirve Lintaya, y puedes cambiar
a dónde apunta sin reimprimirlo. Siempre es una URL, así que no tiene tipo de
contenido. Actívalo en **Settings → Builder** y define antes una URL base
pública; si no, un teléfono fuera de tu red no podrá abrirlo.

## Tipos de contenido

ISO/IEC 18004 estandariza el símbolo QR en sí — módulos, codificación y
corrección de errores — pero no el significado del texto. Cada tipo sigue la
norma o la convención que leen las cámaras de iOS y Android:

| Tipo | Qué hace el teléfono | Norma | Empieza por |
|---|---|---|---|
| Texto o URL | Muestra el texto o abre el enlace | Texto libre; URLs según RFC 3986 | cualquier cosa |
| Wi-Fi | Ofrece conectarse a la red | Convención de ZXing, recogida en WPA3 | `WIFI:` |
| Contacto | Ofrece guardar el contacto | vCard 3.0, RFC 2426 | `BEGIN:VCARD` |
| Correo | Abre un mensaje nuevo | URI `mailto:`, RFC 6068 | `mailto:` |
| Llamada | Ofrece marcar el número | URI `tel:`, RFC 3966 | `tel:` |
| SMS | Abre un mensaje de texto nuevo | Convención de ZXing | `SMSTO:` |
| Ubicación | Abre la app de mapas | URI `geo:`, RFC 5870 | `geo:` |
| Evento | Ofrece añadirlo al calendario | `VEVENT` de iCalendar, RFC 5545 | `BEGIN:VEVENT` |

Los códigos de pago siguen la especificación QR de EMVCo para sistemas de pago.
Ese contenido lo emite tu banco o tu pasarela de pago, así que Lintaya no lo
construye; si tienes uno, pégalo como **Texto o URL**.

## Cada formato

### Texto o URL

El contenido se codifica tal cual lo escribes. Úsalo para enlaces y para
cualquier formato que esta página no incluya.

```text
https://lintaya.com
```

### Wi-Fi

```text
WIFI:T:WPA;S:Office;P:correct-horse;;
```

- El **nombre de la red (SSID)** va en `S`.
- La **seguridad** va en `T`: `WPA` cubre WPA, WPA2 y WPA3; `WEP` es antiguo;
  `nopass` es una red abierta y omite la contraseña.
- La **contraseña** va en `P`, y **Red oculta** añade `H:true`.
- Una barra invertida, `;`, `,`, `:` o `"` en el nombre o la contraseña se
  escribe con una barra invertida delante, así que `Office;North` queda como
  `Office\;North`. Lintaya lo hace por ti.

La contraseña la puede leer cualquiera que escanee o fotografíe el código — el
formato no tiene manera de ocultarla — y se guarda junto con el block.
Imprímelo solo donde cualquiera que lo vea pueda conectarse. El texto de WPA3
pide codificación por porcentaje, mientras que Android usa barras invertidas;
Lintaya sigue a Android, que es lo que los teléfonos leen de verdad.

### Contacto

```text
BEGIN:VCARD
VERSION:3.0
N:Pérez;Ana;;;
FN:Ana Pérez
ORG:Lintaya
TEL:+525512345678
EMAIL:ana@example.com
URL:https://lintaya.com
END:VCARD
```

Hace falta al menos un nombre, unos apellidos o una empresa. Las líneas terminan
en CRLF, como exige el RFC, y el teléfono se guarda sin espacios.

### Correo

```text
mailto:ana@example.com?subject=Hello&body=See%20you%20soon
```

El asunto y el cuerpo son opcionales y van codificados por porcentaje.

### Llamada

```text
tel:+525512345678
```

Escribe el número con su prefijo de país para que funcione desde cualquier país.

### SMS

```text
SMSTO:+525512345678:See you at 10:30
```

El mensaje es opcional y puede contener dos puntos.

### Ubicación

```text
geo:19.4326,-99.1332
```

La latitud va de -90 a 90 y la longitud de -180 a 180, en grados decimales.

### Evento

```text
BEGIN:VEVENT
SUMMARY:Launch
DTSTART:20260920T180000
DTEND:20260920T200000
LOCATION:Office
END:VEVENT
```

Hacen falta un título y un inicio; el final no puede ser anterior al inicio. Las
horas no llevan zona horaria, así que cada teléfono las lee en la suya: un evento
creado en Ciudad de México a las 18:00 aparece a las 18:00 en un teléfono
configurado en Madrid.

## Logo y densidad

El logo va sobre una placa opaca en el centro y nunca tapa los patrones de
búsqueda, temporización o alineación. La corrección de errores se elige
automáticamente, y un código con logo usa siempre el nivel más alto.

En las versiones 7–13, 21–27, 35, 37, 38 y 40 el estándar coloca un patrón de
alineación justo en el centro, así que ningún logo centrado cabe, por pequeño que
sea. Un contenido largo — un evento, un contacto — suele caer ahí. Lintaya pasa
entonces el código a la siguiente versión con el centro libre: el mismo contenido
en una rejilla más densa, por ejemplo 73×73 módulos en vez de 57×57. El editor
avisa cuando ocurre; imprime ese código un poco más grande o quita el logo. Solo
un código de versión 40, que no tiene a dónde subir, se genera sin logo.

Escanea el código con un teléfono real antes de imprimirlo.

## Editar un código guardado

Solo se guarda el texto final. Al editar un block, el editor vuelve a leer ese
texto en el formulario. Solo acepta un tipo si al reconstruirlo sale exactamente
el mismo texto; cualquier otra cosa — por ejemplo una vCard escrita en otro sitio
con campos adicionales — se abre como **Texto o URL**, así que no se pierde
contenido.

## Crear un código QR con el Asistente

El Asistente puede crear blocks QR estáticos de todos los tipos de esta página:

- Pídelo con palabras normales, por ejemplo "un QR para el Wi-Fi de la oficina".
- El Asistente rellena los campos y pregunta lo que falte, como una contraseña o
  el inicio de un evento. Nunca escribe él mismo el texto `WIFI:` o la vCard;
  Lintaya lo construye a partir de los campos.
- No se crea nada hasta que apruebas la propuesta en el chat o en el Approval
  Center.
- Cuando el Asistente lista tus blocks ve el tipo de cada código QR, nunca su
  contenido, así que una contraseña de Wi-Fi no se envía al proveedor del modelo.

Los códigos dinámicos solo se crean desde **Blocks → + New block**. Los agentes
que se conectan por HTTP descubren que Lintaya construye códigos QR, y en qué
formatos, con el endpoint público `GET /api/ai-context`.

## Referencias

- [ISO/IEC 18004:2024, simbología del código QR](https://www.iso.org/standard/83389.html)
- [RFC 2426, vCard 3.0](https://www.rfc-editor.org/rfc/rfc2426)
- [RFC 3966, el URI tel](https://www.rfc-editor.org/rfc/rfc3966)
- [RFC 3986, sintaxis de URI](https://www.rfc-editor.org/rfc/rfc3986)
- [RFC 5545, iCalendar](https://www.rfc-editor.org/rfc/rfc5545)
- [RFC 5870, el URI geo](https://www.rfc-editor.org/rfc/rfc5870)
- [RFC 6068, el URI mailto](https://www.rfc-editor.org/rfc/rfc6068)
- [Especificación QR de EMVCo para sistemas de pago](https://www.emvco.com/emv-technologies/qr-codes/)
