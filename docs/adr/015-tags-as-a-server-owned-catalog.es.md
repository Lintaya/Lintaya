# ADR-015: las etiquetas son un catálogo del servidor

[English](015-tags-as-a-server-owned-catalog.md) | Español

- Estado: Propuesto
- Fecha: 2026-09-06
- Deciden: proyecto Lintaya

## Contexto

Las etiquetas existen en Lintaya, pero no como datos. El catálogo vive en
`window.APP_DATA.TAGS`, una constante que viaja en `app/public-data.js`, y
editar una etiqueta reescribe la lista entera en `localStorage["hq_tags"]` de
ese único navegador. No hay `/api/tags`. Una etiqueta nunca llega al servidor,
nunca entra en un respaldo, y no existe para el mismo usuario en una segunda
máquina ni después de borrar los datos del sitio.

Lo que puede llevar una etiqueta es aún más estrecho. Passwords elige del
catálogo y persiste en la columna `tags` de `vault_items`. Devices tiene un
campo `tags` en su API, pero el formulario es un input de texto libre separado
por comas; las cadenas que produce se pintan con `TagPill`, que resuelve un id
contra el catálogo y cae a `{ id, label: id, color: "#78716c" }` cuando no
encuentra nada. Escribir `production` da entonces una píldora gris que parece
una etiqueta, no comparte color ni categoría con ninguna, y no cuenta como uso
de ninguna. Blocks, Boards y Dashboards no tienen campo de etiquetas en
absoluto, ni en sus rutas ni en su interfaz.

El contador de usos lo agrava: recorre `APP_DATA.PASSWORDS` y
`APP_DATA.DEVICES`, que en una build pública son arrays de ejemplo vacíos, así
que la vista Etiquetas informa cero usos por muchos dispositivos reales que
haya.

El resultado es una función que se lee como terminada y no lo está. Este ADR
cubre la parte que bloquea todo lo demás: dónde vive el catálogo.

## Decisión

El catálogo de etiquetas pasa a ser dato del servidor, guardado en la tabla `kv`
bajo la clave `tags` y servido por `/api/tags`, con la misma forma que ya usan
Dashboards y Boards. El navegador deja de ser el sistema de registro.

`kv` lo respalda entero `server/core/services/backup.js`, así que solo con esto
las etiquetas sobreviven a una reinstalación, viajan con un respaldo, y son las
mismas en cualquier navegador apuntado a una instancia.

Las cinco por defecto —Connection, Environment, Criticality, Ownership y Device
Type— se siembran en la primera lectura cuando la clave no existe, para que una
instalación existente y una nueva converjan en el mismo catálogo en vez de que
las de por defecto sean una constante del cliente que difiere en silencio de lo
guardado.

`localStorage["hq_tags"]` deja de escribirse. Se lee una vez, en la primera
carga contra una instancia sin catálogo guardado, y se sube: una etiqueta que
alguien creó en un navegador no se pierde por este cambio.

El id de una etiqueta sigue siendo un slug derivado de su nombre, y los valores
de una categoría conservan sus propios ids, porque ambos ya están referenciados
por filas guardadas de `vault_items.tags`. Cambiar el esquema de ids dejaría
huérfana toda asignación existente.

## Consecuencias

Las etiquetas pasan a ser datos normales de Lintaya: auditados, respaldados,
exportables, y legibles por la CLI y por un agente a través de la misma API que
todo lo demás. La vista Etiquetas gana los modos de fallo de cualquier otra
vista —ahora puede quedar desactualizada, o fallar al guardar— donde antes solo
podía estar equivocada.

Esto no permite, por sí solo, que un Block, Board, Dashboard o Device lleve una
etiqueta. Eso necesita un campo `tags` en cada registro y un selector en cada
editor, y Devices necesita que su input de texto libre se reemplace por ese
selector. Ese trabajo depende de esta decisión y queda deliberadamente fuera.

Para *qué* sirve una etiqueta —solo filtrar y buscar, o también agrupar en la
barra lateral— también queda abierto. El catálogo no necesita esa respuesta; los
selectores sí.
