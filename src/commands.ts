import { foldText } from './text';
export type Command = { name: string; description: string; action?: 'new' | 'mcp' };
export const builtinCommands: Command[] = [
  { name: 'new', description: 'Create a new session', action: 'new' },
  { name: 'mcp', description: 'Enable or disable MCP servers', action: 'mcp' },
];
export function filterCommands(commands: Command[], query: string): Command[] {
  const search = foldText(query).trim();
  return commands.filter(command => foldText(`${command.name} ${command.description}`).includes(search));
}
/** A command token alone opens completion; arguments leave normal editing active. */
export function commandQuery(value: string): string | null {
  const match = /^\s*\/([a-z0-9_-]*)$/i.exec(value);
  return match ? match[1] : null;
}
export function parseCommand(value: string): { name: string; args: string } | null {
  const match = /^\/([a-z0-9][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i.exec(value.trim());
  return match ? { name: match[1].toLowerCase(), args: (match[2] ?? '').trim() } : null;
}
