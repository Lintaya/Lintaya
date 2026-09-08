# ADR-014: distribución de conectores y el modelo de instalación por carpeta

[English](014-connector-distribution-and-drop-in.md) | Español

- Estado: Propuesto
- Fecha: 2026-09-03
- Depende de: ADR-010
- Habilita: release público sin los tiers enterprise y development

## Contexto

El release público entrega sólo el tier community. Los conectores enterprise
(qportal, ucsm, vcenter) y los development (outlook, outlook-local,
lintaya-remote) quedan privados. Quien instale la versión pública debe poder
volver a agregar esos conectores en otra máquina y ver aparecer sus módulos,
blocks y rutas, sin editar el producto.

El registry ya funciona así. `findManifestFiles()` recorre las carpetas de tier
y carga cualquier `manifest.json` que encuentre, y el loader llama al
`register()` de cada paquete sin una línea en `server.js`. Ese fue el criterio
de salida de la Fase 2 del roadmap.

El producto lo contradice. Quitar ambos tiers de un snapshot limpio y arrancar
el servidor falla de inmediato:

```
Error: Cannot find module './connectors/enterprise/vcenter'
```

Los bloqueos verificados:

| Bloqueo | Ubicación | Efecto |
|---|---|---|
| `require` directo de un paquete de conector | server.js:32 | El servidor no arranca. Cuatro funciones, 14 usos. |
| Archivos de ruta específicos de conector en core | routes/live-vcenter.js, routes/vcenter-diagnostics.js | 268 líneas registradas incondicionalmente para un solo conector. |
| Rutas de test listadas una por una | server/package.json | 17 rutas en tiers ausentes; `npm test` falla. |
| Lista de objetivos de sync programado | server.js:740 | Nombra qportal, outlook, ucsm y vcenter a mano. |
| Nombres e iconos de proveedor en el shell | app/app.jsx, block-catalog.jsx, block-builder.jsx, connectors.jsx | Vistas huérfanas y un fetch directo a `/api/connectors/outlook/events`. |
| Registro de acciones que lista cada conector | core/actions/bootstrap.js | 13 requires fijos, 5 en tiers ausentes. Encontrado al implementar la Fase 0, no en el análisis inicial. |
| Páginas core que sólo pintan datos de un conector | VMs, Hosts | Dos módulos que un usuario público nunca podrá llenar. |

El lugar de instalación importa tanto como la carga. Una carpeta dentro del
árbol de trabajo hay que ignorarla en git, se pierde al reclonar y compite con
las operaciones normales de git. Hermes (NousResearch) resuelve el mismo
problema descubriendo skills desde un directorio de usuario fuera del proyecto,
y monta el hub de compartición encima de esa convención de directorios, no en
lugar de ella.

## Decisión

**Los conectores se descubren, nunca se importan.** Ningún archivo fuera de
`server/connectors/` puede referenciar un paquete de conector por ruta. El core
depende del registry y del loader, nunca de un proveedor.

**Un conector se instala fuera del repositorio.** El descubrimiento recorre
`server/connectors/<tier>/` como hoy, y además un directorio de usuario
(`LINTAYA_CONNECTORS_DIR`, por defecto `~/.lintaya/connectors/`). Ese directorio
es la vía documentada para agregar un conector privado: sobrevive a un reclonado
y a una actualización, no necesita entrada en `.gitignore`, y mantiene el código
privado fuera del árbol público por construcción y no por omisión.

**Los conectores privados tienen su propio repositorio.** Se mueven a un repo
git privado con su historia y su CI, y se instalan clonando dentro del
directorio de usuario. Un `.gitignore` esconde una carpeta; no la versiona, no
la respalda ni la lleva a otra máquina.

**Un conector es dueño de las páginas que alimenta.** VMs y Hosts pasan a
`modules[]` de vCenter, como Portainer ya publica Containers. Sin una conexión
de vCenter no aparecen, así que una instalación pública no muestra ninguna
página que no pueda llenar.

**El core no conserva archivos de ruta específicos de conector.**
`live-vcenter.js` y `vcenter-diagnostics.js` se mueven al paquete de vCenter y
se registran vía `register()`.

## Consecuencias

La versión pública arranca, pasa tests y funciona sólo con el tier community.
Agregar un conector privado es copiar una carpeta; quitarlo es borrarla. El
shell deja de nombrar proveedores que quizá no entrega, lo que además elimina el
riesgo permanente de que una versión pública anuncie un sistema interno.

