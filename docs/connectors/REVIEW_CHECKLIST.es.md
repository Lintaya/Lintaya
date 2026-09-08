# Checklist de revisión de conectores

[English](REVIEW_CHECKLIST.md) | Español

Copiar esta lista al pull request y marcar únicamente elementos verificados.

## Producto y clasificación

- [ ] El ID es genérico y no contiene cliente, región, sitio o ambiente.
- [ ] La carpeta corresponde a community, enterprise o development.
- [ ] Tier, lifecycle y licencia se decidieron por separado.
- [ ] El manifiesto declara solo capacidades implementadas.
- [ ] La versión sigue SemVer.

## Paquete

- [ ] Contiene manifest, schema, entry point, client, routes, tests y README.
- [ ] Usa modo de implementación package.
- [ ] Importa servicios compartidos desde connectors/sdk.
- [ ] No realiza red, escritura, timers o procesos al importarse.
- [ ] La lógica del proveedor no vive en server.js.

## Seguridad

- [ ] Secretos marcados writeOnly y x-lintaya-secret.
- [ ] Config, responses, status y logs nunca exponen credenciales.
- [ ] URLs y protocolos se validan.
- [ ] TLS inseguro no está habilitado por defecto.
- [ ] Timeout, cancelación, rate limit y errores están normalizados.
- [ ] Paginación, concurrencia y tamaño tienen límites.
- [ ] Test y sync no escriben remotamente.
- [ ] Cada mutación remota tiene una acción de Action Registry con schemas y efecto explícito.
- [ ] Cada acción destructiva crea `pending-approval` antes de cualquier llamada al proveedor.
- [ ] Ninguna ruta destructiva llama al proveedor directamente; un alias legacy solo delega a la acción y falla cerrado.

## Contratos

- [ ] Config/test/sync conservan el contrato lifecycle.
- [ ] Los datos se mapean al modelo normalizado.
- [ ] Fechas, IDs, nulls y estados usan formatos comunes.
- [ ] Cloud y self-hosted preservan su base path.
- [ ] Cambios incompatibles incluyen migración y versión apropiada.

## Diseño y accesibilidad

- [ ] Logo, tier, lifecycle y estado son indicadores separados.
- [ ] Cada Connection es un artículo/tarjeta dentro de una lista etiquetada;
  abrir detalle usa un botón nativo y no un div clickable.
- [ ] El formulario tiene labels, ayuda y errores accionables.
- [ ] Los controles solo-ícono tienen nombre accesible y los controles
  seleccionados exponen su estado.
- [ ] Los secretos no se vuelven a mostrar después de guardarse.
- [ ] Loading, empty, success y error están diseñados.
- [ ] Funciona con teclado, foco visible y lector de pantalla.
- [ ] Cada diálogo tiene nombre accesible, Escape, focus trap y retorno de foco.
- [ ] Los valores `data-lintaya-*` son solo metadata estable; no contienen
  secretos, prompts, IDs privados ni estado serializado.
- [ ] No hay overflow a 393 px y se verificaron los viewports definidos.
- [ ] Claro/oscuro y reduced motion funcionan correctamente.

## Contrato de agente

- [ ] ConnectorType pertenece al manifest/registry y Connection posee su
  configuración, referencias a secretos, status, datos sincronizados y nombre.
- [ ] La implementación no trata HTML, CSS, texto visible ni atributos `data-*`
  como una API de agente.
- [ ] Lecturas/escrituras para agentes usan endpoints autenticados y schemas
  documentados; las escrituras usan Action Registry cuando corresponde.
- [ ] Un agente consulta el AI context de la Connection antes de crear o editar datos.
- [ ] Las escrituras iniciadas por agente incluyen `X-Actor`, se auditan y
  respetan el riesgo/aprobación de la acción.
- [ ] El agente registró el inventario de operaciones remotas del conector y leyó la regla obligatoria de Approval Center.
- [ ] Las superficies públicas de descubrimiento se prueban para excluir
  configuración privada, hostnames internos, datos de usuario, prompts
  editables y secretos.

## Pruebas y documentación

- [ ] Manifest y JSON pasan validación.
- [ ] Cliente y mapper tienen fixtures ficticios.
- [ ] Rutas tienen pruebas sin puerto, SQLite o red externa.
- [ ] Existe una prueba explícita de redacción de secretos.
- [ ] npm run test:connectors pasa.
- [ ] npm run check pasa.
- [ ] La detección de secretos pasa.
- [ ] README documenta permisos, límites, TLS y compatibilidad.
- [ ] Changelog y roadmap están actualizados.
- [ ] El diff no incluye cambios ajenos al conector.
