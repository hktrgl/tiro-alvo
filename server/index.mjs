import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync, createReadStream } from 'node:fs';
import { createDocument, deposit, shoot, GameError } from './game.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(projectRoot, '.data');
const stateFile = path.join(dataDirectory, 'state.json');
const distributionDirectory = path.join(projectRoot, 'dist');
const production = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';

mkdirSync(dataDirectory, { recursive: true });
let document = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : createDocument();
if (document.version !== 1 || document.state?.mode !== 'demo' || !document.receipts) {
  throw new Error('Arquivo de demonstração incompatível. Preserve o arquivo e verifique a configuração DATA_DIR.');
}

function persist(nextDocument) {
  const temporary = `${stateFile}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(nextDocument), { mode: 0o600 });
  renameSync(temporary, stateFile);
  document = nextDocument;
}
if (!existsSync(stateFile)) persist(document);

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function readBody(request) {
  if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    throw new GameError('Use application/json.', 415);
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new GameError('Requisição muito grande.', 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new GameError('JSON inválido.');
  }
}

function assertOrigin(request) {
  const origin = request.headers.origin;
  const allowed = new Set([`http://${request.headers.host}`, `https://${request.headers.host}`]);
  if (!production) {
    allowed.add('http://localhost:5173');
    allowed.add('http://127.0.0.1:5173');
  }
  if ((origin && !allowed.has(origin)) || request.headers['sec-fetch-site'] === 'cross-site') {
    throw new GameError('Origem não autorizada.', 403);
  }
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

function serveStatic(request, response, pathname) {
  if (!production || !['GET', 'HEAD'].includes(request.method)) return false;
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw new GameError('Caminho inválido.'); }
  if (decoded.includes('\0')) throw new GameError('Caminho inválido.');
  const requested = path.resolve(distributionDirectory, `.${decoded}`);
  if (requested !== distributionDirectory && !requested.startsWith(`${distributionDirectory}${path.sep}`)) {
    throw new GameError('Caminho inválido.', 403);
  }
  let file = requested;
  if (!existsSync(file) || !statSync(file).isFile()) {
    if (path.extname(decoded)) return false;
    file = path.join(distributionDirectory, 'index.html');
  }
  if (!existsSync(file)) return false;
  response.writeHead(200, {
    'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream',
    'Content-Length': statSync(file).size,
    'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).pipe(response);
  return true;
}

const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  try {
    const { pathname } = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && pathname === '/api/health') return sendJson(response, 200, { status: 'ok', mode: 'demo' });
    if (request.method === 'GET' && pathname === '/api/state') return sendJson(response, 200, document.state);
    if (request.method === 'POST' && ['/api/deposits', '/api/shots'].includes(pathname)) {
      assertOrigin(request);
      const input = await readBody(request);
      const transaction = pathname === '/api/deposits' ? deposit(document, input) : shoot(document, input);
      if (transaction.nextDocument !== document) persist(transaction.nextDocument);
      return sendJson(response, 200, transaction.response);
    }
    if (pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'Rota não encontrada.' });
    if (serveStatic(request, response, pathname)) return;
    sendJson(response, 404, { error: production ? 'Página não encontrada.' : 'Use o servidor Vite para abrir a interface.' });
  } catch (error) {
    if (!(error instanceof GameError)) console.error('Falha ao processar solicitação:', error.message);
    if (!response.headersSent) sendJson(response, error.status || 500, { error: error instanceof GameError ? error.message : 'Não foi possível concluir. Tente novamente.' });
    else response.end();
  }
});

server.listen(port, host, () => console.log(`Tiro ao Alvo API: ${host}:${port} (${production ? 'production demo' : 'development demo'})`));
server.on('error', (error) => { console.error(error.message); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
