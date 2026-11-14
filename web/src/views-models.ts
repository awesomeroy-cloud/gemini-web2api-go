// View 5: Model Registry & Hot-Reload (models.json visual table, raw JSON editor, model CRUD dialog).
// Endpoints: GET api/models, PUT api/models

import { apiFetch, errMessage, fmtTime, isApiError } from './api.ts';
import { bi, t } from './i18n.ts';
import type { ModelConfig, ModelsResponse, ViewContext, ViewController } from './types.ts';
import {
  confirmDialog,
  el,
  renderTable,
  setAlert,
  toast,
  uiAlert,
  uiBadge,
  uiButton,
  uiField,
  uiFilterBar,
  uiKeyValueGrid,
  uiModalDialog,
  uiPageHeader,
  uiSectionPanel,
  uiSwitchRow,
  uiTabs,
  wireDialogLightDismiss,
} from './ui.ts';

interface HexPreset {
  hex: string;
  label: string;
}

interface ToolOption {
  value: number;
  zh: string;
  en: string;
}

interface AspectOption {
  value: number;
  label?: string;
  zh?: string;
  en?: string;
}

interface ResolvedModelDisplay {
  raw: ModelConfig;
  effective: ModelConfig;
  brokenAlias: boolean;
}

interface ModelTableRow extends ResolvedModelDisplay {
  id: string;
}

type DialogMode = 'create' | 'edit' | 'clone';
type ModelsTabKey = 'table' | 'json';
type KindFilter = 'all' | 'primary' | 'alias';

const KNOWN_HEX_IDS: ReadonlyArray<HexPreset> = [
  { hex: 'fbb127bbb056c959', label: '3.6 Flash / Media / Tools' },
  { hex: 'cf41b0e0dd7d53e5', label: '3.5 Flash-Lite' },
  { hex: '9d8ca3786ebdfbea', label: '3.1 Pro' },
  { hex: '56fdd199312815e2', label: '3.8 Flash / 4 Hydrogen' },
  { hex: '95a4c0abcba24364', label: '4 Argon' },
];

const MODE_LABELS: Record<number, string> = {
  0: 'Auto',
  1: 'Flash',
  3: 'Pro',
  6: 'Lite',
  8: 'Argon',
};

const TOOL_OPTIONS: ReadonlyArray<ToolOption> = [
  { value: 0, zh: '0 · 对话 (Chat)', en: '0 · Chat' },
  { value: 2, zh: '2 · 画布 (Canvas)', en: '2 · Canvas' },
  { value: 11, zh: '11 · 视频 (Video / Veo)', en: '11 · Video (Veo)' },
  { value: 14, zh: '14 · 生图 (Image)', en: '14 · Image' },
  { value: 18, zh: '18 · 深度研究 (DeepResearch)', en: '18 · DeepResearch' },
  { value: 21, zh: '21 · 音乐 (Music / Lyria)', en: '21 · Music (Lyria)' },
  { value: 35, zh: '35 · 引导学习 (GuidedLearning)', en: '35 · GuidedLearning' },
];

const VIDEO_ASPECT_OPTIONS: ReadonlyArray<AspectOption> = [
  { value: 0, zh: '默认 (未指定)', en: 'Default (unset)' },
  { value: 16, label: '16 · 16:9 (Landscape)' },
  { value: 17, label: '17 · 9:16 (Portrait)' },
];

function formatModeBadge(mode: number | undefined): string {
  const n = Number(mode ?? 0);
  const name = MODE_LABELS[n];
  return name ? `${n} ${name}` : String(n);
}

function formatToolLabel(tool: number | undefined): string {
  const n = Number(tool ?? 0);
  const found = TOOL_OPTIONS.find((item) => item.value === n);
  if (found) return bi(found.zh, found.en);
  return String(n);
}

function formatVideoAspect(aspect: number | undefined): string {
  const n = Number(aspect ?? 0);
  if (n === 16) return '16 (16:9)';
  if (n === 17) return '17 (9:16)';
  return n ? String(n) : '-';
}

