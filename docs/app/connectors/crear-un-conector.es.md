# Crear un conector

[English](crear-un-conector.md) | Español


Un conector es una carpeta. Lintaya la encuentra, lee su manifiesto y llama a una
función; no hay lista de registro que editar ni archivo del core que tocar.

## Dónde vive

Si la integración es de utilidad general y se puede mantener en abierto, va en
`server/connectors/community/` del repositorio de Lintaya, y se entrega con el
producto.

Cualquier otra cosa — atada a los sistemas de una organización, o todavía
cambiando de forma — va en el connector pack, un repositorio aparte que se
instala en `~/.lintaya/connectors/`. Ese directorio es plano: una carpeta por
conector, sin carpetas de tier, porque un tier describe cómo organiza el
repositorio de Lintaya lo que *él* entrega y ahí fuera no hay carpeta con la que
concordar.

El segundo caso no es de segunda. El mismo manifiesto, el mismo ciclo de vida,
las mismas pruebas.

## Qué lleva la carpeta

```text
acme/
├── manifest.json
├── config.schema.json
├── index.js
├── client.js
├── routes.js
├── actions.js
├── README.md
├── README.es.md
├── docs/
└── *.test.js
```

`manifest.json` es identidad, tier, capacidades y las páginas o bloques de Home
que el conector publique. `config.schema.json` describe el formulario de
credenciales. `index.js` exporta `register(context)`, la única convención que
el loader busca. `client.js` habla con el proveedor, `routes.js` monta
`/api/connectors/acme/…`, y `actions.js` registra lo que el Action Registry deba
exponer.

El formulario de configuración se genera desde `config.schema.json`, así que un
conector con credenciales normales no escribe UI ninguna.

## Escríbelo dos veces, para dos lectores

`README.md` y `README.es.md` son la página del conector. Lintaya los renderiza
bajo Conectores, y GitHub muestra el inglés cuando alguien abre la carpeta. Los
dos sitios lo enseñan primero, así que ahí va lo primero que alguien necesita:
qué hace el conector, qué configurar, qué publica, qué no puede hacer.

`docs/` es todo lo demás — notas de implementación, el porqué de una clave poco
obvia, los bugs que arregló una migración. Útil, y no lo que un lector necesita
antes que nada. Lintaya también los renderiza, anidados bajo el conector.

Un conector que se entrega con Lintaya pone su página de usuario en
`docs/app/connectors/community/`, porque no hay carpeta instalada de la cual
leerla.

Los dos README, siempre. Un conector documentado en un solo idioma está
documentado para la mitad de quienes van a usarlo, y la mitad que queda fuera no
es la que escribe el código.

## La regla que se le escapa a todo el mundo

Todo lo compartido llega en el contexto que Lintaya entrega a `register()` — el
Connector SDK, `express`, los helpers de almacenamiento y de log. No lo busques
con un `require` relativo:

```js
function registerAcmeRoutes(options) {
  const { createConnectorStore, requestJson } = options.sdk;
  const { app, requireAuth, kvGet, kvSet } = options;
}
```

Un conector instalado fuera del repositorio no puede resolver `../../sdk`, y
llevarse una copia del SDK sería peor que la ruta rota: es la fachada del secret
store del proceso, así que una segunda copia construye un segundo almacén y el
conector lee secretos que el host nunca escribió — en silencio.

## Si solo corre en un sistema

Dilo, y Lintaya no lo ofrece donde no puede funcionar:

```json
{
  "os": ["win32"],
  "requires": "Outlook desktop installed and signed in on this machine"
}
```

El conector no se monta en otra plataforma, no entra al planificador de sync, y
su tarjeta explica qué haría falta en vez de parecer simplemente desconectado.
Omite `os` salvo que el conector esté genuinamente atado — casi ninguno lo está.

## Instalar y comprobar

Copia o clona la carpeta en `~/.lintaya/connectors/` y reinicia. Aparece en
Conectores, sin configurar; ahí le pones sus credenciales. Borrar la carpeta
quita el conector. Un id que choque con uno que Lintaya ya entrega se rechaza al
arrancar, nombrando ambos manifiestos, así que una carpeta en un directorio
personal nunca puede suplantar en silencio a `github`.

## La guía completa

Esta página es la forma del trabajo. Los contratos, las reglas de nombres, el
vocabulario de capacidades, las convenciones de paginación y errores, y el
checklist de revisión viven con el código, en `docs/connectors/` — empieza por
`DEVELOPMENT_GUIDE.md` y completa `REVIEW_CHECKLIST.md` antes de proponer uno.