El costo es real. vCenter se menciona 55 veces en `server.js`, y mover sus rutas
toca una integración que funciona; esto debe aterrizar respaldado por los tests
existentes y no junto a un release. Además, dos paquetes de conector querrán
crecer con código de vista, algo que el modelo actual no permite: un conector
declara un componente y el shell lo resuelve desde `app/`, así que un conector
que traiga su propia página necesita una vía de carga que todavía no existe.
Mientras tanto, VMs y Hosts siguen siendo archivos core publicados por el
manifiesto de vCenter, lo que basta para el comportamiento de la barra lateral y
pospone el problema difícil.

## Plan

**Fase 0 — que la ausencia sea sobrevivible.** Bloqueante para el release
público.

1. Reemplazar las 17 rutas de test fijas por globs. `node --test` los acepta;
   verificado.
2. Derivar `AUTO_SYNC_TARGETS` del registry en vez de una lista literal.
3. Blindar los supuestos de proveedor del shell: eliminar
   `DUMMY_CONNECTOR_MODULES`, condicionar el fetch de eventos de Outlook a que
   la conexión exista, y dar icono y etiqueta por defecto a un proveedor
   desconocido.
4. Derivar también el registro de acciones de los manifiestos. Un tier ausente
   no tiene manifiesto, así que no se requiere nada suyo.
5. Resolver el paquete de vCenter de forma opcional, con un helper compartido,
   para que su ausencia sea una función faltante y no un servidor que no
   arranca. Es la parte mínima de la Fase 1 adelantada: el test de arranque no
   puede pasar sin ella, y una fase llamada "que la ausencia sea sobrevivible"
   que deje el servidor sin arrancar no merecería el nombre. Mover las rutas
   sigue en la Fase 1.
6. Agregar tests que sostengan la regla: el core no puede requerir de forma dura
   un conector de un tier opcional, y tanto el registro de acciones como el sync
   programado deben funcionar con un conjunto de manifiestos sólo community.

**Estado: implementada.** El servidor ahora arranca, sirve y pasa su suite con
los tiers enterprise y development retirados.

**Fase 1 — sacar vCenter del core.** Mover ambos archivos de ruta al paquete,
registrarlos vía `register()`, borrar el import opcional y las cuatro funciones
inyectadas que dejó la Fase 0, y pasar VMs y Hosts a `modules[]` de vCenter.
Cuando esto aterrice, el core no debe nombrar un paquete enterprise o
development en absoluto — ni siquiera a través de `requireOptional`.

**Estado: implementada.** Dos correcciones al plan de arriba, ambas encontradas
al ejecutarlo.

El criterio de salida se escribió primero como "`requireOptional` no debería
tener llamadores". Ese test es el equivocado. `core/actions/bootstrap.js` usa el
helper para algo distinto y permanente: un conector no está obligado a declarar
un `actions.js` (lintaya-remote no lo hace), y esa ausencia es esperada
pertenezca al tier que pertenezca. El criterio que importa es el que ahora se
enuncia — ningún archivo del core nombra un paquete opcional — y
`core/tier-independence.test.js` verifica exactamente eso, tras endurecerlo de
"ningún require pelado" a "ninguna referencia de cualquiera de las dos formas".

El plan también contaba dos consumidores del cliente de vCenter en el core y
eran tres. `getWorkloadIndex()` y `getHostMacIndex()` — los índices de MAC
contra los que la correlación de fabric hace el join — llamaban al cliente
directamente. Borrar el import sin ellos era imposible, y dejarlos habría
mantenido al core conociendo un proveedor por su nombre. Se movieron al paquete
detrás de un registro nuevo, `core/services/workload-sources.js`: el core es
dueño del join y pregunta a cada fuente registrada, vCenter se registra al
cargar, y una instalación sin el tier correlaciona fabric con todas las MAC sin
nombre en vez de no correlacionar. Es la misma forma que `FABRIC_ADAPTERS` ya
tenía del lado del plano, que es la razón por la que el comentario de esa misma
sección afirmaba que los proveedores podían conectarse "sin tocar el motor"
mientras uno de ellos estaba, de hecho, hardcodeado.

Una afirmación de salida de esta fase era demasiado amplia y queda corregida
aquí. Mover VMs y Hosts a los `modules[]` de vCenter no bastó, por sí solo,
para que una instalación pública dejara de anunciar dos páginas que no puede
llenar. El shell ocultaba una ruta core propiedad de un conector solo cuando el
conector estaba presente y Disconnected; un build que no instala el conector no
publica módulo alguno, así que no había `coreRoute` que ocultar y la entrada
sobrevivía. `NAV_ROUTES` marca ahora las nueve rutas que un conector posee, y
una sola regla cubre ambos casos: una ruta propia aparece únicamente mientras
algún módulo disponible la publique.

