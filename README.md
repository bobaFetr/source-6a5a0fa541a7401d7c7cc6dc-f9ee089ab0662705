# Northstar Server Console

## Health overview and alerts

Overview includes read-only CPU, RAM availability, memory stall pressure (PSI),
root filesystem capacity, failed systemd services, cached APT updates, and
Ubuntu's reboot-required marker. Health checks continue across dashboard tabs
while connected, repeating 10 seconds after each check finishes. Readings older
than 25 seconds are labelled delayed; slow results cannot resolve current alerts.
Checks tolerate a busy VM for up to 90 seconds and retry after failures.

Alerts trigger for CPU or RAM use at least 90%, or memory PSI avg10 at least 10%,
observed for 30 seconds without observation gaps exceeding 30 seconds. Root disk
usage at least 90%, failed services, cached security updates, and reboot-required
status raise immediate alerts. Missing checks stay unavailable and cannot resolve
an existing alert. CPU excludes I/O wait and steal time; RAM use here is based on
MemAvailable, which includes reclaimable cache, rather than top's used field.

The latest 100 accessible journal records are checked for crash/OOM/lockup
evidence. These become recorded incidents, not claims that a crash is still active.
This bounded check does not capture every incident; Events provides a broader
journal query. Package lists are read from the local APT cache without running
apt update or installing packages. The cache directory timestamp is not proof
that every package list is current.

The Alerts tab provides status/severity filters, search, acknowledgement,
JSON export, and clearing historical incidents. Up to 200 incidents and 1,000
journal deduplication IDs are saved in browser localStorage per server and user,
without connection credentials. Active incidents remain until a known fresh
check verifies recovery. Acknowledgement does not resolve an alert. Monitoring
and recovery checks stop on Disconnect or closing the app; there is no background
agent, email notification, or monitoring while the browser is closed.

Local Ubuntu VM management through password-authenticated SSH.

## Start locally

```powershell
npm.cmd install
npm.cmd run dev
```

Open http://127.0.0.1:3000. Enter the VM host, SSH port, Ubuntu username,
and that user's password. The dashboard opens only after the VM accepts the
password and the overview command succeeds. Incorrect credentials fail the connection.
There is no SSH-key fallback or simulated connection mode.

## Prepare the VM

1. Install OpenSSH in Ubuntu: `sudo apt install openssh-server`.
2. Ensure SSH password authentication is enabled for your Ubuntu user. Accounts
   requiring keyboard-interactive/MFA authentication are not supported by this version.
3. Use the VM's reachable host-only/bridged IP and port 22, or configure NAT forwarding
   from host `127.0.0.1:2222` to guest port `22`.
4. Connect once from PowerShell with `ssh -p 2222 ubuntu@127.0.0.1`, replacing the
   coordinates as needed. Verify the host fingerprint against the VM console before
   accepting it. `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` shows the VM's
   ED25519 fingerprint. Northstar verifies host keys against this Windows user's
   default `~/.ssh/known_hosts`, using the installed OpenSSH `ssh-keygen` command.
5. Enter those same coordinates and the Ubuntu user's password in Northstar.

## Live tools

System overview, processes, storage, running services, journal, Docker listing,
and confirmed container start/stop/restart by ID. The Processes view streams completed top CPU samples (3 seconds by default; selectable 1, 2, 3, or 5 seconds) over a single authenticated SSH connection; other views refresh on demand. Process updates can be paused, stop when you leave the view, and automatically reconnect after transient failures with a bounded 1?10 second backoff. Authentication, host-key, and invalid-request errors require correction before resuming.
Docker operations require existing Docker permissions for the Ubuntu user.
Dashboard actions do not invoke sudo. Dedicated file editing, firewall, user, and package-management views are not implemented.

## Visual task manager

**Processes** keeps the raw `top` process listing and adds CPU/RAM gauges,
CPU/RAM/I/O-wait history, task counts, load averages, buffers/cache, and swap usage.
Both views use the same completed SSH sample. History stores up to 120 samples
in memory while the Processes view is open; it is not historical monitoring storage.
Unavailable summaries show as unavailable. Pause and stream errors retain the last
sample with an explicit status. Whole-server CPU is normalized to 100%; individual
process CPU in `top` can exceed 100%. The CPU gauge sums user, system, nice, and
interrupt execution time, excluding I/O wait and VM steal time. Memory summaries
are collected in KiB to reduce rounding error. I/O wait is distinct from disk usage and throughput.
The monitor runs one continuous top process. The first lifetime-average frame is
discarded; subsequent frames are emitted once the next header confirms completion.
Initial collection takes about two sampling intervals, then results arrive at the
selected interval with a one-interval completion delay. Sample timestamps identify
the frame's measurement time. History charts auto-scale with labelled percentage
axes to reveal small real changes; unchanging measurements remain flat.
CPU, RAM, and I/O-wait charts display a fixed rolling 60-second window with line
traces only. Each new sample shifts earlier values left; values older than the
window disappear. The window freezes while paused and advances on the next sample.

## Programs

Open **Programs** to list installed APT/DPKG packages with name, version, and
architecture. Snap and Flatpak packages are also listed when their tools are
available. Includes system packages and libraries; manually copied binaries and
language-specific packages are not inventoried. Use **Refresh** after installing
or removing software. Listing is read-only and does not use sudo.

