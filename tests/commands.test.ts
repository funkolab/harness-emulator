import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { builtinCommands, commandQuery, filterCommands, parseCommand } from '../src/commands';
test('a leading slash opens the palette only before arguments', () => {
  assert.equal(commandQuery('/'), '');
  assert.equal(commandQuery('/Ne'), 'Ne');
  for (const value of ['/new ', '/new arguments', 'question /new', 'https://example.com', '/new\n'])
    assert.equal(commandQuery(value), null);
});
test('search matches descriptions and ignores accents and case', () => {
  assert.equal(filterCommands(builtinCommands, 'CREATE')[0].name, 'new');
  assert.equal(filterCommands([{ name: 'fr', description: 'Créer une session' }], 'CREER')[0].name, 'fr');
  assert.equal(filterCommands(builtinCommands, 'mc')[0].name, 'mcp');
  assert.equal(filterCommands(builtinCommands, 'absent').length, 0);
  assert.equal(filterCommands(builtinCommands, '').length, 2);
});
test('commands keep multiline arguments as text', () => {
  assert.deepEqual(parseCommand(' /Probe hello\nworld '), { name: 'probe', args: 'hello\nworld' });
  assert.deepEqual(parseCommand('/new '), { name: 'new', args: '' });
  for (const value of ['/', 'texte /new', '/foo/bar']) assert.equal(parseCommand(value), null);
});
