import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = ['--root', `${root}roku`, `${root}roku/source/DeviceAuth.brs`, `${root}roku/tests/device-auth.brs`];
const command = process.env.BRS_BIN || 'bunx';
const result = spawnSync(command, process.env.BRS_BIN ? args : ['--package', 'brs', 'brs', ...args], {
  cwd: root, encoding: 'utf8', timeout: 120000,
});
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.error) console.error(result.error.message);
if (result.status !== 0 || !result.stdout?.includes('ROKU_TESTS_COMPLETE') || result.stdout.includes('FAIL:')) {
  process.exitCode = 1;
}