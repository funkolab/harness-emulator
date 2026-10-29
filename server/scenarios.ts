import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readScenario, type Config } from '../src/engine';

/** Reload on every request so operators can edit files without restarting. */
export async function loadScenarios(
  directory: string,
  mcpServers?: { name: string }[],
  agents?: string[],
): Promise<Config> {
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter(file => file.isFile() && /\.ya?ml$/i.test(file.name))
    .map(file => file.name)
    .sort();
  if (!files.length) throw new Error(`No YAML files in ${directory}`);
  const config: Config = { version: 1, scenarios: [] };
  const ids = new Set<string>();
  for (const filename of files) {
    try {
      const content = await readFile(join(directory, filename), 'utf8');
      if (Buffer.byteLength(content) > 1024 * 1024) throw new Error('The file exceeds 1 MiB.');
      const scenario = readScenario(content);
      if (mcpServers && scenario.when?.mcp)
        for (const name of Object.keys(scenario.when.mcp))
          if (!mcpServers.some(server => server.name === name))
            throw new Error(`Unknown MCP server in when.mcp: ${name}`);
      if (mcpServers && scenario.when?.mcpAny)
        for (const name of scenario.when.mcpAny)
          if (!mcpServers.some(server => server.name === name))
            throw new Error(`Unknown MCP server in when.mcpAny: ${name}`);
      if (agents && scenario.when?.agent !== undefined && !agents.includes(scenario.when.agent))
        throw new Error(`Unknown agent in when.agent: ${scenario.when.agent}`);
      if (ids.has(scenario.id)) throw new Error(`Duplicate ID: ${scenario.id}`);
      ids.add(scenario.id);
      config.scenarios.push(scenario);
    } catch (error) {
      throw new Error(`${filename}: ${(error as Error).message}`);
    }
  }
  return config;
}
