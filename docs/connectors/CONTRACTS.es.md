# Contratos de conectores

[English](CONTRACTS.md) | Español

Estado: referencia de implementación actual. Este catálogo lista los ConnectorTypes
incluidos en este repositorio. Una instalación configurada es una **Connection**
de uno de estos tipos. Complementa la [guía de desarrollo](DEVELOPMENT_GUIDE.md),
que define cómo debe construirse un conector nuevo o modificado.

## Contrato común

Cada paquete tiene un `manifest.json` validado durante el arranque. Su `id` es
la identidad estable del tipo; una Connection puede usar un ID de instancia
distinto, como `gitlab2`. `tier` y `lifecycle` describen clasificación y
madurez, no licencia comercial. `capabilities` solo declara operaciones de
producto implementadas; no concede credenciales ni aprobación de agentes.
`blocks`, `modules` e `instantiable` declaran aportes UI opcionales y si el
tipo puede tener Connections con nombre separado.

`GET /config` nunca devuelve campos `writeOnly` / `x-lintaya-secret`. El ciclo
normal es `POST /config`, `POST /test` y luego `POST /sync`; test y sync leen
al proveedor y no lo modifican intencionalmente. Los paquetes SDK dejan
configuración pública, estado y datos sincronizados bajo `connector-config-<connection-id>`,
`connector-status-<connection-id>` y `connector-data-<connection-id>`.
Las cachés son snapshots locales y pueden estar desactualizadas.

## ConnectorTypes incluidos

