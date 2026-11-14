// View 3: Account Pool & 5h Video Quota
// Endpoints: GET/POST api/cookies, POST/PATCH/DELETE api/cookies/{id}[/check|/rotate|/toggle], GET api/video-quota

import { apiFetch, errMessage, fmtDuration, fmtNum, fmtRel, fmtTime, isApiError } from './api.ts';
import { bi, t } from './i18n.ts';
import type {
  AccountVideoQuota,
  CookieAccountView,
  CookieCheckResponse,
  CookieCreateResponse,
  CookieHealth,
  CookieRotateResponse,
  CookiesListResponse,
  CookieStatus,
  CookieToggleResponse,
  QuotaEvent,
  VideoQuotaResponse,
  ViewContext,
  ViewController,
  ViewRefreshOptions,
} from './types.ts';
import {
  confirmDialog,
  el,
  renderTable,
  setAlert,
  toast,
  uiAlert,
  uiBadge,
  uiButton,
  uiDetails,
  uiEmptyState,
  uiField,
  uiFilterBar,
  uiKeyValueGrid,
  uiModalDialog,
  uiPageHeader,
  uiSectionPanel,
  uiTabs,
  wireDialogLightDismiss,
  type BadgeTone,
} from './ui.ts';

const KEY_COOKIE_FIELDS = [
  '__Secure-1PSID',
  '__Secure-1PSIDTS',
  '__Secure-1PSIDCC',
  'SAPISID',
  'SID',
  'HSID',
  'SSID',
  'APISID',
  '__Secure-1PAPISID',
] as const;

const HEALTH_TONE: Record<CookieHealth, BadgeTone> = {
  ok: 'ok',
  dead: 'err',
  disabled: 'default',
  unknown: 'warn',
};

const QUOTA_STATUS_TONE: Record<string, BadgeTone> = {
  available: 'ok',
  exhausted: 'warn',
  error: 'err',
};

interface ActionFeedback {
  ok: boolean;
  label: string;
  took_ms?: number;
  proxy_name?: string;
  detail: string;
  next_sec?: number;
}

function buildCookieStringFromInputs(inputsMap: Map<string, HTMLInputElement>): string {
  const parts: string[] = [];
  for (const name of KEY_COOKIE_FIELDS) {
    const val = (inputsMap.get(name)?.value ?? '').trim();
    if (val) parts.push(`${name}=${val}`);
  }
  return parts.join('; ');
}

