import { parse } from 'yaml';
export type Event = {
  type: 'thinking' | 'tool' | 'message' | 'final';
  content?: string;
  title?: string;
  delay: number;
  duration: number;
  server?: string;
  name?: string;
  input?: unknown;
  output?: unknown;
  status?: 'success' | 'error';
};
export type Scenario = {
  id: string;
  name: string;
  description?: string;
  example?: string;
  when?: { mcp?: Record<string, boolean>; mcpAny?: string[]; agent?: string };
  matcher: {
    type: 'contains' | 'exact' | 'regex' | 'always' | 'fuzzy';
    value?: string;
    caseSensitive?: boolean;
    keywords?: (string | string[])[];
    threshold?: number;
  };
  events: Event[];
};
export type Config = { version: number; scenarios: Scenario[] };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function readScenario(source: string): Scenario {
  const data: unknown = parse(source, { maxAliasCount: 30 });
  if (!object(data) || data.version !== 1)
    throw new Error('The document must contain version: 1 and a scenario at the root.');
  if (Object.hasOwn(data, 'scenarios'))
    throw new Error('Each file must contain one scenario at the root; remove the scenarios list and its indentation.');
  return validateScenario(data);
}
function validateScenario(s: Record<string, unknown>): Scenario {
  if (typeof s.id !== 'string' || !s.id || typeof s.name !== 'string' || !s.name)
    throw new Error('id and name are required.');
  if (!object(s.matcher) || !['contains', 'exact', 'regex', 'always', 'fuzzy'].includes(String(s.matcher.type)))
    throw new Error('matcher.type must be contains, exact, regex, fuzzy or always.');
  if (s.matcher.caseSensitive !== undefined && typeof s.matcher.caseSensitive !== 'boolean')
    throw new Error('caseSensitive must be a boolean.');
  if (
    !['always', 'fuzzy'].includes(String(s.matcher.type)) &&
    (typeof s.matcher.value !== 'string' || !s.matcher.value)
  )
    throw new Error('matcher.value is required.');
  if (s.matcher.type === 'fuzzy') {
    const keywords = s.matcher.keywords;
    const validKeyword = (v: unknown) => typeof v === 'string' && v.length <= 200 && tokenize(v).length > 0;
    if (
      !Array.isArray(keywords) ||
      !keywords.length ||
      keywords.length > 32 ||
      keywords.some(group =>
        Array.isArray(group)
          ? !group.length || group.length > 16 || group.some(v => !validKeyword(v))
          : !validKeyword(group),
      )
    )
      throw new Error(
        'fuzzy.keywords requires 1 to 32 nonempty keywords or alternative groups (200 characters maximum).',
      );
    if (s.matcher.threshold === undefined) s.matcher.threshold = 0.7;
    if (
      typeof s.matcher.threshold !== 'number' ||
      !Number.isFinite(s.matcher.threshold) ||
      s.matcher.threshold <= 0 ||
      s.matcher.threshold > 1
    )
      throw new Error('fuzzy.threshold must be greater than 0 and less than or equal to 1.');
  }
  if (s.matcher.type === 'regex') {
    try {
      new RegExp(String(s.matcher.value), s.matcher.caseSensitive ? '' : 'i');
    } catch {
      throw new Error('Invalid regular expression.');
    }
  }
  if (s.when !== undefined) {
    if (
      !object(s.when) ||
      !Object.keys(s.when).length ||
      Object.keys(s.when).some(key => !['mcp', 'mcpAny', 'agent'].includes(key))
    )
      throw new Error('when must contain agent, mcp or mcpAny.');
    if (
      s.when.mcpAny !== undefined &&
      (!Array.isArray(s.when.mcpAny) ||
        !s.when.mcpAny.length ||
        s.when.mcpAny.some(name => typeof name !== 'string' || !name.trim() || name.length > 100) ||
        new Set(s.when.mcpAny).size !== s.when.mcpAny.length)
    )
      throw new Error('when.mcpAny requires a nonempty list of unique MCP server names.');
    if (
      s.when.agent !== undefined &&
      (typeof s.when.agent !== 'string' || !s.when.agent.trim() || s.when.agent.length > 100)
    )
      throw new Error('when.agent requires a nonempty agent name (100 characters maximum).');
    if (s.when.mcp !== undefined) {
      if (!object(s.when.mcp) || !Object.keys(s.when.mcp).length)
        throw new Error('when.mcp must be a nonempty object.');
      for (const [name, state] of Object.entries(s.when.mcp))
        if (!name.trim() || name.length > 100 || typeof state !== 'boolean')
          throw new Error('when.mcp requires server names and boolean states.');
    }
  }
  if (!Array.isArray(s.events) || !s.events.length) throw new Error('events must be a nonempty list.');
  for (const [j, e] of s.events.entries()) {
    if (!object(e) || !['thinking', 'tool', 'message', 'final'].includes(String(e.type)))
      throw new Error(`Event ${j + 1}: invalid type.`);
    for (const field of ['delay', 'duration']) {
      if (e[field] === undefined) e[field] = 0;
      if (
        typeof e[field] !== 'number' ||
        !Number.isFinite(e[field]) ||
        (e[field] as number) < 0 ||
        (e[field] as number) > 60000
      )
        throw new Error(`${field} must be between 0 and 60000 ms.`);
    }
    if (e.type === 'tool') {
      if (typeof e.name !== 'string' || !e.name || typeof e.server !== 'string' || !e.server)
        throw new Error('A tool requires name and server.');
      if (e.status !== undefined && !['success', 'error'].includes(String(e.status)))
        throw new Error('status must be success or error.');
    } else if (typeof e.content !== 'string') throw new Error(`content is required for ${e.type}.`);
    if (e.title !== undefined && typeof e.title !== 'string') throw new Error('title must be a string.');
    if (e.type === 'final' && j !== s.events.length - 1) throw new Error('The final response must be the last event.');
  }
  if (s.events.at(-1).type !== 'final') throw new Error('The last event must have type final.');
  return s as unknown as Scenario;
}
function tokenize(text: string, caseSensitive = false): string[] {
  const normalized = text.normalize('NFD').replace(/\p{M}/gu, '');
  return (
    (caseSensitive ? normalized : normalized.toLowerCase()).match(/[\p{L}\p{N}]+/gu)?.map(word => word.slice(0, 64)) ??
    []
  );
}
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  // Keep short identifiers such as VM precise to avoid unrelated matches.
  if (Math.min(a.length, b.length) <= 3) return 0;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[i - 1] !== b[j - 1]));
    row = next;
  }
  const score = 1 - row[b.length] / Math.max(a.length, b.length);
  return score >= 0.6 ? score : 0;
}
export function fuzzyScore(s: Scenario, prompt: string): number {
  const m = s.matcher;
  const words = tokenize(prompt, m.caseSensitive).slice(0, 256);
  const groups = m.keywords ?? [];
  if (!groups.length || !words.length) return 0;
  return (
    groups.reduce((sum, group) => {
      let best = 0;
      for (const alternative of Array.isArray(group) ? group : [group]) {
        const phrase = tokenize(alternative, m.caseSensitive);
        if (!phrase.length) continue;
        for (let start = 0; start <= words.length - phrase.length; start++) {
          const score =
            phrase.reduce((total, word, i) => total + similarity(word, words[start + i]), 0) / phrase.length;
          best = Math.max(best, score);
        }
      }
      return sum + best;
    }, 0) / groups.length
  );
}
export function matches(s: Scenario, prompt: string): boolean {
  const m = s.matcher;
  const p = m.caseSensitive ? prompt.trim() : prompt.trim().toLocaleLowerCase();
  const v = m.caseSensitive ? (m.value ?? '') : (m.value ?? '').toLocaleLowerCase();
  switch (m.type) {
    case 'fuzzy':
      return fuzzyScore(s, prompt) >= (m.threshold ?? 0.7);
    case 'always':
      return true;
    case 'contains':
      return p.includes(v);
    case 'exact':
      return p === v.trim();
    case 'regex':
      return new RegExp(m.value!, m.caseSensitive ? '' : 'i').test(prompt);
  }
}
export function findScenario(
  config: Config,
  prompt: string,
  mcpStates: Record<string, boolean> = {},
  agent?: string,
): Scenario | undefined {
  const eligible = config.scenarios.filter(
    s =>
      !s.when ||
      ((s.when.agent === undefined || s.when.agent === agent) &&
        Object.entries(s.when.mcp ?? {}).every(
          ([name, state]) => Object.hasOwn(mcpStates, name) && mcpStates[name] === state,
        ) &&
        (s.when.mcpAny === undefined ||
          s.when.mcpAny.some(name => Object.hasOwn(mcpStates, name) && mcpStates[name] === true))),
  );
  const choose = (always: boolean) =>
    eligible.find(
      s =>
        (always ? s.matcher.type === 'always' : !['always', 'fuzzy'].includes(s.matcher.type)) &&
        !!s.when &&
        matches(s, prompt),
    ) ??
    eligible.find(
      s =>
        (always ? s.matcher.type === 'always' : !['always', 'fuzzy'].includes(s.matcher.type)) &&
        !s.when &&
        matches(s, prompt),
    );
  const specific = choose(false);
  if (specific) return specific;
  let best: Scenario | undefined,
    bestScore = -1;
  for (const scenario of eligible) {
    if (scenario.matcher.type !== 'fuzzy') continue;
    const score = fuzzyScore(scenario, prompt);
    if (score < (scenario.matcher.threshold ?? 0.7)) continue;
    if (score > bestScore || (score === bestScore && scenario.when && !best?.when)) {
      best = scenario;
      bestScore = score;
    }
  }
  return best ?? choose(true);
}
export function interpolate(value: unknown, prompt: string, variables: Record<string, string> = {}): unknown {
  if (typeof value === 'string')
    return value.replace(/\{\{(\w+)\}\}/g, (marker, key: string) =>
      key === 'prompt' ? prompt : (variables[key] ?? marker),
    );
  if (Array.isArray(value)) return value.map(v => interpolate(v, prompt, variables));
  if (object(value))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v, prompt, variables)]));
  return value;
}
