# Connect via MCP

English | [Español](via-mcp.es.md)

Lintaya ships an MCP (Model Context Protocol) server so an AI agent — Claude
Code, or any other MCP-capable client — can call your connectors as tools.
Like the CLI, it's a thin caller: it holds no database connection and no copy
of connector logic, it only calls the same HTTP API the dashboard uses (see
[ADR-011](../../adr/011-connector-actions-rest-mcp.md)). That means **the
Lintaya server must be running and reachable** for these tools to work —
unlike the dashboard's own local state, MCP has nothing to fall back on if the
server is down.

## Setup

Add an entry to `.mcp.json` at the repository root:

```json
{
  "mcpServers": {
    "lintaya": {
      "command": "node",
      "args": ["server/mcp-server.js"],
      "env": { "HQ_TOKEN": "dev-token" }
    }
  }
}
```

`HQ_TOKEN` must match the token the running server was started with. By
default the MCP server calls `http://127.0.0.1:<PORT>` (port 3000 unless
overridden) — set `LINTAYA_API_URL` in the same `env` block to point it at a
different host or port. If a connector uses a self-signed certificate (e.g. an
internal vCenter), also set `NODE_TLS_REJECT_UNAUTHORIZED: "0"`.

## What's available today

Every registered action, across all 13 connector types, is a tool — 31 in
total. Eight are hand-written, with real added value over a raw action call
(derived summaries, filtering):

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

The other 24 are generated straight from the Action Registry, one tool per
action, named `<connectorTypeId>_<actionId>` — `gitlab_sync`, `github_status`,
`plane_create-issue`, `plane_delete-issue`, `outline_delete-document`, and so on for Bitbucket,
Portainer, Qportal, Outlook, Outlook Local, and Anthropic. Each accepts an
optional `connectionId` on top of the action's own input fields, defaulting
to the type id itself — pass a different one to target an extra connection of
the same type (e.g. `gitlab2`, "GitLab CICD").

Every action-backed tool calls
`POST /api/connectors/:id/actions/:actionId`, tagged `actor: mcp` so it shows
up in **Logs → Conectores** like any other write. Destructive actions (such as
Outline's `delete-document` and Plane's `delete-issue`) return
`pending-approval` first. They run only after a local human reviews the exact
request in **Approval Center**; agents cannot approve their own requests.
