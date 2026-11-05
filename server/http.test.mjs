import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function availablePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

async function fixture(t, { production = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tiro-alvo-http-'));
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  let child;

  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const current = child;
    const exited = once(current, 'exit');
    current.kill('SIGTERM');
    const timeout = setTimeout(() => current.kill('SIGKILL'), 5_000);
    try { await exited; } finally { clearTimeout(timeout); }
  }

  t.after(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true });
  });

  async function start() {
    child = spawn(process.execPath, ['server/index.mjs'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: directory, NODE_ENV: production ? 'production' : 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      let output = '';
      let errors = '';
      const timeout = setTimeout(() => reject(new Error(`API startup timed out: ${errors}`)), 5_000);
      const cleanup = () => {
        clearTimeout(timeout);
        child.off('error', failed);
        child.off('exit', exited);
        child.stdout.off('data', ready);
        child.stderr.off('data', captureError);
      };
      const failed = error => { cleanup(); reject(error); };
      const exited = code => { cleanup(); reject(new Error(`API exited during startup (${code}): ${errors}`)); };
      const captureError = chunk => { errors = `${errors}${chunk}`.slice(-2_048); };
      const ready = chunk => {
        output = `${output}${chunk}`.slice(-2_048);
        if (output.includes('Tiro ao Alvo API:')) { cleanup(); resolve(); }
      };
      child.on('error', failed);
      child.on('exit', exited);
      child.stdout.on('data', ready);
      child.stderr.on('data', captureError);
    });
  }

  async function request(route, body, options = {}) {
    const response = await fetch(`${base}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? options.headers : { 'Content-Type': 'application/json', Origin: base, ...options.headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    return { response, data: await response.json() };
  }

  await start();
  return { base, request, restart: async () => { await stop(); await start(); } };
}

test('HTTP health and initial state expose a no-cache demonstration with 3 shots', async t => {
  const api = await fixture(t);
  const health = await api.request('/api/health');
  assert.equal(health.response.status, 200);
  assert.deepEqual(health.data, { status: 'ok', mode: 'demo' });
  const state = await api.request('/api/state');
  assert.equal(state.response.headers.get('cache-control'), 'no-store');
  assert.equal(state.data.shots, 3);
  assert.equal(state.data.depositTotal, 0);
  assert.deepEqual(state.data.history, []);
  assert.equal((await api.request('/api/not-a-route')).response.status, 404);
});

test('HTTP deposits accumulate exact cents and repeat safely with the same idempotency key', async t => {
  const api = await fixture(t);
  const initial = await api.request('/api/deposits', { amount: 99.99, idempotencyKey: 'http-deposit-part1' });
  assert.equal(initial.data.creditedShots, 0);
  const deposit = { amount: 0.01, idempotencyKey: 'http-deposit-part2' };
  const first = await api.request('/api/deposits', deposit);
  const repeated = await api.request('/api/deposits', deposit);
  assert.equal(first.response.status, 200);
  assert.equal(first.data.creditedShots, 3);
  assert.equal(repeated.data.state.shots, 6);
  assert.equal(repeated.data.state.depositTotal, 100);
  assert.equal(repeated.data.state.depositRemainder, 0);
  assert.equal((await api.request('/api/deposits', { ...deposit, amount: 100 })).response.status, 409);
});

test('HTTP shots credit one reward, remain idempotent, and reject a new shot after depletion', async t => {
  const api = await fixture(t);
  const firstBody = { x: 0.25, y: 0.75, idempotencyKey: 'http-shot-first' };
  const first = await api.request('/api/shots', firstBody);
  assert.equal(first.response.status, 200);
  assert.equal(first.data.state.shots, 2);
  assert.equal(first.data.state.history.length, 1);
  assert.ok(['giftcard', 'coupon', 'keychain', 'highlights', 'consolation'].includes(first.data.result.type));
  for (let i = 0; i < 2; i++) {
    const shot = await api.request('/api/shots', { x: 0.5, y: 0.5, idempotencyKey: `http-shot-next-${i}` });
    assert.equal(shot.response.status, 200);
  }
  const repeated = await api.request('/api/shots', firstBody);
  assert.deepEqual(repeated.data.result, first.data.result);
  assert.equal(repeated.data.state.shots, 0);
  assert.equal(repeated.data.state.history.length, 3);
  const empty = await api.request('/api/shots', { x: 0.5, y: 0.5, idempotencyKey: 'http-shot-empty' });
  assert.equal(empty.response.status, 409);
  assert.match(empty.data.error, /sem tiros/);
});

test('HTTP malformed JSON and invalid transaction data are rejected without mutating state', async t => {
  const api = await fixture(t);
  const malformed = await fetch(`${api.base}/api/deposits`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: api.base }, body: '{broken', signal: AbortSignal.timeout(5_000) });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, 'JSON inválido.');
  assert.equal((await api.request('/api/deposits', { amount: -1, idempotencyKey: 'http-invalid-deposit' })).response.status, 400);
  assert.equal((await api.request('/api/shots', { x: 2, y: 0.5, idempotencyKey: 'http-invalid-shot' })).response.status, 400);
  const state = await api.request('/api/state');
  assert.equal(state.data.shots, 3);
  assert.equal(state.data.depositTotal, 0);
});

test('HTTP cross-origin mutations are forbidden and same-origin mutations still work', async t => {
  const api = await fixture(t);
  const blocked = await api.request('/api/deposits', { amount: 100, idempotencyKey: 'http-origin-blocked' }, { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(blocked.response.status, 403);
  const blockedFetch = await api.request('/api/shots', { x: 0.5, y: 0.5, idempotencyKey: 'http-origin-fetch' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(blockedFetch.response.status, 403);
  assert.equal((await api.request('/api/state')).data.shots, 3);
  assert.equal((await api.request('/api/deposits', { amount: 100, idempotencyKey: 'http-origin-allowed' })).data.state.shots, 6);
});

test('HTTP restart restores balances, reward history and idempotency receipts from disk', async t => {
  const api = await fixture(t);
  const deposit = { amount: 125.15, idempotencyKey: 'http-persist-deposit' };
  const shot = { x: 0, y: 1, idempotencyKey: 'http-persist-shot' };
  await api.request('/api/deposits', deposit);
  const before = await api.request('/api/shots', shot);
  await api.restart();
  const restored = await api.request('/api/state');
  assert.deepEqual(restored.data, before.data.state);
  assert.equal(restored.data.depositTotal, 125.15);
  assert.equal(restored.data.depositRemainder, 25.15);
  assert.equal(restored.data.shots, 5);
  assert.deepEqual((await api.request('/api/shots', shot)).data.result, before.data.result);
  assert.equal((await api.request('/api/deposits', deposit)).data.state.shots, 5);
});

test('production serves the built app and assets, supports SPA routes, and blocks traversal', { skip: !existsSync(path.join(root, 'dist', 'index.html')) && 'Run npm run build to validate production static files.' }, async t => {
  const api = await fixture(t, { production: true });
  const index = await fetch(api.base, { signal: AbortSignal.timeout(5_000) });
  const html = await index.text();
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.equal(html, await readFile(path.join(root, 'dist', 'index.html'), 'utf8'));
  const script = html.match(/<script[^>]+src="([^"]+)"/);
  assert.ok(script, 'The built page must reference a JavaScript bundle.');
  const asset = await fetch(`${api.base}${script[1]}`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.equal(await asset.text(), await readFile(path.join(root, 'dist', script[1]), 'utf8'));
  const spa = await fetch(`${api.base}/campaign/history`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(spa.status, 200);
  assert.equal(await spa.text(), html);
  const traversal = await fetch(`${api.base}/%2e%2e%2fserver%2fgame.mjs`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(traversal.status, 403);
  assert.match((await traversal.json()).error, /Caminho inválido/);
});
