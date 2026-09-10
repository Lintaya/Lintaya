# Settings

English | [Español](ajustes.es.md)

Open **Settings** from the gear button at the bottom of the sidebar. The page
groups local account preferences, application behavior, server synchronization,
backups, and instance information.

## Account

### Profile

Set the name and role shown at the bottom of the sidebar. The **API token** is
used by this browser as `Authorization: Bearer` for protected requests. The
server does not return the token. **Sign out** removes the token from this
browser; it does not delete server data.

### AI Assistant

Configure the provider used by the Assistant. Depending on the provider, the
form can contain an API key, base URL, model, and optional credentials. The
server may resolve the configuration through LiteLLM, an OpenAI-compatible
endpoint, Ollama, opencode, or another supported provider. Save applies the
configuration immediately; remove clears the saved provider settings.

## Application

### Appearance

Choose dark mode, the accent color, the application font, and whether the
sidebar is spacious or compact. These preferences are stored in this browser
and apply immediately.

### Language

Choose the interface language. It changes menu labels, controls, and built-in
messages; connector-provided documentation may have its own translation
availability.

### Navigation

Show or hide sidebar links and reorder them. Links remain available in Settings
even when hidden from the main sidebar. Group controls expand or collapse a
navigation group; moving an item changes its order within the application.

### Views

Select the default layout for the VM list: table, cards, or compact grid. This
changes presentation only; it does not change the stored inventory.

## System

### Synchronization

Automatic synchronization runs on the server, not in the browser. Enable or
disable it and set the fast interval for most connectors or the slower interval
for heavy vCenter synchronization. A connector can define its own effective
interval from its detail panel.

### Backups

Export an encrypted `.lhq` backup containing primary data, connector
configuration, and repository settings. The backup password must have at least
12 characters and is never stored by Lintaya. The master password and the
Bitwarden session are not exported.

Restoring replaces the current data. Before restoring, Lintaya creates an
encrypted recovery point on the server and locks the vault. Type `RESTORE` to
confirm the irreversible replacement, then restart Lintaya after a successful
restore.

## Information

### About

Shows the running Lintaya version, the remote protocol capability, and
information about remote connections. When testing a remote instance, compare
its version with the expected version before sending changes.

## What each control does

### Profile actions

- **Name** changes the name and avatar initials shown in the sidebar.
- **Role** changes the text shown below that name.
- **Sign out** clears the API token from this browser and reloads the login
  flow. It does not delete server data; the token must be entered again.

### AI Assistant details

Supported providers are **Anthropic (Claude)**, **OpenAI**, **opencode**,
**Ollama**, **OpenAI-compatible**, and **LiteLLM proxy**. Anthropic currently
offers `claude-haiku-4-5` and `claude-sonnet-4-5`; OpenAI offers `gpt-4o-mini`
and `gpt-4o`. Ollama, opencode, LiteLLM, and compatible endpoints obtain their
models from the configured server: enter a base URL and select **Find models**,
or type the model identifier manually.

Use the matching API key for Anthropic or OpenAI. Ollama defaults to
`http://127.0.0.1:11434/v1`; opencode normally uses
`http://127.0.0.1:4096` and may require username/password. LiteLLM and other
compatible services require their own base URL and credentials. Saved secrets
are masked and never returned to the browser. **Save** applies the selection;
**Remove** clears the stored provider configuration.

### Appearance, navigation, and views

Choose Blue, Cyan, Violet, Orange, Green, or Red; Geist, IBM Plex, or System
UI; and a spacious or compact sidebar. Toggle each sidebar link, use the
up/down buttons to reorder it, or collapse a whole group. Hiding a link does
not delete its route or data. For VM views, choose **Table**, **Cards**, or
**Grid**; this changes presentation only.

### Synchronization actions

Use **Enabled** to pause scheduled synchronization while keeping manual sync
available. The fast interval accepts 1–180 minutes; the slow vCenter interval
accepts 1–360 minutes. The page shows each connector's effective interval and
whether it has a custom override.

### Backup actions

To export, enter a password of at least 12 characters and select **Download
`.lhq`**. To restore, select the `.lhq` file, enter its password, type `RESTORE`,
and choose **Restore data**. Restore replaces current data, creates a recovery
point first, and locks the vault, so treat it as destructive.
