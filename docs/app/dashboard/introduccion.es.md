# Dashboards

[English](introduccion.md) | Español

Un Dashboard agrupa varios Boards como tabs superiores. Es un contenedor de
navegación: no copia el layout ni los Blocks de los Boards.

Desde **Dashboards** puedes crear o editar un Dashboard, elegir sus Boards,
cambiar el orden de los tabs y decidir si estará activo y visible en el
sidebar. Un Dashboard vacío también es válido.

## Crear la jerarquía completa con el Assistant

El Assistant puede crear en una sola propuesta un Dashboard nuevo junto con
sus Blocks de contenido y Boards. Describe el título, el orden de los Boards y
el contenido que debe aparecer en cada uno. Lintaya muestra una sola tarjeta de
confirmación con el total de Boards y Blocks; nada se guarda hasta que una
persona la aprueba en el Approval Center.

La operación compuesta usa los IDs reales que genera Lintaya y enlaza la
jerarquía automáticamente. Si ya existe un Dashboard, Board o Block con uno de
los títulos solicitados, la operación falla antes de crear elementos parciales.
Para reutilizar contenido existente, el Assistant también puede consultar los
IDs mediante `list_custom_blocks` y usar el flujo individual de creación.

Cada Board compuesto puede elegir un preset de zonas (`single`, `columns`,
`rows`, `grid`, `priority` o `focus`). Los Blocks se colocan en zonas distintas
siguiendo ese preset. Estos Boards quedan ocultos del sidebar por defecto, para
que el Dashboard sea su punto de entrada. El contenido puede incluir imágenes
con texto alternativo y atribución; sus URLs deben usar HTTPS.

El tab seleccionado se guarda en el Dashboard. Puedes cambiar de tab con clic
o con las teclas Flecha izquierda, Flecha derecha, Inicio y Fin. En pantallas
estrechas, la fila de tabs se desplaza horizontalmente.

Arrastra un tab sobre otro para cambiar su posición. El nuevo orden se guarda
en el Dashboard y también determina el recorrido de la presentación. Con
teclado, usa Alt + Flecha izquierda o Alt + Flecha derecha para mover el tab.

Dentro de un Dashboard, el lápiz junto a **Administrar** abre el editor del
Board seleccionado. Su título no se repite dentro del contenido porque el tab
ya identifica qué Board está abierto.
Cancelar o guardar desde ese editor regresa al mismo Dashboard.

El botón **Presentar** (ícono Play junto a Administrar) abre el Dashboard como
una presentación a pantalla completa. Usa Flecha izquierda y Flecha derecha o
los controles visibles para retroceder y avanzar; Escape cierra la presentación.
El botón con forma de ojo en la cabecera oculta o vuelve a mostrar los títulos
y controles de todos los Blocks. La preferencia se mantiene al recorrer los
Boards y se restablece al abrir una nueva presentación.

Si un Board referenciado está inactivo o ya no existe, su referencia se
conserva y se muestra como no disponible. Esto permite restaurarlo o enlazarlo
durante una futura importación. Eliminar un Dashboard nunca elimina sus Boards
ni sus Blocks.
