import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { commands } from '../src/server/ssh-input.ts'

const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/sh'
const options = { skip: !existsSync(shell) }
function run(crashBody) {
  return spawnSync(shell, ['-c', `
systemctl() { printf '0 failed services\\n'; }
journalctl() { case "$*" in *--grep=*) ${crashBody} ;; *) printf 'warning record\\n';; esac; }
command() { return 1; }
${commands.events}`], { encoding: 'utf8', windowsHide: true })
}
test('Events continues to core dumps when the crash query has no matches', options, () => {
  for (const body of ['return 1', "printf '%s\\n' '-- No entries --'; return 1"]) {
    const result = run(body)
    assert.equal(result.status, 0)
    assert.match(result.stdout, /No recorded crash signals/)
    assert.match(result.stdout, /coredumpctl is not installed/)
  }
})
test('Events preserves crash records and propagates query errors', options, () => {
  const crash = run("printf 'app: segfault\\n'")
  assert.equal(crash.status, 0)
  assert.match(crash.stdout, /app: segfault/)
  const error = run("printf 'Journal unavailable\\n' >&2; return 1")
  assert.equal(error.status, 1)
  assert.match(error.stdout, /Journal unavailable/)
  assert.doesNotMatch(error.stdout, /No recorded crash signals/)
})
