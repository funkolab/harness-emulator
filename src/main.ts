import { t as tr, language } from './i18n';
import './style.css';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Event } from './engine';
import { defaultSettings, type Settings, type Selection } from './settings';
import { createCommandPalette, type CommandPalette } from './command-palette';
import { openMcpDialog, getMcpStates } from './mcp-dialog';
import { parseCommand } from './commands';
import { openModelPicker, closeModelPicker, openChoicePicker } from './model-picker';
import { escapeHtml as esc } from './text';
const root = document.querySelector<HTMLDivElement>('#app')!;
const paths: Record<string, string> = {
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  plus: 'M12 5v14M5 12h14',
  send: 'm7 10 5-5 5 5M12 5v14',
  code: 'm8 8-4 4 4 4m8-8 4 4-4 4m-5-11-2 14',
  close: 'm6 6 12 12M6 18 18 6',
  panel: 'M9 3v18M3 3h18v18H3z',
  check: 'm5 12 4 4L19 6',
  chevron: 'm9 5 7 7-7 7',
  tool: 'M14 6a5 5 0 0 0-6 6L3 17l4 4 5-5a5 5 0 0 0 6-6l-4 4-4-4z',
  brain: 'M9 18c-4 2-7-3-4-6-3-4 1-8 4-6 1-4 5-4 6 0 3-2 7 2 4 6 3 3 0 8-4 6M12 4v16',
  download: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4',
  stop: 'M6 6h12v12H6z',
  clock: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  branch: 'M6 3v12a3 3 0 0 0 6 0V9a6 6 0 0 1 6-6M4 3h4M16 3h4',
  chat: 'M4 4h16v12H8l-4 4z',
  alert: 'M12 8v5m0 3v1M12 3 2 21h20z',
  play: 'm8 4 12 8-12 8z',
  file: 'M14 3H5v18h14V8zM14 3v5h5',
};
const icon = (name: string) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] ?? paths.code}"/></svg>`;
const md = (s: string) => DOMPurify.sanitize(marked.parse(s, { async: false }) as string);
const uid = () => crypto.randomUUID();
type DisplayEvent = Event & { state: 'running' | 'done' | 'cancelled'; visible: string };
type Turn = {
  selection?: Selection;
  mcpStates?: Record<string, boolean>;
  prompt: string;
  events: DisplayEvent[];
  state: 'running' | 'done' | 'cancelled' | 'error';
  elapsed?: number;
  error?: string;
};
type Session = { id: string; title: string; turns: Turn[]; draft?: string; attachments?: string[] };
let settings: Settings = structuredClone(defaultSettings);
let selection: Selection = { ...settings.defaults };
let settingsReady = false;
let sessions: Session[] = [];
try {
  const saved = JSON.parse(localStorage.getItem('harness-emulator.sessions.v2') ?? '[]');
  if (Array.isArray(saved))
    sessions = saved.filter(
      s =>
        s &&
        typeof s.id === 'string' &&
        typeof s.title === 'string' &&
        Array.isArray(s.turns) &&
        s.turns.every((t: Turn) => typeof t.prompt === 'string' && Array.isArray(t.events)),
    );
  for (const s of sessions)
    for (const t of s.turns) {
      if (t.state === 'running') t.state = 'cancelled';
      for (const e of t.events) if (e.state === 'running') e.state = 'cancelled';
    }
} catch {
  sessions = [];
}
let openSessions: string[] = [];
let current = '',
  sidebar = false,
  running = false,
  notice = '',
  promptDraft = '',
  controller: AbortController | null = null;
let attachments: string[] = [];
let commandPalette: CommandPalette | null = null;
let closeMcpDialog: (() => void) | null = null;
const sessionTitle = (s: Session) => (s.turns.length ? s.title : tr('New session'));
const session = () => sessions.find(s => s.id === current);
const save = () => {
  try {
    localStorage.setItem('harness-emulator.sessions.v2', JSON.stringify(sessions));
    localStorage.setItem('harness-emulator.tabs.v1', JSON.stringify({ open: openSessions, current }));
  } catch {
    toast(tr('History could not be saved.'));
  }
};
function wordmark() {
  const chars: Record<string, string[]> = {
    o: ['00000', '00000', '11111', '11011', '11011', '11011', '11111'],
    p: ['00000', '00000', '11111', '11011', '11111', '11000', '11000'],
    e: ['00000', '00000', '11111', '11011', '11111', '11000', '11111'],
    n: ['00000', '00000', '11110', '11011', '11011', '11011', '11011'],
    c: ['00000', '00000', '11111', '11000', '11000', '11000', '11111'],
    d: ['00011', '00011', '11111', '11011', '11011', '11011', '11111'],
  };
  const rects = [...'opencode']
    .flatMap((c, i) =>
      chars[c].flatMap((row, y) =>
        [...row].flatMap((v, x) => (v === '1' ? `<rect x="${i * 6 + x}" y="${y}" width="1.03" height="1.03"/>` : [])),
      ),
    )
    .join('');
  return `<svg class="wordmark-logo" viewBox="0 0 47 8" role="img" aria-label="OpenCode">${rects}</svg>`;
}
const chevronDown =
  '<svg class="model-trigger-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
