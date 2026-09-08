# Devices

English | [Español](introduccion.es.md)

Devices is Lintaya's core network inventory. Register devices manually without
configuring an inventory connector.

## Manage inventory

Save a name, type and management address, with vendor, model, operating system,
location, serial number, tags and notes. Configure the SSH user and port too.
Saved devices can be edited or deleted. Inventory status is separate from SSH
session status and does not confirm live reachability.

## Add a device step by step

1. Open **Devices** and use the add-device button.
2. Fill in **Hostname / Name**, select **Device type** and enter **Management IP**.
3. Check **SSH User** and **SSH Port**.
4. For Bitwarden, select an item in **SSH Credential (from vault, optional)**, or leave it empty.
5. Optionally enter location, serial number and tags, then save.
6. Open SSH from the saved device to connect.

| Field | Required | Value |
|---|---|---|
| Hostname / Name | Yes | Display name, such as `office-switch`. It does not replace the management address. |
| Device type | Yes | Select the equipment type. |
| Management IP | Yes | Connection address, such as `10.0.0.25`. The form accepts text; a DNS name must resolve from the Lintaya server. |
| SSH User | Has a default | Remote account; defaults to `admin`. |
| SSH Port | Has a default | Defaults to `22`; use the actual SSH port, from 1 to 65535. |
| SSH Credential | No | Vault item supplying the connection password. |
| Location, Serial Number, Tags | No | Inventory metadata; separate tags with commas. |

The name and address are separate: `office-switch` can connect to
`10.0.0.25`. Do not enter an HTTPS URL or append a port to Management IP;
the port has its own field.

## Manual password or Bitwarden

**Without Bitwarden:** leave SSH Credential empty. The terminal asks for a
password when connecting. The creation form has no password field; inventory
can be saved before credentials are available.

**With Bitwarden:** configure its connection in Connectors, unlock the vault
and check that the password item is available in Passwords. Select it during
device creation, or link a credential from the saved device. Lintaya stores the
item reference and retrieves its password when connecting.

The device's **SSH User remains the login account**, even if the Bitwarden item
shows a different username. For example, use name `office-switch`, address
`10.0.0.25`, user `operator`, port `22` and vault item `Office switch`.
The password comes from that item, while the login account is `operator`.

If the picker is empty, check that vault credentials are available. For a failed
connection, check network/VPN access, address, port, username and password, and
ensure the vault is unlocked if using Bitwarden.

## SSH access

Open SSH from a device. Connections need network access and valid credentials.
You can associate a vault item; retrieving its password requires a configured,
unlocked vault.

Keep several sessions open in tabs or a grid. See [SSH](../ssh/introduccion.md)
under Lintaya for connection colors, reconnecting, copying output and sending a
command to multiple sessions.

## Implementation

- `app/devices.jsx`: inventory, editing and credential associations.
- `server/routes/devices.js`: inventory API and persistence, including vault mappings.
- `app/vms.jsx`: shared terminal and SSH workspace components.
- `server/routes/ssh.js`: server SSH sessions.
- `app/app.jsx`: navigation and sidebar session indicators.

The shared SSH components in `vms.jsx` also serve Devices. Their code location
does not make Devices a VMware connector.
