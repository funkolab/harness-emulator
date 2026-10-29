import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { resolveMcpStates } from '../src/mcp-dialog';
test('saved MCP choices override initial states and ignore stale data', () => {
  const servers = [
    { name: 'github', enabled: false },
    { name: 'notion', enabled: true },
  ];
  assert.deepEqual(resolveMcpStates(servers, { github: true, notion: false, removed: true }), {
    github: true,
    notion: false,
  });
  assert.deepEqual(resolveMcpStates(servers, { github: 'false' }), { github: false, notion: true });
  for (const saved of [null, undefined, [], true, 'invalid'])
    assert.deepEqual(resolveMcpStates(servers, saved), { github: false, notion: true });
  assert.deepEqual(resolveMcpStates([{ name: '__proto__', enabled: true }], {}), JSON.parse('{"__proto__":true}'));
});
