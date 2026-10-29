import { t } from './i18n';
import { commandQuery, filterCommands, type Command } from './commands';
import { escapeHtml as esc } from './text';
export function createCommandPalette(
  area: HTMLElement,
  input: HTMLTextAreaElement,
  commands: Command[],
  onChoose: (command: Command) => void,
  onOpen: () => void,
) {
  let popup: HTMLDivElement | null = null,
    items: Command[] = [],
    active = 0,
    previousQuery = '',
    dismissed: string | null = null;
  function close() {
    popup?.remove();
    popup = null;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-controls');
    input.removeAttribute('aria-activedescendant');
    document.removeEventListener('pointerdown', outside);
    window.removeEventListener('resize', place);
  }
  function place() {
    if (popup) popup.style.maxHeight = `${Math.min(320, Math.max(96, area.getBoundingClientRect().top - 20))}px`;
  }
  function outside(event: PointerEvent) {
    if (!popup?.contains(event.target as Node) && event.target !== input) {
      dismissed = input.value;
      close();
    }
  }
  function highlight(index: number) {
    active = index;
    const rows = Array.from(popup?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    rows.forEach((row, i) => {
      row.classList.toggle('active', i === active);
      row.setAttribute('aria-selected', String(i === active));
    });
    if (rows[active]) {
      input.setAttribute('aria-activedescendant', rows[active].id);
      rows[active].scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function choose(command: Command) {
    dismissed = input.value;
    close();
    onChoose(command);
  }
  function refresh() {
    const query = commandQuery(input.value);
    if (query === null || dismissed === input.value) {
      close();
      return;
    }
    if (!popup) {
      onOpen();
      popup = document.createElement('div');
      popup.className = 'command-palette';
      popup.id = 'command-options';
      popup.setAttribute('role', 'listbox');
      popup.setAttribute('aria-label', t('Commands'));
      area.prepend(popup);
      document.addEventListener('pointerdown', outside);
      window.addEventListener('resize', place);
    }
    items = filterCommands(
      commands.map(command => ({
        ...command,
        description: command.action ? t(command.description) : command.description,
      })),
      query,
    );
    if (query !== previousQuery) {
      active = 0;
      previousQuery = query;
    }
    active = Math.min(active, Math.max(0, items.length - 1));
    popup.innerHTML = items.length
      ? items
          .map(
            (command, i) =>
              `<div role="option" id="command-option-${i}" class="command-row" aria-selected="false"><span class="command-name">/${esc(command.name)}</span><span class="command-description" title="${esc(command.description)}">${esc(command.description)}</span></div>`,
          )
          .join('')
      : `<div class="command-empty" role="status">${t('No commands found')}</div>`;
    popup.querySelectorAll<HTMLElement>('[role="option"]').forEach((row, i) => {
      row.onpointerdown = e => e.preventDefault();
      row.onpointermove = () => highlight(i);
      row.onclick = () => choose(items[i]);
    });
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', popup.id);
    place();
    highlight(active);
  }
  function keydown(event: KeyboardEvent): boolean {
    if (event.isComposing) return false;
    if (event.key === 'Escape' && popup) {
      event.preventDefault();
      dismissed = input.value;
      close();
      return true;
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && commandQuery(input.value) !== null) {
      event.preventDefault();
      dismissed = null;
      refresh();
      if (items.length) highlight((active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
      return true;
    }
    if (event.key === 'Enter' && !event.shiftKey && popup && items.length) {
      event.preventDefault();
      choose(items[active]);
      return true;
    }
    return false;
  }
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  return {
    refresh,
    keydown,
    dismiss: () => {
      dismissed = input.value;
      close();
    },
    destroy: close,
  };
}
export type CommandPalette = ReturnType<typeof createCommandPalette>;