**Fase 2 — directorio de conectores del usuario.** Extender
`findManifestFiles()` para recorrer `LINTAYA_CONNECTORS_DIR`, documentar la
precedencia cuando un id existe en ambos lugares, y rechazar un conector cuyo id
choque con uno entregado.

**Estado: implementada.** El descubrimiento lee primero las carpetas de tier
entregadas y después `LINTAYA_CONNECTORS_DIR` (por defecto
`~/.lintaya/connectors/`). Tres decisiones que la fase dejaba abiertas:

*El directorio del usuario es plano.* Una carpeta por conector, sin carpetas de
tier. Los tiers describen cómo este repositorio organiza lo que entrega; obligar
a hacer `mkdir enterprise` antes de soltar un conector sería ceremonia sin nada
detrás. Un conector instalado sigue declarando su `tier`, que se valida contra
el conjunto permitido — la comprobación de que carpeta y tier coinciden es la
única regla que no aplica fuera del repo, porque no hay carpeta con la que
coincidir.

*La precedencia es rechazo, no sombra.* Los manifiestos entregados cargan
primero, así que un choque solo puede ser un conector instalado reclamando un id
que Lintaya ya entrega. Eso falla ruidosamente y nombra ambos manifiestos. Que
ganara el directorio del usuario significaría que una carpeta en un home puede
reemplazar `github` en silencio, que es la sustitución que nadie notaría; que
ganara el entregado en silencio dejaría al conector instalado ausente sin
explicación. Ninguna de las dos vale la comodidad.

*`implementation.source` se resuelve contra una base registrada.* Un manifiesto
entregado la escribe desde la raíz del repositorio, que es lo que siempre ha
significado y lo que ya dicen catorce manifiestos. Un conector instalado no sabe
nada de este repositorio, así que su source es relativo a su propia carpeta
(`index.js`). El registry anota esa base en cada manifiesto como `packageRoot`,
y tanto `connectors/loader.js` como `core/actions/bootstrap.js` resuelven a
través de ella en vez de asumir la raíz del repositorio.

Un directorio ausente o sin definir es el caso normal, no un error, y una
carpeta sin `manifest.json` se omite en vez de romper el escaneo: un clon a
medias en ese directorio no debe impedir que el servidor arranque.

**Fase 3 — distribución.** Crear el repositorio privado, mover los seis
conectores, y documentar instalación y actualización como un clone y un pull.

**Estado: hecha.** Siete conectores — los tres de enterprise, los tres de
development, y `anthropic`, sacado de community porque no está listo para ser
público — viven ahora en su propio repositorio y se instalan bajo
`LINTAYA_CONNECTORS_DIR`. Este repositorio entrega solo el tier community.

Hacerla destapó una suposición que la Fase 2 nunca probó: un conector instalado
no podía alcanzar el SDK en absoluto, y todos lo necesitan.

`require("../../sdk")` es una ruta relativa que solo resuelve bajo el layout de
tiers que el repo distribuye; desde un directorio de usuario plano cae un nivel
más arriba. Copiar el SDK al pack tampoco es la respuesta. `sdk/index.js` entra
a `core/services/connector-store`, que entra a `core/services/secret-store` y
a su default de proceso, así que una segunda copia construiría un segundo
connector store sobre un segundo secret store, y el conector leería en silencio
secretos que el host nunca escribió. Un conector instalado tiene que alcanzar
las instancias de módulo del propio host, no equivalentes de ellas.

Por eso el SDK viaja ahora en el contexto del conector, igual que ya lo hacían
`runBw` y `workloadSources`, y `getConnectorConfig` se suma a sus exports
porque vCenter era el único que se saltaba esa fachada para entrar al core.
`express` necesitó el mismo trato por la misma razón: `outlook-local` usa
`express.raw` para subir adjuntos, y un paquete fuera del repositorio resuelve
`require("express")` contra el directorio del usuario y no contra
`server/node_modules`. En ambos casos el `require` relativo queda como
fallback que solo se evalúa donde sí resuelve.

Verificado con los seis instalados desde un directorio fuera del repositorio y
ambos tiers opcionales quitados del árbol: catorce conectores registran, montan
120 rutas, y cada uno de los seis reclama las suyas. Sin el SDK en el contexto
la carga falla ruidosamente — `Cannot find module '../../sdk'` — en vez de
encontrar una copia vieja.