| Tipo | Manifiesto: tier / lifecycle / capacidades | Configuración y secretos | Sync y caché local | Límites, compatibilidad y límite conocido |
|---|---|---|---|---|
| Anthropic | Community / beta · `usage.read`, `usage.local-transcripts`, `costs.read` | Ruta de transcripciones, lookback 1–365 días, métrica/ventanas opcionales; Admin API key secreta opcional. | Agrega JSONL local de Claude Code y reportes opcionales de organización; `calibrate` persiste límites de cuota derivados por usuario. | Máximo 400 archivos de transcripciones; lookback por defecto 30 días. Solo ve esta máquina; costo es estimación de lista y límites de suscripción requieren observación o calibración. |
| Bitbucket | Community / beta · `repositories.read`, `repositories.clone`, `pull-requests.read`, `commits.read` | Cloud: username + token secreto, workspace opcional. Server/DC: base URL + token personal secreto. | Guarda proyectos, deployments y commits normalizados; aporta módulo de repositorios. | Máximo 10 páginas. TLS con certificado privado self-hosted es compatibilidad histórica y debe hacerse explícito antes de stable. |
| Bitwarden CLI | Community / beta · `vault.status`, `server.health`, `items.count` | Requiere URL de servidor; e-mail, API client ID y client secret opcionales. | Refresca estado CLI y conteo de elementos que el módulo vault dejó en caché; aporta módulo Passwords. | Vault bloqueado es normal. Lecturas reales usan `/api/vault/*`, necesitan desbloqueo tras reinicio y no son datos de caché del conector. |
| GitHub | Community / beta · `repositories.read`, `repositories.clone`, `pull-requests.read`, `deployments.read`, `workflows.read`, `commits.read` | Base URL por defecto es GitHub Cloud; se soporta raíz API GitHub Enterprise. Token fine-grained/clásico es secreto. | Guarda repositorios, deployments y commits; aporta tres bloques y módulo de repositorios. | 10 × 100 repositorios; por repositorio: 10 deployments, 5 commits, 1 workflow, 100 PRs abiertos. Fallo de enriquecimiento no descarta el repositorio. |
| GitLab | Community / beta · `repositories.read`, `repositories.clone`, `pull-requests.read`, `deployments.read`, `workflows.read`, `commits.read` | Requiere base URL de instancia y Personal, Project o Group Access Token secreto. | Guarda proyectos, deployments y commits; aporta bloque recent-commits y módulo de repositorios. | 10 × 100 proyectos; por proyecto: 10 deployments, 5 commits, 1 pipeline, 100 MRs abiertos. TLS privado/self-signed es compatibilidad histórica. |
| Outline | Community / beta · `collections.read`, `documents.read`, `documents.write`, `documents.delete` | Requiere base URL raíz y API key secreta con permisos collection/document. | Guarda colecciones y resúmenes de documentos; detalle es vivo. Create/delete operan remotamente; delete es papelera recuperable. | Collections y documents se detienen a 10 × 100 elementos cada uno. TLS de certificado privado es una brecha beta de compatibilidad. |
| Plane | Community / beta · `projects.read`, `projects.write`, `issues.read`, `issues.write`, `modules.write`, `members.read`, `members.write` | Requiere API key secreta y workspace; base URL se normaliza para excluir `/api` y `/api/v1`. | Guarda proyectos, issues, miembros, módulos, user ID y proyectos truncados; rutas list en caché no llaman Plane. | Timeout 10 segundos; páginas issues de 100 elementos con guarda de 100 páginas por proyecto. Efectos destructivos gobernados por agentes esperan Action Registry/política de aprobación. |
| Portainer | Community / beta · `containers.read`, `endpoints.read`, `logs.read` | Requiere base URL y API key secreta, o username + password secreto; la key gana si existen ambas. | Guarda endpoints y contenedores normalizados; lecturas inspect/log pueden ser vivas. | Timeout JSON 12s, logs 15s. Un endpoint fallido queda vacío sin fallar todo sync. Verificación TLS está desactivada para compatibilidad self-hosted. |
| Outlook Local | Development / development · `mail.read`, `mail.send`, `calendar.events.read`, `contacts.read` | No almacena credencial; SMTP de cuenta local y límite recent 1–50 opcionales. | Guarda correo reciente; recent/sent/agenda refrescan cortes locales. Expone rutas de cuentas, contactos, correo, envío, respuesta, reenvío y borrador. | Solo Windows y Outlook Win32 clásico, timeout COM 20 segundos. Send/reply/forward son escrituras aún no clasificadas por Action Registry. |
| Outlook Calendar | Development / development · `calendar.events.read`, `identity.read` | Requiere client ID de Entra; tenant opcional; refresh token rotativo es secreto y se obtiene por device-code OAuth. | Guarda identidad autenticada y siguientes siete días de ocurrencias de calendario expandidas; device code temporal vence absolutamente. | Madurez development; necesita app Entra y permisos Graph. Sin client ID es distinto de cuenta no enlazada; horas usan preferencia México Central. |
| Qportal | Enterprise / beta · `metrics.read`, `requests.read`, `vrf-catalog.read`, `assigned-resources.read` | Requiere base URL, e-mail, password secreto; token manejado en caché es secreto. | Guarda métricas, requests de primera página, catálogo VRF, recursos asignados y metadata de paginación; filtros request son en caché y métricas vivas. | Timeout 15 segundos; solo se guardan los primeros 100 requests y total puede ser cota superior. VPN suele ser requerida; HTTP histórico puede reportar payload inválido como test exitoso. |
| UCS Manager | Enterprise / beta · `chassis.read`, `blades.read`, `inventory.read` | Requiere username, password secreto, `hosts.MEX` y `hosts.GDL`; sitios comparten credenciales. | Guarda chassis/blades por sitio. Test inicia/cierra sesión en ambos; sitio fallido deja caché previa en vez de inventario parcial. | Timeout XML `/nuova` 12s; errores auth pueden ser HTTP 200 y se analizan desde XML. TLS self-signed y acceso VPN a ambos VIPs son requisitos actuales. |
| VMware vCenter | Enterprise / beta · `vms.read`, `hosts.read`, `clusters.read`, `datastores.read`, `networks.read`, `tags.read` | Requiere URL host, username y password secreto para sesiones REST y SOAP. | Guarda inventario, tags y mapas derivados en histórico `vcenter-data-<connection-id>`; config/status usan claves connector. Rutas antiguas `vc-mex` siguen compatibles. | REST/SOAP degradan independientemente; sync fallido conserva inventario previo. Parsing SOAP y cliente MCP duplicado son deuda técnica; certificados requieren revisión antes de stable. |

## Leer detalles del proveedor

La tabla es resumen de contrato, no reemplaza pruebas del paquete. Cada
proveedor tiene README de implementación junto a su manifiesto bajo
`server/connectors/`; úsalo para particularidades API, comportamiento por ruta
y diagnóstico. El [checklist de revisión](REVIEW_CHECKLIST.md) es obligatorio
al cambiar un manifiesto, schema de configuración o capability.

## Compatibilidad y seguridad

Los IDs de Connection, incluidos IDs históricos de ruta, mantienen
compatibilidad durante la migración ConnectorType/Connection. No infieras una
capability desde un campo en caché, botón UI o endpoint histórico: consulta el
manifiesto y contrato de ruta. Reporta vulnerabilidades mediante la [política de seguridad](../../SECURITY.md)
del repositorio y nunca adjuntes tokens de producción, hostnames privados,
exportaciones de vault ni datos sincronizados a un issue.