const disabledIf = (condition: boolean) => (condition ? 'disabled' : '');
const json = (value: unknown) => JSON.stringify(value ?? {}, null, 2);
function renderEvent(e: DisplayEvent) {
  const waiting = e.state === 'running';
  const open = waiting ? 'open' : '';
  const pulse = waiting ? 'pulse' : '';
  if (e.type === 'tool') {
    const status = waiting
      ? tr('Running')
      : e.state === 'cancelled'
        ? tr('Interrupted')
        : e.status === 'error'
          ? tr('Error')
          : tr('Done');
    const result = waiting
      ? ''
      : `<div class="code-label">${tr('RESULT')}</div><pre>${esc(typeof e.output === 'string' ? e.output : json(e.output))}</pre>`;
    return `<details class="event tool" ${open}><summary><span class="event-icon ${pulse}">${icon(e.status === 'error' && !waiting ? 'alert' : 'tool')}</span><span class="tool-name">${esc(e.server)}<span class="slash"> / </span>${esc(e.name)}</span><span class="event-status ${e.status === 'error' ? 'error' : ''}">${status}</span>${icon('chevron')}</summary><div class="tool-body"><div class="code-label">${tr('PARAMETERS')}</div><pre>${esc(json(e.input))}</pre>${result}</div></details>`;
  }
  if (e.type === 'thinking') {
    const status = waiting
      ? tr('Running')
      : e.state === 'cancelled'
        ? tr('Interrupted', {}, 'thinking')
        : tr('Done', {}, 'thinking');
    return `<details class="event thinking" ${open}><summary><span class="event-icon ${pulse}">${icon('brain')}</span><span>${esc(e.title ?? tr('Thinking'))}</span><span class="event-status">${status}</span>${icon('chevron')}</summary><div class="thought">${md(e.visible)}</div></details>`;
  }
  return `<div class="answer markdown ${waiting ? 'streaming' : ''}">${md(e.visible)}</div>`;
}
function renderTabbar() {
  const tabs = openSessions
    .map(id => {
      const item = sessions.find(s => s.id === id)!;
      const title = esc(sessionTitle(item));
      return `<div class="session-tab ${id === current ? 'active' : ''}"><button class="session-tab-select" role="tab" aria-selected="${id === current}" data-tab="${id}" title="${title}">${icon(item.turns.length ? 'chat' : 'plus')}<span>${title}</span></button><button class="session-tab-close" data-close-tab="${id}" aria-label="${tr('Close tab')} ${title}" title="${tr('Close tab')}">${icon('close')}</button></div>`;
    })
    .join('');
  return `<header class="tabbar"><button class="icon-button" data-action="sidebar" aria-label="${tr('Show sessions')}" title="${tr('Sessions')}">${icon('panel')}</button><div class="session-tabs" role="tablist" aria-label="${tr('Open sessions')}">${tabs}</div><button class="icon-button" data-action="new" aria-label="${tr('New session')}" title="${tr('New session')}">${icon('plus')}</button></header>`;
}
function renderSidebar() {
  if (!sidebar) return '';
  const history = sessions.length
    ? sessions
        .map(
          s =>
            `<button class="history-item ${s.id === current ? 'selected' : ''}" data-session="${s.id}">${icon('chat')}<span>${esc(sessionTitle(s))}</span></button>`,
        )
        .join('')
    : `<p class="quiet">${tr('No recent sessions.')}</p>`;
  return `<aside class="sidebar"><div class="side-heading">${tr('Sessions')} <button class="icon-button" data-action="new" aria-label="${tr('Create session')}">${icon('plus')}</button></div>${history}<div class="sidebar-bottom"><button type="button" class="clear-history" data-action="clear-history" ${disabledIf(running)}>${icon('trash')}<span>${tr('Delete all sessions')}</span></button><span class="project-badge">W</span> ${esc(settings.project)}</div></aside>`;
}
function renderTurn(t: Turn, index: number) {
  const error = t.error
    ? `<div class="no-match">${icon('alert')}<div>${esc(tr(t.error))}<p><button class="text-button" data-retry="${index}" ${disabledIf(running)}>${tr('Retry')}</button></p></div></div>`
    : '';
  const outcome =
    t.state === 'cancelled'
      ? tr('Interrupted')
      : t.state === 'error'
        ? tr('Error')
        : esc(t.selection?.model ?? selection.model);
  const footer =
    t.state === 'running'
      ? ''
      : `<div class="turn-footer">${icon(t.state === 'done' ? 'check' : 'stop')} ${outcome} · ${((t.elapsed ?? 0) / 1000).toFixed(1)} s</div>`;
  return `<section class="turn"><div class="user-message"><span class="avatar">${tr('You')}</span><div>${esc(t.prompt)}</div></div><div class="assistant-message"><div class="assistant-label"><span class="assistant-mark">O</span> ${esc(tr(t.selection?.agent ?? selection.agent))}</div>${t.events.map(renderEvent).join('')}${error}${footer}</div></section>`;
}
function renderComposer() {
  const locked = disabledIf(running || !settingsReady);
  const files = attachments.length
    ? `<div class="attachment-list">${attachments.map(name => `<span>${icon('file')}${esc(name)}</span>`).join('')}<button type="button" class="icon-button" data-action="clear-files" aria-label="${tr('Remove files')}">${icon('close')}</button></div>`
    : '';
  const agent = esc(tr(selection.agent));
  const level = esc(tr(selection.reasoningLevel));
  const send = running
    ? `<button type="button" class="send stop" data-action="stop" aria-label="${tr('Stop')}">${icon('stop')}</button>`
    : `<button type="submit" class="send" aria-label="${tr('Send')}" ${disabledIf(!promptDraft.trim() || !settingsReady)}>${icon('send')}</button>`;
  const toolbar = [
    `<button type="button" class="icon-button" data-action="attach" aria-label="${tr('Add files')}" title="${tr('Add files')}" ${disabledIf(running)}>${icon('plus')}</button>`,
    `<button type="button" class="model-trigger choice-trigger" data-action="agents" id="agent" aria-label="${tr('Choose agent')}" aria-haspopup="listbox" aria-expanded="false" title="${agent}" ${locked}><span class="choice-trigger-name">${agent}</span>${chevronDown}</button>`,
    `<button type="button" class="model-trigger" data-action="models" id="model-trigger" aria-label="${tr('Choose model')}" aria-haspopup="listbox" aria-expanded="false" title="${esc(selection.model)}" ${locked}>${icon('brain')}<span class="model-trigger-name">${esc(selection.model)}</span>${chevronDown}</button>`,
    `<button type="button" class="model-trigger choice-trigger" data-action="reasoning" id="reasoning" aria-label="${tr('Reasoning level')}" aria-haspopup="listbox" aria-expanded="false" title="${tr('Reasoning level: {level}', { level })}" ${locked}><span class="choice-trigger-name">${level}</span>${chevronDown}</button>`,
    '<span class="toolbar-spacer"></span>',
    send,
  ].join('');
  return `<div class="composer-area"><form class="composer" id="prompt-form">${files}<textarea aria-label="${tr('Your question')}" id="prompt" placeholder="${tr('Ask anything, / for commands, @ for context...')}" rows="2" maxlength="16000" ${disabledIf(running)}>${esc(promptDraft)}</textarea><div class="composer-toolbar">${toolbar}</div></form><div class="workspace-footer"><span class="project-badge">W</span> ${esc(settings.project)} <span class="slash">/</span> ${icon('branch')} ${esc(settings.branch)}</div></div>`;
}
function render() {
  closeMcpDialog?.();
  closeMcpDialog = null;
  commandPalette?.destroy();
  commandPalette = null;
  closeModelPicker();
  const turns = session()?.turns ?? [];
  const content = turns.length
    ? `<div class="transcript" aria-live="polite"><div class="transcript-inner">${turns.map(renderTurn).join('')}</div></div>`
    : `<div class="welcome">${wordmark()}</div>`;
  root.innerHTML = `${renderTabbar()}
 <div class="layout">${renderSidebar()}
 <main class="workspace ${turns.length ? 'conversation' : ''}">${content}
 ${renderComposer()}</main></div><div class="toast ${notice ? 'visible' : ''}" role="status">${esc(notice)}</div><input type="file" id="attachments" multiple hidden>`;
  bind();
  scrollToEnd();
  root
    .querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function scrollToEnd() {
  const el = root.querySelector('.transcript');
  if (el) el.scrollTop = el.scrollHeight;
}
function toast(message: string) {
  notice = message;
  const el = root.querySelector('.toast');
  if (el) {
    el.textContent = message;
    el.classList.add('visible');
    setTimeout(() => {
      notice = '';
      el.classList.remove('visible');
    }, 3500);
  }
}
function stashDraft() {
  const s = session();
  if (s) {
    s.draft = promptDraft;
    s.attachments = [...attachments];
  }
}
function createSession() {
  const s: Session = { id: uid(), title: tr('New session'), turns: [] };
  sessions.unshift(s);
  openSessions.push(s.id);
  current = s.id;
  promptDraft = '';
  attachments = [];
  return s;
}
function newSession() {
  if (running) return toast(tr('Stop the response before switching sessions.'));
  stashDraft();
  createSession();
  save();
  render();
  root.querySelector<HTMLTextAreaElement>('#prompt')?.focus();
}
function openSession(id: string) {
  if (id === current) return;
  if (running) return toast(tr('Stop the response before switching sessions.'));
  const s = sessions.find(s => s.id === id);
  if (!s) return;
  stashDraft();
  if (!openSessions.includes(id)) openSessions.push(id);
  current = id;
  promptDraft = typeof s.draft === 'string' ? s.draft : '';
  attachments = Array.isArray(s.attachments) ? s.attachments : [];
  save();
  render();
  root.querySelector<HTMLTextAreaElement>('#prompt')?.focus();
}
function closeSessionTab(id: string) {
  if (id === current && running) return toast(tr('Stop the response before closing this tab.'));
  const index = openSessions.indexOf(id);
  if (index < 0) return;
  stashDraft();
  openSessions.splice(index, 1);
  if (id === current) {
    current = openSessions[Math.min(index, openSessions.length - 1)] ?? '';
    if (!current) createSession();
    else {
      const s = session()!;
      promptDraft = s.draft ?? '';
      attachments = s.attachments ?? [];
    }
  }
  save();
  render();
}
function restoreTabs() {
  try {
    const tabs = JSON.parse(localStorage.getItem('harness-emulator.tabs.v1') ?? 'null');
    if (tabs && Array.isArray(tabs.open))
      openSessions = [
        ...new Set<string>(
          tabs.open.filter((id: unknown) => typeof id === 'string' && sessions.some(s => s.id === id)),
        ),
      ];
    if (openSessions.length) current = openSessions.includes(tabs.current) ? tabs.current : openSessions[0];
  } catch {}
  if (!current) createSession();
  else {
    const s = session()!;
    promptDraft = typeof s.draft === 'string' ? s.draft : '';
    attachments = Array.isArray(s.attachments) ? s.attachments : [];
  }
  save();
}
function clearHistory() {
  if (running) return toast(tr('Stop the response before deleting sessions.'));
  closeModelPicker();
  const overlay = document.createElement('div');
  overlay.className = 'mcp-overlay';
  overlay.innerHTML = `<section class="mcp-dialog history-dialog" role="dialog" aria-modal="true" aria-labelledby="clear-history-title"><h2 id="clear-history-title">${tr('Delete all sessions?')}</h2><p>${tr('Conversations and drafts will be permanently deleted from this browser.')}</p><div class="history-dialog-actions"><button type="button" class="cancel-history">${tr('Cancel')}</button><button type="button" class="confirm-clear-history">${tr('Delete')}</button></div></section>`;
  root.append(overlay);
  function close() {
    document.removeEventListener('keydown', keys);
    overlay.remove();
    closeMcpDialog = null;
    root.querySelector<HTMLButtonElement>('.clear-history')?.focus();
  }
  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const cancel = overlay.querySelector<HTMLButtonElement>('.cancel-history')!,
        confirm = overlay.querySelector<HTMLButtonElement>('.confirm-clear-history')!;
      (document.activeElement === cancel ? confirm : cancel).focus();
    }
  }
  closeMcpDialog = close;
  overlay.querySelector<HTMLButtonElement>('.cancel-history')!.onclick = close;
  overlay.onpointerdown = event => {
    if (event.target === overlay) close();
  };
  overlay.querySelector<HTMLButtonElement>('.confirm-clear-history')!.onclick = () => {
    close();
    sessions = [];
    openSessions = [];
    current = '';
    promptDraft = '';
    attachments = [];
    createSession();
    save();
    render();
    toast(tr('All sessions have been deleted.'));
  };
  document.addEventListener('keydown', keys);
  overlay.querySelector<HTMLButtonElement>('.cancel-history')!.focus();
}
function bind() {
  for (const el of root.querySelectorAll<HTMLElement>('[data-action]'))
    el.onclick = () => {
      commandPalette?.dismiss();
      switch (el.dataset.action) {
        case 'sidebar':
          sidebar = !sidebar;
          render();
          break;
        case 'new':
          newSession();
          break;
        case 'clear-history':
          clearHistory();
          break;
        case 'stop':
          controller?.abort();
          break;
        case 'attach':
          root.querySelector<HTMLInputElement>('#attachments')!.click();
          break;
        case 'clear-files':
          attachments = [];
          stashDraft();
          save();
          render();
          break;
        case 'agents':
        case 'reasoning': {
          const agent = el.dataset.action === 'agents',
            key = agent ? 'agent' : 'reasoningLevel',
            trigger = root.querySelector<HTMLButtonElement>(agent ? '#agent' : '#reasoning')!;
          openChoicePicker(
            root,
            trigger,
            agent ? settings.agents : settings.reasoningLevels,
            selection[key],
            agent ? tr('Agents') : tr('Reasoning level'),
            value => {
              selection[key] = value;
              trigger.querySelector('.choice-trigger-name')!.textContent = tr(value);
              trigger.title = tr(value);
            },
          );
          break;
        }
        case 'models': {
          const trigger = root.querySelector<HTMLButtonElement>('#model-trigger')!;
          openModelPicker(root, trigger, settings, selection.model, model => {
            selection.model = model;
            trigger.querySelector('.model-trigger-name')!.textContent = model;
            trigger.title = model;
          });
          break;
        }
      }
    };
  for (const el of root.querySelectorAll<HTMLElement>('[data-session]'))
    el.onclick = () => openSession(el.dataset.session!);
  for (const el of root.querySelectorAll<HTMLElement>('[data-tab]')) el.onclick = () => openSession(el.dataset.tab!);
  for (const el of root.querySelectorAll<HTMLElement>('[data-close-tab]'))
    el.onclick = () => closeSessionTab(el.dataset.closeTab!);
  for (const el of root.querySelectorAll<HTMLElement>('[data-retry]'))
    el.onclick = () => {
      void run(session()!.turns[Number(el.dataset.retry)].prompt);
    };
  const input = root.querySelector<HTMLTextAreaElement>('#prompt')!;
  commandPalette = createCommandPalette(
    root.querySelector<HTMLElement>('.composer-area')!,
    input,
    settings.commands,
    command => {
      void run(`/${command.name}`);
    },
    closeModelPicker,
  );
  input.oninput = () => {
    promptDraft = input.value;
    stashDraft();
    save();
    root.querySelector<HTMLButtonElement>('.send')!.disabled = !input.value.trim() || !settingsReady;
    if (settingsReady && !running) commandPalette?.refresh();
  };
  input.onfocus = () => {
    if (settingsReady && !running) commandPalette?.refresh();
  };
  input.onkeydown = e => {
    if (settingsReady && !running && commandPalette?.keydown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!running) void run(input.value);
    }
  };
  root.querySelector<HTMLFormElement>('#prompt-form')!.onsubmit = e => {
    e.preventDefault();
    void run(input.value);
  };
  root.querySelector<HTMLInputElement>('#attachments')!.onchange = e => {
    attachments = Array.from((e.target as HTMLInputElement).files ?? []).map(f => f.name);
    stashDraft();
    save();
    render();
  };
}
type Packet = {
  type: string;
  event?: Event;
  content?: string;
  output?: unknown;
  elapsed?: number;
  message?: string;
  selection?: Selection;
};
function receive(packet: Packet, t: Turn) {
  if (packet.type === 'start' && packet.selection) {
    t.selection = packet.selection;
    render();
  } else if (packet.type === 'event' && packet.event) {
    t.events.push({ ...packet.event, state: 'running', visible: '' });
    render();
  } else if (packet.type === 'text') {
    const event = t.events.at(-1);
    if (!event) return;
    event.visible = packet.content ?? '';
    const el = root
      .querySelectorAll('.turn')
      .item(session()!.turns.length - 1)
      ?.querySelectorAll('.event,.answer')
      .item(t.events.length - 1);
    const body = el?.querySelector('.thought') ?? el;
    if (body) body.innerHTML = md(event.visible);
    scrollToEnd();
  } else if (packet.type === 'complete') {
    const event = t.events.at(-1);
    if (event) {
      event.state = 'done';
      event.output = packet.output;
    }
    render();
  } else if (packet.type === 'done') {
    t.state = 'done';
    t.elapsed = packet.elapsed;
  } else if (packet.type === 'error') throw new Error(packet.message ?? tr('The connection was interrupted.'));
}
async function run(prompt: string) {
  prompt = prompt.trim();
  if (!prompt || running || !settingsReady) return;
  const parsed = parseCommand(prompt);
  if (parsed) {
    const command = settings.commands.find(command => command.name === parsed.name);
    if (!command) return toast(tr('Unknown command: {name}', { name: `/${parsed.name}` }));
    if (command.action === 'new') {
      promptDraft = '';
      newSession();
      return;
    }
    if (command.action === 'mcp') {
      commandPalette?.dismiss();
      closeModelPicker();
      promptDraft = '';
      stashDraft();
      save();
      const input = root.querySelector<HTMLTextAreaElement>('#prompt')!;
      input.value = '';
      root.querySelector<HTMLButtonElement>('.send')!.disabled = true;
      closeMcpDialog?.();
      closeMcpDialog = openMcpDialog(root, settings.mcpServers, () => {
        closeMcpDialog = null;
        input.focus();
      });
      return;
    }
    commandPalette?.dismiss();
    promptDraft = '';
    stashDraft();
    save();
    const input = root.querySelector<HTMLTextAreaElement>('#prompt')!;
    input.value = '';
    input.focus();
    root.querySelector<HTMLButtonElement>('.send')!.disabled = true;
    return;
  }
  commandPalette?.dismiss();
  let s = session();
  if (!s) s = createSession();
  if (!s.turns.length) s.title = prompt.slice(0, 40);
  const t: Turn = {
    prompt,
    mcpStates: getMcpStates(settings.mcpServers),
    selection: { ...selection },
    events: [],
    state: 'running',
  };
  s.turns.push(t);
  promptDraft = '';
  attachments = [];
  running = true;
  controller = new AbortController();
  const signal = controller.signal,
    start = performance.now();
  stashDraft();
  save();
  render();
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...t.selection, mcpStates: t.mcpStates, language }),
      signal,
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error ?? tr('The service is temporarily unavailable.'));
    }
    if (!response.body) throw new Error(tr('The connection was interrupted.'));
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        pending += decoder.decode();
        break;
      }
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) receive(JSON.parse(line), t);
    }
    if (pending.trim()) receive(JSON.parse(pending), t);
    if (t.state !== 'done') throw new Error(tr('The connection was interrupted. Please try again.'));
  } catch (error) {
    if (signal.aborted) t.state = 'cancelled';
    else {
      t.state = 'error';
      t.error = error instanceof Error ? error.message : tr('The service is temporarily unavailable.');
    }
    for (const e of t.events) if (e.state === 'running') e.state = 'cancelled';
  } finally {
    t.elapsed ??= performance.now() - start;
    running = false;
    controller = null;
    save();
    render();
    root.querySelector<HTMLTextAreaElement>('#prompt')!.focus();
  }
}
restoreTabs();
render();
document.documentElement.lang = language;
fetch('/api/settings')
  .then(async response => {
    if (!response.ok) throw new Error(tr('The service is temporarily unavailable. Reload the page.'));
    settings = await response.json();
    selection = { ...settings.defaults };
    try {
      const hidden = JSON.parse(localStorage.getItem('harness-emulator.hiddenModels') ?? '[]');
      if (Array.isArray(hidden) && hidden.includes(selection.model))
        selection.model = settings.models.find(model => !hidden.includes(model)) ?? selection.model;
    } catch {}
    settingsReady = true;
    render();
  })
  .catch(() => {
    toast(tr('The service is temporarily unavailable. Reload the page.'));
  });
