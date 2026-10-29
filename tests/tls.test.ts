import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { request } from 'node:https';
import { makeServer } from '../server/app';
import { loadTls } from '../server/tls';
import { parseOptions } from '../server/options';

test('TLS flags keep HTTP defaults and resolve custom certificate paths', () => {
  assert.equal(parseOptions([], '/opt/harness-emulator').tls, false);
  assert.equal(parseOptions([], '/opt/harness-emulator').port, 4097);
  const tls = parseOptions(['--tls'], '/opt/harness-emulator');
  assert.equal(tls.port, 443);
  assert.equal(tls.tlsCert, resolve('cert.pem'));
  assert.equal(tls.tlsKey, resolve('key.pem'));
  const custom = parseOptions(
    ['--port', '8443', '--tls', '--tls-cert', 'custom.crt', '--tls-key', 'custom.key'],
    '/opt/harness-emulator',
  );
  assert.equal(custom.port, 8443);
  assert.equal(custom.tlsCert, resolve('custom.crt'));
  assert.equal(custom.tlsKey, resolve('custom.key'));
  for (const args of [
    ['--tls-cert', 'cert.pem'],
    ['--tls-key', 'key.pem'],
    ['--tls', '--tls-cert'],
    ['--tls', '--tls-key'],
  ])
    assert.throws(() => parseOptions(args, '/opt/harness-emulator'));
  assert.throws(() => loadTls('/missing/cert.pem', '/missing/key.pem'), /TLS/);
});
test('HTTPS serves the UI and streams chat with certificate verification and same-origin protection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opencode-tls-'));
  let server: ReturnType<typeof makeServer> | undefined;
  try {
    const certPath = join(dir, 'cert.pem'),
      keyPath = join(dir, 'key.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    );
    const tls = loadTls(certPath, keyPath);
    const cert = await readFile(certPath);
    await writeFile(
      join(dir, 'hello.yaml'),
      'version: 1\nid: hello\nname: Hello\nmatcher: {type: exact, value: Hello}\nevents: [{type: final, content: TLS works}]',
    );
    server = makeServer(
      { scenarios: dir },
      { '/index.html': { body: Buffer.from('HTTPS UI').toString('base64'), type: 'text/html' } },
      tls,
    );
    await new Promise<void>((r, j) => {
      server!.once('error', j);
      server!.listen(0, '127.0.0.1', () => r());
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `https://127.0.0.1:${address.port}`;
    const call = (path: string, origin?: string) =>
      new Promise<{ status: number; body: string }>((r, j) => {
        const req = request(
          `${base}${path}`,
          {
            ca: cert,
            method: origin ? 'POST' : 'GET',
            headers: origin ? { Origin: origin, 'Content-Type': 'application/json' } : {},
          },
          res => {
            let body = '';
            res.on('data', chunk => (body += chunk));
            res.on('end', () => r({ status: res.statusCode!, body }));
          },
        );
        req.on('error', j);
        req.end(origin ? JSON.stringify({ prompt: 'Hello' }) : undefined);
      });
    assert.deepEqual(await call('/'), { status: 200, body: 'HTTPS UI' });
    const chat = await call('/api/chat', base);
    assert.equal(chat.status, 200);
    assert.match(chat.body, /TLS works/);
    assert.match(chat.body, /"type":"done"/);
    assert.equal((await call('/api/chat', base.replace('https:', 'http:'))).status, 403);
    assert.equal((await call('/api/chat', 'https://example.com')).status, 403);
    await writeFile(certPath, 'invalid certificate');
    assert.throws(() => loadTls(certPath, keyPath), /TLS/);
  } finally {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise<void>(r => server!.close(() => r()));
    }
    await rm(dir, { recursive: true, force: true });
  }
});
