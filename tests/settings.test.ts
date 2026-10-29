import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSettings, loadSettings, resolveSelection } from '../server/settings';
import { interpolate } from '../src/engine';
const source = `version: 1
agents: [Architecte, Analyste]
models: [Modèle rapide, Modèle précis]
reasoningLevels: [Défaut, Faible, Élevé]
defaults:
  agent: Analyste
  model: Modèle précis
  reasoningLevel: Élevé
`;
test('configured names and defaults replace the built-in choices', () => {
  const s = readSettings(source);
  assert.deepEqual(s.agents, ['Architecte', 'Analyste']);
  assert.equal(s.defaults.agent, 'Analyste');
  assert.equal(s.defaults.model, 'Modèle précis');
  assert.equal(s.defaults.reasoningLevel, 'Élevé');
  assert.deepEqual(resolveSelection({}, s), s.defaults);
  assert.equal(
    resolveSelection({ agent: 'Architecte', model: 'Modèle rapide', reasoningLevel: 'Faible' }, s).reasoningLevel,
    'Faible',
  );
  assert.throws(() => resolveSelection({ agent: 'Plan' }, s));
  assert.throws(() => resolveSelection({ reasoningLevel: 7 }, s));
});
test('lists, duplicates and defaults are validated', () => {
  for (const value of [
    source.replace('version: 1', 'version: 2'),
    source.replace('[Architecte, Analyste]', '[]'),
    source.replace('[Architecte, Analyste]', '[Architecte, Architecte]'),
    source.replace('agent: Analyste', 'agent: Plan'),
    source.replace('reasoningLevel: Élevé', 'reasoningLevel: High'),
    source.replace('[Défaut, Faible, Élevé]', '[Défaut, 42]'),
  ])
    assert.throws(() => readSettings(value));
  const noDefaults = readSettings(source.split('defaults:')[0]);
  assert.deepEqual(noDefaults.defaults, { agent: 'Architecte', model: 'Modèle rapide', reasoningLevel: 'Défaut' });
});
test('the configuration file is optional, reloaded and reports errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opencode-settings-')),
    file = join(directory, 'config.yaml');
  try {
    assert.equal((await loadSettings(file)).defaults.agent, 'Plan');
    await writeFile(file, source);
    assert.equal((await loadSettings(file)).defaults.agent, 'Analyste');
    await writeFile(file, source.replace('agent: Analyste', 'agent: Architecte'));
    assert.equal((await loadSettings(file)).defaults.agent, 'Architecte');
    await writeFile(file, 'version: 1\nagents: []');
    await assert.rejects(loadSettings(file), /config.yaml/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('selections are interpolated without interpreting the prompt', () => {
  assert.deepEqual(
    interpolate(
      { text: '{{agent}} / {{model}} / {{reasoningLevel}} / {{prompt}}', other: '{{unknown}}' },
      '{{model}}',
      { agent: 'Analyste', model: 'Modèle précis', reasoningLevel: 'Élevé' },
    ),
    { text: 'Analyste / Modèle précis / Élevé / {{model}}', other: '{{unknown}}' },
  );
});
test('models accept providers and keep plain lists', () => {
  const s = readSettings(
    source.replace(
      'models: [Modèle rapide, Modèle précis]',
      `models:
  - name: Modèle rapide
    provider: OpenAI
  - name: Modèle précis
    provider: Nutanix Enterprise AI`,
    ),
  );
  assert.deepEqual(s.models, ['Modèle rapide', 'Modèle précis']);
  assert.equal(s.modelProviders['Modèle rapide'], 'OpenAI');
  assert.equal(s.modelProviders['Modèle précis'], 'Nutanix Enterprise AI');
  assert.equal(readSettings(source).modelProviders['Modèle rapide'], 'Models');
  for (const models of [
    '[{ name: A, provider: "" }]',
    '[{ name: A, provider: 5 }]',
    '[{ provider: OpenAI }]',
    '[A, { name: A, provider: OpenAI }]',
  ])
    assert.throws(() => readSettings(`${source.split('models:')[0]}models: ${models}\nreasoningLevels: [Default]\n`));
});

test('configured commands extend the reserved commands', () => {
  const settings = readSettings(
    source +
      'commands:\n  - name: /Recherche\n    description: Rechercher\n    prompt: "Recherche {{args}}"\n  - name: diagnostic\n',
  );
  assert.deepEqual(
    settings.commands.map(command => command.name),
    ['new', 'mcp', 'recherche', 'diagnostic'],
  );
  assert.ok(!Object.hasOwn(settings.commands[2], 'prompt'));
  for (const commands of [
    '{}',
    '[{name: new}]',
    '[{name: /MCP}]',
    '[{name: a}, {name: A}]',
    '[{name: "a b"}]',
    '[{name: a, action: new}]',
    '[{name: a, description: 42}]',
  ])
    assert.throws(() => readSettings(`${source}commands: ${commands}\n`));
});

test('MCP configuration: plain names, initial states and validation', () => {
  assert.deepEqual(readSettings(source).mcpServers, []);
  assert.deepEqual(readSettings(`${source}mcpServers: [github, notion]\n`).mcpServers, [
    { name: 'github', enabled: false },
    { name: 'notion', enabled: false },
  ]);
  assert.deepEqual(readSettings(`${source}mcpServers: [{name: github, enabled: true}, {name: notion}]\n`).mcpServers, [
    { name: 'github', enabled: true },
    { name: 'notion', enabled: false },
  ]);
  for (const value of [
    '{}',
    '[github, github]',
    '[{name: github}, github]',
    '[{name: ""}]',
    '[{name: github, enabled: yes}]',
    '[42]',
    '[{name: github, enabled: 1}]',
  ])
    assert.throws(() => readSettings(`${source}mcpServers: ${value}\n`));
});

test('custom commands use one plain description field', () => {
  const settings = readSettings(
    `${source}commands: [{name: diagnostic, description: English diagnostic}, {name: empty}]\n`,
  );
  assert.equal(settings.commands[2].description, 'English diagnostic');
  assert.equal(settings.commands[3].description, '');
  for (const description of [
    '{fr: Diagnostic français, en: English diagnostic}',
    '{en: English diagnostic}',
    '{}',
    '42',
    'null',
  ])
    assert.throws(() => readSettings(`${source}commands: [{name: test, description: ${description}}]\n`));
  assert.throws(() => readSettings(`${source}commands: [{name: test, description: "${'a'.repeat(1001)}"}]\n`));
});
