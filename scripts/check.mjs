import { resolve } from 'node:path';
import { loadSettings } from '../server/settings.ts';
import { loadScenarios } from '../server/scenarios.ts';

try {
  const settings = await loadSettings(resolve('config.yaml'));
  const config = await loadScenarios(resolve('scenarios'), settings.mcpServers, settings.agents);
  console.log(`Configuration valid; ${config.scenarios.length} scenarios validated.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
