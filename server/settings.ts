import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { defaultSettings, type Settings, type Selection } from '../src/settings';
import { builtinCommands, type Command } from '../src/commands';
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function readSettings(source: string): Settings {
  const data: unknown = parse(source, { maxAliasCount: 30 });
  if (!object(data) || data.version !== 1) throw new Error('Configuration must contain version: 1.');
  const config = data;
  if (config.mcpServers !== undefined && !Array.isArray(config.mcpServers))
    throw new Error('mcpServers must be a list.');
  const serverNames = new Set<string>();
  const mcpServers = ((config.mcpServers ?? []) as unknown[]).map(server => {
    const name = typeof server === 'string' ? server : object(server) ? server.name : undefined;
    const enabled = object(server) ? (server.enabled ?? false) : false;
    if (typeof name !== 'string' || !name.trim() || name.length > 100)
      throw new Error('Each MCP server requires a nonempty name (100 characters maximum).');
    if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean for each MCP server.');
    if (serverNames.has(name.trim())) throw new Error('mcpServers contains duplicate names.');
    serverNames.add(name.trim());
    return { name: name.trim(), enabled };
  });
  const commands: Command[] = structuredClone(builtinCommands);
  const commandNames = new Set(commands.map(command => command.name));
  if (config.commands !== undefined) {
    if (!Array.isArray(config.commands)) throw new Error('commands must be a list.');
    for (const command of config.commands) {
      if (!object(command) || typeof command.name !== 'string') throw new Error('Each command requires name.');
      const name = command.name.replace(/^\//, '').toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name))
        throw new Error('Command names must contain letters, digits, hyphens or underscores (64 characters maximum).');
      if (commandNames.has(name)) throw new Error(`Duplicate or reserved command: /${name}`);
      const description = command.description === undefined ? '' : command.description;
      if (typeof description !== 'string') throw new Error(`/${name}: description must be a string.`);
      if (description.length > 1000) throw new Error(`/${name}: description exceeds 1000 characters.`);
      if (command.action !== undefined) throw new Error(`/${name}: action is reserved for built-in commands.`);
      commandNames.add(name);
      commands.push({ name, description });
    }
  }
  function list(key: string): string[] {
    const value = config[key];
    if (!Array.isArray(value) || !value.length || value.some(v => typeof v !== 'string' || !v.trim() || v.length > 100))
      throw new Error(`${key} must be a nonempty list of names (100 characters maximum).`);
    const names: string[] = value.map(v => v.trim());
    if (new Set(names).size !== names.length) throw new Error(`${key} contains duplicate names.`);
    return names;
  }
  const agents = list('agents'),
    reasoningLevels = list('reasoningLevels');
  if (!Array.isArray(config.models) || !config.models.length)
    throw new Error('models must be a nonempty list of names or { name, provider } objects.');
  const modelProviders: Record<string, string> = Object.create(null);
  const models = config.models.map(value => {
    const name = typeof value === 'string' ? value : object(value) ? value.name : undefined;
    const provider = object(value) ? (value.provider ?? 'Models') : 'Models';
    if (typeof name !== 'string' || !name.trim() || name.length > 100)
      throw new Error('Each model requires a nonempty name (100 characters maximum).');
    if (typeof provider !== 'string' || !provider.trim() || provider.length > 100)
      throw new Error('Each provider must have a nonempty name (100 characters maximum).');
    const trimmed = name.trim();
    if (Object.hasOwn(modelProviders, trimmed)) throw new Error('models contains duplicate names.');
    modelProviders[trimmed] = provider.trim();
    return trimmed;
  });
  const rawDefaults = config.defaults === undefined ? {} : config.defaults;
  if (!object(rawDefaults)) throw new Error('defaults must be an object.');
  const defaults: Record<string, unknown> = rawDefaults;
  function selected(key: string, names: string[]) {
    const value = defaults[key] ?? names[0];
    if (typeof value !== 'string' || !names.includes(value))
      throw new Error(`defaults.${key} must belong to its corresponding list.`);
    return value;
  }
  function text(key: 'project' | 'branch'): string {
    const value = config[key];
    if (value === undefined) return defaultSettings[key];
    if (typeof value !== 'string' || !value.trim() || value.length > 100)
      throw new Error(`${key} must be a nonempty name (100 characters maximum).`);
    return value.trim();
  }
  return {
    agents,
    models,
    modelProviders,
    reasoningLevels,
    commands,
    mcpServers,
    defaults: {
      agent: selected('agent', agents),
      model: selected('model', models),
      reasoningLevel: selected('reasoningLevel', reasoningLevels),
    },
    project: text('project'),
    branch: text('branch'),
  };
}
export async function loadSettings(filename?: string): Promise<Settings> {
  if (!filename) return structuredClone(defaultSettings);
  try {
    const source = await readFile(filename, 'utf8');
    if (Buffer.byteLength(source) > 65536) throw new Error('The file exceeds 64 KiB.');
    return readSettings(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(defaultSettings);
    throw new Error(`${filename}: ${(error as Error).message}`);
  }
}
export function resolveSelection(input: Record<string, unknown>, settings: Settings): Selection {
  const selection: Selection = { ...settings.defaults };
  const choices = { agent: settings.agents, model: settings.models, reasoningLevel: settings.reasoningLevels };
  for (const key of Object.keys(choices) as (keyof Selection)[]) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || !choices[key].includes(input[key]))
        throw new Error('This choice is no longer available. Reload the page and try again.');
      selection[key] = input[key];
    }
  }
  return selection;
}

export function resolveMcpSelection(value: unknown, settings: Settings): Record<string, boolean> {
  if (value !== undefined && !object(value)) throw new Error('MCP states must be booleans for each server.');
  const input = object(value) ? value : {};
  for (const [name, state] of Object.entries(input)) {
    if (!settings.mcpServers.some(server => server.name === name))
      throw new Error('An MCP server is no longer available. Reload the page and try again.');
    if (typeof state !== 'boolean') throw new Error('MCP states must be booleans for each server.');
  }
  return Object.fromEntries(
    settings.mcpServers.map(server => [
      server.name,
      Object.hasOwn(input, server.name) ? (input[server.name] as boolean) : server.enabled,
    ]),
  );
}
