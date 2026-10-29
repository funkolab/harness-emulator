import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadScenarios } from '../server/scenarios';
import { parseOptions } from '../server/options';
import { makeServer } from '../server/app';
const document = (id: string, content: string, type = 'exact', value = 'ping') =>
  `version: 1\nid: ${id}\nname: SECRET_OPERATOR_NAME\nmatcher: { type: ${type}, value: '${value}' }\nevents:\n  - type: tool\n    server: notion\n    name: search\n    input: { query: '{{prompt}}' }\n    output: { result: '${content}' }\n    duration: 5\n  - type: final\n    content: '${content} : {{prompt}}'\n    duration: 5\n`;
test('scenarios default to the working directory and arguments are validated', () => {
  assert.equal(parseOptions([], '/opt/demo/harness-emulator').scenarios, resolve('scenarios'));
  assert.equal(parseOptions(['--scenarios', 'custom'], '/opt/demo/harness-emulator').scenarios, resolve('custom'));
  assert.equal(parseOptions([], '/opt/demo/harness-emulator').config, '/opt/demo/config.yaml');
  assert.equal(parseOptions(['--config', '/tmp/custom.yaml'], '/opt/demo/harness-emulator').config, '/tmp/custom.yaml');
  assert.equal(parseOptions(['--port', '5123'], '/opt/demo/harness-emulator').port, 5123);
  assert.equal(parseOptions(['--check'], '/opt/demo/harness-emulator').check, true);
  for (const args of [
    ['--port', 'abc'],
    ['--port', '0'],
    ['--port', '65536'],
    ['--scenarios'],
    ['--config'],
    ['--other'],
  ])
    assert.throws(() => parseOptions(args, '/opt/harness-emulator'));
});
test('scenario files are sorted, reloaded and validated together', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opencode-config-'));
  try {
    await assert.rejects(loadScenarios(dir), /No YAML files/);
    await writeFile(join(dir, '20-second.yml'), document('second', 'second'));
    await writeFile(join(dir, '10-first.yaml'), document('first', 'first'));
    await writeFile(join(dir, 'notes.txt'), 'ignored');
    assert.deepEqual(
      (await loadScenarios(dir)).scenarios.map(s => s.id),
      ['first', 'second'],
    );
    await writeFile(join(dir, '10-first.yaml'), document('updated', 'new'));
    assert.equal((await loadScenarios(dir)).scenarios[0].id, 'updated');
    await writeFile(join(dir, '20-second.yml'), document('updated', 'duplicate'));
    await assert.rejects(loadScenarios(dir), /20-second.yml.*Duplicate ID/);
    await writeFile(join(dir, '20-second.yml'), 'version: 1\nscenarios: [{id: second}, {id: third}]');
    await assert.rejects(loadScenarios(dir), /20-second.yml.*scenario at the root/);
    await writeFile(join(dir, '20-second.yml'), 'invalid YAML: [');
    await assert.rejects(loadScenarios(dir), /20-second.yml/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('the server streams events without exposing configuration and reloads YAML files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opencode-api-'));
  const dir = join(directory, 'scenarios');
  await mkdir(dir);
  const settingsFile = join(directory, 'config.yaml');
  const server = makeServer(
    { scenarios: dir, config: settingsFile },
    { '/index.html': { body: Buffer.from('<h1>OpenCode</h1>').toString('base64'), type: 'text/html' } },
  );
  try {
    await writeFile(join(dir, 'demo.yaml'), document('demo', 'first'));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal(await (await fetch(base)).text(), '<h1>OpenCode</h1>');
    assert.equal((await fetch(`${base}/scenarios/demo.yaml`)).status, 404);
    assert.equal((await fetch(`${base}/api/scenarios`)).status, 404);
    const chat = async (prompt: string, choices: Record<string, unknown> = {}) =>
      fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, language: 'fr', ...choices }),
      });
    await writeFile(
      settingsFile,
      `version: 1
agents: [Architecte, Analyste]
models: [Rapide, Précis]
reasoningLevels: [Default, High]
mcpServers: [{name: github, enabled: true}, notion]
defaults: { agent: Architecte, model: Rapide, reasoningLevel: Default }
`,
    );
    const initialSettings = await (await fetch(`${base}/api/settings`)).json();
    assert.deepEqual(initialSettings.agents, ['Architecte', 'Analyste']);
    assert.deepEqual(initialSettings.mcpServers, [
      { name: 'github', enabled: true },
      { name: 'notion', enabled: false },
    ]);
    assert.equal((await chat('ping', { agent: 'Plan' })).status, 400);
    const selected = await (await chat('ping', { agent: 'Analyste', model: 'Précis', reasoningLevel: 'High' })).text();
    assert.deepEqual(JSON.parse(selected.split('\n')[0]).selection, {
      agent: 'Analyste',
      model: 'Précis',
      reasoningLevel: 'High',
    });
    await writeFile(
      join(dir, 'agent.yaml'),
      document('agent', 'Agent choisi').replace('matcher:', 'when: {agent: Analyste, mcp: {github: true}}\nmatcher:'),
    );
    assert.match(await (await chat('ping', { agent: 'Analyste' })).text(), /Agent choisi : ping/);
    assert.match(await (await chat('ping')).text(), /first : ping/);
    assert.match(
      await (await chat('ping', { agent: 'Analyste', mcpStates: { github: false } })).text(),
      /first : ping/,
    );
    await rm(join(dir, 'agent.yaml'));
    await writeFile(
      join(dir, 'zz-conditional.yaml'),
      document('conditional', 'MCP actif').replace('matcher:', 'when: { mcp: { github: true } }\nmatcher:'),
    );
    assert.match(await (await chat('ping')).text(), /MCP actif : ping/);
    assert.match(await (await chat('ping', { mcpStates: { github: false, notion: false } })).text(), /first : ping/);
    for (const mcpStates of [[], { github: 'true' }, { missing: true }])
      assert.equal((await chat('ping', { mcpStates })).status, 400);
    await writeFile(
      join(dir, 'zz-conditional.yaml'),
      document('invalid', 'Invalid').replace('matcher:', 'when: { mcp: { missing: true } }\nmatcher:'),
    );
    await assert.rejects(loadScenarios(dir, initialSettings.mcpServers), /zz-conditional.yaml.*Unknown MCP server/);
    await rm(join(dir, 'zz-conditional.yaml'));
    const first = await (await chat('ping')).text();
    assert.ok(!/SECRET_OPERATOR_NAME|matcher|duration|delay/.test(first));
    const packets = first
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    assert.equal(packets[0].type, 'start');
    assert.equal(packets.at(-1).type, 'done');
    assert.ok(packets.some(p => p.type === 'complete' && p.output?.result === 'first'));
    assert.ok(packets.some(p => p.type === 'text' && p.content === 'first : ping'));
    await writeFile(join(dir, 'demo.yaml'), document('demo', 'updated'));
    assert.match(await (await chat('ping')).text(), /updated : ping/);
    const customConfig = await (await import('node:fs/promises')).readFile(settingsFile, 'utf8');
    await writeFile(
      settingsFile,
      `${customConfig}commands:\n  - name: probe\n    description: Diagnostic\n    prompt: "ping"\n  - name: direct\n`,
    );
    const metadata = await (await fetch(`${base}/api/settings`)).json();
    assert.deepEqual(
      metadata.commands.map((command: { name: string }) => command.name),
      ['new', 'mcp', 'probe', 'direct'],
    );
    assert.ok(metadata.commands.every((command: object) => !Object.hasOwn(command, 'prompt')));
    // Neither legacy prompt templates nor the slash input may trigger a scenario.
    await writeFile(join(dir, 'demo.yaml'), document('command', 'MUST NOT RUN', 'always'));
    for (const prompt of ['/probe', '/probe hello world', '/direct argument']) {
      const ignored = await chat(prompt);
      assert.equal(ignored.status, 204);
      assert.equal(await ignored.text(), '');
    }
    await writeFile(settingsFile, `${customConfig}commands: [{name: probe, prompt: "ping {{args}}"}]\n`);
    assert.equal((await chat('/probe hello', { language: 'en' })).status, 204);
    await writeFile(join(dir, 'demo.yaml'), document('demo', 'updated'));
    for (const prompt of ['/unknown', '/new', '/mcp']) assert.equal((await chat(prompt)).status, 400);
    assert.equal((await chat('')).status, 400);
    const unmatched = await (await chat('something else')).text();
    assert.match(await (await chat('something else', { language: 'en' })).text(), /Could you clarify your request/);
    assert.match(unmatched, /Pourriez-vous préciser/);
    assert.ok(!/scénario|matcher|YAML/.test(unmatched));
    assert.equal(
      (await fetch(`${base}/api/chat`, { method: 'POST', headers: { origin: 'http://example.com' }, body: '{}' }))
        .status,
      403,
    );
    await writeFile(join(dir, 'demo.yaml'), 'version: 1\nscenarios: []');
    const broken = await chat('ping');
    assert.equal(broken.status, 503);
    assert.ok(!(await broken.text()).includes('scénarios'));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
