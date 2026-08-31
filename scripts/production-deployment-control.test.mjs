import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { test } from 'node:test'

const deployScriptPath = new URL('../deploy/production/deploy-production.sh', import.meta.url)
const controlScriptPath = new URL(
  '../deploy/production/control-production-deployment.sh',
  import.meta.url,
)
const deploymentReadmePath = new URL('../deploy/production/README.md', import.meta.url)

const deployScript = readFileSync(deployScriptPath, 'utf8')
const controlScript = readFileSync(controlScriptPath, 'utf8')
const deploymentReadme = readFileSync(deploymentReadmePath, 'utf8')

test('production deployment scripts have valid POSIX shell syntax', () => {
  execFileSync('sh', ['-n', deployScriptPath.pathname])
  execFileSync('sh', ['-n', controlScriptPath.pathname])
})

test('deployment records and removes an atomic root-only lock owner state', () => {
  assert.match(deployScript, /LINKSENSE_DEPLOY_STATE_FILE/)
  assert.match(deployScript, /printf 'PID=%s\\n' "\$\$"/)
  assert.match(deployScript, /chmod 0600 "\$state_temporary_file"/)
  assert.match(deployScript, /mv "\$state_temporary_file" "\$lock_state_file"/)
  assert.match(deployScript, /remove_deployment_state\n  exit "\$exit_status"/)
})

test('control script verifies the lock owner and never removes a held lock file', () => {
  assert.match(controlScript, /pid_is_lock_holder/)
  assert.match(controlScript, /process_is_deployment/)
  assert.match(controlScript, /deploy\/production\/deploy-production\.sh/)
  assert.doesNotMatch(controlScript, /rm\s+-f\s+"?\$lock_file"?/)
  assert.match(controlScript, /signal_pid_list TERM/)
  assert.match(controlScript, /signal_pid_list KILL/)
})

test('control script is executable and documents safe recovery commands', () => {
  assert.equal(statSync(controlScriptPath).mode & 0o111, 0o111)
  assert.match(deploymentReadme, /control-production-deployment\.sh status/)
  assert.match(deploymentReadme, /control-production-deployment\.sh stop/)
  assert.match(deploymentReadme, /control-production-deployment\.sh kill/)
  assert.match(deploymentReadme, /不要删除 `\/run\/lock\/linksense-deploy\.lock`/)
})