// Resolve effective model properties across alias_of chains for table display without mutating raw map.
function resolveEntryForDisplay(id: string, modelsMap: Record<string, ModelConfig>): ResolvedModelDisplay {
  const raw = modelsMap[id] ?? {};
  if (!raw.alias_of) return { raw, effective: raw, brokenAlias: false };

  const visited = new Set<string>([id]);
  let cur: ModelConfig = raw;
  let depth = 0;
  while (cur.alias_of && depth < 16) {
    if (visited.has(cur.alias_of)) {
      return { raw, effective: raw, brokenAlias: true };
    }
    const target = modelsMap[cur.alias_of];
    if (!target) {
      return { raw, effective: raw, brokenAlias: true };
    }
    visited.add(cur.alias_of);
    cur = target;
    depth += 1;
  }

  return {
    raw,
    effective: {
      ...cur,
      alias_of: raw.alias_of,
      desc: raw.desc || cur.desc || '',
      video_aspect: raw.video_aspect || cur.video_aspect || 0,
    },
    brokenAlias: Boolean(cur.alias_of),
  };
}

// Serialize ModelConfig keeping Go omitempty conventions clean.
function normalizeModelEntry(entry: ModelConfig): ModelConfig {
  const out: ModelConfig = {};
  if (entry.alias_of) out.alias_of = String(entry.alias_of).trim();
  if (entry.hex_id) out.hex_id = String(entry.hex_id).trim();
  const mode = Number(entry.mode ?? 0);
  if (mode > 0) out.mode = mode;
  if (entry.desc) out.desc = String(entry.desc).trim();
  if (entry.thinking) out.thinking = true;
  const thinkWire = Number(entry.think_wire ?? 0);
  if (thinkWire > 0) out.think_wire = thinkWire;
  const tool = Number(entry.tool ?? 0);
  if (tool > 0) out.tool = tool;
  if (entry.upstream) out.upstream = String(entry.upstream).trim();
  const aspect = Number(entry.video_aspect ?? 0);
  if (aspect > 0) out.video_aspect = aspect;
  return out;
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

// Client-side validation mirroring models_config.go resolveModelAliases before PUT.
function validateModelsMap(rawValue: unknown): string {
  if (!isPlainRecord(rawValue)) {
    return bi('顶层 JSON 必须是模型映射对象', 'Top-level JSON must be an object map');
  }
  const keys = Object.keys(rawValue);
  if (keys.length === 0) {
    return bi('模型映射表不能为空', 'Models map cannot be empty');
  }
  const mapObj = rawValue as Record<string, unknown>;
  for (const name of keys) {
    const mcVal = mapObj[name];
    if (!isPlainRecord(mcVal)) {
      return bi(`模型 "${name}" 必须是对象`, `Model "${name}" must be an object`);
    }
    const mc = mcVal as ModelConfig;
    if (!mc.alias_of) {
      if (!mc.hex_id || !String(mc.hex_id).trim()) {
        return bi(
          `模型 "${name}" 必须指定 hex_id 或 alias_of`,
          `Model "${name}" must specify hex_id or alias_of`,
        );
      }
      continue;
    }
    const seen = new Set<string>([name]);
    let curName: string | undefined = String(mc.alias_of);
    while (curName) {
      if (seen.has(curName)) {
        return bi(`检测到 alias_of 循环引用: ${curName}`, `alias_of cycle detected at "${curName}"`);
      }
      if (!Object.prototype.hasOwnProperty.call(mapObj, curName)) {
        return bi(
          `模型 "${name}" 的 alias_of 目标 "${curName}" 不存在`,
          `Model "${name}" references unknown alias_of target "${curName}"`,
        );
      }
      const nextTarget: unknown = mapObj[curName];
      if (!isPlainRecord(nextTarget)) {
        return bi(`模型 "${curName}" 必须是对象`, `Model "${curName}" must be an object`);
      }
      seen.add(curName);
      const nextAlias: unknown = nextTarget.alias_of;
      curName = typeof nextAlias === 'string' && nextAlias ? nextAlias : undefined;
    }
  }
  return '';
}

export function mountModels(container: HTMLElement, _ctx: ViewContext): ViewController {
  let state: {
    path: string;
    mtime: number;
    models: Record<string, ModelConfig>;
  } = {
    path: '',
    mtime: 0,
    models: {},
  };
  let activeTab: ModelsTabKey = 'table';
  let filterText = '';
  let filterKind: KindFilter = 'all';
  let dialogMode: DialogMode = 'create';
  let editingOrigId = '';
  let toggleJsonBtnRef: HTMLButtonElement | null = null;
  let tabsCtrlRef: { select: (key: string) => void } | null = null;
  let jsonDirty = false;

  container.innerHTML = '';
  const rootBody = el('div', { class: 'view-stack' });
  const dlg = buildEditDialog();
  container.append(rootBody, dlg.dialog);
  wireDialogLightDismiss(container);

  function buildEditDialog(): {
    dialog: HTMLDialogElement;
    open: (mode: DialogMode, modelId?: string) => void;
  } {
    const errorBox = uiAlert({ tone: 'err', role: 'alert', hidden: true });

    const idInput = el('input', {
      id: 'modelFieldId',
      type: 'text',
      name: 'id',
      required: true,
      placeholder: 'gemini-3.6-flash',
    });
    const aliasInput = el('input', {
      id: 'modelFieldAliasOf',
      type: 'text',
      name: 'alias_of',
      list: 'modelsAliasDatalist',
      placeholder: 'optional target model id',
    });
    const aliasDatalist = el('datalist', { id: 'modelsAliasDatalist' });

    const hexInput = el('input', {
      id: 'modelFieldHexId',
      type: 'text',
      name: 'hex_id',
      list: 'modelsHexDatalist',
      placeholder: 'fbb127bbb056c959',
    });
    const hexDatalist = el(
      'datalist',
      { id: 'modelsHexDatalist' },
      KNOWN_HEX_IDS.map((item) => el('option', { value: item.hex, label: item.label })),
    );

    const modeInput = el('input', {
      id: 'modelFieldMode',
      type: 'number',
      name: 'mode',
      min: '0',
      step: '1',
      value: '1',
    });
    const thinkWireInput = el('input', {
      id: 'modelFieldThinkWire',
      type: 'number',
      name: 'think_wire',
      min: '0',
      step: '1',
      value: '0',
    });
    const thinkingInput = el('input', {
      id: 'modelFieldThinking',
      type: 'checkbox',
      switch: true,
      name: 'thinking',
    });

    const toolSelect = el('select', { id: 'modelFieldTool', name: 'tool' });
    const aspectSelect = el('select', { id: 'modelFieldAspect', name: 'video_aspect' });
    const upstreamInput = el('input', {
      id: 'modelFieldUpstream',
      type: 'text',
      name: 'upstream',
      placeholder: '3.6 Flash',
    });
    const descInput = el('input', {
      id: 'modelFieldDesc',
      type: 'text',
      name: 'desc',
      placeholder: 'Model description',
    });

    const lblId = el('label', { for: 'modelFieldId' });
    const lblAlias = el('label', { for: 'modelFieldAliasOf' });
    const aliasHint = el('small', { class: 'field__hint' });
    const lblHex = el('label', { for: 'modelFieldHexId' });
    const lblMode = el('label', { for: 'modelFieldMode' });
    const modeHint = el('small', { class: 'field__hint' });
    const lblThinkWire = el('label', { for: 'modelFieldThinkWire' });
    const thinkWireHint = el('small', { class: 'field__hint' });
    const thinkingTitle = el('span', { class: 'switch-row__title' });
    const thinkingDesc = el('span', { class: 'switch-row__desc' });
    const lblTool = el('label', { for: 'modelFieldTool' });
    const lblAspect = el('label', { for: 'modelFieldAspect' });
    const lblUpstream = el('label', { for: 'modelFieldUpstream' });
    const lblDesc = el('label', { for: 'modelFieldDesc' });

    const cancelBtn = uiButton({
      i18n: 'common.cancel',
      onClick: () => modal.dialog.close(),
    });
    const saveBtn = uiButton({
      type: 'submit',
      variant: 'primary',
      i18n: 'common.save',
    });

    const form = el(
      'form',
      { id: 'modelEditForm', novalidate: true },
      el(
        'div',
        { class: 'dialog__body' },
        errorBox,
        el(
          'div',
          { class: 'form-grid' },
          uiField({ labelEl: lblId, control: idInput }),
          uiField({ labelEl: lblAlias, control: aliasInput, extra: aliasDatalist, hint: aliasHint }),
          uiField({ labelEl: lblHex, control: hexInput, extra: hexDatalist }),
          uiField({ labelEl: lblMode, control: modeInput, hint: modeHint }),
          uiField({ labelEl: lblTool, control: toolSelect }),
          uiField({ labelEl: lblAspect, control: aspectSelect }),
          uiField({ labelEl: lblThinkWire, control: thinkWireInput, hint: thinkWireHint }),
          uiField({ labelEl: lblUpstream, control: upstreamInput }),
        ),
        uiSwitchRow({
          id: 'modelFieldThinking',
          name: 'thinking',
          title: thinkingTitle,
          desc: thinkingDesc,
          inputEl: thinkingInput,
        }),
        uiField({ labelEl: lblDesc, control: descInput }),
      ),
      el('div', { class: 'dialog__foot' }, cancelBtn, saveBtn),
    );

    const modal = uiModalDialog({
      id: 'modelEditDialog',
      titleId: 'modelEditTitle',
      closedby: 'any',
      content: [form],
    });

    function refreshDialogLabels(): void {
      modal.closeTopBtn.textContent = t('common.close');
      modal.closeTopBtn.setAttribute('aria-label', t('common.close'));
      cancelBtn.textContent = t('common.cancel');
      saveBtn.textContent = t('common.save');
      lblId.textContent = bi('模型 ID (id)', 'Model ID (id)');
      lblAlias.textContent = bi('别名指向 (alias_of)', 'Alias Target (alias_of)');
      aliasHint.textContent = bi('留空表示主模型；填目标 ID 则继承其配置', 'Empty = Primary; target ID = Alias');
      lblHex.textContent = bi('模型 Hex ID (hex_id)', 'Server Hex ID (hex_id)');
      lblMode.textContent = bi('模式值 (mode)', 'Mode Code (mode)');
      modeHint.textContent = '0=Auto, 1=Flash, 3=Pro, 6=Lite, 8=Argon';
      lblThinkWire.textContent = bi('思考线值 (think_wire)', 'Think Wire (think_wire)');
      thinkWireHint.textContent = bi('0=由 Thinking 开关决定(1/2)；4=Argon 中档', '0=use switch (1/2); 4=Argon Medium');
      thinkingTitle.textContent = bi('扩展思考 (thinking)', 'Extended Thinking (thinking)');
      thinkingDesc.textContent = bi('开启后请求 inner[80]=2 并透传 reasoning_content', 'Sets inner[80]=2 and streams reasoning_content');
      lblTool.textContent = bi('工具通道 (tool)', 'Tool Channel (tool)');
      lblAspect.textContent = bi('视频画幅 (video_aspect)', 'Video Aspect (video_aspect)');
      lblUpstream.textContent = bi('上游自报名称 (upstream)', 'Upstream Display Name (upstream)');
      lblDesc.textContent = bi('说明 (desc)', 'Description (desc)');

      const prevTool = toolSelect.value;
      toolSelect.innerHTML = '';
      for (const opt of TOOL_OPTIONS) {
        toolSelect.append(el('option', { value: String(opt.value) }, bi(opt.zh, opt.en)));
      }
      if (prevTool !== '') toolSelect.value = prevTool;

      const prevAspect = aspectSelect.value;
      aspectSelect.innerHTML = '';
      for (const opt of VIDEO_ASPECT_OPTIONS) {
        const text = opt.label ?? bi(opt.zh ?? '', opt.en ?? '');
        aspectSelect.append(el('option', { value: String(opt.value) }, text));
      }
      if (prevAspect !== '') aspectSelect.value = prevAspect;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setAlert(errorBox, '');

      const newId = idInput.value.trim();
      if (!newId) {
        setAlert(errorBox, bi('模型 ID 不能为空', 'Model ID is required'));
        idInput.focus();
        return;
      }

      const aliasOf = aliasInput.value.trim();
      const hexId = hexInput.value.trim();
      if (!aliasOf && !hexId) {
        setAlert(errorBox, bi('主模型必须填写 hex_id（或设置 alias_of 作为别名）', 'Primary model requires hex_id (or specify alias_of)'));
        hexInput.focus();
        return;
      }

      const modeNum = Number(modeInput.value || '0');
      const thinkWireNum = Number(thinkWireInput.value || '0');
      if (!Number.isInteger(modeNum) || modeNum < 0) {
        setAlert(errorBox, bi('mode 必须是非负整数', 'mode must be a non-negative integer'));
        modeInput.focus();
        return;
      }
      if (!Number.isInteger(thinkWireNum) || thinkWireNum < 0) {
        setAlert(errorBox, bi('think_wire 必须是非负整数', 'think_wire must be a non-negative integer'));
        thinkWireInput.focus();
        return;
      }

      const nextModels: Record<string, ModelConfig> = { ...state.models };
      if (dialogMode === 'edit') {
        if (newId !== editingOrigId && Object.prototype.hasOwnProperty.call(nextModels, newId)) {
          setAlert(errorBox, bi(`模型 ID "${newId}" 已存在`, `Model ID "${newId}" already exists`));
          idInput.focus();
          return;
        }
        if (newId !== editingOrigId) {
          delete nextModels[editingOrigId];
          for (const [k, mc] of Object.entries(nextModels)) {
            if (mc && mc.alias_of === editingOrigId) {
              nextModels[k] = { ...mc, alias_of: newId };
            }
          }
        }
      } else if (Object.prototype.hasOwnProperty.call(nextModels, newId)) {
        setAlert(errorBox, bi(`模型 ID "${newId}" 已存在`, `Model ID "${newId}" already exists`));
        idInput.focus();
        return;
      }

      const entry = normalizeModelEntry({
        alias_of: aliasOf,
        hex_id: hexId,
        mode: modeNum,
        thinking: thinkingInput.checked,
        think_wire: thinkWireNum,
        tool: parseInt(toolSelect.value || '0', 10),
        video_aspect: parseInt(aspectSelect.value || '0', 10),
        upstream: upstreamInput.value.trim(),
        desc: descInput.value.trim(),
      });

      nextModels[newId] = entry;
      const validationErr = validateModelsMap(nextModels);
      if (validationErr) {
        setAlert(errorBox, validationErr);
        return;
      }

      saveBtn.disabled = true;
      try {
        await saveModelsMap(nextModels);
        modal.dialog.close();
        toast(bi(`模型 ${newId} 已热更新`, `Hot-reloaded model ${newId}`), 'ok');
      } catch (err: unknown) {
        setAlert(errorBox, errMessage(err));
      } finally {
        saveBtn.disabled = false;
      }
    });

    function open(mode: DialogMode, modelId = ''): void {
      dialogMode = mode;
      editingOrigId = mode === 'edit' ? modelId : '';
      refreshDialogLabels();
      setAlert(errorBox, '');

      aliasDatalist.innerHTML = '';
      for (const k of Object.keys(state.models).sort()) {
        if (mode === 'edit' && k === modelId) continue;
        aliasDatalist.append(el('option', { value: k }));
      }

      const src: ModelConfig = modelId
        ? (state.models[modelId] ?? {})
        : { hex_id: KNOWN_HEX_IDS[0].hex, mode: 1 };
      if (mode === 'create') {
        modal.titleEl.textContent = bi('新增模型条目', 'Add Model Entry');
        idInput.value = '';
      } else if (mode === 'clone') {
        modal.titleEl.textContent = bi(`克隆模型: ${modelId}`, `Clone Model: ${modelId}`);
        idInput.value = `${modelId}-copy`;
      } else {
        modal.titleEl.textContent = bi(`编辑模型: ${modelId}`, `Edit Model: ${modelId}`);
        idInput.value = modelId;
      }

      aliasInput.value = src.alias_of ?? '';
      hexInput.value = src.hex_id ?? '';
      modeInput.value = String(src.mode ?? 0);
      thinkingInput.checked = Boolean(src.thinking);
      thinkWireInput.value = String(src.think_wire ?? 0);

      const toolVal = String(src.tool ?? 0);
      if (!Array.from(toolSelect.options).some((o) => o.value === toolVal)) {
        toolSelect.append(el('option', { value: toolVal }, toolVal));
      }
      toolSelect.value = toolVal;

      const aspectVal = String(src.video_aspect ?? 0);
      if (!Array.from(aspectSelect.options).some((o) => o.value === aspectVal)) {
        aspectSelect.append(el('option', { value: aspectVal }, aspectVal));
      }
      aspectSelect.value = aspectVal;

      upstreamInput.value = src.upstream ?? '';
      descInput.value = src.desc ?? '';

      modal.dialog.showModal();
      idInput.focus();
    }

    return { dialog: modal.dialog, open };
  }

  async function saveModelsMap(nextModels: Record<string, ModelConfig>): Promise<void> {
    const res = await apiFetch<ModelsResponse>('models', {
      method: 'PUT',
      body: { models: nextModels },
    });
    state = {
      path: res.path || state.path,
      mtime: res.mtime || state.mtime,
      models: res.models || nextModels,
    };
    jsonDirty = false;
    render();
  }

  async function handleDeleteModel(id: string): Promise<void> {
    const keys = Object.keys(state.models);
    if (keys.length <= 1) {
      toast(bi('至少需要保留一个模型条目', 'At least one model must remain'), 'warn');
      return;
    }

    const target = state.models[id] ?? {};
    const dependents = Object.entries(state.models)
      .filter(([k, mc]) => k !== id && Boolean(mc && mc.alias_of === id))
      .map(([k]) => k);

    const msg = dependents.length > 0
      ? bi(
          `确认删除模型 "${id}"？别名 [${dependents.join(', ')}] 正指向它；删除时将自动把配置内联/迁移到这些别名，避免悬空 alias_of 引用。`,
          `Delete model "${id}"? Aliases [${dependents.join(', ')}] point to it and will inherit its config directly to prevent dangling alias_of references.`,
        )
      : bi(`确认删除模型 "${id}" 并立即热更新 models.json？`, `Delete model "${id}" and hot-reload models.json?`);

    const confirmed = await confirmDialog({
      title: bi('删除模型', 'Delete Model'),
      message: msg,
      confirmText: t('common.delete'),
      danger: true,
    });
    if (!confirmed) return;

    const nextModels: Record<string, ModelConfig> = { ...state.models };
    for (const dep of dependents) {
      const depCfg = nextModels[dep] ?? {};
      nextModels[dep] = normalizeModelEntry({
        ...target,
        alias_of: target.alias_of ?? '',
        desc: depCfg.desc || target.desc || '',
        video_aspect: depCfg.video_aspect || target.video_aspect || 0,
      });
    }
    delete nextModels[id];

    try {
      await saveModelsMap(nextModels);
      toast(bi(`已删除模型 ${id}`, `Deleted model ${id}`), 'ok');
    } catch (err: unknown) {
      toast(errMessage(err), 'err');
    }
  }

  function renderTableTab(panelBody: HTMLElement): void {
    panelBody.innerHTML = '';

    const searchInput = el('input', {
      id: 'modelsFilterQuery',
      type: 'search',
      value: filterText,
      placeholder: bi('按 ID / hex_id / upstream / 描述过滤…', 'Filter by ID / hex_id / upstream / desc…'),
    });
    const kindSelect = el('select', { id: 'modelsFilterKind' });
    kindSelect.append(
      el('option', { value: 'all' }, t('common.all')),
      el('option', { value: 'primary' }, bi('主模型 (Primary)', 'Primary')),
      el('option', { value: 'alias' }, bi('别名 (Alias)', 'Alias')),
    );
    kindSelect.value = filterKind;

    const tableContainer = el('div', {});

    const updateRows = (): void => {
      const q = filterText.trim().toLowerCase();
      const entries: ModelTableRow[] = Object.keys(state.models)
        .sort()
        .map((id) => {
          const resolved = resolveEntryForDisplay(id, state.models);
          return { id, ...resolved };
        })
        .filter((row) => {
          if (filterKind === 'primary' && row.raw.alias_of) return false;
          if (filterKind === 'alias' && !row.raw.alias_of) return false;
          if (!q) return true;
          const hay = [
            row.id,
            row.raw.alias_of,
            row.effective.hex_id,
            row.effective.upstream,
            row.effective.desc,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return hay.includes(q);
        });

      renderTable<ModelTableRow>(tableContainer, {
        ariaLabel: bi('模型注册表', 'Model Registry Table'),
        caption: bi('models.json 中的模型配置列表', 'Models configured in models.json'),
        emptyText: bi('没有匹配的模型记录', 'No matching models'),
        rows: entries,
        columns: [
          {
            label: 'ID',
            rowHeader: true,
            render: (r) => el('span', { class: 'mono font-bold' }, r.id),
          },
          {
            label: bi('类型', 'Kind'),
            render: (r) => {
              if (!r.raw.alias_of) {
                return uiBadge('Primary', 'accent');
              }
              return uiBadge(`Alias → ${r.raw.alias_of}`, r.brokenAlias ? 'err' : 'warn');
            },
          },
          {
            label: 'Mode',
            render: (r) => uiBadge(formatModeBadge(r.effective.mode)),
          },
          {
            label: 'Hex ID',
            render: (r) =>
              el(
                'span',
                { class: r.raw.alias_of ? 'mono text-secondary' : 'mono' },
                r.effective.hex_id || '-',
              ),
          },
          {
            label: bi('思考档', 'Thinking'),
            render: (r) => {
              if (r.effective.think_wire && r.effective.think_wire > 0) {
                const label = r.effective.think_wire === 4 ? '4 (Medium)' : String(r.effective.think_wire);
                return uiBadge(`wire=${label}`, 'warn');
              }
              if (r.effective.thinking) {
                return uiBadge(bi('扩展思考 (2)', 'Extended (2)'), 'ok');
              }
              return el('span', { class: 'text-muted' }, 'Normal (1)');
            },
          },
          {
            label: bi('工具', 'Tool'),
            render: (r) => {
              const toolVal = Number(r.effective.tool ?? 0);
              return uiBadge(formatToolLabel(toolVal), toolVal > 0 ? 'accent' : 'default');
            },
          },
          {
            label: bi('视频画幅', 'Aspect'),
            render: (r) => el('span', { class: 'mono' }, formatVideoAspect(r.effective.video_aspect)),
          },
          {
            label: bi('上游显示名', 'Upstream'),
            render: (r) => r.effective.upstream || '-',
          },
          {
            label: bi('说明', 'Description'),
            render: (r) => el('div', { class: 'cell-trunc', title: r.effective.desc || '' }, r.effective.desc || '-'),
          },
          {
            label: bi('操作', 'Actions'),
            render: (r) =>
              el(
                'div',
                { class: 'row-actions' },
                uiButton({
                  size: 'sm',
                  text: t('common.edit'),
                  onClick: () => dlg.open('edit', r.id),
                }),
                uiButton({
                  size: 'sm',
                  text: bi('克隆', 'Clone'),
                  onClick: () => dlg.open('clone', r.id),
                }),
                uiButton({
                  size: 'sm',
                  variant: 'danger',
                  text: t('common.delete'),
                  onClick: () => { void handleDeleteModel(r.id); },
                }),
              ),
          },
        ],
      });
    };

    searchInput.addEventListener('input', () => {
      filterText = searchInput.value;
      updateRows();
    });
    kindSelect.addEventListener('change', () => {
      filterKind = (kindSelect.value as KindFilter) || 'all';
      updateRows();
    });

    const filterBar = uiFilterBar([
      uiField({
        label: bi('筛选模型', 'Filter Models'),
        forId: 'modelsFilterQuery',
        grow: true,
        control: searchInput,
      }),
      uiField({
        label: bi('条目类型', 'Entry Kind'),
        forId: 'modelsFilterKind',
        control: kindSelect,
      }),
    ]);

    panelBody.append(filterBar.root, tableContainer);
    updateRows();
  }

  function renderJsonTab(panelBody: HTMLElement): void {
    panelBody.innerHTML = '';

    const errorAlert = uiAlert({
      id: 'modelsJsonError',
      tone: 'err',
      role: 'alert',
      hidden: true,
    });
    const textarea = el('textarea', {
      class: 'code-editor',
      rows: '22',
      spellcheck: 'false',
      'aria-label': bi('models.json 原始编辑器', 'Raw models.json editor'),
    });
    textarea.value = JSON.stringify(state.models, null, 2);
    textarea.addEventListener('input', () => {
      jsonDirty = true;
    });

    const formatBtn = uiButton({
      text: bi('格式化 JSON', 'Format JSON'),
      onClick: () => {
        setAlert(errorAlert, '');
        try {
          const parsed: unknown = JSON.parse(textarea.value);
          textarea.value = JSON.stringify(parsed, null, 2);
          toast(bi('JSON 已格式化', 'JSON formatted'), 'info', 1800);
        } catch (err: unknown) {
          setAlert(errorAlert, `JSON syntax error: ${errMessage(err)}`);
        }
      },
    });

    const resetBtn = uiButton({
      text: bi('还原当前快照', 'Reset to Loaded'),
      onClick: () => {
        setAlert(errorAlert, '');
        textarea.value = JSON.stringify(state.models, null, 2);
        jsonDirty = false;
      },
    });

    const saveBtn = uiButton({
      variant: 'primary',
      text: bi('校验并热重载保存', 'Validate & Save Hot-Reload'),
      onClick: async () => {
        setAlert(errorAlert, '');
        let parsed: unknown;
        try {
          parsed = JSON.parse(textarea.value);
        } catch (err: unknown) {
          setAlert(errorAlert, `JSON parse error: ${errMessage(err)}`);
          return;
        }
        const validationErr = validateModelsMap(parsed);
        if (validationErr) {
          setAlert(errorAlert, validationErr);
          return;
        }

        saveBtn.disabled = true;
        try {
          await saveModelsMap(parsed as Record<string, ModelConfig>);
          toast(bi('models.json 已校验并原子热重载', 'Validated & hot-reloaded models.json'), 'ok');
        } catch (err: unknown) {
          setAlert(errorAlert, errMessage(err));
        } finally {
          saveBtn.disabled = false;
        }
      },
    });

    const editorPanel = uiSectionPanel({
      title: 'models.json',
      stack: true,
      actions: [formatBtn, resetBtn, saveBtn],
      body: [errorAlert, textarea],
    });

    panelBody.append(editorPanel.root);
  }

  function render(): void {
    rootBody.innerHTML = '';

    const keys = Object.keys(state.models);
    const aliasCount = keys.filter((k) => Boolean(state.models[k] && state.models[k].alias_of)).length;
    const primaryCount = keys.length - aliasCount;

    const toggleJsonBtn = uiButton({
      active: activeTab === 'json',
      text: activeTab === 'json' ? bi('返回表格视图', 'Table View') : bi('models.json 原始编辑', 'Raw models.json'),
      onClick: () => {
        const nextTab: ModelsTabKey = activeTab === 'json' ? 'table' : 'json';
        tabsCtrlRef?.select(nextTab);
      },
    });
    toggleJsonBtnRef = toggleJsonBtn;

    const header = uiPageHeader({
      titleI18n: 'models.title',
      subtitleI18n: 'models.subtitle',
      actions: [
        uiButton({
          variant: 'primary',
          text: bi('+ 新增模型', '+ Add Model'),
          onClick: () => dlg.open('create'),
        }),
        toggleJsonBtn,
        uiButton({
          i18n: 'common.refresh',
          onClick: () => { void refresh(); },
        }),
      ],
    });

    const metaStrip = uiKeyValueGrid([
      { key: bi('配置文件路径', 'Registry Path'), value: state.path || 'models.json' },
      { key: bi('最后修改时间', 'Last Modified'), value: fmtTime(state.mtime) },
      {
        key: bi('主模型 / 别名数量', 'Primary / Alias Count'),
        value: `${primaryCount} Primary / ${aliasCount} Alias (${keys.length} Total)`,
      },
    ]);

    const tabs = uiTabs({
      ariaLabel: bi('模型视图模式', 'Model Registry Modes'),
      activeTab,
      tabs: [
        {
          key: 'table',
          id: 'modelsTabTable',
          panelId: 'modelsPanelTable',
          label: bi('结构化注册表', 'Model Table'),
        },
        {
          key: 'json',
          id: 'modelsTabJson',
          panelId: 'modelsPanelJson',
          label: bi('原始 JSON 编辑器', 'Raw models.json Editor'),
        },
      ],
      onSelect: (nextKey) => {
        activeTab = nextKey === 'json' ? 'json' : 'table';
        if (toggleJsonBtnRef) {
          toggleJsonBtnRef.className = activeTab === 'json' ? 'btn btn--active' : 'btn';
          toggleJsonBtnRef.textContent = activeTab === 'json'
            ? bi('返回表格视图', 'Table View')
            : bi('models.json 原始编辑', 'Raw models.json');
        }
        if (activeTab === 'json' && !jsonDirty) {
          const ta = tabs.panelBodies.json?.querySelector('textarea');
          if (ta) ta.value = JSON.stringify(state.models, null, 2);
        }
      },
    });
    tabsCtrlRef = tabs.controller;

    renderTableTab(tabs.panelBodies.table);
    renderJsonTab(tabs.panelBodies.json);

    rootBody.append(
      header.root,
      metaStrip,
      el('div', {}, tabs.tablist, ...tabs.panelElements),
    );
    tabs.controller.select(activeTab);
  }

  async function refresh(): Promise<void> {
    try {
      const data = await apiFetch<ModelsResponse>('models');
      state = {
        path: data.path || '',
        mtime: data.mtime || 0,
        models: data.models || {},
      };
      jsonDirty = false;
      render();
    } catch (err: unknown) {
      if (isApiError(err) && err.status === 401) return;
      toast(errMessage(err), 'err');
    }
  }

  void refresh();
  return { refresh };
}
