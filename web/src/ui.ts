// Unified Design System & Strict Typed DOM Component Library (Zero Inline Styles).
// Every component consumes design tokens from internal/app/admin_ui/styles.css.

import { bi, t, type DictKey } from './i18n.ts';
import { copyTextWithToast, fmtNum } from './api.ts';

export type BadgeTone = 'default' | 'ok' | 'warn' | 'err' | 'accent';
export type AlertTone = 'info' | 'ok' | 'warn' | 'err';
export type ButtonVariant = 'default' | 'primary' | 'danger';
export type ButtonSize = 'md' | 'sm';

export type ChildNodeInput = Node | string | number | boolean | null | undefined | ChildNodeInput[];

export interface ElProps {
  class?: string;
  id?: string;
  title?: string;
  role?: string;
  tabindex?: number | string;
  hidden?: boolean | 'until-found';
  dataset?: Record<string, string | number | boolean | undefined>;
  style?: never; // Enforces token-driven CSS classes across all views
  [key: string]: unknown;
}

function appendChildren(parent: HTMLElement, children: ChildNodeInput[]): void {
  for (const ch of children) {
    if (ch == null || ch === false || ch === true) continue;
    if (Array.isArray(ch)) {
      appendChildren(parent, ch);
    } else if (ch instanceof Node) {
      parent.append(ch);
    } else {
      parent.append(document.createTextNode(String(ch)));
    }
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  ...children: ChildNodeInput[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style' || v == null || v === false) continue;
    if (k === 'class') {
      node.className = String(v);
    } else if (k === 'dataset' && typeof v === 'object') {
      for (const [dk, dv] of Object.entries(v as Record<string, unknown>)) {
        if (dv != null && dv !== false) node.dataset[dk] = String(dv);
      }
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (v === true) {
      node.setAttribute(k, '');
    } else {
      node.setAttribute(k, String(v));
    }
  }
  appendChildren(node, children);
  return node;
}

export function biEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps,
  zhText: string,
  enText: string,
): HTMLElementTagNameMap[K] {
  const dataset = { ...(props.dataset ?? {}), biZh: zhText, biEn: enText };
  return el(tag, { ...props, dataset }, bi(zhText, enText));
}

// ─── Notifications & Clipboard ───────────────────────────────────────────

export function toast(message: string, kind: AlertTone = 'info', durationMs = 3400): void {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const item = document.createElement('div');
  item.className = `toast toast--${kind}`;
  item.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  item.textContent = String(message || '');
  stack.append(item);
  setTimeout(() => {
    item.classList.add('toast--leaving');
    setTimeout(() => item.remove(), 220);
  }, durationMs);
}

export function copyText(str: string, label?: string): Promise<void> {
  return copyTextWithToast(str, label, toast);
}

// ─── Primitives: Badges, Buttons, Alerts, Empty States ───────────────────

export function uiBadge(text: string, tone: BadgeTone = 'default', opts: { mono?: boolean; title?: string } = {}): HTMLSpanElement {
  const cls = [
    'badge',
    tone !== 'default' ? `badge--${tone}` : '',
    opts.mono ? 'mono' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return el('span', { class: cls, title: opts.title }, text);
}

export interface ButtonOptions {
  text?: string;
  i18n?: DictKey;
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: 'button' | 'submit' | 'reset';
  id?: string;
  disabled?: boolean;
  active?: boolean;
  ariaLabel?: string;
  onClick?: (e: MouseEvent) => void;
}

export function uiButton(opts: ButtonOptions): HTMLButtonElement {
  const cls = [
    'btn',
    opts.variant === 'primary' ? 'btn--primary' : opts.variant === 'danger' ? 'btn--danger' : '',
    opts.size === 'sm' ? 'btn--sm' : '',
    opts.active ? 'btn--active' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return el(
    'button',
    {
      type: opts.type ?? 'button',
      id: opts.id,
      class: cls,
      disabled: opts.disabled,
      'aria-label': opts.ariaLabel,
      'data-i18n': opts.i18n,
      onClick: opts.onClick,
    },
    opts.i18n ? t(opts.i18n) : (opts.text ?? ''),
  );
}

export function uiAlert(opts: {
  message?: string | ChildNodeInput;
  tone?: AlertTone;
  id?: string;
  role?: 'alert' | 'status';
  hidden?: boolean;
  onDismiss?: () => void;
}): HTMLDivElement {
  const toneCls =
    opts.tone === 'ok'
      ? 'alert--ok'
      : opts.tone === 'warn'
        ? 'alert--warn'
        : opts.tone === 'err'
          ? 'alert--err'
          : '';
  const closeBtn = opts.onDismiss
    ? uiButton({
        text: '×',
        size: 'sm',
        ariaLabel: t('common.close'),
        onClick: opts.onDismiss,
      })
    : null;
  const content =
    typeof opts.message === 'string'
      ? el('span', { class: 'text-break' }, opts.message)
      : opts.message;
  return el(
    'div',
    {
      id: opts.id,
      class: ['alert', toneCls].filter(Boolean).join(' '),
      role: opts.role ?? (opts.tone === 'err' ? 'alert' : 'status'),
      hidden: opts.hidden,
    },
    content,
    closeBtn,
  );
}

export function setAlert(box: HTMLElement | null, msg: string): void {
  if (!box) return;
  if (msg) {
    box.textContent = msg;
    box.hidden = false;
  } else {
    box.textContent = '';
    box.hidden = true;
  }
}

export function uiEmptyState(text: string): HTMLDivElement {
  return el('div', { class: 'empty-state' }, text);
}

// ─── Page Layout Components ──────────────────────────────────────────────

export interface PageHeaderRefs {
  root: HTMLDivElement;
  titleEl: HTMLHeadingElement;
  subtitleEl: HTMLParagraphElement;
}

export function uiPageHeader(opts: {
  titleI18n?: DictKey;
  title?: string;
  subtitleI18n?: DictKey;
  subtitle?: string;
  actions?: ChildNodeInput[];
}): PageHeaderRefs {
  const titleEl = el(
    'h1',
    { 'data-i18n': opts.titleI18n },
    opts.titleI18n ? t(opts.titleI18n) : (opts.title ?? ''),
  );
  const subtitleEl = el(
    'p',
    { 'data-i18n': opts.subtitleI18n },
    opts.subtitleI18n ? t(opts.subtitleI18n) : (opts.subtitle ?? ''),
  );
  const actionsWrap = el('div', { class: 'view-actions' }, ...(opts.actions ?? []));
  const root = el('div', { class: 'view-header' }, el('div', {}, titleEl, subtitleEl), actionsWrap);
  return { root, titleEl, subtitleEl };
}

export interface StatCardRefs {
  root: HTMLElement;
  valueEl: HTMLDivElement;
  subEl: HTMLDivElement;
}

export function uiStatCard(opts: {
  labelI18n?: DictKey;
  label?: string;
  value?: string;
  sub?: string;
}): StatCardRefs {
  const labelEl = el(
    'div',
    { class: 'kpi-card__label', 'data-i18n': opts.labelI18n },
    opts.labelI18n ? t(opts.labelI18n) : (opts.label ?? ''),
  );
  const valueEl = el('div', { class: 'kpi-card__value' }, opts.value ?? '—');
  const subEl = el('div', { class: 'kpi-card__sub' }, opts.sub ?? '');
  const root = el('article', { class: 'kpi-card' }, labelEl, valueEl, subEl);
  return { root, valueEl, subEl };
}

export function uiStatGrid(...cards: ChildNodeInput[]): HTMLDivElement {
  return el('div', { class: 'kpi-grid' }, ...cards);
}

export interface SectionPanelRefs {
  root: HTMLElement;
  headEl: HTMLDivElement;
  titleEl: HTMLHeadingElement;
  bodyEl: HTMLDivElement;
}

export function uiSectionPanel(opts: {
  id?: string;
  titleId?: string;
  title?: string;
  titleI18n?: DictKey;
  headingTag?: 'h2' | 'h3';
  headerExtra?: ChildNodeInput[];
  actions?: ChildNodeInput[];
  body?: ChildNodeInput[];
  stack?: boolean;
}): SectionPanelRefs {
  const headingTag = opts.headingTag ?? 'h2';
  const titleId = opts.titleId ?? (opts.id ? `${opts.id}Heading` : undefined);
  const titleEl = el(
    headingTag,
    { id: titleId, 'data-i18n': opts.titleI18n },
    opts.titleI18n ? t(opts.titleI18n) : (opts.title ?? ''),
  ) as HTMLHeadingElement;

  const leftNode = opts.headerExtra?.length
    ? el('div', { class: 'cluster' }, titleEl, ...opts.headerExtra)
    : titleEl;

  const actionsNode = opts.actions?.length
    ? (opts.actions.length === 1 && opts.actions[0] instanceof HTMLElement
        ? opts.actions[0]
        : el('div', { class: 'row-actions' }, ...opts.actions))
    : null;

  const headEl = el('div', { class: 'panel__head' }, leftNode, actionsNode);
  const bodyEl = el(
    'div',
    { class: opts.stack ? 'panel__body panel__body--stack' : 'panel__body' },
    ...(opts.body ?? []),
  );
  const root = el(
    'section',
    { class: 'panel', id: opts.id, 'aria-labelledby': titleId },
    headEl,
    bodyEl,
  );
  return { root, headEl, titleEl, bodyEl };
}

export function uiKeyValueGrid(
  items: ReadonlyArray<{ key: string; value: ChildNodeInput }>,
): HTMLDivElement {
  return el(
    'div',
    { class: 'kv-grid' },
    ...items.map((item) =>
      el(
        'div',
        { class: 'kv-item' },
        el('div', { class: 'kv-item__k' }, item.key),
        el('div', { class: 'kv-item__v' }, item.value),
      ),
    ),
  );
}

export function uiMeterRow(opts: {
  label: string;
  current: number;
  limit: number;
  isRph?: boolean;
  rphRedline?: number;
  rphCap?: number;
}): HTMLDivElement {
  const cur = Number(opts.current || 0);
  const lim = Number(opts.limit || 0);
  const cap = opts.rphCap ?? 80;
  const redline = opts.rphRedline ?? 72;
  const denom = lim > 0 ? lim : opts.isRph ? cap : 0;
  const pct = denom > 0 ? Math.min(100, (cur / denom) * 100) : cur > 0 ? 20 : 0;
  const isErr = opts.isRph ? pct >= 90 || cur >= redline : pct >= 90;
  const isWarn = !isErr && pct >= 70;

  const progressCls = isErr
    ? 'meter-progress meter-progress--err'
    : isWarn
      ? 'meter-progress meter-progress--warn'
      : 'meter-progress';

  const limitDisplay = lim > 0 ? fmtNum(lim) : '∞';
  const valueText =
    opts.isRph && cur >= redline
      ? `${fmtNum(cur)} / ${limitDisplay} (${bi('逼近 80 红线', 'near 80 cap')})`
      : `${fmtNum(cur)} / ${limitDisplay}`;

  return el(
    'div',
    { class: 'meter-row' },
    el(
      'div',
      { class: 'meter-row__head' },
      el('span', { class: 'meter-row__label' }, opts.label),
      el(
        'span',
        { class: isErr ? 'meter-row__val meter-row__val--err' : 'meter-row__val' },
        valueText,
      ),
    ),
    el('progress', {
      class: progressCls,
      max: '100',
      value: pct.toFixed(1),
      'aria-label': `${opts.label}: ${valueText}`,
    }),
  );
}

export function uiCodeBlock(opts: {
  code: string;
  ariaLabel: string;
  tall?: boolean;
}): HTMLPreElement {
  return el(
    'pre',
    {
      class: opts.tall ? 'code-block code-block--tall' : 'code-block',
      role: 'region',
      tabindex: '0',
      'aria-label': opts.ariaLabel,
    },
    el('code', {}, opts.code),
  );
}

export function uiCodePanel(opts: {
  title: string;
  text: string | null | undefined;
  ariaLabel?: string;
}): HTMLElement {
  const content = opts.text == null || opts.text === '' ? '' : String(opts.text);
  const copyBtn = uiButton({
    text: bi('复制', 'Copy'),
    size: 'sm',
    disabled: !content,
    onClick: () => copyText(content, opts.title),
  });
  const pre = uiCodeBlock({
    code: content || bi('（空）', '(empty)'),
    ariaLabel: opts.ariaLabel || opts.title,
  });
  return uiSectionPanel({
    title: opts.title,
    headingTag: 'h3',
    actions: [copyBtn],
    body: [pre],
  }).root;
}

export function uiDetails(opts: {
  summary: string | ChildNodeInput;
  open?: boolean;
  children: ChildNodeInput[];
}): HTMLDetailsElement {
  return el(
    'details',
    { class: 'disclosure', open: opts.open },
    el('summary', { class: 'disclosure__summary' }, opts.summary),
    ...opts.children,
  );
}

// ─── Form & Filter Primitives ────────────────────────────────────────────

export function uiField(opts: {
  label?: ChildNodeInput;
  labelEl?: HTMLLabelElement;
  forId?: string;
  control: ChildNodeInput;
  hint?: ChildNodeInput;
  extra?: ChildNodeInput;
  grow?: boolean;
  compact?: boolean;
}): HTMLDivElement {
  const cls = [
    'field',
    opts.grow ? 'field--grow' : '',
    opts.compact ? 'field--compact' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const labelNode =
    opts.labelEl ?? (opts.label != null ? el('label', { for: opts.forId }, opts.label) : null);
  const hintNode =
    typeof opts.hint === 'string' ? el('small', { class: 'field__hint' }, opts.hint) : opts.hint;
  return el('div', { class: cls }, labelNode, opts.control, opts.extra, hintNode);
}

export function uiSwitchRow(opts: {
  id: string;
  name?: string;
  title: ChildNodeInput;
  desc?: ChildNodeInput;
  checked?: boolean;
  inputEl?: HTMLInputElement;
}): HTMLLabelElement {
  const input =
    opts.inputEl ??
    el('input', {
      id: opts.id,
      name: opts.name ?? opts.id,
      type: 'checkbox',
      switch: true,
    });
  if (opts.checked !== undefined) input.checked = opts.checked;
  return el(
    'label',
    { class: 'switch-row', for: opts.id },
    el(
      'span',
      { class: 'switch-row__meta' },
      el('span', { class: 'switch-row__title' }, opts.title),
      opts.desc != null ? el('span', { class: 'switch-row__desc' }, opts.desc) : null,
    ),
    input,
  );
}

export function uiFilterBar(
  children: ChildNodeInput[],
  onSubmit?: (e: SubmitEvent) => void,
): { root: HTMLElement; form: HTMLFormElement } {
  const form = el('form', { class: 'filter-grid', novalidate: true }, ...children);
  if (onSubmit) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      onSubmit(e);
    });
  }
  const root = el('search' as keyof HTMLElementTagNameMap, { class: 'filter-bar' }, form);
  return { root, form };
}

// ─── Native <dialog> Modals, Drawers, Light-Dismiss & Confirm ─────────────

export function wireDialogLightDismiss(root: ParentNode = document): void {
  for (const dialog of root.querySelectorAll<HTMLDialogElement>('dialog')) {
    if (!dialog.dataset.wiredCloseReset) {
      dialog.dataset.wiredCloseReset = '1';
      dialog.addEventListener('close', () => {
        queueMicrotask(() => {
          dialog.returnValue = '';
        });
      });
    }
    if (!('closedBy' in HTMLDialogElement.prototype) && dialog.getAttribute('closedby') === 'any') {
      if (dialog.dataset.wiredFallback) continue;
      dialog.dataset.wiredFallback = '1';
      let pressedOutside = false;
      const outside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      dialog.addEventListener('pointerdown', (e) => {
        pressedOutside = e.target === dialog && outside(e);
      });
      dialog.addEventListener('pointerup', (e) => {
        if (pressedOutside && e.target === dialog && outside(e)) {
          dialog.close('');
        }
        pressedOutside = false;
      });
    }
  }
}

export function uiModalDialog(opts: {
  id: string;
  titleId: string;
  title?: string;
  closedby?: 'any' | 'closerequest' | 'none';
  drawer?: boolean;
  subtitle?: ChildNodeInput;
  headerActions?: ChildNodeInput[];
  content: ChildNodeInput[];
}): {
  dialog: HTMLDialogElement;
  titleEl: HTMLHeadingElement;
  closeTopBtn: HTMLButtonElement;
} {
  const titleEl = el('h2', { id: opts.titleId }, opts.title ?? '');
  const closeTopBtn = uiButton({
    text: t('common.close'),
    size: 'sm',
    ariaLabel: t('common.close'),
  });
  const titleBlock = opts.subtitle
    ? el('div', { class: 'dialog__title-group' }, titleEl, opts.subtitle)
    : titleEl;
  const actionsRow = el(
    'div',
    { class: 'row-actions' },
    ...(opts.headerActions ?? []),
    closeTopBtn,
  );
  const dialog = el(
    'dialog',
    {
      id: opts.id,
      class: opts.drawer ? 'drawer' : undefined,
      closedby: opts.closedby ?? 'any',
      'aria-labelledby': opts.titleId,
    },
    el('div', { class: 'dialog__head' }, titleBlock, actionsRow),
    ...opts.content,
  );
  closeTopBtn.addEventListener('click', () => dialog.close(''));
  return { dialog, titleEl, closeTopBtn };
}

export function confirmDialog(opts: {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}): Promise<boolean> {
  const dlg = document.getElementById('confirmDialog') as HTMLDialogElement | null;
  if (!dlg) return Promise.resolve(window.confirm(opts.message || opts.title || ''));

  const titleEl = document.getElementById('confirmDialogTitle')!;
  const bodyEl = document.getElementById('confirmDialogBody')!;
  const confirmBtn = document.getElementById('confirmDialogOk') as HTMLButtonElement;
  const cancelBtn = document.getElementById('confirmDialogCancel') as HTMLButtonElement;

  titleEl.textContent = opts.title || t('common.confirm');
  bodyEl.textContent = opts.message || '';
  confirmBtn.textContent = opts.confirmText || t('common.confirm');
  cancelBtn.textContent = opts.cancelText || t('common.cancel');
  confirmBtn.className = opts.danger ? 'btn btn--danger' : 'btn btn--primary';

  return new Promise<boolean>((resolve) => {
    const onClose = () => {
      dlg.removeEventListener('close', onClose);
      const val = dlg.returnValue;
      dlg.returnValue = '';
      resolve(val === 'confirm');
    };
    dlg.addEventListener('close', onClose);
    dlg.returnValue = '';
    dlg.showModal();
    if (opts.danger) cancelBtn.focus();
  });
}

// ─── WAI-ARIA Tablist Controller ─────────────────────────────────────────

export interface TabController {
  select: (key: string) => void;
}

export function setupTablist(
  tablistEl: HTMLElement,
  panels: Record<string, HTMLElement>,
  onSelect?: (key: string) => void,
): TabController {
  const tabs = Array.from(tablistEl.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const selectTab = (targetTab: HTMLButtonElement, moveFocus = false) => {
    const key = targetTab.dataset.tab ?? '';
    for (const tab of tabs) {
      const active = tab === targetTab;
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
    }
    for (const [panelKey, panelEl] of Object.entries(panels)) {
      const active = panelKey === key;
      if (active) {
        panelEl.removeAttribute('hidden');
        panelEl.tabIndex = panelEl.querySelector('a,button,input,select,textarea') ? -1 : 0;
      } else {
        panelEl.setAttribute('hidden', 'until-found');
        panelEl.removeAttribute('tabindex');
      }
    }
    if (moveFocus) targetTab.focus();
    targetTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (onSelect) onSelect(key);
  };

  for (const [idx, tab] of tabs.entries()) {
    tab.addEventListener('click', () => selectTab(tab, false));
    tab.addEventListener('keydown', (e) => {
      let nextIdx = -1;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = tabs.length - 1;
      if (nextIdx >= 0) {
        e.preventDefault();
        tabs[nextIdx].focus();
      }
    });
  }

  for (const [panelKey, panelEl] of Object.entries(panels)) {
    panelEl.addEventListener('beforematch', () => {
      const matchingTab = tabs.find((tb) => tb.dataset.tab === panelKey);
      if (matchingTab) selectTab(matchingTab, false);
    });
  }

  return {
    select(key: string) {
      const matchingTab = tabs.find((tb) => tb.dataset.tab === key);
      if (matchingTab) selectTab(matchingTab, false);
    },
  };
}

export interface TabDefinition {
  key: string;
  id: string;
  panelId: string;
  label: string;
  i18n?: DictKey;
}

export function uiTabs(opts: {
  ariaLabel: string;
  tabs: TabDefinition[];
  activeTab: string;
  onSelect?: (key: string) => void;
}): {
  tablist: HTMLDivElement;
  panels: Record<string, HTMLDivElement>;
  panelBodies: Record<string, HTMLDivElement>;
  panelElements: HTMLDivElement[];
  controller: TabController;
} {
  const tabButtons: HTMLButtonElement[] = [];
  const panels: Record<string, HTMLDivElement> = {};
  const panelBodies: Record<string, HTMLDivElement> = {};
  const panelElements: HTMLDivElement[] = [];

  for (const def of opts.tabs) {
    const active = def.key === opts.activeTab;
    const btn = el(
      'button',
      {
        type: 'button',
        role: 'tab',
        id: def.id,
        'data-tab': def.key,
        'aria-selected': active ? 'true' : 'false',
        'aria-controls': def.panelId,
        tabindex: active ? '0' : '-1',
        'data-i18n': def.i18n,
      },
      def.i18n ? t(def.i18n) : def.label,
    );
    tabButtons.push(btn);

    const body = el('div', { class: 'tabpanel-body' });
    const panel = el(
      'div',
      {
        role: 'tabpanel',
        id: def.panelId,
        'aria-labelledby': def.id,
        hidden: active ? false : 'until-found',
      },
      body,
    );
    panels[def.key] = panel;
    panelBodies[def.key] = body;
    panelElements.push(panel);
  }

  const tablist = el(
    'div',
    { role: 'tablist', 'aria-label': opts.ariaLabel },
    ...tabButtons,
  );
  const controller = setupTablist(tablist, panels, opts.onSelect);

  return { tablist, panels, panelBodies, panelElements, controller };
}

// ─── Typed Responsive Table Builder ──────────────────────────────────────

export interface TableColumn<T> {
  key?: string;
  label: string;
  rowHeader?: boolean;
  align?: 'left' | 'right';
  className?: string;
  render?: (row: T) => ChildNodeInput;
}

export interface RenderTableOptions<T> {
  ariaLabel?: string;
  caption?: string;
  columns: TableColumn<T>[];
  rows: T[];
  emptyText?: string;
  onRowClick?: (row: T) => void;
}

export function renderTable<T>(container: HTMLElement, opts: RenderTableOptions<T>): void {
  container.innerHTML = '';
  const { ariaLabel, caption, columns, rows, emptyText, onRowClick } = opts;
  if (!rows || rows.length === 0) {
    container.append(uiEmptyState(emptyText || t('common.empty')));
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrapper';
  wrapper.tabIndex = 0;
  wrapper.setAttribute('role', 'region');
  wrapper.setAttribute('aria-label', ariaLabel || caption || 'Data table');

  const table = document.createElement('table');
  if (caption) {
    const cap = document.createElement('caption');
    cap.className = 'sr-only';
    cap.textContent = caption;
    table.append(cap);
  }

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const col of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = col.label;
    if (col.align === 'right') th.className = 'num';
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    if (onRowClick) {
      tr.className = 'is-clickable';
      tr.tabIndex = 0;
      tr.addEventListener('click', (e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('button, a, input, select, summary')) return;
        onRowClick(row);
      });
      tr.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === tr) {
          e.preventDefault();
          onRowClick(row);
        }
      });
    }
    for (const [idx, col] of columns.entries()) {
      const cell = idx === 0 && col.rowHeader ? document.createElement('th') : document.createElement('td');
      if (cell.tagName === 'TH') (cell as HTMLTableCellElement).scope = 'row';
      cell.setAttribute('data-label', col.label);
      if (col.align === 'right') cell.classList.add('num');
      if (col.className) {
        for (const c of col.className.split(/\s+/)) {
          if (c) cell.classList.add(c);
        }
      }
      const rawVal = col.render
        ? col.render(row)
        : col.key
          ? (row as Record<string, unknown>)[col.key]
          : null;
      if (rawVal instanceof Node) {
        cell.append(rawVal);
      } else if (Array.isArray(rawVal)) {
        appendChildren(cell, rawVal as ChildNodeInput[]);
      } else if (rawVal !== null && rawVal !== undefined && rawVal !== false) {
        cell.textContent = String(rawVal);
      }
      tr.append(cell);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrapper.append(table);
  container.append(wrapper);
}
