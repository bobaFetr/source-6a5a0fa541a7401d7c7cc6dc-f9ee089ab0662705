// Fixed read-only commands. No user-controlled shell arguments.
export const healthCommand = [
  'export LC_ALL=C',
  'printf "@@cpu_before\\n"; head -n 1 /proc/stat',
  'sleep 1',
  'printf "@@cpu_after\\n"; head -n 1 /proc/stat',
  'printf "@@memory\\n"; cat /proc/meminfo',
  'printf "@@pressure\\n"; cat /proc/pressure/memory 2>/dev/null',
  'printf "@@disk\\n"; df -P / 2>&1; printf "@@disk_status\\n%s\\n" "$?"',
  'printf "@@services\\n"; systemctl --no-pager --plain --no-legend list-units --type=service --state=failed 2>&1; printf "@@services_status\\n%s\\n" "$?"',
  'printf "@@updates\\n"; apt list --upgradable 2>&1; printf "@@updates_status\\n%s\\n" "$?"',
  'printf "@@cache\\n"; stat -c %Y /var/lib/apt/lists 2>/dev/null',
  'printf "@@reboot\\n"; if [ -f /run/reboot-required ]; then printf "yes\\n"; else printf "no\\n"; fi',
  'printf "@@journal\\n"; journalctl --no-pager -n 100 -o json 2>&1; printf "@@journal_status\\n%s\\n" "$?"',
].join('\n')
