import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readScenario, findScenario } from '../src/engine';
import { loadScenarios } from '../server/scenarios';
const yaml = (when: string, id = 'agent') =>
  `version: 1\nid: ${id}\nname: Agent\n${when}\nmatcher: {type: exact, value: ping}\nevents: [{type: final, content: OK}]`;
test('mcpAny accepts either enabled MCP and combines with agent and required states', async () => {
  const scenario = readScenario(yaml('when: {agent: Brown, mcpAny: [github, nai], mcp: {other: false}}'));
  const config = { version: 1, scenarios: [scenario] };
  for (const states of [
    { github: true, nai: false },
    { github: false, nai: true },
    { github: true, nai: true },
  ])
    assert.equal(findScenario(config, 'ping', { ...states, other: false }, 'Brown')?.id, 'agent');
  const disabledStates: Record<string, boolean>[] = [
    { github: false, nai: false, other: false },
    { github: true, nai: true, other: true },
    { other: false },
  ];
  for (const states of disabledStates) assert.equal(findScenario(config, 'ping', states, 'Brown'), undefined);
  assert.equal(findScenario(config, 'ping', { github: true, other: false }, 'Jones'), undefined);
  for (const value of ['[]', '[github, github]', '[42]', '[""]', 'github'])
    assert.throws(() => readScenario(yaml(`when: {mcpAny: ${value}}`)), /mcpAny/);
  const dir = await mkdtemp(join(tmpdir(), 'opencode-mcp-any-'));
  try {
    await writeFile(join(dir, 'any.yaml'), yaml('when: {mcpAny: [github, nai]}'));
    await assert.rejects(loadScenarios(dir, [{ name: 'github' }]), /Unknown MCP server in when.mcpAny/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('agent conditions filter by exact selection and combine with MCP', () => {
  const general = readScenario(yaml('', 'general'));
  const gated = readScenario(yaml('when: {agent: Build, mcp: {nutanix: true}}'));
  const onlyAgent = readScenario(yaml('when: {agent: Plan}', 'plan'));
  const config = { version: 1, scenarios: [general, gated, onlyAgent] };
  assert.equal(findScenario(config, 'ping', { nutanix: true }, 'Build')?.id, 'agent');
  assert.equal(findScenario(config, 'ping', { nutanix: false }, 'Build')?.id, 'general');
  assert.equal(findScenario(config, 'ping', { nutanix: true }, 'build')?.id, 'general');
  assert.equal(findScenario(config, 'ping', {}, 'Plan')?.id, 'plan');
  assert.equal(findScenario(config, 'ping')?.id, 'general');
  for (const type of ['fuzzy', 'always']) {
    const scenario = readScenario(
      yaml('when: {agent: Build}').replace(
        'matcher: {type: exact, value: ping}',
        type === 'fuzzy' ? 'matcher: {type: fuzzy, keywords: [ping]}' : 'matcher: {type: always}',
      ),
    );
    assert.equal(findScenario({ version: 1, scenarios: [scenario] }, 'ping', {}, 'Build')?.id, 'agent');
    assert.equal(findScenario({ version: 1, scenarios: [scenario] }, 'ping', {}, 'Plan'), undefined);
  }
});
test('invalid or unknown agent conditions are rejected when loading', async () => {
  for (const condition of [
    'when: {}',
    'when: {agent: ""}',
    'when: {agent: 42}',
    'when: {agent: [Build]}',
    'when: {agent: Build, other: true}',
  ])
    assert.throws(() => readScenario(yaml(condition)));
  const dir = await mkdtemp(join(tmpdir(), 'opencode-agent-'));
  try {
    await writeFile(join(dir, 'agent.yaml'), yaml('when: {agent: Build}'));
    assert.equal((await loadScenarios(dir, [], ['Build'])).scenarios.length, 1);
    await assert.rejects(loadScenarios(dir, [], ['Plan']), /Unknown agent/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
