import { t } from './i18n';
import type { McpServer } from './settings';
import { foldText } from './text';

const storageKey = 'harness-emulator.mcpStates';
export function resolveMcpStates(servers: McpServer[], saved: unknown): Record<string, boolean> {
  const overrides =
    saved && typeof saved === 'object' && !Array.isArray(saved) ? (saved as Record<string, unknown>) : {};
  return Object.fromEntries(
    servers.map(server => [
      server.name,
      Object.hasOwn(overrides, server.name) && typeof overrides[server.name] === 'boolean'
        ? (overrides[server.name] as boolean)
        : server.enabled,
    ]),
  );
}
export function getMcpStates(servers: McpServer[]): Record<string, boolean> {
  let saved: unknown;
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
  } catch {}
  return resolveMcpStates(servers, saved);
}
export function openMcpDialog(root: HTMLElement, servers: McpServer[], onClose: () => void): () => void {
  const states = getMcpStates(servers);
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const rows = new Map<string, { toggle: HTMLInputElement; status: HTMLElement }>();
  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(states));
    } catch {}
  }
  function updateRows() {
    for (const [name, { toggle, status }] of rows) {
      toggle.checked = states[name];
      toggle.disabled = pending.has(name);
      toggle.setAttribute('aria-busy', String(pending.has(name)));
      status.textContent = pending.has(name) ? t('connecting…') : states[name] ? t('connected') : t('disabled');
    }
    updateCount();
  }
  const overlay = document.createElement('div');
  overlay.className = 'mcp-overlay';
  overlay.innerHTML = `<section class="mcp-dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-title"><header class="mcp-dialog-header"><h2 id="mcp-title">MCP</h2><button type="button" class="icon-button" aria-label="${t('Close MCP servers')}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></header><p class="mcp-count" aria-live="polite"></p><label class="mcp-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></svg><input type="search" aria-label="${t('Search MCP servers')}" placeholder="${t('Search')}" autocomplete="off" spellcheck="false"></label><div class="mcp-list"></div></section>`;
  root.append(overlay);
  const search = overlay.querySelector<HTMLInputElement>('input')!,
    list = overlay.querySelector<HTMLElement>('.mcp-list')!;
  function updateCount() {
    overlay.querySelector('.mcp-count')!.textContent = t('Active MCPs: {active} of {total}', {
      active: servers.filter(server => states[server.name]).length,
      total: servers.length,
    });
  }
  function renderList() {
    rows.clear();
    list.replaceChildren();
    const visible = servers.filter(server => foldText(server.name).includes(foldText(search.value).trim()));
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'mcp-empty';
      empty.textContent = servers.length ? t('No servers found.') : t('No MCP servers available.');
      list.append(empty);
    }
    for (const server of visible) {
      const row = document.createElement('label');
      row.className = 'mcp-row';
      const name = document.createElement('span');
      name.className = 'mcp-name';
      name.textContent = server.name;
      const status = document.createElement('span');
      status.className = 'mcp-status';
      status.textContent = states[server.name] ? t('connected') : t('disabled');
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.className = 'mcp-toggle';
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-label', server.name);
      toggle.checked = states[server.name];
      rows.set(server.name, { toggle, status });
      toggle.onchange = () => {
        if (pending.has(server.name)) {
          updateRows();
          return;
        }
        if (states[server.name]) {
          states[server.name] = false;
          persist();
          updateRows();
          return;
        }
        pending.set(
          server.name,
          setTimeout(() => {
            pending.delete(server.name);
            states[server.name] = true;
            persist();
            updateRows();
          }, 1200),
        );
        updateRows();
      };
      const control = document.createElement('span');
      control.className = 'mcp-switch';
      const track = document.createElement('span');
      track.className = 'mcp-switch-track';
      track.setAttribute('aria-hidden', 'true');
      const thumb = document.createElement('span');
      thumb.className = 'mcp-switch-thumb';
      track.append(thumb);
      control.append(toggle, track);
      row.append(name, status, control);
      list.append(row);
    }
    updateRows();
  }
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
    document.removeEventListener('keydown', keys);
    document.removeEventListener('focusin', keepFocus);
    overlay.remove();
    onClose();
  }
  function keepFocus(event: FocusEvent) {
    if (!overlay.contains(event.target as Node)) search.focus();
  }
  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (event.key === 'Tab') {
      const elements = Array.from(overlay.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)'));
      const index = elements.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) {
        event.preventDefault();
        elements.at(-1)?.focus();
      } else if (!event.shiftKey && (index === elements.length - 1 || index < 0)) {
        event.preventDefault();
        elements[0].focus();
      }
    }
  }
  overlay.querySelector('button')!.onclick = close;
  overlay.onpointerdown = event => {
    if (event.target === overlay) close();
  };
  search.oninput = renderList;
  document.addEventListener('keydown', keys);
  document.addEventListener('focusin', keepFocus);
  renderList();
  search.focus();
  return close;
}
