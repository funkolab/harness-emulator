import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadScenarios } from '../server/scenarios';
import { loadSettings } from '../server/settings';
import { findScenario, matches } from '../src/engine';

test('Nutanix requests select the three flows only with their agent and the active MCP', async () => {
  const settings = await loadSettings(resolve('config.yaml'));
  const config = await loadScenarios(resolve('scenarios'), settings.mcpServers, settings.agents);
  const enabled = { 'nutanix-official': true, github: true, 'github via NAI': true };
  const examples: [string, string][] = [
    ['Donne-moi la liste des VM.', 'nutanix-liste-vm'],
    ['Montre les machines virtuelles de mon projet.', 'nutanix-liste-vm'],
    ['List all VMs', 'nutanix-liste-vm'],
    ['Crée une nouvelle VM.', 'nutanix-creation-vm'],
    ['Créer une machine virtuelle', 'nutanix-creation-vm'],
    ['Create a new virtual machine', 'nutanix-creation-vm'],
    ['Éteins les VM pour libérer des ressources.', 'nutanix-extinction-vm'],
    ['Éteindre des VM pour libérer des ressources', 'nutanix-extinction-vm'],
    ['Arrête les machines virtuelles', 'nutanix-extinction-vm'],
    ['Turn off the VMs to free resources', 'nutanix-extinction-vm'],
    ['Liste les VM à éteindre pour libérer des ressources', 'nutanix-extinction-vm'],
    ["Merci d'arrêter les VM de test afin de libérer de la ressource.", 'nutanix-extinction-vm'],
    ['Merci d’arrêter les VM de test afin de libérer de la ressource.', 'nutanix-extinction-vm'],
    ['Merci d’arreter les VM de test.', 'nutanix-extinction-vm'],
    ['Merci d’arrter les VM de test.', 'nutanix-extinction-vm'],
    ['Éteindr les machines virtuelles de test.', 'nutanix-extinction-vm'],
    ['Show the VMs to shut down', 'nutanix-extinction-vm'],
  ];
  for (const [prompt, id] of examples) {
    const selectedAgent = id === 'nutanix-extinction-vm' ? 'Smith' : 'Jones';
    assert.equal(findScenario(config, prompt, enabled, selectedAgent)?.id, id, prompt);
    for (const agent of settings.agents.filter(name => name !== selectedAgent))
      assert.ok(!findScenario(config, prompt, enabled, agent)?.id.startsWith('nutanix-'), `${agent}: ${prompt}`);
    assert.ok(!findScenario(config, prompt, enabled)?.id.startsWith('nutanix-'), prompt);
    assert.ok(
      !findScenario(config, prompt, { ...enabled, 'nutanix-official': false }, selectedAgent)?.id.startsWith(
        'nutanix-',
      ),
      prompt,
    );
  }
  const extinction = findScenario(config, examples[6][0], enabled, 'Smith')!;
  assert.equal(extinction.matcher.type, 'fuzzy');
  for (const prompt of [
    'Liste les VM de test',
    'Crée une VM de test',
    'Merci de libérer de la ressource',
    'Arrête le serveur de test',
  ]) {
    assert.equal(matches(extinction, prompt), false, prompt);
  }
  assert.match(extinction.events.at(-1)?.content ?? '', /effac[ée]/i);
  assert.ok(extinction.events.some(event => event.type === 'tool' && event.name === 'delete_vms'));
  assert.ok(
    extinction.events.filter(event => event.type === 'tool').every(event => event.server === 'nutanix-official'),
  );
});
