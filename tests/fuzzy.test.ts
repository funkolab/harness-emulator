import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readScenario, findScenario, matches, fuzzyScore, type Scenario } from '../src/engine';
const scenario = (id: string, matcher: Scenario['matcher'], when?: Scenario['when']): Scenario => ({
  id,
  name: id,
  matcher,
  when,
  events: [{ type: 'final', content: id, delay: 0, duration: 0 }],
});
test('fuzzy matches accents, case, typos, alternatives and phrases', () => {
  const s = scenario('create', {
    type: 'fuzzy',
    keywords: [
      ['créer', 'provisionner'],
      ['VM', 'machine virtuelle'],
    ],
  });
  assert.ok(matches(s, 'Peux-tu CRÉEER une machine virtuelle ?'));
  assert.ok(matches(s, 'Provisionner une VM'));
  assert.equal(fuzzyScore(s, 'Créer une VM'), 1);
  assert.equal(matches(s, 'Lister les VM'), false);
  assert.equal(matches(s, 'Bonjour'), false);
  assert.equal(matches(s, 'Créer un volume'), false);
  assert.equal(matches(scenario('case', { type: 'fuzzy', keywords: ['VM'], caseSensitive: true }), 'vm'), false);
});
test('fuzzy ranking respects MCP eligibility, scores, ties and existing matchers', () => {
  const broad = scenario('broad', { type: 'fuzzy', keywords: ['créer', 'VM', 'test'], threshold: 0.5 });
  const precise = scenario('precise', { type: 'fuzzy', keywords: ['créer', 'VM', 'production'] });
  const gated = scenario('gated', precise.matcher, { mcp: { nutanix: true } });
  const fallback = scenario('fallback', { type: 'always' });
  const config = { version: 1, scenarios: [fallback, broad, precise, gated] };
  assert.equal(findScenario(config, 'Créer une VM de production')?.id, 'precise');
  assert.equal(findScenario(config, 'Créer une VM de production', { nutanix: true })?.id, 'gated');
  assert.equal(findScenario(config, 'Créer une VM')?.id, 'broad');
  assert.equal(findScenario(config, 'Bonjour')?.id, 'fallback');
  assert.equal(
    findScenario({ version: 1, scenarios: [broad, scenario('tie', broad.matcher)] }, 'Créer une VM')?.id,
    'broad',
  );
  config.scenarios.push(scenario('exact', { type: 'exact', value: 'Créer une VM de production' }));
  assert.equal(findScenario(config, 'Créer une VM de production', { nutanix: true })?.id, 'exact');
});
test('fuzzy YAML validates keywords and thresholds with a default threshold', () => {
  const yaml = (matcher: string) =>
    `version: 1\nid: fuzzy\nname: Fuzzy\nmatcher: ${matcher}\nevents: [{type: final, content: OK}]`;
  assert.equal(readScenario(yaml('{type: fuzzy, keywords: [create, [VM, virtual machine]]}')).matcher.threshold, 0.7);
  for (const matcher of [
    '{type: fuzzy}',
    '{type: fuzzy, keywords: []}',
    '{type: fuzzy, keywords: [[]]}',
    '{type: fuzzy, keywords: [42]}',
    '{type: fuzzy, keywords: ["!!!"]}',
    '{type: fuzzy, keywords: [create], threshold: 0}',
    '{type: fuzzy, keywords: [create], threshold: 1.1}',
    '{type: fuzzy, keywords: [create], threshold: high}',
  ])
    assert.throws(() => readScenario(yaml(matcher)));
});