export function mountAccounts(container: HTMLElement, ctx: ViewContext): ViewController {
  let activeTab: 'cookies' | 'video' = 'cookies';
  let cookiesData: CookiesListResponse = { items: [], total: 0, enabled: 0 };
  let batchChecking = false;
  let lastActionResult: ActionFeedback | null = null;
  let videoHours = 8;
  let videoData: VideoQuotaResponse | null = null;
  let videoLoadedOnce = false;
  let videoLoading = false;
  let editingCookieId: number | null = null;
  let importMode: 'raw' | 'keys' = 'raw';

  container.innerHTML = '';

  // Header
  const headerSummaryBadge = uiBadge('0 / 0', 'accent');
  headerSummaryBadge.id = 'accountsHeaderSummary';
  const headerRefreshBtn = uiButton({
    i18n: 'common.refresh',
    onClick: () => {
      if (activeTab === 'video') void loadVideoQuota();
      else void loadCookies();
    },
  });
  const pageHeader = uiPageHeader({
    titleI18n: 'accounts.title',
    subtitleI18n: 'accounts.subtitle',
    actions: [headerSummaryBadge, headerRefreshBtn],
  });

  // Tab 1: Cookies Pool
  const openImportBtn = uiButton({ variant: 'primary', onClick: () => openImportDialog() });
  const batchCheckBtn = uiButton({ onClick: () => void runBatchCheckAll() });
  const cookiesRefreshBtn = uiButton({
    i18n: 'common.refresh',
    onClick: () => void loadCookies(),
  });
  const poolSummaryBadge = uiBadge('0 / 0');
  const actionFeedbackWrap = el('div', { hidden: true });
  const cookiesTableWrap = el('div', { id: 'cookiesTableWrap' });
  const cookiesPoolPanel = uiSectionPanel({
    id: 'cookiesPoolPanel',
    title: bi('Cookie 账号池', 'Cookie Pool'),
    headerExtra: [poolSummaryBadge],
    actions: [openImportBtn, batchCheckBtn, cookiesRefreshBtn],
    stack: true,
    body: [actionFeedbackWrap, cookiesTableWrap],
  });

  // Tab 2: Video Quota
  const hoursLabelEl = el('label', { for: 'videoQuotaHours' });
  const hoursSelect = el(
    'select',
    { id: 'videoQuotaHours' },
    ...[5, 8, 12, 24, 48].map((h) =>
      el('option', { value: String(h), selected: h === videoHours }, `${h}h`),
    ),
  );
  const checkQuotaBtn = uiButton({ variant: 'primary', type: 'submit' });
  const videoMetaStrip = el('div', { class: 'row-actions' });
  const videoFilterBar = uiFilterBar(
    [
      uiField({ labelEl: hoursLabelEl, control: hoursSelect }),
      checkQuotaBtn,
      videoMetaStrip,
    ],
    () => {
      void loadVideoQuota();
    },
  );
  const videoResultsWrap = el('div', { id: 'videoQuotaResults', class: 'stack-md' });

  // Tabs Wiring
  const tabs = uiTabs({
    ariaLabel: bi('账号与配额子视图', 'Accounts sub-views'),
    activeTab: 'cookies',
    tabs: [
      {
        key: 'cookies',
        id: 'accountsTabCookies',
        panelId: 'accountsPanelCookies',
        label: t('accounts.tab.cookies'),
        i18n: 'accounts.tab.cookies',
      },
      {
        key: 'video',
        id: 'accountsTabVideo',
        panelId: 'accountsPanelVideo',
        label: t('accounts.tab.video'),
        i18n: 'accounts.tab.video',
      },
    ],
    onSelect: (tabKey) => {
      activeTab = tabKey === 'video' ? 'video' : 'cookies';
      if (activeTab === 'video' && !videoLoadedOnce && !videoLoading) {
        void loadVideoQuota();
      }
    },
  });
  tabs.panelBodies.cookies.append(cookiesPoolPanel.root);
  tabs.panelBodies.video.append(videoFilterBar.root, videoResultsWrap);

  // Import Dialog (#cookieImportDialog)
  const importErrorBox = uiAlert({ tone: 'err', role: 'alert', hidden: true });
  const importLabelLbl = el('label', { for: 'cookieImportLabel' });
  const importLabelInput = el('input', { type: 'text', id: 'cookieImportLabel', autocomplete: 'off' });
  const importAuthLbl = el('label', { for: 'cookieImportAuthuser' });
  const importAuthInput = el('input', {
    type: 'number',
    id: 'cookieImportAuthuser',
    min: '0',
    max: '9',
    value: '0',
  });
  const importNoteLbl = el('label', { for: 'cookieImportNote' });
  const importNoteInput = el('input', { type: 'text', id: 'cookieImportNote', autocomplete: 'off' });

  const modeRawBtn = uiButton({
    size: 'sm',
    active: true,
    onClick: () => setImportMode('raw'),
  });
  const modeKeysBtn = uiButton({
    size: 'sm',
    active: false,
    onClick: () => setImportMode('keys'),
  });

  const rawTextareaLbl = el('label', { for: 'cookieImportRaw' });
  const rawTextarea = el('textarea', {
    id: 'cookieImportRaw',
    rows: '5',
    placeholder: 'SID=...; HSID=...; SAPISID=...; __Secure-1PSID=...  OR  {"cookie":"..."}',
  });
  const rawModePane = uiField({ labelEl: rawTextareaLbl, control: rawTextarea });

  const keyInputsMap = new Map<string, HTMLInputElement>();
  const keysGrid = el('div', { class: 'form-grid' });
  for (const keyName of KEY_COOKIE_FIELDS) {
    const inputId = `cookieKey_${keyName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const inp = el('input', {
      type: 'text',
      id: inputId,
      autocomplete: 'off',
      placeholder: keyName,
    });
    keyInputsMap.set(keyName, inp);
    keysGrid.append(uiField({ label: keyName, forId: inputId, control: inp }));
  }
  const keysModePane = el('div', { hidden: true }, keysGrid);

  const importCancelBtn = uiButton({
    i18n: 'common.cancel',
    onClick: () => importModal.dialog.close(),
  });
  const importSubmitBtn = uiButton({ type: 'submit', variant: 'primary' });
  const importForm = el(
    'form',
    {},
    el(
      'div',
      { class: 'dialog__body' },
      importErrorBox,
      el(
        'div',
        { class: 'form-grid' },
        uiField({ labelEl: importLabelLbl, control: importLabelInput }),
        uiField({ labelEl: importAuthLbl, control: importAuthInput }),
        uiField({ labelEl: importNoteLbl, control: importNoteInput, grow: true }),
      ),
      el('div', { class: 'row-actions' }, modeRawBtn, modeKeysBtn),
      rawModePane,
      keysModePane,
    ),
    el('div', { class: 'dialog__foot' }, importCancelBtn, importSubmitBtn),
  );
  const importModal = uiModalDialog({
    id: 'cookieImportDialog',
    titleId: 'cookieImportTitle',
    closedby: 'any',
    content: [importForm],
  });

  // Edit Dialog (#cookieEditDialog)
  const editErrorBox = uiAlert({ tone: 'err', role: 'alert', hidden: true });
  const editLabelLbl = el('label', { for: 'cookieEditLabel' });
  const editLabelInput = el('input', { type: 'text', id: 'cookieEditLabel', autocomplete: 'off' });
  const editNoteLbl = el('label', { for: 'cookieEditNote' });
  const editNoteInput = el('input', { type: 'text', id: 'cookieEditNote', autocomplete: 'off' });
  const editAuthLbl = el('label', { for: 'cookieEditAuthuser' });
  const editAuthInput = el('input', {
    type: 'number',
    id: 'cookieEditAuthuser',
    min: '0',
    max: '9',
    value: '0',
  });
  const editStatusLbl = el('label', { for: 'cookieEditStatus' });
  const editStatusOptEnabled = el('option', { value: 'enabled' });
  const editStatusOptDisabled = el('option', { value: 'disabled' });
  const editStatusSelect = el('select', { id: 'cookieEditStatus' }, editStatusOptEnabled, editStatusOptDisabled);

  const editCancelBtn = uiButton({
    i18n: 'common.cancel',
    onClick: () => editModal.dialog.close(),
  });
  const editSubmitBtn = uiButton({
    type: 'submit',
    variant: 'primary',
    i18n: 'common.save',
  });
  const editForm = el(
    'form',
    {},
    el(
      'div',
      { class: 'dialog__body' },
      editErrorBox,
      el(
        'div',
        { class: 'form-grid' },
        uiField({ labelEl: editLabelLbl, control: editLabelInput }),
        uiField({ labelEl: editAuthLbl, control: editAuthInput }),
        uiField({ labelEl: editStatusLbl, control: editStatusSelect }),
        uiField({ labelEl: editNoteLbl, control: editNoteInput, grow: true }),
      ),
    ),
    el('div', { class: 'dialog__foot' }, editCancelBtn, editSubmitBtn),
  );
  const editModal = uiModalDialog({
    id: 'cookieEditDialog',
    titleId: 'cookieEditTitle',
    closedby: 'any',
    content: [editForm],
  });

  const viewRoot = el(
    'div',
    { class: 'view-stack' },
    pageHeader.root,
    tabs.tablist,
    ...tabs.panelElements,
    importModal.dialog,
    editModal.dialog,
  );
  container.append(viewRoot);
  wireDialogLightDismiss(container);

  function setImportMode(mode: 'raw' | 'keys'): void {
    importMode = mode;
    const isRaw = mode === 'raw';
    rawModePane.hidden = !isRaw;
    keysModePane.hidden = isRaw;
    modeRawBtn.classList.toggle('btn--active', isRaw);
    modeKeysBtn.classList.toggle('btn--active', !isRaw);
    modeRawBtn.setAttribute('aria-pressed', String(isRaw));
    modeKeysBtn.setAttribute('aria-pressed', String(!isRaw));
  }

  function renderLabels(): void {
    tabs.tablist.setAttribute('aria-label', bi('账号与配额子视图', 'Accounts sub-views'));
    cookiesPoolPanel.titleEl.textContent = bi('Cookie 账号池', 'Cookie Pool');
    openImportBtn.textContent = bi('导入 Cookie', 'Import Cookie');
    if (!batchChecking) {
      batchCheckBtn.textContent = bi('批量检测全部', 'Batch Check All');
    }

    hoursLabelEl.textContent = bi('回溯窗口 (hours)', 'Lookback (hours)');
    checkQuotaBtn.textContent = videoLoading ? t('common.loading') : bi('查询视频配额', 'Check Quota');

    importModal.titleEl.textContent = bi('导入 Google Cookie 账号', 'Import Google Cookie Account');
    importModal.closeTopBtn.textContent = t('common.close');
    importModal.closeTopBtn.setAttribute('aria-label', t('common.close'));
    importLabelLbl.textContent = bi('账号标签 (label)', 'Label');
    importAuthLbl.textContent = bi('账号序号 authuser (/u/0..9)', 'Authuser (/u/0..9)');
    importNoteLbl.textContent = bi('备注 (note)', 'Note');
    modeRawBtn.textContent = bi('粘贴原始串 / JSON', 'Paste Raw Cookie/JSON');
    modeKeysBtn.textContent = bi('逐项填写关键字段 (9)', 'Key-by-Key Inputs (9)');
    rawTextareaLbl.textContent = bi('Cookie 串或 JSON', 'Cookie String or JSON');
    importSubmitBtn.textContent = bi('导入账号', 'Import Account');

    editModal.titleEl.textContent = editingCookieId
      ? bi(`编辑账号 #${editingCookieId}`, `Edit Account #${editingCookieId}`)
      : bi('编辑账号', 'Edit Account');
    editModal.closeTopBtn.textContent = t('common.close');
    editModal.closeTopBtn.setAttribute('aria-label', t('common.close'));
    editLabelLbl.textContent = bi('账号标签 (label)', 'Label');
    editNoteLbl.textContent = bi('备注 (note)', 'Note');
    editAuthLbl.textContent = bi('账号序号 authuser (/u/0..9)', 'Authuser (/u/0..9)');
    editStatusLbl.textContent = bi('状态 (status)', 'Status');
    editStatusOptEnabled.textContent = `enabled (${t('common.enabled')})`;
    editStatusOptDisabled.textContent = `disabled (${t('common.disabled')})`;
  }

  function renderActionFeedback(): void {
    actionFeedbackWrap.innerHTML = '';
    if (!lastActionResult) {
      actionFeedbackWrap.hidden = true;
      return;
    }
    actionFeedbackWrap.hidden = false;
    const r = lastActionResult;
    const row = el(
      'div',
      { class: 'row-actions' },
      uiBadge(r.ok ? 'OK' : 'FAIL', r.ok ? 'ok' : 'err'),
      el('strong', {}, r.label),
      r.proxy_name ? uiBadge(`proxy: ${r.proxy_name}`) : null,
      r.took_ms !== undefined ? uiBadge(`${r.took_ms} ms`, 'default', { mono: true }) : null,
      r.next_sec !== undefined ? uiBadge(`next: ${fmtDuration(r.next_sec)}`, 'default', { mono: true }) : null,
      el('span', { class: 'text-break' }, r.detail),
    );
    actionFeedbackWrap.append(
      uiAlert({
        tone: r.ok ? 'ok' : 'err',
        role: r.ok ? 'status' : 'alert',
        message: row,
        onDismiss: () => {
          lastActionResult = null;
          renderActionFeedback();
        },
      }),
    );
  }

  function updateSummaryCounts(): void {
    const total = Number(cookiesData.total || 0);
    const enabled = Number(cookiesData.enabled || 0);
    const txt = `${enabled} / ${total}`;
    headerSummaryBadge.textContent = bi(`可用 ${txt}`, `${txt} enabled`);
    poolSummaryBadge.textContent = bi(`账号池: ${txt} 启用`, `Pool: ${txt} enabled`);
    ctx.updateShellCounts({ accounts: { enabled, total } });
  }

  function renderCookiesTable(): void {
    const items = cookiesData.items ?? [];
    renderTable<CookieAccountView>(cookiesTableWrap, {
      ariaLabel: bi('Cookie 账号池列表', 'Cookie Account Pool'),
      caption: bi('Cookie 账号池', 'Cookie Pool'),
      emptyText: bi(
        '暂无 Cookie 账号，请点击「导入 Cookie」添加。',
        'No cookie accounts yet. Click Import Cookie to add one.',
      ),
      rows: items,
      columns: [
        {
          key: 'id',
          label: 'ID',
          rowHeader: true,
          className: 'mono',
          render: (row) => `#${row.id}`,
        },
        {
          key: 'label',
          label: bi('标签', 'Label'),
          render: (row) => el('strong', {}, row.label || '-'),
        },
        {
          key: 'note',
          label: bi('备注', 'Note'),
          className: 'cell-trunc',
          render: (row) => el('span', { title: row.note || '' }, row.note || '-'),
        },
        {
          key: 'health',
          label: bi('健康度', 'Health'),
          render: (row) => uiBadge(row.health || 'unknown', HEALTH_TONE[row.health] ?? 'default'),
        },
        {
          key: 'status',
          label: bi('状态', 'Status'),
          render: (row) => uiBadge(row.status || 'disabled', row.status === 'enabled' ? 'ok' : 'default'),
        },
        {
          key: 'key_cookies',
          label: bi('关键项', 'Key Cookies'),
          className: 'mono',
          render: (row) => {
            const keys = Array.isArray(row.key_cookies) ? row.key_cookies : [];
            const title =
              keys.length > 0
                ? `${keys.join(', ')} (total: ${row.cookie_count || 0})`
                : `total: ${row.cookie_count || 0}`;
            return uiBadge(`${keys.length}/9`, keys.length >= 9 ? 'ok' : 'warn', { mono: true, title });
          },
        },
        {
          key: 'has_1psidts',
          label: '1PSIDTS',
          render: (row) =>
            uiBadge(row.has_1psidts ? bi('有', 'Yes') : bi('缺', 'No'), row.has_1psidts ? 'ok' : 'warn'),
        },
        {
          key: 'sapisid_tail',
          label: 'SAPISID',
          className: 'mono',
          render: (row) => (row.sapisid_tail ? `...${row.sapisid_tail}` : '-'),
        },
        {
          key: 'authuser',
          label: 'Authuser',
          className: 'mono',
          render: (row) => `/u/${Number(row.authuser || 0)}`,
        },
        {
          key: 'proxy_name',
          label: bi('绑定出口', 'Proxy'),
          render: (row) => row.proxy_name || (row.proxy_id ? `#${row.proxy_id}` : '-'),
        },
        {
          key: 'fail_count',
          label: bi('失败数', 'Fails'),
          align: 'right',
          render: (row) => {
            const n = Number(row.fail_count || 0);
            return n > 0 ? uiBadge(fmtNum(n), 'err', { mono: true }) : el('span', { class: 'mono' }, fmtNum(n));
          },
        },
        {
          key: 'last_used_at',
          label: bi('最近使用', 'Last Used'),
          className: 'mono',
          render: (row) => el('span', { title: fmtRel(row.last_used_at) }, fmtTime(row.last_used_at)),
        },
        {
          key: 'last_ok_at',
          label: bi('最近成功', 'Last OK'),
          className: 'mono',
          render: (row) => el('span', { title: fmtRel(row.last_ok_at) }, fmtTime(row.last_ok_at)),
        },
        {
          key: 'created_at',
          label: bi('创建时间', 'Created'),
          className: 'mono',
          render: (row) => fmtTime(row.created_at),
        },
        {
          key: 'last_error',
          label: bi('最近错误', 'Last Error'),
          className: 'cell-trunc',
          render: (row) => el('span', { title: row.last_error || '' }, row.last_error || '-'),
        },
        {
          key: 'actions',
          label: bi('操作', 'Actions'),
          render: (row) => {
            const checkBtn = uiButton({
              text: bi('检测', 'Check'),
              size: 'sm',
              disabled: batchChecking,
              onClick: () => void runCheckOne(row, checkBtn),
            });
            const rotateBtn = uiButton({
              text: bi('轮换', 'Rotate'),
              size: 'sm',
              disabled: batchChecking,
              onClick: () => void runRotateOne(row, rotateBtn),
            });
            const toggleBtn = uiButton({
              text: row.status === 'enabled' ? bi('停用', 'Disable') : bi('启用', 'Enable'),
              size: 'sm',
              disabled: batchChecking,
              onClick: () => void runToggleOne(row),
            });
            const editBtn = uiButton({
              text: t('common.edit'),
              size: 'sm',
              onClick: () => openEditDialog(row),
            });
            const delBtn = uiButton({
              text: t('common.delete'),
              size: 'sm',
              variant: 'danger',
              onClick: () => void runDeleteOne(row),
            });
            return el('div', { class: 'row-actions' }, checkBtn, rotateBtn, toggleBtn, editBtn, delBtn);
          },
        },
      ],
    });
  }

  async function loadCookies(): Promise<void> {
    try {
      const data = await apiFetch<CookiesListResponse>('cookies');
      cookiesData = {
        items: Array.isArray(data?.items) ? data.items : [],
        total: Number(data?.total || 0),
        enabled: Number(data?.enabled || 0),
      };
      updateSummaryCounts();
      renderCookiesTable();
    } catch (err: unknown) {
      if (!isApiError(err) || err.status !== 401) {
        toast(errMessage(err), 'err');
      }
    }
  }

  async function runCheckOne(row: CookieAccountView, btn?: HTMLButtonElement): Promise<void> {
    const acctLabel = row.label || `#${row.id}`;
    if (btn) btn.disabled = true;
    try {
      const res = await apiFetch<CookieCheckResponse>(`cookies/${row.id}/check`, { method: 'POST' });
      const ok = Boolean(res?.ok);
      lastActionResult = {
        ok,
        label: acctLabel,
        took_ms: res?.took_ms,
        proxy_name: res?.proxy_name || row.proxy_name || '-',
        detail: res?.detail || '',
      };
      renderActionFeedback();
      const msg = `[${acctLabel}] ${res?.detail || (ok ? 'OK' : 'Failed')} (${res?.proxy_name || '-'}, ${res?.took_ms ?? 0}ms)`;
      toast(msg, ok ? 'ok' : 'err', 4500);
      await loadCookies();
    } catch (err: unknown) {
      if (!isApiError(err) || err.status !== 401) toast(errMessage(err), 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function runRotateOne(row: CookieAccountView, btn?: HTMLButtonElement): Promise<void> {
    const acctLabel = row.label || `#${row.id}`;
    if (btn) btn.disabled = true;
    const t0 = performance.now();
    try {
      const res = await apiFetch<CookieRotateResponse>(`cookies/${row.id}/rotate`, { method: 'POST' });
      const tookMs = Math.round(performance.now() - t0);
      const ok = Boolean(res?.ok);
      lastActionResult = {
        ok,
        label: acctLabel,
        took_ms: tookMs,
        proxy_name: row.proxy_name || '-',
        detail: res?.detail || '',
        next_sec: res?.next_sec,
      };
      renderActionFeedback();
      const msg = `[${acctLabel}] ${res?.detail || (ok ? 'Rotated' : 'Failed')} (${row.proxy_name || '-'}, ${tookMs}ms)`;
      toast(msg, ok ? 'ok' : 'err', 4500);
      await loadCookies();
    } catch (err: unknown) {
      if (!isApiError(err) || err.status !== 401) toast(errMessage(err), 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function runToggleOne(row: CookieAccountView): Promise<void> {
    try {
      const res = await apiFetch<CookieToggleResponse>(`cookies/${row.id}/toggle`, { method: 'POST' });
      toast(bi(`账号 #${row.id} 状态: ${res.status}`, `Account #${row.id} status: ${res.status}`), 'ok');
      await loadCookies();
    } catch (err: unknown) {
      if (!isApiError(err) || err.status !== 401) toast(errMessage(err), 'err');
    }
  }

  async function runDeleteOne(row: CookieAccountView): Promise<void> {
    const acctLabel = row.label ? `${row.label} (#${row.id})` : `#${row.id}`;
    const confirmed = await confirmDialog({
      title: bi('删除 Cookie 账号', 'Delete Cookie Account'),
      message: bi(
        `确认从账号池删除 ${acctLabel}？此操作不可撤销。`,
        `Delete ${acctLabel} from the pool? This cannot be undone.`,
      ),
      confirmText: t('common.delete'),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await apiFetch(`cookies/${row.id}`, { method: 'DELETE' });
      toast(bi(`已删除 ${acctLabel}`, `Deleted ${acctLabel}`), 'ok');
      await loadCookies();
    } catch (err: unknown) {
      if (!isApiError(err) || err.status !== 401) toast(errMessage(err), 'err');
    }
  }

  async function runBatchCheckAll(): Promise<void> {
    const items = cookiesData.items ?? [];
    if (items.length === 0) {
      toast(bi('暂无可检测账号', 'No accounts to check'), 'warn');
      return;
    }
    batchChecking = true;
    batchCheckBtn.disabled = true;
    openImportBtn.disabled = true;
    renderCookiesTable();

    let okCount = 0;
    let failCount = 0;
    const t0 = performance.now();
    try {
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const acctLabel = item.label || `#${item.id}`;
        batchCheckBtn.textContent = bi(`检测中 ${i + 1}/${items.length}…`, `Checking ${i + 1}/${items.length}…`);
        try {
          const res = await apiFetch<CookieCheckResponse>(`cookies/${item.id}/check`, { method: 'POST' });
          const ok = Boolean(res?.ok);
          if (ok) okCount += 1;
          else failCount += 1;
          lastActionResult = {
            ok,
            label: `${acctLabel} (${i + 1}/${items.length})`,
            took_ms: res?.took_ms,
            proxy_name: res?.proxy_name || item.proxy_name || '-',
            detail: res?.detail || '',
          };
          renderActionFeedback();
        } catch (err: unknown) {
          if (isApiError(err) && err.status === 401) throw err;
          failCount += 1;
          lastActionResult = {
            ok: false,
            label: `${acctLabel} (${i + 1}/${items.length})`,
            proxy_name: item.proxy_name || '-',
            detail: errMessage(err),
          };
          renderActionFeedback();
        }
      }
      const totalMs = Math.round(performance.now() - t0);
      lastActionResult = {
        ok: failCount === 0,
        label: bi('批量检测完成', 'Batch Check Complete'),
        took_ms: totalMs,
        detail: bi(`${okCount}/${items.length} 有效，${failCount} 失败`, `${okCount}/${items.length} ok, ${failCount} failed`),
      };
      renderActionFeedback();
      toast(lastActionResult.detail, failCount === 0 ? 'ok' : 'warn', 4500);
      await loadCookies();
    } catch (err: unknown) {
      if (!isApiError(err) || err.status !== 401) toast(errMessage(err), 'err');
    } finally {
      batchChecking = false;
      batchCheckBtn.disabled = false;
      openImportBtn.disabled = false;
      renderLabels();
      renderCookiesTable();
    }
  }

  function openImportDialog(): void {
    setAlert(importErrorBox, '');
    importLabelInput.value = '';
    importAuthInput.value = '0';
    importNoteInput.value = '';
    rawTextarea.value = '';
    for (const inp of keyInputsMap.values()) inp.value = '';
    setImportMode('raw');
    importModal.dialog.showModal();
    importLabelInput.focus();
  }

  function openEditDialog(row: CookieAccountView): void {
    editingCookieId = row.id;
    setAlert(editErrorBox, '');
    editLabelInput.value = row.label || '';
    editNoteInput.value = row.note || '';
    editAuthInput.value = String(Number(row.authuser || 0));
    editStatusSelect.value = row.status === 'disabled' ? 'disabled' : 'enabled';
    renderLabels();
    editModal.dialog.showModal();
    editLabelInput.focus();
  }

  function renderAccountQuotaCard(acct: AccountVideoQuota): HTMLElement {
    const events = Array.isArray(acct.events) ? acct.events : [];
    const statusTone = QUOTA_STATUS_TONE[acct.status] ?? 'default';

    const kvGrid = uiKeyValueGrid([
      { key: 'videos_last_5h', value: fmtNum(acct.videos_last_5h || 0) },
      { key: 'window_started_at', value: fmtTime(acct.window_started_at) },
      { key: 'last_video_at', value: fmtTime(acct.last_video_at) },
      { key: 'last_refusal_at', value: fmtTime(acct.last_refusal_at) },
      {
        key: 'reset_at',
        value: acct.reset_at ? `${fmtTime(acct.reset_at)} (${fmtRel(acct.reset_at)})` : '-',
      },
      { key: 'reset_source', value: acct.reset_source || '-' },
    ]);

    const errorBanner = acct.error
      ? uiAlert({ tone: 'err', role: 'alert', message: acct.error })
      : null;

    const eventsTableContainer = el('div');
    renderTable<QuotaEvent>(eventsTableContainer, {
      ariaLabel: bi(`账号 #${acct.id} 视频事件明细`, `Account #${acct.id} video events`),
      emptyText: bi('回溯窗口内无视频事件', 'No video events in lookback window'),
      rows: events,
      columns: [
        { key: 'at', label: 'at', className: 'mono', render: (ev) => fmtTime(ev.at) },
        {
          key: 'kind',
          label: 'kind',
          render: (ev) => {
            const tone: BadgeTone =
              ev.kind === 'video'
                ? 'ok'
                : ev.kind === 'quota_refused'
                  ? 'err'
                  : ev.kind === 'policy_refused'
                    ? 'warn'
                    : 'default';
            return uiBadge(ev.kind || '-', tone);
          },
        },
        { key: 'cid', label: 'cid', className: 'mono', render: (ev) => ev.cid || '-' },
        {
          key: 'title',
          label: 'title',
          className: 'cell-trunc',
          render: (ev) => el('span', { title: ev.title || '' }, ev.title || '-'),
        },
        { key: 'reset_at', label: 'reset_at', className: 'mono', render: (ev) => fmtTime(ev.reset_at) },
      ],
    });

    const detailsEl = uiDetails({
      summary: bi(`视频事件明细 (${events.length})`, `Events (${events.length})`),
      children: [eventsTableContainer],
    });

    const card = uiSectionPanel({
      title: acct.label || `#${acct.id}`,
      headingTag: 'h3',
      headerExtra: [
        uiBadge(`#${acct.id}`, 'default', { mono: true }),
        uiBadge(acct.status || 'unknown', statusTone),
      ],
      actions: [
        uiBadge(`${bi('近 5h 视频', '5h Videos')}: ${fmtNum(acct.videos_last_5h || 0)}`, 'accent', { mono: true }),
        ...(acct.reset_source ? [uiBadge(`reset_source: ${acct.reset_source}`)] : []),
      ],
      stack: true,
      body: [kvGrid, errorBanner, detailsEl],
    });
    return card.root;
  }

  function renderVideoResults(): void {
    videoMetaStrip.innerHTML = '';
    videoResultsWrap.innerHTML = '';

    if (videoLoading && !videoData) {
      videoResultsWrap.append(uiEmptyState(t('common.loading')));
      return;
    }

    if (!videoData) {
      videoResultsWrap.append(
        uiEmptyState(
          bi(
            '点击「查询视频配额」从各启用账号的 Gemini 会话历史读取 5 小时 Veo 视频配额。',
            'Click Check Quota to inspect live 5-hour Veo video history across enabled accounts.',
          ),
        ),
      );
      return;
    }

    const winSec = Number(videoData.window_seconds || 18000);
    videoMetaStrip.append(uiBadge(`${bi('配额窗口', 'Window')}: ${fmtDuration(winSec)}`, 'accent'));
    if (videoData.now) {
      videoMetaStrip.append(uiBadge(`${bi('查询时间', 'Checked')}: ${fmtTime(videoData.now)}`, 'default', { mono: true }));
    }

    if (videoData.history_incomplete) {
      videoResultsWrap.append(
        uiAlert({
          tone: 'warn',
          role: 'status',
          message: el(
            'div',
            {},
            el('strong', {}, bi('历史记录不完整：', 'History Incomplete: ')),
            videoData.history_incomplete,
          ),
        }),
      );
    }

    if (videoData.note) {
      videoResultsWrap.append(uiAlert({ tone: 'info', role: 'status', message: videoData.note }));
    }

    const accounts = Array.isArray(videoData.accounts) ? videoData.accounts : [];
    if (accounts.length === 0) {
      videoResultsWrap.append(
        uiEmptyState(bi('当前没有处于 enabled 状态的账号。', 'No enabled cookie accounts found.')),
      );
      return;
    }

    const listEl = el('div', { class: 'stack-md' }, ...accounts.map((acct) => renderAccountQuotaCard(acct)));
    videoResultsWrap.append(listEl);
  }

  async function loadVideoQuota(): Promise<void> {
    videoLoading = true;
    checkQuotaBtn.disabled = true;
    renderLabels();
    if (!videoData) renderVideoResults();
    try {
      const hours = Number(hoursSelect.value || 8);
      videoHours = hours;
      videoData = await apiFetch<VideoQuotaResponse>(`video-quota?hours=${encodeURIComponent(String(hours))}`);
      videoLoadedOnce = true;
      renderVideoResults();
    } catch (err: unknown) {
      if (!isApiError(err) || err.status !== 401) toast(errMessage(err), 'err');
      renderVideoResults();
    } finally {
      videoLoading = false;
      checkQuotaBtn.disabled = false;
      renderLabels();
    }
  }

  hoursSelect.addEventListener('change', () => {
    videoHours = Number(hoursSelect.value || 8);
  });

  importForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setAlert(importErrorBox, '');
    const cookieStr =
      importMode === 'raw' ? rawTextarea.value.trim() : buildCookieStringFromInputs(keyInputsMap);
    if (!cookieStr) {
      setAlert(importErrorBox, bi('请填写 Cookie 内容', 'Please provide cookie data'));
      return;
    }
    const authuser = Number(importAuthInput.value || 0);
    if (!Number.isInteger(authuser) || authuser < 0 || authuser > 9) {
      setAlert(importErrorBox, bi('authuser 须在 0..9 之间', 'authuser must be between 0 and 9'));
      return;
    }
    importSubmitBtn.disabled = true;
    try {
      const res = await apiFetch<CookieCreateResponse>('cookies', {
        method: 'POST',
        body: {
          label: importLabelInput.value.trim(),
          authuser,
          note: importNoteInput.value.trim(),
          cookie: cookieStr,
        },
      });
      importModal.dialog.close();
      toast(bi(`已导入账号 #${res.id}`, `Imported account #${res.id}`), 'ok');
      await loadCookies();
    } catch (err: unknown) {
      if (!isApiError(err) || err.status !== 401) setAlert(importErrorBox, errMessage(err));
    } finally {
      importSubmitBtn.disabled = false;
    }
  });

  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editingCookieId) return;
    setAlert(editErrorBox, '');
    const authuser = Number(editAuthInput.value || 0);
    if (!Number.isInteger(authuser) || authuser < 0 || authuser > 9) {
      setAlert(editErrorBox, bi('authuser 须在 0..9 之间', 'authuser must be between 0 and 9'));
      return;
    }
    editSubmitBtn.disabled = true;
    try {
      const statusVal: CookieStatus = editStatusSelect.value === 'disabled' ? 'disabled' : 'enabled';
      await apiFetch(`cookies/${editingCookieId}`, {
        method: 'PATCH',
        body: {
          label: editLabelInput.value.trim(),
          note: editNoteInput.value.trim(),
          authuser,
          status: statusVal,
        },
      });
      editModal.dialog.close();
      toast(bi(`已更新账号 #${editingCookieId}`, `Updated account #${editingCookieId}`), 'ok');
      await loadCookies();
    } catch (err: unknown) {
      if (!isApiError(err) || err.status !== 401) setAlert(editErrorBox, errMessage(err));
    } finally {
      editSubmitBtn.disabled = false;
    }
  });

  renderLabels();
  renderActionFeedback();
  renderVideoResults();
  void loadCookies();

  return {
    refresh(opts: ViewRefreshOptions = {}) {
      renderLabels();
      renderActionFeedback();
      if (opts.tab === 'cookies' || opts.tab === 'video') {
        tabs.controller.select(opts.tab);
      }
      void loadCookies();
      if (activeTab === 'video' && videoLoadedOnce) {
        void loadVideoQuota();
      } else if (videoData) {
        renderVideoResults();
      }
    },
  };
}
