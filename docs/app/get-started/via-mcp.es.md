# Conectar por MCP

[English](via-mcp.md) | Español

Lintaya incluye un servidor MCP (Model Context Protocol) para que un agente de
IA — Claude Code, o cualquier otro cliente compatible con MCP — pueda invocar
tus conectores como herramientas. Igual que la CLI, es un llamador delgado: no
mantiene conexión a base de datos ni copia la lógica de conectores, solo llama
a la misma API HTTP que usa el dashboard (ver
[ADR-011](../../adr/011-connector-actions-rest-mcp.md)). Eso significa que
**el servidor de Lintaya debe estar corriendo y accesible** para que estas
herramientas funcionen — a diferencia del estado local propio del dashboard,
MCP no tiene nada a lo que recurrir si el servidor está caído.

## Configuración

Agrega una entrada a `.mcp.json` en la raíz del repositorio:

```json
{
  "mcpServers": {
    "lintaya": {
      "command": "node",
      "args": ["server/mcp-server.js"],
      "env": { "LINTAYA_TOKEN": "dev-token" }
    }
  }
}
```

`LINTAYA_TOKEN` debe coincidir con el token con el que se inició el servidor en
ejecución. Por defecto el servidor MCP llama a `http://127.0.0.1:<PORT>`
(puerto 3000 salvo que se indique otro) — define `LINTAYA_API_URL` en el
mismo bloque `env` para apuntarlo a otro host o puerto. Si un conector usa un
certificado autofirmado (por ejemplo, un vCenter interno), define también
`NODE_TLS_REJECT_UNAUTHORIZED: "0"`.

## Qué hay disponible hoy

Cada acción registrada, en los 13 tipos de conector, es una herramienta — 31
en total. Ocho son escritas a mano, con valor real agregado sobre una llamada
de acción cruda (resúmenes derivados, filtrado):

```text
vcenter_summary          vms/hosts/clusters/datastores counts, last sync
vcenter_list_vms         filter by power state, env, name
vcenter_find_vm          look up one VM by name
vcenter_list_hosts       filter by connection state
vcenter_sync             trigger a fresh sync from vCenter
bitwarden_status         server health + CLI login status
bitwarden_list_items     names/users/folders — never passwords
bitwarden_get_password   requires the vault already unlocked via the Passwords page
```

Las otras 24 se generan directo desde el Registro de acciones, una
herramienta por acción, nombradas `<connectorTypeId>_<actionId>` —
`gitlab_sync`, `github_status`, `plane_create-issue`, `plane_delete-issue`,
`outline_delete-document`, y así para Bitbucket, Portainer, Qportal, Outlook,
Outlook Local y Anthropic. Cada una acepta un `connectionId` opcional además
de los campos propios de la acción, con el id del tipo como valor por
defecto — pasa uno distinto para apuntar a una conexión extra del mismo tipo
(por ejemplo `gitlab2`, "GitLab CICD").

Toda herramienta respaldada por una acción llama a
`POST /api/connectors/:id/actions/:actionId`, etiquetada `actor: mcp` para
que aparezca en **Logs → Conectores** como cualquier otra escritura. Las
acciones destructivas (como `delete-document` de Outline y `delete-issue` de
Plane) primero devuelven `pending-approval`. Solo se ejecutan cuando una persona
local revisa la solicitud exacta en **Approval Center**; un agente no puede
aprobar su propia solicitud.
