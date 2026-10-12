export type Coordinates = { host: string; port: string; username: string; password: string }
export const commands = {
  overview: "hostname && uptime && free -h && df -h / && uname -sr",
  processes: 'LC_ALL=C top -b -n 2 -d 1 -w 180 -E k -o %CPU',
  containers: "docker ps -a --format '{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Image}}'",
  storage: 'df -h && lsblk',
  services: 'systemctl --no-pager --plain list-units --type=service --state=running',
  programs: [
    "packages=$(LC_ALL=C dpkg-query -W -f='${db:Status-Status}\\t${binary:Package}\\t${Version}\\t${Architecture}\\n') || exit 1",
    "printf 'APT / DPKG packages (name, version, architecture)\\n'",
    "printf '%s\\n' \"$packages\" | awk -F '\\t' '$1 == \"installed\" { print $2 \"\\t\" $3 \"\\t\" $4 }' || exit 1",
    "if command -v snap >/dev/null 2>&1; then printf '\\nSNAP packages\\n'; snap list 2>&1 || printf 'Unable to list Snap packages.\\n'; fi",
    "if command -v flatpak >/dev/null 2>&1; then printf '\\nFLATPAK packages\\n'; flatpak list --columns=application,version,installation 2>&1 || printf 'Unable to list Flatpak packages.\\n'; fi",
  ].join('\n'),
  journal: 'journalctl --no-pager -n 60',
  logs: 'LC_ALL=C journalctl --no-pager -n 300 -o short-iso 2>&1',
  events: [
    "printf '=== Failed services (current state) ===\\n'",
    'LC_ALL=C systemctl --no-pager --plain list-units --type=service --state=failed || exit 1',
    "printf '\\n=== Warnings and errors (last 24 hours, latest 200) ===\\n'",
    'LC_ALL=C journalctl --no-pager --since "24 hours ago" -p warning -n 200 -o short-iso 2>&1 || exit 1',
    "printf '\\n=== Crash / OOM / kernel panic signals (last 24 hours, latest 100) ===\\n'",
    'crash_output=$(LC_ALL=C journalctl --no-pager --quiet --since "24 hours ago" --case-sensitive=no --grep="segfault|core dumped|dumped core|out of memory|oom-kill|killed process|kernel panic|soft lockup|hard LOCKUP|watchdog.*(BUG|lockup|panic)|status=.*(SEGV|ABRT)" -n 100 -o short-iso 2>&1)',
    'crash_status=$?',
    'printf "%s\\n" "$crash_output"',
    'if [ "$crash_status" -eq 1 ] && { [ -z "$crash_output" ] || [ "$crash_output" = "-- No entries --" ]; }; then printf "No recorded crash signals in the accessible journal.\\n"; elif [ "$crash_status" -ne 0 ]; then exit "$crash_status"; fi',
    "printf '\\n=== Recorded core dumps (last 24 hours, latest 50) ===\\n'",
    'if command -v coredumpctl >/dev/null 2>&1; then LC_ALL=C coredumpctl --no-pager --since "24 hours ago" list 2>&1 | tail -n 50; else printf "coredumpctl is not installed; crash signals above come from the journal.\\n"; fi',
  ].join('\n'),
} as const
export type Operation = keyof typeof commands | 'start' | 'stop' | 'restart'
export type SshInput = Coordinates & { operation: Operation; container?: string }

export function validateInput(input: unknown): SshInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid request.')
  const data = input as Record<string, unknown>
  if (typeof data.password !== 'string' || data.password.length === 0 || data.password.length > 1024) throw new Error('Enter your Ubuntu user password (maximum 1024 characters).')
  if (typeof data.host !== 'string' || !/^(?:[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}|::[a-fA-F0-9:]{0,251})$/.test(data.host)) throw new Error('Enter a valid hostname or IP address.')
  if (typeof data.username !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(data.username)) throw new Error('Enter a valid Ubuntu username.')
  if (typeof data.port !== 'string' || !/^\d{1,5}$/.test(data.port) || Number(data.port) < 1 || Number(data.port) > 65535) throw new Error('SSH port must be between 1 and 65535.')
  const operation = data.operation
  if (typeof operation !== 'string' || ![...Object.keys(commands), 'start', 'stop', 'restart'].includes(operation)) throw new Error('Unsupported operation.')
  if (['start', 'stop', 'restart'].includes(operation) && (typeof data.container !== 'string' || !/^[a-f0-9]{12,64}$/.test(data.container))) throw new Error('Enter a container ID from the container list.')
  return { host: data.host, username: data.username, password: data.password, port: data.port, operation: operation as Operation, container: typeof data.container === 'string' ? data.container : undefined }
}

export function commandForInput(input: unknown): string {
  const data = validateInput(input)
  return Object.hasOwn(commands, data.operation)
    ? commands[data.operation as keyof typeof commands]
    : `docker ${data.operation} ${data.container}`
}
