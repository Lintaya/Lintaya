# Lintaya

English | [Español](introduccion.es.md)

Lintaya's core runs locally without configuring a connector. Connectors add
provider data and operations to that workspace.

## Capabilities without connectors

| Capability | What works locally |
|---|---|
| Devices | Create, edit and delete network inventory with management address, vendor, model, SSH user/port, tags and notes. |
| Blocks | Write and edit Markdown content. Connector feeds require their connection. |
| Boards | Arrange reusable blocks into zones, resize them and manage saved boards. |
| Dashboards | Group boards into tabs and present them. |
| Workspace | Home, navigation, appearance and language settings, documentation and authenticated local API. |

Devices is part of the core. Its saved status is inventory data, not proof of
automatic monitoring. SSH needs a reachable host and valid credentials; vault
password retrieval additionally needs the vault integration unlocked. VMware
inventory, containers and provider tasks require their respective connectors.

## Code and folder structure

| Folder or file | Responsibility |
|---|---|
| `Lintaya.html` | Loads the frontend scripts; no bundler is required. |
| `app/` | UI: `devices.jsx`, `home.jsx`, `block-catalog.jsx`, `block-builder.jsx`, `module-builder.jsx`, `custom-page-view.jsx`, `dashboard.jsx` and `documentation.jsx`. |
| `server/app.js`, `server/server.js` | Authentication, Express application and route/service wiring. |
| `server/routes/` | Core APIs, including `devices.js`, `home.js`, `custom-blocks.js`, `dashboards.js`, `ssh.js` and `documentation.js`. |
| `server/core/` | Shared services, storage, migrations and infrastructure. This folder alone is not the entire product core. |
| `server/connectors/sdk/` | Shared connector contracts and helpers. |
| `server/connectors/community/` | Connector packages shipped with the repository. |
| `~/.lintaya/connectors/` | Separately installed connector packages, each in its own folder. |
| `docs/app/` | Documentation shown in the app. |

The Lintaya documentation tab groups the existing `block/`, `module/` (Boards)
and `dashboard/` pages. This overview lives in `docs/app/lintaya/`; existing page
paths remain valid. Devices and the core are described here, while each connector
documents its own capabilities separately.