Los tests necesitaron una historia propia. Llegan más lejos de lo que el runtime
llegó nunca: más allá del harness del SDK, hasta `core/actions/registry`,
`core/errors` y `core/services/secret-store`, y — en las dos suites de rutas de
vCenter — hasta la aplicación Express entera. Nada de eso se puede vendorizar
sin volverse una copia que deriva, así que el pack resuelve un checkout de
Lintaya por `LINTAYA_REPO` o por un directorio hermano, y cada suite que lo
necesita se salta con una razón impresa cuando no lo hay. El silencio ahí habría
sido la misma trampa que el campo de plataforma: cobertura que deja de cubrir
sin decirlo.

También tuvieron que empezar a pasar el SDK —y `express`— como los pasa el host.
No es un rodeo: un harness que entrega algo distinto de lo que entrega
producción es exactamente cómo el defecto del logger se quedó invisible un día.

Sacar los conectores rompió cinco pruebas de este repositorio y dejó una sexta
pasando por suerte. Las seis leían `connectorManifests`, que se construye con el
directorio de usuario real, así que describían los conectores que tuviera
instalados la máquina de quien las corría. Una afirmaba "catorce conectores" y
seguía en verde solo porque el pack le prestaba seis. Ahora cargan con un
directorio vacío a propósito, y las que usaban un conector movido como fixture
usan uno propio. La suite da 691 con y sin el pack instalado; antes no.

Otro campo resultó ser decoración. `os` lo declaraba `outlook-local` —solo
Windows, por PowerShell y COM— y no lo leía nadie: en Linux o macOS cargaba,
montaba sus rutas y se ofrecía para configurar, y fallaba a la primera llamada
con un error de COM que no nombraba la razón real. El registro ahora no monta un
conector cuya plataforma no es esta, lo deja fuera del planificador, y la tarjeta
lo dice con el propio texto de `requires` en vez de leerse como simplemente
desconectado. `manifest.schema.json` había derivado igual —catorce campos
declarados con `additionalProperties: false` contra diecisiete en uso, y nadie
leyéndolo— y ahora está al día con una prueba que lo sostiene.

De la misma lectura salió algo más chico. `CONFIG_KEY`, `DATA_KEY` y
`STATUS_KEY` se construían a nivel de módulo en seis conectores y se
exportaban, y nadie fuera de esos archivos los leía nunca — ni sus propios
tests. Ahora viven dentro de `register()`, junto al `connectorKeys` que los
construye.

**Fase 4 — compartición.** Diferida hasta terminar las fases 0–3 y haber probado
que el manifiesto aguanta una instalación real fuera del árbol. Las opciones son
una instancia de Lintaya publicando sus conectores a otra sobre el conector
`lintaya-remote` ya existente, o un índice de paquetes firmado. Ninguna vale la
pena diseñarla antes de haber usado el contrato de directorios en serio.

La misma forma apareció una vez más, en el visor de documentación, y esa mitad
está resuelta. Ahora indexa `<conector>/docs/` del directorio instalado junto a
`docs/app/`, como sección propia y no mezclada en "Conectores": lo que se lee
ahí vino con el conector y no con Lintaya, y el árbol debería decirlo en vez de
dejarlo para deducir. Las páginas de los siete que se movieron se quedan aquí
también, porque puede que quieras leer qué hace un tipo antes de instalarlo.

Responderla obligó a replantear por qué ese visor inyecta el markdown
renderizado sin sandbox. La razón era "estas docs están versionadas en este
repositorio", que deja de ser cierta en cuanto un conector instalado puede
aportar una. La razón real es que ese conector ya corre su `index.js` dentro del
proceso del servidor, con la base y el secret store: quien pueda dejar una
carpeta ahí ya es dueño del servidor, así que su markdown no cruza ninguna
frontera que no estuviera cruzada al instalar. La Fase 4 es justo lo que
invalidaría eso — un conector instalado desde un índice remoto que nadie revisa —
y el comentario ahora lo dice, porque una justificación que deja de aplicar en
silencio es cómo la siguiente persona toma con confianza la decisión equivocada.

También tiene que responder una pregunta que este ADR nunca hizo: si un conector
puede ser dueño de su interfaz. Hoy no puede. Un manifiesto nombra un componente
que Lintaya ya cargó — `app/app.jsx` resuelve `window[module.component]` y lo
dice sin rodeos, que "never sends executable UI over the API" — y
`Lintaya.html` carga cada vista con un script tag hardcodeado. Así que las
cuatro vistas que publican los seis conectores se quedan en el `app/` público
aun después de que los paquetes se vayan. Hay un argumento para cambiarlo, ya
que el `index.js` de un conector ya corre en el proceso del servidor y la
frontera de confianza se cruza al instalar, pero es una decisión sobre código
ejecutable venido de un directorio de usuario y merece su propio ADR.

La Fase 0 es la única de la que depende el release público. Las fases 1 y 2
hacen honesto el modelo; la fase 3 lo hace portátil.