## File Explorer

Open **File Explorer** after connecting to browse the VM through SFTP. Start at `/`,
use **Home** for the SSH user's home directory, click folders/breadcrumbs, or enter
an absolute Linux path. Hidden files are shown by default. Directory entries show
size, modification time, numeric permissions, and owner UID/GID. Listings are paged
in groups of 200; filtering applies to the current page. Refresh after directory changes.

Click a regular file for a read-only UTF-8 preview (first 64 KB). Binary files show
metadata instead of text. Symbolic links resolve to their target; devices, sockets,
and other special files are not opened. The browser does not modify server files.
Access uses the logged-in user's Linux permissions; protected directories such as
`/root` may be denied. The VM must have the SFTP subsystem enabled in OpenSSH.

## Interactive Ubuntu terminal

After connecting, open **Terminal**. This opens a real SSH shell with a pseudo-terminal
on the VM as your logged-in Ubuntu user. Commands, current directory, history,
Ctrl+C, Tab completion, sudo password prompts, and interactive programs such as
`top` and `nano` use the remote shell. It is independent of the VM console session.
The terminal resizes with the browser. Leaving Terminal, Disconnect, or closing
the page closes the SSH shell; background jobs explicitly detached on Linux may
continue. Use Reconnect after exiting a shell.

Restart `npm.cmd run dev` after installing this update so the local WebSocket
endpoint is registered. Terminal access is available only in local development.
The shell uses your Ubuntu account permissions, including any sudo access you
invoke. Unlike dashboard buttons, commands typed here are unrestricted shell input.
No terminal commands, output, or passwords are logged or persisted by Northstar;
the remote shell may write its normal Linux history.

### Shared Bash command history

For Bash sessions of the same Linux user, install
`scripts/bash-history-sync.bash` as `~/.config/northstar/history-sync.bash` and add
`. "$HOME/.config/northstar/history-sync.bash"` at the end of `~/.bashrc`.
Back up `.bashrc` and `.bash_history` before changing these settings.
Also replace earlier finite `HISTSIZE`/`HISTFILESIZE` assignments with `-1` so
startup does not truncate history before the shared-history hook is loaded.

The hook appends pending commands and reloads shared history at each prompt,
preserving existing prompt hooks. It enables history for commands with leading
spaces and duplicates, with unlimited Bash history retention. `history`, Up/Down,
and Ctrl+R then use the shared server-side history; Northstar does not maintain
a separate browser history database. Hidden password prompts are not shell commands.

Reconnect Northstar and open a new server terminal, or run `source ~/.bashrc`
once in each already-open Bash session. Press Enter at an empty prompt to pull
commands written by another session. Commands never saved by an older session
cannot be recovered from disk; source the configuration there while that session
is still open to append its pending commands. History belongs to the logged-in
user; root or other users have separate histories. This setup is for Bash.

## Password handling and local scope

The password travels to the loopback backend in a POST request (or the first terminal WebSocket message) and is used by the
SSH library over the encrypted SSH connection. It is never placed in command-line
arguments, written to files, logged, or saved to browser storage by the app. It remains
in browser memory while connected so later operations can authenticate, and is cleared
on a failed connection or Disconnect. Each one-off operation reauthenticates with the supplied password. The process monitor authenticates once and keeps SSH open until paused or disconnected. Reloading the page requires signing in again.

The gateway accepts same-origin requests on the loopback development server only;
production builds disable remote management. Do not expose the development server
through a tunnel or reverse proxy. Dashboard commands are allowlisted and have time/output limits. The explicitly opened terminal supports interactive shell input through a same-origin WebSocket restricted to loopback peers, with SSH password and host-key verification.

## Checks

Overview includes a Baobab-style disk usage analyzer with two interactive rings,
a size-sorted entry table, Root/Home/Up navigation, and an absolute-path scanner.
The inner ring shows immediate entries and the outer ring shows their contents.
Data comes from GNU `du -a -x -B1 --max-depth=2 --null`; filesystem capacity comes
from `df -B1`. Sizes are allocated blocks, not apparent file lengths. Scans remain
on one filesystem, count hard links once, and do not follow symlinks inside the
selected folder. Selecting a symlink path resolves its target before scanning.
There is no sudo elevation. Permission failures, changes during scanning, and the
45-second scan limit are labelled as partial results. Interrupted records are
discarded while complete records are preserved. The SSH deadline for this read-only
scan is 60 seconds; other operations retain their existing 20-second deadline.
Filesystem used space is separate from scanned sizes and can include metadata,
unreadable files, or deleted files still held open. Refresh rescans Overview;
other dashboard views keep their existing behavior.

```powershell
node --experimental-strip-types --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
npm.cmd run build
```

The SSH integration test starts a temporary loopback SSH server and verifies correct
passwords, rejected passwords/users, rejected host keys, and no key/agent fallback.
It does not test your actual VM.

Monitoring tolerates up to 90 seconds without SSH output during VM memory pressure. Old readings remain labelled stale. Slow browser consumption retains only the newest waiting sample instead of stopping monitoring. Pause, leaving Processes, and Disconnect cancel pending reconnects. The monitor cannot produce fresh readings while the guest itself is unable to schedule top or SSH.
