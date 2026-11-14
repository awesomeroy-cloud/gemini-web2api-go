// View 4: Egress Pool, Rate-Limit Slots & E2E Probe
// Endpoints: GET api/usage, GET/POST api/proxies, POST/PATCH/DELETE api/proxies/{id}[/toggle|/reset], GET api/test

import { apiFetch, errMessage, fmtMs, fmtNum, fmtRel, fmtTime, isApiError } from './api.ts';
import { bi, t } from './i18n.ts';
import type {
  ProbeResult,
  ProxiesListResponse,
  ProxyCreateResponse,
  ProxyItem,
  ProxyToggleResponse,
  SlotUsageItem,
  UsageListResponse,
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
  uiCodeBlock,
  uiDetails,
  uiEmptyState,
  uiField,
  uiFilterBar,
  uiKeyValueGrid,
  uiMeterRow,
  uiModalDialog,
  uiPageHeader,
  uiSectionPanel,
  uiSwitchRow,
  wireDialogLightDismiss,
} from './ui.ts';

const RPH_REDLINE = 72;
const RPH_BAN_CAP = 80;

export function mountEgress(container: HTMLElement, ctx: ViewContext): ViewController {
  let usageItems: SlotUsageItem[] = [];
  let proxiesList: ProxyItem[] = [];
  let probeResult: ProbeResult | null = null;
  let probing = false;
  let editingProxyId: number | null = null;

  container.innerHTML = '';

  // Header
  const refreshAllBtn = uiButton({
    i18n: 'common.refresh',
    onClick: () => void refreshAll(),
  });
  const pageHeader = uiPageHeader({
    titleI18n: 'egress.title',
    subtitleI18n: 'egress.subtitle',
    actions: [refreshAllBtn],
  });

  // Panel A: Live IP Rate-Limit & 80 RPH Ban Redline
  const redlineBadge = uiBadge('', 'warn');
  const usageRefreshBtn = uiButton({
    i18n: 'common.refresh',
    size: 'sm',
    onClick: () => void loadUsage(),
  });
  const usageGrid = el('div', { class: 'kv-grid' });
  const usagePanel = uiSectionPanel({
    id: 'egressUsagePanel',
    titleId: 'egressUsageHeading',
    title: bi('实时单 IP 限流槽位与 80 RPH 封禁红线', 'Live IP Rate-Limit Slots & 80 RPH Ban Redline'),
    headerExtra: [redlineBadge],
    actions: [usageRefreshBtn],
    body: [usageGrid],
  });

  // Panel B: Proxy Egress Pool CRUD
  const proxiesSummaryBadge = uiBadge('0 / 0', 'accent');
  const addNameLbl = el('label', { for: 'proxyAddName' });
  const addNameInput = el('input', { type: 'text', id: 'proxyAddName', required: true, autocomplete: 'off' });
  const addUrlLbl = el('label', { for: 'proxyAddUrl' });
  const addUrlInput = el('input', {
    type: 'text',
    id: 'proxyAddUrl',
    required: true,
    autocomplete: 'off',
    placeholder: 'socks5://127.0.0.1:1080 or http://...',
  });
  const addWeightLbl = el('label', { for: 'proxyAddWeight' });
  const addWeightInput = el('input', { type: 'number', id: 'proxyAddWeight', min: '1', value: '1' });
  const addSubmitBtn = uiButton({ type: 'submit', variant: 'primary' });
  const addFilterBar = uiFilterBar(
    [
      uiField({ labelEl: addNameLbl, control: addNameInput }),
      uiField({ labelEl: addUrlLbl, control: addUrlInput, grow: true }),
      uiField({ labelEl: addWeightLbl, control: addWeightInput, compact: true }),
      addSubmitBtn,
    ],
    () => {
      void submitAddProxy();
    },
  );
  addFilterBar.form.id = 'proxyAddForm';
  const proxiesTableWrap = el('div', { id: 'proxiesTableWrap' });
  const proxiesPanel = uiSectionPanel({
    id: 'egressProxiesPanel',
    titleId: 'egressProxiesHeading',
    title: bi('出口代理池管理', 'Proxy Egress Pool'),
    actions: [proxiesSummaryBadge],
    stack: true,
    body: [addFilterBar.root, proxiesTableWrap],
  });

  // Panel C: E2E Connectivity & TLS Probe
  const probeTargetLbl = el('label', { for: 'egressProbeTarget' });
  const probeTargetSelect = el('select', { id: 'egressProbeTarget' });
  const probePromptLbl = el('label', { for: 'egressProbePrompt' });
  const probePromptInput = el('input', {
    type: 'text',
    id: 'egressProbePrompt',
    value: 'Reply with one short word.',
  });
  const probeRunBtn = uiButton({ type: 'submit', variant: 'primary' });
  const probeFilterBar = uiFilterBar(
    [
      uiField({ labelEl: probeTargetLbl, control: probeTargetSelect }),
      uiField({ labelEl: probePromptLbl, control: probePromptInput, grow: true }),
      probeRunBtn,
    ],
    () => {
      void runProbe();
    },
  );
  const probeResultWrap = el('div', { id: 'egressProbeResult', class: 'stack-md' });
  const probePanel = uiSectionPanel({
    id: 'egressProbePanel',
    titleId: 'egressProbeHeading',
    title: bi('端到端连通性与 TLS 指纹探针', 'E2E Connectivity & TLS Probe'),
    stack: true,
    body: [probeFilterBar.root, probeResultWrap],
  });

  // Edit Dialog (#proxyEditDialog)
  const editErrorBox = uiAlert({ tone: 'err', role: 'alert', hidden: true });
  const editNameLbl = el('label', { for: 'proxyEditName' });
  const editNameInput = el('input', { type: 'text', id: 'proxyEditName', required: true, autocomplete: 'off' });
  const editUrlLbl = el('label', { for: 'proxyEditUrl' });
  const editUrlInput = el('input', { type: 'text', id: 'proxyEditUrl', required: true, autocomplete: 'off' });
  const editWeightLbl = el('label', { for: 'proxyEditWeight' });
  const editWeightInput = el('input', { type: 'number', id: 'proxyEditWeight', min: '1', value: '1' });
  const editEnabledSwitch = el('input', { type: 'checkbox', switch: true, id: 'proxyEditEnabled' });
  const editEnabledTitle = el('span');
  const editEnabledDesc = el('span');
  const editEnabledRow = uiSwitchRow({
    id: 'proxyEditEnabled',
    title: editEnabledTitle,
    desc: editEnabledDesc,
    inputEl: editEnabledSwitch,
  });
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
        uiField({ labelEl: editNameLbl, control: editNameInput }),
        uiField({ labelEl: editWeightLbl, control: editWeightInput }),
        uiField({ labelEl: editUrlLbl, control: editUrlInput, grow: true }),
      ),
      editEnabledRow,
    ),
    el('div', { class: 'dialog__foot' }, editCancelBtn, editSubmitBtn),
  );
  const editModal = uiModalDialog({
    id: 'proxyEditDialog',
    titleId: 'proxyEditTitle',
    closedby: 'any',
    content: [editForm],
  });

  const viewRoot = el(
    'div',
    { class: 'view-stack' },
    pageHeader.root,
    usagePanel.root,
    proxiesPanel.root,
    probePanel.root,
    editModal.dialog,
  );
  container.append(viewRoot);
  wireDialogLightDismiss(container);

  function renderLabels(): void {
    usagePanel.titleEl.textContent = bi(
      '实时单 IP 限流槽位与 80 RPH 封禁红线',
      'Live IP Rate-Limit Slots & 80 RPH Ban Redline',
    );
    redlineBadge.textContent = bi('Google 封禁红线: 80 RPH (≥72 告警)', 'Google Redline: 80 RPH (warn ≥72)');

    proxiesPanel.titleEl.textContent = bi('出口代理池管理', 'Proxy Egress Pool');
    addNameLbl.textContent = bi('名称 (name)', 'Name');
    addUrlLbl.textContent = bi('代理地址 (url)', 'Proxy URL');
    addWeightLbl.textContent = bi('权重 (weight)', 'Weight');
    addSubmitBtn.textContent = bi('添加代理', 'Add Proxy');

    probePanel.titleEl.textContent = bi('端到端连通性与 TLS 指纹探针', 'E2E Connectivity & TLS Probe');
    probeTargetLbl.textContent = bi('目标出口', 'Target Egress');
    probePromptLbl.textContent = bi('测试提示词 (prompt)', 'Test Prompt');
    probeRunBtn.textContent = probing ? t('common.loading') : bi('运行探针', 'Run Probe');

    editModal.titleEl.textContent = editingProxyId
      ? bi(`编辑代理 #${editingProxyId}`, `Edit Proxy #${editingProxyId}`)
      : bi('编辑代理', 'Edit Proxy');
    editModal.closeTopBtn.textContent = t('common.close');
    editModal.closeTopBtn.setAttribute('aria-label', t('common.close'));
    editNameLbl.textContent = bi('名称 (name)', 'Name');
    editUrlLbl.textContent = bi('代理地址 (url)', 'Proxy URL');
    editWeightLbl.textContent = bi('权重 (weight)', 'Weight');
    editEnabledTitle.textContent = bi('启用该代理', 'Enable Proxy');
    editEnabledDesc.textContent = bi('停用后不再参与轮询调度', 'Disabled proxies are excluded from pool scheduling');
  }

  function renderUsageSlots(): void {
    usageGrid.innerHTML = '';
    if (usageItems.length === 0) {
      usageGrid.append(uiEmptyState(bi('暂无活跃出口槽位', 'No active egress slots')));
      return;
    }
    for (const slot of usageItems) {
      const isDirect = Number(slot.proxy_id) === 0;
      const displayName = isDirect ? bi('直连 (Direct)', 'Direct') : slot.name || `#${slot.proxy_id}`;
      const redlineWarn = Number(slot.rph || 0) >= RPH_REDLINE;
      const card = el(
        'article',
        { class: 'kpi-card' },
        el(
          'div',
          { class: 'slot-card__head' },
          el('strong', {}, displayName),
          el(
            'div',
            { class: 'row-actions' },
            uiBadge(`proxy_id=${slot.proxy_id}`, 'default', { mono: true }),
            redlineWarn ? uiBadge(`≥${RPH_REDLINE} RPH`, 'err') : null,
          ),
        ),
        uiMeterRow({
          label: bi('并发 (inflight)', 'Inflight'),
          current: slot.inflight,
          limit: slot.limit_concurrent,
        }),
        uiMeterRow({
          label: 'RPM',
          current: slot.rpm,
          limit: slot.limit_rpm,
        }),
        uiMeterRow({
          label: 'RPH',
          current: slot.rph,
          limit: slot.limit_rph,
          isRph: true,
          rphRedline: RPH_REDLINE,
          rphCap: RPH_BAN_CAP,
        }),
      );
      usageGrid.append(card);
    }
  }

  function syncProbeSelectOptions(): void {
    const prevVal = probeTargetSelect.value;
    probeTargetSelect.innerHTML = '';
    probeTargetSelect.append(
      el('option', { value: '' }, bi('自动调度 (Pool Auto)', 'Pool Auto')),
      el('option', { value: '0' }, bi('直连 (Direct, proxy_id=0)', 'Direct (proxy_id=0)')),
    );
    for (const p of proxiesList) {
      const suffix = p.enabled ? '' : ` [${t('common.disabled')}]`;
      probeTargetSelect.append(el('option', { value: String(p.id) }, `#${p.id} ${p.name}${suffix}`));
    }
    const exists = Array.from(probeTargetSelect.options).some((opt) => opt.value === prevVal);
    probeTargetSelect.value = exists ? prevVal : '';
  }

  function updateSummaryCounts(): void {
    const total = proxiesList.length;
    const enabledCount = proxiesList.filter((p) => p.enabled).length;
    const activeCount = proxiesList.filter((p) => p.enabled && (p.fail_count ?? 0) < 5).length;
    proxiesSummaryBadge.textContent = bi(`启用 ${enabledCount} / ${total}`, `${enabledCount} / ${total} enabled`);
    ctx.updateShellCounts({ proxies: { active: activeCount, total } });
  }

  function renderProxiesTable(): void {
    renderTable<ProxyItem>(proxiesTableWrap, {
      ariaLabel: bi('出口代理池列表', 'Proxy Egress Pool'),
      caption: bi('出口代理池', 'Proxy Pool'),
      emptyText: bi(
        '代理池为空（当前回退为直连）。',
        'No proxies configured (pool falls back to direct egress).',
      ),
      rows: proxiesList,
      columns: [
        {
          key: 'id',
          label: 'ID',
          rowHeader: true,
          className: 'mono',
          render: (row) => `#${row.id}`,
        },
        {
          key: 'name',
          label: bi('名称', 'Name'),
          render: (row) => el('strong', {}, row.name || '-'),
        },
        {
          key: 'url',
          label: 'URL',
          className: 'mono cell-trunc',
          render: (row) => el('span', { title: row.url || '' }, row.url || '-'),
        },
        {
          key: 'weight',
          label: bi('权重', 'Weight'),
          align: 'right',
          render: (row) => fmtNum(row.weight || 1),
        },
        {
          key: 'enabled',
          label: bi('状态', 'Enabled'),
          render: (row) => uiBadge(row.enabled ? t('common.enabled') : t('common.disabled'), row.enabled ? 'ok' : 'default'),
        },
        {
          key: 'fail_count',
          label: bi('连续失败', 'Fail Count'),
          align: 'right',
          render: (row) => {
            const n = Number(row.fail_count || 0);
            return n > 0 ? uiBadge(fmtNum(n), 'err', { mono: true }) : el('span', { class: 'mono' }, fmtNum(n));
          },
        },
        {
          key: 'last_used',
          label: bi('最近使用', 'Last Used'),
          className: 'mono',
          render: (row) => el('span', { title: fmtRel(row.last_used) }, fmtTime(row.last_used)),
        },
        {
          key: 'last_error',
          label: bi('最近错误', 'Last Error'),
          className: 'cell-trunc',
          render: (row) => el('span', { title: row.last_error || '' }, row.last_error || '-'),
        },
        {
          key: 'created_at',
          label: bi('创建时间', 'Created'),
          className: 'mono',
          render: (row) => fmtTime(row.created_at),
        },
        {
          key: 'actions',
          label: bi('操作', 'Actions'),
          render: (row) => {
            const editBtn = uiButton({
              text: t('common.edit'),
              size: 'sm',
              onClick: () => openEditDialog(row),
            });
            const toggleBtn = uiButton({
              text: row.enabled ? bi('停用', 'Disable') : bi('启用', 'Enable'),
              size: 'sm',
              onClick: () => void toggleProxy(row),
            });
            const resetBtn = uiButton({
              text: bi('清零失败', 'Reset Fails'),
              size: 'sm',
              onClick: () => void resetProxyFails(row),
            });
            const probeBtn = uiButton({
              text: bi('探针', 'Probe'),
              size: 'sm',
              onClick: () => {
                probeTargetSelect.value = String(row.id);
                probePanel.root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                void runProbe();
              },
            });
            const delBtn = uiButton({
              text: t('common.delete'),
              size: 'sm',
              variant: 'danger',
              onClick: () => void deleteProxy(row),
            });
            return el('div', { class: 'row-actions' }, editBtn, toggleBtn, resetBtn, probeBtn, delBtn);
          },
        },
      ],
    });
  }

  function renderProbeResult(): void {
    probeResultWrap.innerHTML = '';
    if (probing) {
      probeResultWrap.append(uiEmptyState(t('common.loading')));
      return;
    }
    if (!probeResult) {
      probeResultWrap.append(
        uiEmptyState(
          bi(
            '选择出口或点击代理行上的「探针」即可执行端到端 TLS + StreamGenerate 连通诊断。',
            'Select a target or click Probe on any proxy row to run an E2E TLS + StreamGenerate test.',
          ),
        ),
      );
      return;
    }

    const r = probeResult;
    const metaGrid = uiKeyValueGrid([
      { key: 'ok', value: uiBadge(r.ok ? 'OK' : 'FAIL', r.ok ? 'ok' : 'err') },
      { key: 'status', value: r.status || '-' },
      { key: 'http_code', value: String(r.http_code ?? 0) },
      { key: 'total_ms', value: fmtMs(r.total_ms) },
      { key: 'proxy_name', value: r.proxy_name || '-' },
      { key: 'use_direct', value: r.use_direct ? 'true' : 'false' },
      { key: 'impersonate', value: r.impersonate || '-' },
    ]);

    const diagAlert = uiAlert({
      tone: r.ok ? 'ok' : 'err',
      role: r.ok ? 'status' : 'alert',
      message: el('div', {}, el('strong', {}, 'diagnostic: '), r.diagnostic || '-'),
    });

    const respBlock = r.response_text
      ? el(
          'div',
          { class: 'chat-block' },
          el('div', { class: 'chat-block__meta' }, 'response_text'),
          el('div', { class: 'mono text-prewrap' }, r.response_text),
        )
      : null;

    const snipDetails = uiDetails({
      summary: 'upstream_snip',
      children: [uiCodeBlock({ code: r.upstream_snip || '-', ariaLabel: 'upstream_snip' })],
    });

    probeResultWrap.append(metaGrid, diagAlert);
    if (respBlock) probeResultWrap.append(respBlock);
    probeResultWrap.append(snipDetails);
  }

  async function loadUsage(): Promise<void> {
    try {
      const data = await apiFetch<UsageListResponse>('usage');
      usageItems = Array.isArray(data?.items) ? data.items : [];
      renderUsageSlots();
    } catch (err: unknown) {
      if (!isApiError(err) || err.status !== 401) toast(errMessage(err), 'err');
    }
  }

  async function loadProxies(): Promise<void> {
    try {
      const data = await apiFetch<ProxiesListResponse>('proxies');
      proxiesList = Array.isArray(data?.items) ? data.items : [];
      updateSummaryCounts();
      syncProbeSelectOptions();
      renderProxiesTable();
    } catch (err: unknown) {
      if (!isApiError(err) || err.status !== 401) toast(errMessage(err), 'err');
    }
  }

  async function refreshAll(opts: ViewRefreshOptions = {}): Promise<void> {
    renderLabels();
    await Promise.all([loadUsage(), loadProxies()]);
    if (probeResult) renderProbeResult();
    if (opts.focusProbe) {
      probePanel.root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      probeTargetSelect.focus();
    }
  }

  function openEditDialog(row: ProxyItem): void {
    editingProxyId = row.id;
    setAlert(editErrorBox, '');
    editNameInput.value = row.name || '';
    editUrlInput.value = row.url || '';
    editWeightInput.value = String(Math.max(1, Number(row.weight || 1)));
    editEnabledSwitch.checked = Boolean(row.enabled);
    renderLabels();
    editModal.dialog.showModal();
    editNameInput.focus();
  }

  async function submitAddProxy(): Promise<void> {
    const name = addNameInput.value.trim();
    const url = addUrlInput.value.trim();
    const weight = Math.max(1, Number(addWeightInput.value || 1));
    if (!name || !url) {
      toast(bi('名称和 URL 不能为空', 'Name and URL are required'), 'err');
      return;
    }
    addSubmitBtn.disabled = true;
    try {
      const res = await apiFetch<ProxyCreateResponse>('proxies', {
        method: 'POST',
        body: { name, url, weight },
      });
      addNameInput.value = '';
      addUrlInput.value = '';
      addWeightInput.value = '1';
      toast(bi(`已添加代理 #${res.id}`, `Added proxy #${res.id}`), 'ok');
      await refreshAll();
    } catch (err: unknown) {
      if (!isApiError(err) || err.status !== 401) toast(errMessage(err), 'err');
    } finally {
      addSubmitBtn.disabled = false;
    }
  }

  async function toggleProxy(row: ProxyItem): Promise<void> {
    try {
      const res = await apiFetch<ProxyToggleResponse>(`proxies/${row.id}/toggle`, { method: 'POST' });
      const stateText = res.enabled ? t('common.enabled') : t('common.disabled');
      toast(`${row.name}: ${stateText}`, 'ok');
      await refreshAll();
    } catch (err: unknown) {
      if (!isApiError(err) || err.status !== 401) toast(errMessage(err), 'err');
    }
  }

  async function resetProxyFails(row: ProxyItem): Promise<void> {
    try {
      await apiFetch(`proxies/${row.id}/reset`, { method: 'POST' });
      toast(bi(`已重置 ${row.name} 失败计数`, `Reset failures for ${row.name}`), 'ok');
      await refreshAll();
    } catch (err: unknown) {
      if (!isApiError(err) || err.status !== 401) toast(errMessage(err), 'err');
    }
  }

  async function deleteProxy(row: ProxyItem): Promise<void> {
    const confirmed = await confirmDialog({
      title: bi('删除代理节点', 'Delete Proxy'),
      message: bi(`确认删除代理「${row.name}」(#${row.id})？`, `Delete proxy "${row.name}" (#${row.id})?`),
      confirmText: t('common.delete'),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await apiFetch(`proxies/${row.id}`, { method: 'DELETE' });
      toast(bi(`已删除代理 ${row.name}`, `Deleted proxy ${row.name}`), 'ok');
      await refreshAll();
    } catch (err: unknown) {
      if (!isApiError(err) || err.status !== 401) toast(errMessage(err), 'err');
    }
  }

  async function runProbe(): Promise<void> {
    probing = true;
    probeRunBtn.disabled = true;
    renderLabels();
    renderProbeResult();
    try {
      const params = new URLSearchParams();
      if (probeTargetSelect.value !== '') {
        params.set('proxy_id', probeTargetSelect.value);
      }
      const promptVal = probePromptInput.value.trim() || 'Reply with one short word.';
      params.set('prompt', promptVal);
      probeResult = await apiFetch<ProbeResult>(`test?${params.toString()}`);
      renderProbeResult();
      toast(
        probeResult.ok
          ? bi(`探针通过 (${fmtMs(probeResult.total_ms)})`, `Probe OK (${fmtMs(probeResult.total_ms)})`)
          : bi(`探针异常: ${probeResult.status || 'fail'}`, `Probe failed: ${probeResult.status || 'fail'}`),
        probeResult.ok ? 'ok' : 'err',
      );
    } catch (err: unknown) {
      if (!isApiError(err) || err.status !== 401) toast(errMessage(err), 'err');
    } finally {
      probing = false;
      probeRunBtn.disabled = false;
      renderLabels();
      if (!probeResult) renderProbeResult();
    }
  }

  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editingProxyId) return;
    const name = editNameInput.value.trim();
    const url = editUrlInput.value.trim();
    const weight = Math.max(1, Number(editWeightInput.value || 1));
    if (!name || !url) {
      setAlert(editErrorBox, bi('名称和 URL 不能为空', 'Name and URL are required'));
      return;
    }
    if (!/^(https?|socks5h?):\/\//i.test(url)) {
      setAlert(
        editErrorBox,
        bi(
          '代理 URL 必须以 http:// / https:// / socks5:// / socks5h:// 开头',
          'Proxy URL must start with http://, https://, socks5://, or socks5h://',
        ),
      );
      return;
    }
    editSubmitBtn.disabled = true;
    try {
      await apiFetch(`proxies/${editingProxyId}`, {
        method: 'PATCH',
        body: {
          name,
          url,
          weight,
          enabled: Boolean(editEnabledSwitch.checked),
        },
      });
      editModal.dialog.close();
      toast(bi(`已更新代理 #${editingProxyId}`, `Updated proxy #${editingProxyId}`), 'ok');
      await refreshAll();
    } catch (err: unknown) {
      if (!isApiError(err) || err.status !== 401) {
        setAlert(editErrorBox, errMessage(err));
      }
    } finally {
      editSubmitBtn.disabled = false;
    }
  });

  renderLabels();
  syncProbeSelectOptions();
  renderProbeResult();
  void refreshAll();

  return {
    refresh: refreshAll,
  };
}
