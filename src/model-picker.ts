import { t } from './i18n';
import { modelGroups } from './model-menu';
import type { Settings } from './settings';
import { escapeHtml as esc } from './text';
const searchIcon =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>';
const slidersIcon =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 7h5m6 0h7M3 17h11m6 0h1"/><circle cx="11" cy="7" r="3"/><circle cx="17" cy="17" r="3"/></svg>';
let closeActive: (() => void) | undefined;
/** Opens above the trigger when there is room, otherwise below, and stays inside the viewport. */
function placePopover(popup: HTMLElement, trigger: HTMLElement, width: number) {
  const rect = trigger.getBoundingClientRect();
  popup.style.width = `${Math.min(width, window.innerWidth - 16)}px`;
  popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 8))}px`;
  const above = rect.top - 8,
    below = window.innerHeight - rect.bottom - 8;
  const topSide = above >= popup.offsetHeight || above >= below;
  popup.style.maxHeight = `${Math.max(100, topSide ? above : below)}px`;
  popup.style.top = `${topSide ? Math.max(8, rect.top - popup.offsetHeight - 6) : rect.bottom + 6}px`;
}
export function closeModelPicker() {
  closeActive?.();
}
export function openModelPicker(
  root: HTMLElement,
  trigger: HTMLButtonElement,
  settings: Settings,
  selected: string,
  onSelect: (model: string) => void,
) {
  if (closeActive) {
    closeModelPicker();
    return;
  }
  let hidden = new Set<string>();
  try {
    const value = JSON.parse(localStorage.getItem('harness-emulator.hiddenModels') ?? '[]');
    if (Array.isArray(value)) hidden = new Set(value.filter(v => typeof v === 'string' && settings.models.includes(v)));
  } catch {
    /* Use all models. */
  }
  if (settings.models.every(model => hidden.has(model))) hidden.clear();
  // Never hide the current model just because it was selected in another tab.
  hidden.delete(selected);
  const popup = document.createElement('div');
  popup.className = 'model-popover';
  popup.innerHTML = `<div class="model-search">${searchIcon}<input id="model-search" role="combobox" aria-label="${t('Search models')}" placeholder="${t('Search models')}" aria-expanded="true" aria-controls="model-options" autocomplete="off" spellcheck="false"></div><div class="model-results" id="model-options" role="listbox" aria-label="${t('Models')}"></div><button type="button" class="manage-models">${slidersIcon} ${t('Manage models')}</button>`;
  root.append(popup);
  const search = popup.querySelector<HTMLInputElement>('input')!;
  const results = popup.querySelector<HTMLDivElement>('.model-results')!;
  let items: string[] = [],
    active = -1,
    management = false;
  trigger.setAttribute('aria-expanded', 'true');
  trigger.classList.add('open');
  const place = () => placePopover(popup, trigger, 286);
  function close(focus = true) {
    document.removeEventListener('pointerdown', outside);
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    document.removeEventListener('keydown', manageKeys);
    root.querySelectorAll<HTMLElement>('.tabbar,.layout').forEach(el => {
      el.inert = false;
    });
    popup.remove();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.classList.remove('open');
    closeActive = undefined;
    if (focus && trigger.isConnected) trigger.focus();
  }
  closeActive = () => close(false);
  function outside(e: PointerEvent) {
    if (!management && !popup.contains(e.target as Node) && !trigger.contains(e.target as Node)) close(false);
  }
  function highlight(index: number) {
    active = index;
    const options = Array.from(results.querySelectorAll<HTMLElement>('[role="option"]'));
    for (const [i, option] of options.entries()) option.classList.toggle('highlighted', i === active);
    if (options[active]) {
      search.setAttribute('aria-activedescendant', options[active].id);
      options[active].scrollIntoView({ block: 'nearest' });
    } else search.removeAttribute('aria-activedescendant');
  }
  function choose(model: string) {
    close(false);
    onSelect(model);
    trigger.focus();
  }
  function filter() {
    const providers = Object.fromEntries(
      Object.entries(settings.modelProviders).map(([model, provider]) => [model, t(provider)]),
    );
    const groups = modelGroups(settings.models, providers, search.value, hidden);
    items = groups.flatMap(group => group.models);
    let index = 0;
    results.innerHTML = groups.length
      ? groups
          .map(
            group =>
              `<div role="group" aria-label="${esc(t(group.provider))}"><div class="model-provider">${esc(t(group.provider))}</div>${group.models.map(model => `<div id="model-option-${index++}" role="option" aria-selected="${model === selected}" class="model-option" data-name="${esc(model)}">${esc(model)}</div>`).join('')}</div>`,
          )
          .join('')
      : `<div class="model-empty" role="status">${t('No models found')}</div>`;
    results.querySelectorAll<HTMLElement>('[role="option"]').forEach((option, i) => {
      option.onclick = () => choose(items[i]);
      option.onpointermove = () => highlight(i);
      option.onpointerdown = e => e.preventDefault();
    });
    highlight(search.value ? (items.length ? 0 : -1) : items.indexOf(selected));
    place();
  }
  search.oninput = filter;
  popup.onkeydown = e => {
    if (management) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      if (!items.length) return;
      const next =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? items.length - 1
            : e.key === 'ArrowDown'
              ? (active + 1) % items.length
              : (active - 1 + items.length) % items.length;
      highlight(next);
      search.focus();
    } else if (e.key === 'Enter' && e.target === search) {
      e.preventDefault();
      if (items[active]) choose(items[active]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.target === search) popup.querySelector<HTMLButtonElement>('.manage-models')!.focus();
      else search.focus();
    }
  };
  function manageKeys(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    if (e.key === 'Tab') {
      const focusable = Array.from(popup.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled])'));
      const first = focusable[0],
        last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      }
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  }
  function manage() {
    management = true;
    popup.onkeydown = null;
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    popup.className = 'models-overlay';
    popup.removeAttribute('style');
    popup.innerHTML = `<section class="models-dialog" role="dialog" aria-modal="true" aria-labelledby="models-title"><div class="models-dialog-header"><h2 id="models-title">${t('Models')}</h2><button type="button" class="icon-button close-models" aria-label="${t('Close models')}">×</button></div><p>${t('Choose which models to show in the menu.')}</p><div class="managed-model-list">${modelGroups(
      settings.models,
      settings.modelProviders,
    )
      .map(
        group =>
          `<div class="model-provider">${esc(t(group.provider))}</div>${group.models.map(model => `<label class="managed-model-row"><span>${esc(model)}</span><input type="checkbox" data-model="${esc(model)}" ${hidden.has(model) ? '' : 'checked'} aria-label="${t('Show')} ${esc(model)}"></label>`).join('')}`,
      )
      .join(
        '',
      )}</div><div class="models-dialog-footer"><button type="button" class="done-models">${t('Done')}</button></div></section>`;
    root.querySelectorAll<HTMLElement>('.tabbar,.layout').forEach(el => {
      el.inert = true;
    });
    const updateDisabled = () => {
      const lastVisible = settings.models.filter(model => !hidden.has(model)).length === 1;
      for (const input of popup.querySelectorAll<HTMLInputElement>('input'))
        input.disabled = input.checked && lastVisible;
    };
    for (const input of popup.querySelectorAll<HTMLInputElement>('input'))
      input.onchange = () => {
        const model = input.dataset.model!;
        if (input.checked) hidden.delete(model);
        else hidden.add(model);
        try {
          localStorage.setItem('harness-emulator.hiddenModels', JSON.stringify([...hidden]));
        } catch {
          /* Preferences remain active for this dialog. */
        }
        if (hidden.has(selected)) {
          selected = settings.models.find(name => !hidden.has(name))!;
          onSelect(selected);
        }
        updateDisabled();
      };
    updateDisabled();
    popup.querySelector<HTMLButtonElement>('.close-models')!.onclick = () => close();
    popup.querySelector<HTMLButtonElement>('.done-models')!.onclick = () => close();
    popup.onclick = e => {
      if (e.target === popup) close();
    };
    document.addEventListener('keydown', manageKeys);
    popup.querySelector<HTMLButtonElement>('.close-models')!.focus();
  }
  popup.querySelector<HTMLButtonElement>('.manage-models')!.onclick = manage;
  document.addEventListener('pointerdown', outside);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  filter();
  search.focus();
}

export function openChoicePicker(
  root: HTMLElement,
  trigger: HTMLButtonElement,
  values: string[],
  selected: string,
  label: string,
  onSelect: (value: string) => void,
) {
  if (trigger.getAttribute('aria-expanded') === 'true') {
    closeModelPicker();
    return;
  }
  closeModelPicker();
  const popup = document.createElement('div');
  popup.className = 'model-popover choice-popover';
  popup.innerHTML = `<div class="choice-heading">${esc(label)}</div><div class="model-results" role="listbox" aria-label="${esc(label)}">${values.map(value => `<button type="button" role="option" aria-selected="${value === selected}" class="model-option choice-option" data-value="${esc(value)}">${esc(t(value))}</button>`).join('')}</div>`;
  root.append(popup);
  trigger.setAttribute('aria-expanded', 'true');
  trigger.classList.add('open');
  const place = () => placePopover(popup, trigger, 220);
  function close() {
    document.removeEventListener('pointerdown', outside);
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    popup.remove();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.classList.remove('open');
    closeActive = undefined;
  }
  function outside(event: PointerEvent) {
    if (!popup.contains(event.target as Node) && !trigger.contains(event.target as Node)) close();
  }
  for (const option of popup.querySelectorAll<HTMLButtonElement>('[data-value]'))
    option.onclick = () => {
      close();
      onSelect(option.dataset.value!);
    };
  closeActive = close;
  document.addEventListener('pointerdown', outside);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  place();
}
