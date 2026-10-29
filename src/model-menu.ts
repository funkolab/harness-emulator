import { foldText } from './text';
export type ModelGroup = { provider: string; models: string[] };
/** Retain configuration order and allow searching either name or provider. */
export function modelGroups(
  models: string[],
  providers: Record<string, string>,
  query = '',
  hidden: ReadonlySet<string> = new Set(),
): ModelGroup[] {
  const groups = new Map<string, string[]>();
  const search = foldText(query).trim();
  for (const model of models) {
    const provider = providers[model] ?? 'Models';
    if (hidden.has(model) || (search && !foldText(`${provider} ${model}`).includes(search))) continue;
    if (!groups.has(provider)) groups.set(provider, []);
    groups.get(provider)!.push(model);
  }
  return Array.from(groups, ([provider, models]) => ({ provider, models }));
}
