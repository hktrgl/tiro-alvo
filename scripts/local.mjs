import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 3001);
const noOpen = process.argv.includes('--no-open');

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('Instale o Node.js 24 ou superior para iniciar o jogo.');
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT deve ser uma porta válida entre 1 e 65535.');
  process.exit(1);
}
if (!process.env.npm_execpath) {
  console.error('Inicie usando: npm run local');
  process.exit(1);
}

console.log('Preparando o Tiro ao Alvo Premiado…');
const build = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build'], {
  cwd: root, stdio: 'inherit',
});
if (build.status !== 0) {
  console.error('Não foi possível preparar o jogo. Execute npm ci e tente novamente.');
  process.exit(build.status || 1);
}

const child = spawn(process.execPath, ['server/index.mjs', '--production'], {
  cwd: root, stdio: ['inherit', 'pipe', 'inherit'], env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
});
let started = false;
let startupOutput = '';
child.stdout.on('data', chunk => {
  process.stdout.write(chunk);
  startupOutput = `${startupOutput}${chunk}`.slice(-2048);
  if (startupOutput.includes('Tiro ao Alvo API:')) started = true;
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));

const url = `http://127.0.0.1:${port}`;
let ready = false;
for (let attempt = 0; attempt < 50 && child.exitCode === null && child.signalCode === null; attempt++) {
  try {
    if (!started) { await new Promise(resolve => setTimeout(resolve, 100)); continue; }
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(500) });
    if (response.ok && (await response.json()).mode === 'demo') { ready = true; break; }
  } catch { /* The local server may still be starting. */ }
  await new Promise(resolve => setTimeout(resolve, 100));
}

if (ready && child.exitCode === null && child.signalCode === null) {
  console.log(`\nJogo pronto: ${url}\nDeixe este terminal aberto. Para encerrar, pressione Ctrl+C.\n`);
  if (!noOpen) {
    const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const browser = spawn(command, args, { stdio: 'ignore' });
    browser.on('error', () => console.log('Abra o navegador e use o endereço exibido acima.'));
    browser.unref();
  }
} else if (child.exitCode === null && child.signalCode === null) {
  console.error('O servidor não iniciou a tempo. Confira a mensagem de erro acima.');
  child.kill();
  process.exitCode = 1;
}
