# SSH

English | [Español](introduccion.es.md)

Lintaya opens interactive SSH terminals in the browser and keeps them running on
the server. The terminal you see is a client attached to a session the server
owns, not a connection made by the browser, so closing a tab does not end the
work happening on the other side.

## Open a session

SSH is not a sidebar entry of its own. A session is opened from whatever you
are looking at, and the workspace appears once the first one exists:

| Open from | What connects |
|---|---|
| VMs | The virtual machine, using the credential mapped to it. |
| Devices | The device, using its management address. |
| Containers | The container's host VM, then `docker exec` into the container. |

Every open session is listed in the sidebar under the module it was opened
from, so a terminal started from Containers stays visually attached to
Containers. Selecting one focuses its terminal in the workspace.

## Several sessions at once

Sessions are concurrent by design. You can hold terminals to different machines
at the same time and switch between them without any of them disconnecting.

Two different rules keep that from turning into duplicates:

- **In the interface**, a machine you already have open is not opened twice.
  Asking again focuses the existing terminal.
- **On the server**, a request for a host and user that already has a live
  session reattaches to it instead of dialling a second one. The response says
  so explicitly, and both clients then see the same output.

That second rule is what lets the same session be watched from more than one
place — a second browser, or the same browser after a reload. The server keeps
the last 64 KB of output and replays it to a client that attaches late, so a
reattached terminal is not blank.

A session with no clients attached stays alive for ten minutes and then closes
on its own. Reloading the page or losing the network briefly does not cost you
the session.

## Where the password comes from

You are not asked to type a password for each connection. The server resolves
one, in this order:

1. A password supplied directly with the request.
2. A vault item chosen for this connection.
3. The vault item mapped to the machine, when the request only identifies a VM.

The third case is the usual one. The machine-to-vault mapping can also carry the
user name, the port, and a jump host, so a machine that needs something other
than the defaults connects correctly without asking again.

**The vault must be unlocked.** Passwords are read from it at connection time,
and a locked vault stops the attempt with a message telling you to unlock it
first. A vault lookup that fails for any other reason is reported as a lookup
failure rather than a wrong password, so a transient problem is not mistaken
for a bad credential.

## Jump hosts

A machine that is not reachable directly can be reached through a jump host. The
jump host has its own entry in the mapping and its own vault item, so the
bastion's credential is never assumed to be the target's. Lintaya opens the
connection to the jump host first and tunnels the session through it.

## What is recorded

Every session writes a transcript on the server, under `server/ssh-logs/`, named
by date, address, user, and session id. Terminal control sequences are stripped,
so the file reads as plain text rather than as a screen recording.

Those transcripts are what the **SSH Logs** module lists and displays. They stay
on disk after the session ends, which makes them the record of what was run;
treat them accordingly, because anything typed into a terminal — including a
password typed at a prompt inside the session — is in them.

## Connection colors

| Indicator | Meaning |
|---|---|
| Amber | Connecting to the host. |
| Green | Connected session. |
| Red | Connection or authentication failure. |
| Gray | Closed session; the terminal also uses gray during initial loading. |

The sidebar uses amber for initial loading. These indicators describe the SSH
session, not overall device health. Reconnect is offered for closed or errored
sessions; authentication failures require checking credentials.

## Multiple terminals

Use **+ Add Session** to return to inventory and open another host. With multiple
sessions, choose a single terminal in tabs or a split grid showing all terminals.
With one session remaining, the workspace returns to tabs. **Copy** copies the
active terminal output. The cross closes one session; **Close all** closes all.

## Broadcast

1. Open the destination sessions.
2. Enable **Broadcast**; the amber button reads **Broadcast ON**.
3. Type a command in the broadcast bar and press Enter or the send button.
4. Disable Broadcast when finished.

Sending appends a newline and targets every open WebSocket connection in the
terminal workspace, including tabs you are not viewing. There is no individual
recipient picker. Normal typing remains local to its terminal; only input sent
from the broadcast bar is replicated. Check the open hosts before sending,
since the command may execute on all of them.
