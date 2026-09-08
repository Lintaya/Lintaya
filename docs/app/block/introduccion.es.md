# Blocks

[English](introduccion.md) | Español

Un block es contenido reutilizable. Un Board organiza blocks en zonas y un
Dashboard agrupa Boards en pestañas. El mismo block puede aparecer en varios
Boards sin copiar su contenido.

## Tipos de blocks

| Tipo | Contenido | Cómo se actualiza |
|---|---|---|
| Estático Markdown (.md) | Texto, listas, tablas, enlaces, código y diagramas Mermaid. | Al editar y guardar el contenido. |
| Estático HTML | Un fragmento HTML con títulos, párrafos, listas o tablas. | Al editar y guardar el contenido. |
| Dinámico de conector | Datos como commits, repositorios, tareas o documentos. | Mediante las lecturas y sincronización de su conexión. |

El editor llama **IA** al tipo de contenido Markdown/HTML, pero también permite
pegar texto escrito a mano: no necesitas generar nada con IA. Un texto generado
por IA sigue siendo estático; el prompt guardado no se ejecuta automáticamente.
Un bloque dinámico no garantiza datos en tiempo real: depende de la caché y la
frecuencia de sincronización del conector.

## Crear un block Markdown o HTML

1. Abre **Blocks → + New block**.
2. Escribe el título; añade descripción e icono si los necesitas.
3. En **Type**, elige **IA** y selecciona el formato **Markdown** o **HTML**.
4. Elige el modo **External** para escribir o pegar contenido en **Content**.
   Para usar un archivo .md o .html, copia su contenido en el editor; el bloque
   guarda ese texto, no una referencia que siga los cambios del archivo.
5. Revisa la vista previa y deja el block activo para ofrecerlo en el catálogo.
6. Pulsa **Save block**.

El título y el contenido son necesarios. Un ejemplo Markdown:

```md
## Daily review
- Check alerts
- Review pending tasks
```

El mismo contenido como fragmento HTML:

```html
<h2>Daily review</h2>
<ul><li>Check alerts</li><li>Review pending tasks</li></ul>
```

El HTML se limpia antes de mostrarse: no es una aplicación ejecutable ni un
espacio para scripts. No necesita etiquetas html, head o body. Usa URLs HTTP(S)
para imágenes y video, no contenido incrustado data: o blob:.

En modo **Local**, puedes escribir un prompt y generar contenido con el proveedor
IA configurado en Settings. Revisa el resultado antes de guardarlo. Aquí Local
es el nombre del modo del editor; no significa que el modelo se ejecute en tu equipo.

## Crear un block dinámico de conector

1. Configura, habilita y sincroniza la conexión en **Connectors**.
2. Abre **Blocks → + New block** y selecciona **Connector** como tipo.
3. Elige la conexión y uno de los bloques que ofrece.
4. Ajusta el alcance y la cantidad de elementos según las opciones disponibles.
5. Escribe un título que describa el filtro, revisa la vista previa y guarda.

También puedes usar directamente un bloque predefinido del conector en el Board.
Crear un block personalizado sirve para guardar una configuración propia, por
ejemplo un alcance o límite distinto. Solo están disponibles los tipos y filtros
que implementa ese conector. La sincronización requiere una conexión operativa.

## Usar el mismo block en varios Boards

1. Crea o edita un Board desde **Boards**.
2. Busca el block en **Available blocks**; usa búsqueda o filtro de conexión.
3. Selecciona la zona de destino y agrega el block.
4. Pulsa **Save and apply**.
5. Repite en otro Board seleccionando el mismo block del catálogo.

Cada Board conserva su distribución y tamaño. El contenido y la configuración
del block son compartidos: al editar el original, los Boards que lo referencian
cargan esa versión al volver a cargar sus datos. Si necesitas variantes
independientes, crea bloques distintos.

Quitar un block de un Board solo retira esa ubicación; no elimina el block de
la biblioteca ni datos remotos. Eliminar el block de la biblioteca afecta a los
Boards que lo referencian, donde puede aparecer como no disponible.

## Dónde se guarda y se implementa

Los blocks personalizados se guardan en el servidor de Lintaya, no como archivos
.md o .html independientes. El editor está en app/block-builder.jsx, el catálogo
en app/block-catalog.jsx y la API en server/routes/custom-blocks.js. El editor de
Boards está en app/module-builder.jsx.
