# Tableros

[English](introduccion.md) | Español

Un Tablero es una página persistente de Module Builder. Tiene título, icono,
estado activo, visibilidad independiente en el sidebar y un árbol de zonas que coloca Bloques en pilas ordenadas.
El CLI llama Boards a estas páginas; API e IDs guardados aún usan module-pages
por compatibilidad.

## Elegir una distribución

Abre **Boards → New Board** para crear uno, o **Edit Board** desde un Board
guardado. El título es necesario para guardar. El icono identifica el Board;
**Active** permite abrirlo y **In sidebar** controla su acceso en la barra lateral.

El editor tiene tres áreas: catálogo de blocks, diseño de zonas y vista previa.
Puedes ajustar el ancho de las columnas del editor arrastrando sus separadores.
Oculta **Board layout** con su botón de cierre para ampliar la vista previa;
**Show layout** vuelve a mostrarlo. Estos controles organizan el editor, no el
contenido del Board.

| Preset | Uso |
|---|---|
| 1 zone | Empezar con una zona principal. |
| Columns | Organizar contenido lado a lado. |
| Rows | Organizar contenido de arriba abajo. |
| Grid | Combinar filas y columnas. |
| Priority / Focus | Comenzar con una composición que da más espacio a una zona. |

Elige primero el preset y revisa la vista previa después de cambiarlo. Luego
ajusta las proporciones con los separadores.

## Colocar y reorganizar blocks

1. Activa **Add blocks** y selecciona una zona del diseño.
2. Busca el block por nombre o filtra por conexión en **Available blocks**.
3. Pulsa el block para agregarlo a la zona seleccionada.
4. Si la zona ya está ocupada, se crea un panel hermano con separador propio.
5. Usa las flechas arriba/abajo para ordenar los blocks de una misma zona cuando
   contiene varios. Para cambiar de zona, quita la colocación y agrégala al destino.
6. Revisa la vista previa y pulsa **Save and apply**.

Puedes combinar Markdown, HTML y blocks de conectores en el mismo Board. El
catálogo permite reutilizar los mismos blocks en otros Boards. El contenido se
edita en Blocks; el Board controla dónde se presenta.

En **Edit zones**, pulsa una zona para dividirla y usa el control de orientación
para elegir la dirección. El botón de quitar zona elimina esa zona del diseño;
revisa el resultado antes de guardar. Las zonas vacías se compactan y no son
separadores en blanco persistentes.

## Márgenes, separación y tamaño

Actualmente no hay un campo para introducir márgenes o padding en píxeles por
Board o por block. La aplicación define el margen exterior, la separación entre
paneles y el espacio interior de las tarjetas.

Lo que sí puedes ajustar es la proporción de ancho o alto de las zonas:
arrastra el separador entre ellas, o enfócalo con Tab y usa las flechas. Cada
Board guarda sus propias proporciones. Una zona más ancha ayuda a leer títulos
y tablas; una más alta permite ver más filas antes de desplazarte.

La tarjeta se ajusta a su contenido sin rellenar con blanco todo el alto de la
zona. Si su contenido supera el espacio disponible, aparece scroll dentro del
block. Puede quedar espacio libre en la zona: para redistribuirlo, mueve sus
separadores o cambia la composición. La paginación cambia los elementos
mostrados; el scroll permite llegar a los controles que quedan más abajo.

En pantallas angostas, las zonas se presentan verticalmente. Comprueba también
ese formato si compartirás el Board con usuarios de móvil.


## Crear un Tablero

1. Abre Boards y elige New Board.
2. Ingresa un título claro y elige un icono.
3. Mantén activo el Tablero para que pueda abrirse o inactívalo mientras lo preparas.
4. Usa **En sidebar** para decidir si un Tablero activo aparece en el sidebar.
5. Selecciona un preset de layout o edita zonas para crear la estructura deseada.
6. Elige una zona, cambia a Add blocks y agrega bloques disponibles a su pila.
7. Elige Save and apply.

La página se vuelve un Tablero navegable solo cuando está activa. Un Tablero
activo con **En sidebar** desactivado sigue disponible desde el catálogo Boards
y mediante su ruta, pero no ocupa espacio en el sidebar. Los Boards guardados
antes de esta opción siguen visibles por defecto. Ambos estados se guardan por separado.

## Componer el layout

Un Tablero usa zonas en lugar de posicionamiento absoluto libre. Una zona
contiene una pila ordenada de IDs de bloques; un bloque puede estar en más de un
Tablero sin copiar su contenido. Usa Edit zones para dividir, combinar o elegir
un preset y luego Add blocks para llenar la zona seleccionada.

El Board renderizado se comporta como un workspace con reflow. Cada Block
colocado tiene un control visible para cerrarlo. Cerrarlo elimina únicamente esa
colocación del Board actual: el Block global, la configuración del conector, los
datos sincronizados y sus colocaciones en otros Boards permanecen intactos. Si
la zona queda vacía, su hermano ocupado se expande al espacio liberado; cerrar
el último Block muestra un estado vacío claro con una acción que vuelve a abrir
el selector de Blocks.

Al agregar un Block a una zona vacía se reutiliza esa zona. Si la zona ya tiene
contenido, el Builder crea automáticamente un panel hermano 50/50 con su propio
separador; así cerrar y volver a agregar Blocks no elimina la posibilidad de
redimensionarlos. El resultado sigue siendo el mismo árbol compatible del Board.

Redimensiona los separadores entre zonas ocupadas con pointer o con las flechas
cuando el separador tiene foco. Los ratios se guardan en el árbol propio de ese
Board, por lo que redimensionar uno no afecta a otro. En una pantalla angosta,
las zonas hacen reflow en un workspace vertical de ancho completo y conservan
el orden del contenido y los controles accesibles de resize.

En desktop, si el contenido ya no cabe después de redimensionar, solo el cuerpo
del Block muestra un scroll fino; el encabezado y el cierre permanecen visibles.
El cuerpo recibe foco con Tab y admite flechas, Page Up y Page Down. En móvil el
contenido conserva su flujo natural, sin scroll interno.

Los bloques faltantes se muestran como no disponibles en lugar de reemplazarse
silenciosamente. Configura y sincroniza un conector antes de agregar un bloque
propiedad de conector. Una colocación no disponible conserva su control de
cierre, así que no puede atrapar una región vacía en el layout.

## Editar o borrar de forma segura

Abre un Tablero existente desde Module Builder para cambiar título, icono,
estado activo, visibilidad en el sidebar, layout o bloques. Marcarlo inactivo
deshabilita su ruta pero lo conserva editable y almacenado; ocultarlo del
sidebar no lo desactiva.

Eliminar un Tablero solo elimina su página y colocaciones. No borra bloques
Markdown, bloques de conector, conexiones, configuración de proveedor ni datos
remotos de proveedor usados por ese Tablero.

## Portabilidad futura

Los árboles de Board continúan guardando referencias locales a Blocks por
compatibilidad, pero esos IDs se tratan como referencias y no como contenido
propiedad del Board. Un futuro paquete exportable y versionado podrá traducirlos
a claves portables y mapear requisitos de conectores con Connections de otra
instalación de Lintaya. Las fases futuras de Dashboard y compartir se planifican
por separado; esta fase del workspace de Board no crea ninguno de esos
conceptos.
