import { spawn } from 'node:child_process';
const api = spawn(process.execPath, ['server/dev.ts'], { stdio: 'inherit' });
const web = spawn(process.execPath, ['run', '--bun', 'vite', ...process.argv.slice(2)], { stdio: 'inherit' });
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  api.kill('SIGTERM');
  web.kill('SIGTERM');
  process.exitCode = code;
}
api.on('exit', code => stop(code ?? 0));
web.on('exit', code => stop(code ?? 0));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
