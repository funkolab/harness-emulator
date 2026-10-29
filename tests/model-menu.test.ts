import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { modelGroups } from '../src/model-menu';
const names = ['GPT-5.6 Terra', 'auto', 'GPT-6 Astra', 'Modèle précis'];
const providers = {
  'GPT-5.6 Terra': 'OpenAI',
  auto: 'Nutanix Enterprise AI',
  'GPT-6 Astra': 'OpenAI',
  'Modèle précis': 'Nutanix Enterprise AI',
};
test('the menu groups models by provider in configuration order', () => {
  assert.deepEqual(modelGroups(names, providers), [
    { provider: 'OpenAI', models: ['GPT-5.6 Terra', 'GPT-6 Astra'] },
    { provider: 'Nutanix Enterprise AI', models: ['auto', 'Modèle précis'] },
  ]);
});
test('search filters by model or provider, ignoring case and accents', () => {
  assert.deepEqual(modelGroups(names, providers, '  OPENAI '), [
    { provider: 'OpenAI', models: ['GPT-5.6 Terra', 'GPT-6 Astra'] },
  ]);
  assert.deepEqual(modelGroups(names, providers, 'precis'), [
    { provider: 'Nutanix Enterprise AI', models: ['Modèle précis'] },
  ]);
  assert.deepEqual(modelGroups(names, providers, 'inexistant'), []);
});
test('hidden models are removed from the results', () => {
  assert.deepEqual(modelGroups(names, providers, 'OpenAI', new Set(['GPT-5.6 Terra'])), [
    { provider: 'OpenAI', models: ['GPT-6 Astra'] },
  ]);
});
