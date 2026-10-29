import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { detectLanguage, requestLanguage, translate } from '../src/i18n';
test('browser languages honor regional variants and preference order', () => {
  assert.equal(detectLanguage(['en-US', 'fr-FR']), 'en');
  assert.equal(detectLanguage(['fr-CA', 'en-GB']), 'fr');
  assert.equal(detectLanguage(['de-DE', 'fr']), 'fr');
  assert.equal(detectLanguage(['es']), 'en');
  assert.equal(detectLanguage([]), 'en');
  assert.equal(requestLanguage('en;q=0.5,fr-FR;q=0.9'), 'fr');
  assert.equal(requestLanguage('fr;q=0,en-US;q=1'), 'en');
});
test('labels and variables are translated without changing custom text', () => {
  assert.equal(translate('New session', 'fr'), 'Nouvelle session');
  assert.equal(translate('New session', 'en'), 'New session');
  assert.equal(translate('Active MCPs: {active} of {total}', 'fr', { active: 1, total: 3 }), 'MCP actifs : 1 sur 3');
  assert.equal(translate('Texte du scénario', 'en'), 'Texte du scénario');
  assert.equal(translate('Texte du scénario', 'fr'), 'Texte du scénario');
});

test('French configuration labels display in English', () => {
  assert.equal(translate('Architecte', 'en'), 'Architect');
  assert.equal(translate('Défaut', 'en'), 'Default');
  assert.equal(translate('Default', 'fr'), 'Défaut');
});

test('a context selects gendered French forms', () => {
  assert.equal(translate('Interrupted', 'fr'), 'Interrompu');
  assert.equal(translate('Interrupted', 'fr', {}, 'thinking'), 'Interrompue');
  assert.equal(translate('Done', 'fr', {}, 'thinking'), 'Terminée');
  assert.equal(translate('Done', 'en', {}, 'thinking'), 'Done');
});

test('English source messages have French translations', () => {
  assert.equal(translate('Access denied.', 'fr'), 'Accès refusé.');
  assert.equal(
    translate('This choice is no longer available. Reload the page and try again.', 'fr'),
    'Ce choix n’est plus disponible. Rechargez la page puis réessayez.',
  );
  assert.equal(translate('Unknown command: {name}', 'fr', { name: '/test' }), 'Commande inconnue : /test');
  assert.equal(translate('Access denied.', 'en'), 'Access denied.');
});
