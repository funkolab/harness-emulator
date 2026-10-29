import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readScenario, findScenario, interpolate, type Config } from '../src/engine';
const source = readFileSync(new URL('../scenarios/10-recherche.yaml', import.meta.url), 'utf8');
const configOf = (...scenarios: object[]): Config => ({
  version: 1,
  scenarios: scenarios.map(scenario => readScenario(JSON.stringify({ version: 1, ...scenario }))),
});
const demoConfig = {
  version: 1,
  scenarios: ['10-recherche.yaml', '20-erreur-mcp.yaml', '30-salutation.yaml'].map(name =>
    readScenario(readFileSync(new URL(`../scenarios/${name}`, import.meta.url), 'utf8')),
  ),
};
test('demo scenarios match the expected questions', () => {
  const c = demoConfig;
  assert.equal(
    findScenario(c, 'Quels sont les PROJETS en cours ?', { github: false, 'github via NAI': false })?.id,
    'recherche',
  );
  assert.equal(findScenario(c, 'Vérifie la connexion MCP')?.id, 'erreur-mcp');
  assert.equal(findScenario(c, 'Bonjour !')?.id, 'salutation');
  assert.equal(findScenario(c, 'Un message sans correspondance'), undefined);
});
test('a root-level scenario is validated and the legacy list is rejected', () => {
  assert.equal(readScenario(source).id, 'recherche');
  assert.throws(() => readScenario(source.replace('version: 1', 'version: 2')));
  assert.throws(() => readScenario('version: 1\nscenarios: []'), /remove the scenarios list/);
  assert.throws(() => readScenario(source.replace('projet|recherche|document', '[')), /regular expression/);
  assert.throws(() => readScenario(source.replace('duration: 900', 'duration: -1')), /duration/);
  assert.throws(() => readScenario(source.replace('type: final', 'type: tool')), /name and server/);
  assert.throws(() => readScenario(source.replace('type: final', 'type: message')), /last event/);
  assert.throws(() => readScenario('version: 1\nid: incomplete\nname: Incomplete'), /matcher/);
});
test('exact, contains and always fallback', () => {
  const c = configOf(
    { id: 'fallback', name: 'Fallback', matcher: { type: 'always' }, events: [{ type: 'final', content: 'Fallback' }] },
    {
      id: 'exact',
      name: 'Exact',
      matcher: { type: 'exact', value: 'Oui' },
      events: [{ type: 'final', content: 'Exact' }],
    },
    {
      id: 'contains',
      name: 'Contains',
      matcher: { type: 'contains', value: 'MCP', caseSensitive: true },
      events: [{ type: 'final', content: 'Tool' }],
    },
  );
  assert.equal(findScenario(c, ' OUI ')?.id, 'exact');
  assert.equal(findScenario(c, 'Le MCP')?.id, 'contains');
  assert.equal(findScenario(c, 'le mcp')?.id, 'fallback');
});
test('interpolation fills nested parameters without mutating the scenario', () => {
  const v = { query: '{{prompt}}', nested: [{ text: 'Question : {{prompt}}' }] };
  assert.deepEqual(interpolate(v, '<script>'), { query: '<script>', nested: [{ text: 'Question : <script>' }] });
  assert.equal(v.query, '{{prompt}}');
});
test('MCP conditions select the behavior and preserve fallbacks', () => {
  const entry = (id: string, type: string, when?: object) => ({
    id,
    name: id,
    matcher: { type, value: 'projets' },
    ...(when ? { when } : {}),
    events: [{ type: 'final', content: id }],
  });
  const config = configOf(
    entry('generic', 'exact'),
    entry('fallback', 'always'),
    entry('github', 'exact', { mcp: { github: true } }),
    entry('nai', 'exact', { mcp: { github: false, nai: true } }),
    entry('conditional-fallback', 'always', { mcp: { nai: true } }),
  );
  assert.equal(findScenario(config, 'projets', { github: true, nai: true })?.id, 'github');
  assert.equal(findScenario(config, 'projets', { github: false, nai: true })?.id, 'nai');
  assert.equal(findScenario(config, 'projets', { github: false, nai: false })?.id, 'generic');
  assert.equal(findScenario(config, 'projets')?.id, 'generic');
  assert.equal(findScenario(config, 'autre', { github: false, nai: true })?.id, 'conditional-fallback');
  assert.equal(findScenario(config, 'autre')?.id, 'fallback');
  const onlyConditional = { ...config, scenarios: config.scenarios.filter(s => s.when) };
  assert.equal(findScenario(onlyConditional, 'projets'), undefined);
  for (const when of [
    {},
    { mcp: [] },
    { mcp: {} },
    { mcp: { github: 'true' } },
    { mcp: { '': true } },
    { mcp: { github: true }, other: true },
  ])
    assert.throws(() => configOf(entry('invalid', 'exact', when)), /when/);
});
