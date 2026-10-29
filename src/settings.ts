export type Selection = { agent: string; model: string; reasoningLevel: string };
export type McpServer = { name: string; enabled: boolean };
export type Settings = {
  agents: string[];
  models: string[];
  modelProviders: Record<string, string>;
  reasoningLevels: string[];
  defaults: Selection;
  project: string;
  branch: string;
  commands: Command[];
  mcpServers: McpServer[];
};
export const defaultSettings: Settings = {
  agents: ['Plan', 'Build'],
  models: ['GPT-5.6 Terra Fast'],
  modelProviders: { 'GPT-5.6 Terra Fast': 'OpenAI' },
  reasoningLevels: ['Default', 'Low', 'Medium', 'High'],
  defaults: { agent: 'Plan', model: 'GPT-5.6 Terra Fast', reasoningLevel: 'Default' },
  project: 'work',
  branch: 'main',
  commands: builtinCommands,
  mcpServers: [],
};
import { builtinCommands, type Command } from './commands';
