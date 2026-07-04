import { escapeHtml, relTime, t } from './ui.js';
import { renderAddBotsResultSummary, renderBotCheckboxes } from './groups.js';

type TaskPoolStatus = 'draft' | 'pending' | 'in_progress' | 'done' | 'archived';
type TaskPoolPriority = 'P0' | 'P1' | 'P2' | 'P3';
type TaskPoolMode = 'lead' | 'all';
type TaskPoolColumn = 'in_progress' | 'backlog';
type TaskPoolGroupBy = 'status' | 'priority';
type TaskPoolPatch = Partial<Pick<DashboardTaskPool, 'status' | 'priority' | 'prompt' | 'larkAppIds' | 'groupName'>>;

const TASK_POOL_STATUSES: TaskPoolStatus[] = ['draft', 'pending', 'in_progress', 'done', 'archived'];
const TASK_POOL_PRIORITIES: TaskPoolPriority[] = ['P0', 'P1', 'P2', 'P3'];

interface DashboardTaskPool {
  id: string;
  title: string;
  prompt: string;
  larkAppIds: string[];
  mode: TaskPoolMode;
  column: TaskPoolColumn;
  leadLarkAppId?: string;
  groupName?: string;
  bindWorkingDir?: string;
  status: TaskPoolStatus;
  priority: TaskPoolPriority;
  chatId?: string;
  shareLink?: string;
  spawned?: string[];
  failed?: Array<{ larkAppId: string; error: string }>;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  closedAt?: string;
}

interface PickerBot {
  larkAppId: string;
  botName: string;
}

interface TaskPoolGroupBot {
  larkAppId: string;
  botName?: string;
  inChat?: boolean;
  error?: string;
  oncallChat?: { workingDir?: string } | null;
}

interface TaskPoolGroupChat {
  chatId: string;
  name?: string;
  ownerId?: string | null;
  memberBots?: TaskPoolGroupBot[];
}

let taskPools: DashboardTaskPool[] = [];
let bots: PickerBot[] = [];
let groupChats: TaskPoolGroupChat[] = [];

function statusLabel(status: string): string {
  const key = `task_pool.status.${status}`;
  const label = t(key);
  return label === key ? status : label;
}

function priorityLabel(priority: string): string {
  const key = `task_pool.priority.${priority}`;
  const label = t(key);
  return label === key ? priority : label;
}

function columnLabel(column: TaskPoolColumn): string {
  return column === 'backlog' ? t('task_pool.column.backlog') : t('task_pool.column.inProgress');
}

function modeLabel(mode: TaskPoolMode): string {
  return mode === 'all' ? t('task_pool.mode.all') : t('task_pool.mode.lead');
}

function botName(id: string): string {
  return bots.find(b => b.larkAppId === id)?.botName ?? id;
}

function fmtTime(value?: string): string {
  if (!value) return '-';
  const n = Date.parse(value);
  return Number.isFinite(n) ? relTime(n) : '-';
}

function optionHtml(value: string, label: string, selected: boolean): string {
  return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function statusOptions(current: TaskPoolStatus): string {
  return TASK_POOL_STATUSES.map(status => optionHtml(status, statusLabel(status), status === current)).join('');
}

function priorityOptions(current: TaskPoolPriority): string {
  return TASK_POOL_PRIORITIES.map(priority => optionHtml(priority, priorityLabel(priority), priority === current)).join('');
}

async function loadTaskPools(): Promise<void> {
  const r = await fetch('/api/task_pool');
  const body = await r.json().catch(() => ({}));
  taskPools = Array.isArray(body?.taskPools) ? body.taskPools : [];
}

async function loadBots(): Promise<void> {
  try {
    const r = await fetch('/api/groups');
    if (!r.ok) return;
    const body = await r.json().catch(() => ({}));
    const rows = Array.isArray(body?.bots) ? body.bots : [];
    groupChats = Array.isArray(body?.chats) ? body.chats : [];
    bots = rows
      .filter((b: any) => b && typeof b.larkAppId === 'string')
      .map((b: any) => ({
        larkAppId: b.larkAppId,
        botName: typeof b.botName === 'string' && b.botName ? b.botName : b.larkAppId,
      }));
  } catch {
    groupChats = [];
    bots = [];
  }
}

function groupChatFromMatrix(taskPool: DashboardTaskPool): TaskPoolGroupChat | null {
  return taskPool.chatId ? groupChats.find(chat => chat.chatId === taskPool.chatId) ?? null : null;
}

function groupChatForTaskPool(taskPool: DashboardTaskPool): TaskPoolGroupChat | null {
  if (!taskPool.chatId) return null;
  const found = groupChatFromMatrix(taskPool);
  if (found) return found;
  const expected = new Set([...(taskPool.spawned ?? []), ...taskPool.larkAppIds]);
  return {
    chatId: taskPool.chatId,
    name: taskPool.groupName || taskPool.title || taskPool.chatId,
    ownerId: null,
    memberBots: bots.map(bot => ({
      ...bot,
      inChat: expected.has(bot.larkAppId),
      oncallChat: null,
    })),
  };
}

function groupOpenUrl(taskPool: DashboardTaskPool): string | null {
  if (taskPool.shareLink) return taskPool.shareLink;
  return taskPool.chatId ? `https://applink.feishu.cn/client/chat/open?openChatId=${encodeURIComponent(taskPool.chatId)}` : null;
}

function groupDisplayName(taskPool: DashboardTaskPool, chat: TaskPoolGroupChat | null): string {
  return chat?.name || taskPool.groupName || taskPool.title || taskPool.chatId || '';
}

function inChatBots(chat: TaskPoolGroupChat | null): TaskPoolGroupBot[] {
  return (chat?.memberBots ?? []).filter(bot => bot?.inChat);
}

function associatedBotIds(taskPool: DashboardTaskPool): string[] {
  if (!taskPool.chatId) return taskPool.larkAppIds;
  const ids = inChatBots(groupChatForTaskPool(taskPool)).map(bot => bot.larkAppId);
  return ids.length ? ids : taskPool.larkAppIds;
}

function groupTruthBotIds(taskPool: DashboardTaskPool): string[] {
  return inChatBots(groupChatFromMatrix(taskPool)).map(bot => bot.larkAppId);
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function groupOncallCount(chat: TaskPoolGroupChat | null): number {
  return inChatBots(chat).filter(bot => !!bot.oncallChat).length;
}

function botChips(ids: string[]): string {
  return ids.map(id => `<span class="task_pool-chip">${escapeHtml(botName(id))}</span>`).join('');
}

function taskPoolGroupCard(taskPool: DashboardTaskPool): string {
  const chat = groupChatForTaskPool(taskPool);
  if (!taskPool.chatId || !chat) return '';
  const synced = !!groupChatFromMatrix(taskPool);
  const members = inChatBots(chat);
  const openUrl = groupOpenUrl(taskPool);
  const memberChips = members.slice(0, 4).map(bot => `<span class="task_pool-chip">${escapeHtml(bot.botName ?? bot.larkAppId)}</span>`).join('');
  const more = members.length > 4 ? `<span class="task_pool-chip">+${escapeHtml(String(members.length - 4))}</span>` : '';
  return `<section class="task_pool-group-card">
    <div class="task_pool-group-card-head">
      <span>${escapeHtml(t('task_pool.group.title'))}</span>
      <code>${escapeHtml(groupDisplayName(taskPool, chat))}</code>
    </div>
    <div class="task_pool-group-members">
      ${memberChips || `<span class="muted">${escapeHtml(t('task_pool.group.notSynced'))}</span>`}
      ${more}
    </div>
    <div class="task_pool-group-card-meta">
      <span>${escapeHtml(t('task_pool.group.memberCount', { count: members.length }))}</span>
      <span>${escapeHtml(t('task_pool.group.oncallCount', { count: groupOncallCount(chat) }))}</span>
      <span>${escapeHtml(t(synced ? 'task_pool.group.linked' : 'task_pool.group.syncPending'))}</span>
    </div>
    <div class="task_pool-group-actions">
      ${openUrl ? `<a class="task_pool-chat-link" href="${escapeHtml(openUrl)}" target="_blank" rel="noopener">${escapeHtml(t('task_pool.openChat'))}</a>` : ''}
      <button type="button" data-action="group-manage">${escapeHtml(t('groups.manage'))}</button>
    </div>
  </section>`;
}

function taskPoolGroupManagementHtml(taskPool: DashboardTaskPool): string {
  const chat = groupChatForTaskPool(taskPool);
  if (!taskPool.chatId || !chat) return '';
  const members = inChatBots(chat);
  const inChatSet = new Set(members.map(bot => bot.larkAppId));
  const missing = bots.filter(bot => !inChatSet.has(bot.larkAppId));
  const ownerAppId = typeof chat.ownerId === 'string' ? chat.ownerId : '';
  const openUrl = groupOpenUrl(taskPool);
  const title = groupDisplayName(taskPool, chat);
  return `<section class="task_pool-group-management" data-chat-id="${escapeHtml(taskPool.chatId)}">
    <header>
      <div>
        <h4>${escapeHtml(t('groups.manageTitle', { name: title }))}</h4>
        <p><b>chatId:</b> <code>${escapeHtml(taskPool.chatId)}</code></p>
        <p><b>${escapeHtml(t('groups.owner'))}:</b> <code>${escapeHtml(chat.ownerId ?? t('common.unknown'))}</code></p>
      </div>
      ${openUrl ? `<a class="btn-link primary" href="${escapeHtml(openUrl)}" target="_blank" rel="noopener">${escapeHtml(t('task_pool.openChat'))}</a>` : ''}
    </header>

    <fieldset>
      <legend>${escapeHtml(t('task_pool.group.addBots'))}</legend>
      ${missing.length
        ? `${renderBotCheckboxes(bots, inChatSet)}
          <button type="button" data-action="group-add-selected">${escapeHtml(t('task_pool.group.addSelected'))}</button>`
        : `<p class="empty">${escapeHtml(t('task_pool.group.noMissing'))}</p>`}
    </fieldset>

    <fieldset>
      <legend>${escapeHtml(t('groups.oncall'))}</legend>
      <p><small>${escapeHtml(t('groups.oncallHelp'))}</small></p>
      ${members.length === 0
        ? `<p class="empty">${escapeHtml(t('task_pool.group.noMembers'))}</p>`
        : members.map(bot => {
          const enabled = !!bot.oncallChat;
          const workingDir = bot.oncallChat?.workingDir ?? '';
          return `<div class="oncall-row task_pool-group-oncall-row" data-bot="${escapeHtml(bot.larkAppId)}">
            <label class="checkbox-row">
              <input type="checkbox" data-action="toggle" ${enabled ? 'checked' : ''}>
              <strong>${escapeHtml(bot.botName ?? bot.larkAppId)}</strong>
              <small>(${escapeHtml(bot.larkAppId)})</small>
            </label>
            <div class="oncall-row-body">
              <input type="text" data-input="workingDir" placeholder="e.g. /root/iserver/botmux"
                     value="${escapeHtml(workingDir)}" ${enabled ? '' : 'disabled'}>
              <button type="button" data-action="group-oncall-save">${escapeHtml(t('groups.save'))}</button>
              <span class="oncall-status" data-status></span>
            </div>
          </div>`;
        }).join('')}
    </fieldset>

    <fieldset>
      <legend>${escapeHtml(t('groups.leaveTitle'))}</legend>
      ${members.length === 0
        ? `<p class="empty">${escapeHtml(t('task_pool.group.noMembers'))}</p>`
        : members.map(bot => `<label class="checkbox-row">
          <input type="checkbox" name="group-leave-bot" value="${escapeHtml(bot.larkAppId)}">
          ${escapeHtml(bot.botName ?? bot.larkAppId)}
          <small>${bot.larkAppId === ownerAppId ? '· 群主' : ''}</small>
        </label>`).join('')}
    </fieldset>

    <div class="actions task_pool-group-danger-actions">
      <button type="button" data-action="group-leave-selected" ${members.length === 0 ? 'disabled' : ''}>${escapeHtml(t('groups.leaveSelected'))}</button>
      <button type="button" data-action="group-disband" class="contrast" ${members.length === 0 ? 'disabled' : ''}>${escapeHtml(t('groups.disband'))}</button>
    </div>
    <p class="hint-warn"><small>${escapeHtml(t('groups.dangerHint'))}</small></p>
    <div class="task_pool-group-status" data-group-status aria-live="polite"></div>
  </section>`;
}

function filtered(form: HTMLFormElement): DashboardTaskPool[] {
  const fd = new FormData(form);
  const q = String(fd.get('q') ?? '').trim().toLowerCase();
  const status = String(fd.get('status') ?? '');
  const priority = String(fd.get('priority') ?? '');
  return taskPools.filter(taskPool => {
    if (status && taskPool.status !== status) return false;
    if (priority && taskPool.priority !== priority) return false;
    if (!q) return true;
    const hay = [
      taskPool.title,
      taskPool.prompt,
      taskPool.chatId ?? '',
      associatedBotIds(taskPool).map(botName).join(' '),
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function taskPoolCard(taskPool: DashboardTaskPool): string {
  const started = taskPool.status === 'in_progress' && !!taskPool.chatId;
  const startInFlight = taskPool.status === 'pending' && !!taskPool.startedAt && (taskPool.failed?.length ?? 0) === 0;
  const startDisabled = started || startInFlight || taskPool.status === 'archived';
  const failedCount = taskPool.failed?.length ?? 0;
  const spawnedCount = taskPool.spawned?.length ?? 0;
  const associatedIds = associatedBotIds(taskPool);
  return `<article class="task_pool-card" data-id="${escapeHtml(taskPool.id)}">
    <header>
      <div>
        <span class="task_pool-status task_pool-status-${escapeHtml(taskPool.status)}">${escapeHtml(statusLabel(taskPool.status))}</span>
        <span class="task_pool-priority task_pool-priority-${escapeHtml(taskPool.priority)}">${escapeHtml(priorityLabel(taskPool.priority))}</span>
        <h2>${escapeHtml(taskPool.title)}</h2>
      </div>
      <div class="task_pool-card-actions">
        <button type="button" data-action="start" ${startDisabled ? 'disabled' : ''}>${escapeHtml(t(started ? 'task_pool.started' : startInFlight ? 'task_pool.starting' : 'task_pool.start'))}</button>
        <button type="button" data-action="edit">${escapeHtml(t('task_pool.edit'))}</button>
        <button type="button" data-action="archive" ${taskPool.status === 'archived' ? 'disabled' : ''}>${escapeHtml(t('task_pool.archive'))}</button>
        <button type="button" data-action="delete" class="contrast">${escapeHtml(t('task_pool.delete'))}</button>
      </div>
    </header>
    <div class="task_pool-card-controls">
      <label>
        <span>${escapeHtml(t('task_pool.form.status'))}</span>
        <select data-action="status">${statusOptions(taskPool.status)}</select>
      </label>
      <label>
        <span>${escapeHtml(t('task_pool.form.priority'))}</span>
        <select data-action="priority">${priorityOptions(taskPool.priority)}</select>
      </label>
    </div>
    <label class="task_pool-prompt-box">
      <span>${escapeHtml(t('task_pool.form.prompt'))}</span>
      <textarea data-action="prompt" rows="4" required>${escapeHtml(taskPool.prompt)}</textarea>
    </label>
    <div class="task_pool-meta">
      <span>${escapeHtml(modeLabel(taskPool.mode))}</span>
      <span>${escapeHtml(columnLabel(taskPool.column))}</span>
      <span>${escapeHtml(t('task_pool.updated', { time: fmtTime(taskPool.updatedAt) }))}</span>
      ${spawnedCount ? `<span>${escapeHtml(t('task_pool.spawned', { count: spawnedCount }))}</span>` : ''}
      ${failedCount ? `<span class="task_pool-failed">${escapeHtml(t('task_pool.failedCount', { count: failedCount }))}</span>` : ''}
    </div>
    <div class="task_pool-bots">${botChips(associatedIds) || `<span class="muted">${escapeHtml(t('task_pool.group.noMembers'))}</span>`}</div>
    ${taskPoolGroupCard(taskPool)}
  </article>`;
}

function renderList(list: HTMLElement, form: HTMLFormElement): void {
  const rows = filtered(form);
  const fd = new FormData(form);
  const groupBy: TaskPoolGroupBy = fd.get('groupBy') === 'priority' ? 'priority' : 'status';
  const selectedStatus = String(fd.get('status') ?? '') as TaskPoolStatus | '';
  const selectedPriority = String(fd.get('priority') ?? '') as TaskPoolPriority | '';
  list.classList.toggle('task_pool-list-grouped', rows.length > 0);
  if (rows.length === 0) {
    list.innerHTML = `<div class="empty">${escapeHtml(t('task_pool.empty'))}</div>`;
    return;
  }
  const groups = groupBy === 'priority'
    ? (selectedPriority ? [selectedPriority] : TASK_POOL_PRIORITIES)
    : (selectedStatus ? [selectedStatus] : TASK_POOL_STATUSES);
  const buckets = new Map<string, DashboardTaskPool[]>(groups.map(group => [group, []]));
  for (const taskPool of rows) {
    const key = groupBy === 'priority' ? taskPool.priority : taskPool.status;
    buckets.get(key)?.push(taskPool);
  }
  list.innerHTML = `<div class="task_pool-board">${groups.map(group => {
    const groupedRows = buckets.get(group) ?? [];
    const title = groupBy === 'priority' ? priorityLabel(group) : statusLabel(group);
    return `<section class="task_pool-column-group">
      <header>
        <h2>${escapeHtml(title)}</h2>
        <span>${escapeHtml(String(groupedRows.length))}</span>
      </header>
      <div class="task_pool-column-items">
        ${groupedRows.length ? groupedRows.map(taskPoolCard).join('') : `<div class="empty">${escapeHtml(t('task_pool.emptyGroup'))}</div>`}
      </div>
    </section>`;
  }).join('')}</div>`;
}

function selectedBotIds(form: HTMLFormElement): string[] {
  return Array.from(form.querySelectorAll<HTMLInputElement>('input[name=bot]:checked')).map(input => input.value);
}

function taskPoolFormHtml(taskPool?: DashboardTaskPool): string {
  const groupManaged = !!taskPool?.chatId;
  const picked = new Set(taskPool ? associatedBotIds(taskPool) : []);
  const mode = taskPool?.mode ?? 'lead';
  const column = taskPool?.column ?? 'in_progress';
  const priority = taskPool?.priority ?? 'P2';
  const formGroupName = taskPool
    ? groupManaged ? groupDisplayName(taskPool, groupChatForTaskPool(taskPool)) : taskPool.groupName ?? ''
    : '';
  const botRows = bots.map(bot => `
    <label class="checkbox-row task_pool-bot-row">
      <input type="checkbox" name="bot" value="${escapeHtml(bot.larkAppId)}"${picked.has(bot.larkAppId) ? ' checked' : ''}${groupManaged ? ' disabled' : ''}>
      <span>${escapeHtml(bot.botName)}</span>
      <small>${escapeHtml(bot.larkAppId)}</small>
    </label>`).join('');
  return `<article class="task_pool-editor">
    <header><h3>${escapeHtml(t(taskPool ? 'task_pool.editTitle' : 'task_pool.newTitle'))}</h3></header>
    <form id="task_pool-form">
      <label class="form-row">
        <span>${escapeHtml(t('task_pool.form.title'))}</span>
        <input type="text" name="title" maxlength="120" value="${escapeHtml(taskPool?.title ?? '')}" placeholder="${escapeHtml(t('task_pool.form.titlePlaceholder'))}">
      </label>
      <label class="form-row">
        <span>${escapeHtml(t('task_pool.form.prompt'))}</span>
        <textarea name="prompt" rows="9" required placeholder="${escapeHtml(t('task_pool.form.promptPlaceholder'))}">${escapeHtml(taskPool?.prompt ?? '')}</textarea>
      </label>
      <fieldset class="task_pool-bot-picker">
        <legend>${escapeHtml(t('task_pool.form.bots'))}</legend>
        ${groupManaged ? `<p class="task_pool-group-edit-note">${escapeHtml(t('task_pool.group.managedByGroup'))}</p>` : ''}
        ${botRows || `<p class="empty">${escapeHtml(t('task_pool.noBots'))}</p>`}
      </fieldset>
      <label class="form-row">
        <span>${escapeHtml(t('task_pool.form.priority'))}</span>
        <select name="priority">${priorityOptions(priority)}</select>
      </label>
      <fieldset>
        <legend>${escapeHtml(t('task_pool.form.mode'))}</legend>
        <label><input type="radio" name="mode" value="lead"${mode === 'lead' ? ' checked' : ''}> ${escapeHtml(t('task_pool.mode.lead'))}</label>
        <label><input type="radio" name="mode" value="all"${mode === 'all' ? ' checked' : ''}> ${escapeHtml(t('task_pool.mode.all'))}</label>
      </fieldset>
      <label class="form-row task_pool-lead-row">
        <span>${escapeHtml(t('task_pool.form.lead'))}</span>
        <select name="leadLarkAppId"></select>
      </label>
      <fieldset>
        <legend>${escapeHtml(t('task_pool.form.column'))}</legend>
        <label><input type="radio" name="column" value="in_progress"${column === 'in_progress' ? ' checked' : ''}> ${escapeHtml(t('task_pool.column.inProgress'))}</label>
        <label><input type="radio" name="column" value="backlog"${column === 'backlog' ? ' checked' : ''}> ${escapeHtml(t('task_pool.column.backlog'))}</label>
      </fieldset>
      <details class="task_pool-advanced">
        <summary>${escapeHtml(t('task_pool.form.advanced'))}</summary>
        <label class="form-row">
          <span>${escapeHtml(t('task_pool.form.groupName'))}</span>
          <input type="text" name="groupName" maxlength="60" value="${escapeHtml(formGroupName)}"${groupManaged ? ' readonly' : ''}>
        </label>
        <label class="form-row">
          <span>${escapeHtml(t('task_pool.form.workingDir'))}</span>
          <input type="text" name="bindWorkingDir" value="${escapeHtml(taskPool?.bindWorkingDir ?? '')}">
        </label>
      </details>
      <div class="actions task_pool-editor-actions">
        <button type="submit" class="primary">${escapeHtml(t(taskPool ? 'task_pool.save' : 'task_pool.create'))}</button>
        <button type="button" id="task_pool-cancel">${escapeHtml(t('task_pool.cancel'))}</button>
      </div>
    </form>
    ${taskPool ? taskPoolGroupManagementHtml(taskPool) : ''}
  </article>`;
}

function wireTaskPoolForm(
  dialog: HTMLDialogElement,
  taskPool: DashboardTaskPool | undefined,
  onSaved: () => void,
): void {
  const form = dialog.querySelector<HTMLFormElement>('#task_pool-form')!;
  const leadRow = dialog.querySelector<HTMLElement>('.task_pool-lead-row')!;
  const leadSelect = dialog.querySelector<HTMLSelectElement>('select[name=leadLarkAppId]')!;
  const mode = () => form.querySelector<HTMLInputElement>('input[name=mode]:checked')?.value ?? 'lead';

  function syncLead(): void {
    const selectedIds = selectedBotIds(form);
    const ids = taskPool?.chatId && taskPool.leadLarkAppId && !selectedIds.includes(taskPool.leadLarkAppId)
      ? [taskPool.leadLarkAppId, ...selectedIds]
      : selectedIds;
    const leadNeeded = mode() === 'lead';
    leadRow.hidden = !leadNeeded;
    if (!leadNeeded) return;
    leadSelect.disabled = ids.length === 0;
    leadSelect.innerHTML = ids.length
      ? ids.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(botName(id))}</option>`).join('')
      : `<option value="">${escapeHtml(t('task_pool.form.pickBotFirst'))}</option>`;
    const preferred = taskPool?.leadLarkAppId && ids.includes(taskPool.leadLarkAppId) ? taskPool.leadLarkAppId : ids[0];
    if (preferred) leadSelect.value = preferred;
  }

  form.querySelectorAll<HTMLInputElement>('input[name=mode], input[name=bot]').forEach(input => {
    input.addEventListener('change', syncLead);
  });
  syncLead();

  dialog.querySelector<HTMLButtonElement>('#task_pool-cancel')!.onclick = () => dialog.close();
  form.onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(form);
    const groupManaged = !!taskPool?.chatId;
    const larkAppIds = groupManaged ? taskPool.larkAppIds : selectedBotIds(form);
    const taskPoolMode = String(fd.get('mode') ?? 'lead') as TaskPoolMode;
    const body = {
      title: String(fd.get('title') ?? '').trim(),
      prompt: String(fd.get('prompt') ?? '').trim(),
      larkAppIds,
      mode: taskPoolMode,
      leadLarkAppId: taskPoolMode === 'lead' ? String(fd.get('leadLarkAppId') ?? '') : undefined,
      column: String(fd.get('column') ?? 'in_progress') as TaskPoolColumn,
      priority: String(fd.get('priority') ?? 'P2') as TaskPoolPriority,
      groupName: String(fd.get('groupName') ?? '').trim(),
      bindWorkingDir: String(fd.get('bindWorkingDir') ?? '').trim(),
    };
    if (!body.prompt) { alert(t('task_pool.errPrompt')); return; }
    if (body.larkAppIds.length === 0) { alert(t('task_pool.errBot')); return; }
    if (body.mode === 'lead' && !body.leadLarkAppId) { alert(t('task_pool.errLead')); return; }
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type=submit]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      const r = await fetch(taskPool ? `/api/task_pool/${encodeURIComponent(taskPool.id)}` : '/api/task_pool', {
        method: taskPool ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resp = await r.json().catch(() => ({}));
      if (r.ok && resp?.ok) {
        dialog.close();
        onSaved();
      } else if (r.status !== 401) {
        alert(`${t('task_pool.saveFailed')}: ${resp?.error ?? r.status}`);
      }
    } catch (e) {
      alert(`${t('task_pool.saveFailed')}: ${e}`);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  };
}

function openEditor(dialog: HTMLDialogElement, taskPool: DashboardTaskPool | undefined, onSaved: () => void): void {
  dialog.innerHTML = taskPoolFormHtml(taskPool);
  dialog.showModal();
  wireTaskPoolForm(dialog, taskPool, onSaved);
  if (taskPool?.chatId) wireTaskPoolGroupManagement(dialog, taskPool, onSaved);
}

async function patchTaskPool(id: string, patch: TaskPoolPatch, options?: { silent?: boolean }): Promise<boolean> {
  const r = await fetch(`/api/task_pool/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok && r.status !== 401) {
    const body = await r.json().catch(() => ({}));
    if (!options?.silent) alert(`${t('task_pool.saveFailed')}: ${body?.error ?? r.status}`);
    return false;
  }
  return r.ok;
}

async function syncTaskPoolGroupFields(taskPool: DashboardTaskPool): Promise<boolean> {
  const chat = groupChatFromMatrix(taskPool);
  if (!chat) return false;
  const patch: TaskPoolPatch = {};
  const memberIds = groupTruthBotIds(taskPool).sort();
  const currentIds = [...taskPool.larkAppIds].sort();
  if (memberIds.length > 0 && !arraysEqual(memberIds, currentIds)) {
    patch.larkAppIds = memberIds;
  }
  const groupName = typeof chat.name === 'string' ? chat.name.trim() : '';
  if (groupName && groupName !== (taskPool.groupName ?? '')) {
    patch.groupName = groupName;
  }
  return Object.keys(patch).length > 0
    ? patchTaskPool(taskPool.id, patch, { silent: true })
    : false;
}

async function syncAllTaskPoolGroupFields(): Promise<void> {
  const changed = await Promise.all(taskPools.map(taskPool => syncTaskPoolGroupFields(taskPool)));
  if (changed.some(Boolean)) await loadTaskPools();
}

async function refreshTaskPoolGroupLink(taskPool: DashboardTaskPool): Promise<void> {
  await loadBots();
  await syncTaskPoolGroupFields(taskPool);
}

function setGroupStatus(panel: HTMLElement, html: string): void {
  const status = panel.querySelector<HTMLElement>('[data-group-status]');
  if (status) status.innerHTML = html;
}

function groupError(title: string, reason: unknown): string {
  return `<p class="hint-warn"><strong>${escapeHtml(title)}</strong><br><small>${escapeHtml(String(reason ?? 'unknown'))}</small></p>`;
}

function openGroupManager(dialog: HTMLDialogElement, taskPool: DashboardTaskPool, onChanged: () => void): void {
  dialog.innerHTML = `<article class="task_pool-editor task_pool-group-manager-dialog">
    ${taskPoolGroupManagementHtml(taskPool)}
    <form method="dialog"><button>${escapeHtml(t('sessions.dismiss'))}</button></form>
  </article>`;
  if (!dialog.open) dialog.showModal();
  wireTaskPoolGroupManagement(dialog, taskPool, onChanged);
}

function wireTaskPoolGroupManagement(root: HTMLElement, taskPool: DashboardTaskPool, onChanged: () => void): void {
  const panel = root.querySelector<HTMLElement>('.task_pool-group-management');
  if (!panel || !taskPool.chatId) return;
  const chatId = taskPool.chatId;

  panel.querySelectorAll<HTMLDivElement>('.task_pool-group-oncall-row').forEach(row => {
    const cb = row.querySelector<HTMLInputElement>('input[data-action=toggle]');
    const input = row.querySelector<HTMLInputElement>('input[data-input=workingDir]');
    if (!cb || !input) return;
    cb.addEventListener('change', () => {
      input.disabled = !cb.checked;
      if (cb.checked) input.focus();
    });
  });

  panel.addEventListener('click', ev => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'group-add-selected') {
      void (async () => {
        const ids = [...panel.querySelectorAll<HTMLInputElement>('input[name=bot]:checked')].map(input => input.value);
        if (ids.length === 0) {
          setGroupStatus(panel, groupError('请选择 bot', '至少选择一个 bot 后再添加。'));
          return;
        }
        btn.disabled = true;
        setGroupStatus(panel, '');
        try {
          const r = await fetch(`/api/groups/${encodeURIComponent(chatId)}/add-bots`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ larkAppIds: ids }),
          });
          const body = await r.json().catch(() => ({}));
          if (body.error === 'no_proxy_bot') {
            setGroupStatus(panel, groupError('无法添加 bot', '当前群里没有可代理操作的 bot。请先在飞书里手动拉入一个 bot，然后重试。'));
          } else if (body.result) {
            setGroupStatus(panel, renderAddBotsResultSummary(body.result));
            await refreshTaskPoolGroupLink(taskPool);
            onChanged();
          } else {
            setGroupStatus(panel, groupError('响应异常', JSON.stringify(body)));
          }
        } catch (e) {
          setGroupStatus(panel, groupError('网络错误', e));
        } finally {
          btn.disabled = false;
        }
      })();
    } else if (action === 'group-oncall-save') {
      void (async () => {
        const row = btn.closest<HTMLElement>('.task_pool-group-oncall-row');
        const appId = row?.dataset.bot ?? '';
        const checkbox = row?.querySelector<HTMLInputElement>('input[data-action=toggle]');
        const input = row?.querySelector<HTMLInputElement>('input[data-input=workingDir]');
        const statusEl = row?.querySelector<HTMLElement>('[data-status]');
        if (!row || !appId || !checkbox || !input || !statusEl) return;
        statusEl.textContent = '';
        statusEl.className = 'oncall-status';
        const want = checkbox.checked;
        const workingDir = input.value.trim();
        if (want && !workingDir) {
          statusEl.textContent = t('groups.needWorkingDir');
          statusEl.classList.add('hint-warn-inline');
          return;
        }
        btn.disabled = true;
        try {
          const url = `/api/groups/${encodeURIComponent(chatId)}/oncall/${encodeURIComponent(appId)}`;
          const r = want
            ? await fetch(url, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ workingDir }),
            })
            : await fetch(url, { method: 'DELETE' });
          const body = await r.json().catch(() => ({}));
          if (r.ok && body.ok) {
            statusEl.textContent = want
              ? `✓ 已绑定 → ${body.resolvedPath ?? workingDir}`
              : '✓ 已解绑';
            statusEl.classList.add('hint-ok');
            await refreshTaskPoolGroupLink(taskPool);
            onChanged();
          } else {
            statusEl.textContent = `✗ ${body.error ?? r.status}`;
            statusEl.classList.add('hint-warn-inline');
          }
        } catch (e: any) {
          statusEl.textContent = `✗ ${e?.message ?? e}`;
          statusEl.classList.add('hint-warn-inline');
        } finally {
          btn.disabled = false;
        }
      })();
    } else if (action === 'group-leave-selected') {
      void (async () => {
        const checked = [...panel.querySelectorAll<HTMLInputElement>('input[name=group-leave-bot]:checked')].map(input => input.value);
        if (checked.length === 0) { alert('至少选一个机器人'); return; }
        if (!confirm(`确定让 ${checked.length} 个机器人退出群聊？该 bot 在此群的会话会一并关闭。`)) return;
        btn.disabled = true;
        try {
          const r = await fetch(`/api/groups/${encodeURIComponent(chatId)}/leave`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ larkAppIds: checked }),
          });
          const body = await r.json().catch(() => ({}));
          const lines = (body.result ?? []).map((x: any) => {
            if (!x.ok) return `${x.larkAppId}: 失败 (${x.error ?? 'unknown'})`;
            const closed = (x.closedSessions ?? []) as any[];
            const failed = closed.filter(c => !c.ok).length;
            const ok = closed.length - failed;
            const note = closed.length === 0
              ? ''
              : failed === 0 ? `（关闭 ${ok} 个会话）` : `（关闭 ${ok} 个，${failed} 个失败）`;
            return `${x.larkAppId}: OK${note}`;
          }).join('\n');
          alert(lines || `Unexpected: ${JSON.stringify(body)}`);
          await refreshTaskPoolGroupLink(taskPool);
          onChanged();
        } catch (e) {
          alert('Network error: ' + e);
        } finally {
          btn.disabled = false;
        }
      })();
    } else if (action === 'group-disband') {
      void (async () => {
        const chat = groupChatForTaskPool(taskPool);
        const members = inChatBots(chat);
        const ownerAppId = typeof chat?.ownerId === 'string' ? chat.ownerId : '';
        if (members.length === 0) return;
        if (!confirm(`确定解散群聊「${groupDisplayName(taskPool, chat)}」？此操作不可恢复，本群所有机器人会话也会一并关闭。`)) return;
        btn.disabled = true;
        const ordered = [...members].sort((a, b) =>
          (b.larkAppId === ownerAppId ? 1 : 0) - (a.larkAppId === ownerAppId ? 1 : 0)
        );
        const errs: string[] = [];
        for (const member of ordered) {
          try {
            const r = await fetch(`/api/groups/${encodeURIComponent(chatId)}/disband`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ larkAppId: member.larkAppId }),
            });
            const body = await r.json().catch(() => ({}));
            if (body.ok) {
              const closed = (body.closedSessions ?? []) as any[];
              const failed = closed.filter(c => !c.ok).length;
              const ok = closed.length - failed;
              const closedNote = closed.length === 0
                ? ''
                : failed === 0 ? `\n关闭了 ${ok} 个会话。` : `\n关闭了 ${ok} 个会话，${failed} 个会话关闭失败。`;
              alert(`已解散（由 ${member.botName ?? member.larkAppId} 执行）${closedNote}`);
              await refreshTaskPoolGroupLink(taskPool);
              onChanged();
              if (root instanceof HTMLDialogElement) root.close();
              return;
            }
            errs.push(`${member.botName ?? member.larkAppId}: ${body.error ?? r.status}`);
          } catch (e) {
            errs.push(`${member.botName ?? member.larkAppId}: ${e}`);
          }
        }
        alert(`所有在群机器人均无法解散：\n${errs.join('\n')}\n\n建议改用「退出群聊」。`);
        btn.disabled = false;
      })();
    }
  });
}

export function wireTaskPoolPage(root: HTMLElement): () => void {
  let disposed = false;
  let renderTimer: number | undefined;
  const list = root.querySelector<HTMLElement>('#task_pool-list')!;
  const form = root.querySelector<HTMLFormElement>('#task_pool-filters')!;
  const dialog = root.querySelector<HTMLDialogElement>('#task_pool-dialog')!;
  const createBtn = root.querySelector<HTMLButtonElement>('#task_pool-create')!;
  const refreshBtn = root.querySelector<HTMLButtonElement>('#task_pool-refresh')!;

  const reload = async (): Promise<void> => {
    await Promise.all([loadTaskPools(), loadBots()]);
    await syncAllTaskPoolGroupFields();
    if (!disposed) renderList(list, form);
  };
  const renderNow = (): void => {
    if (renderTimer !== undefined) {
      window.clearTimeout(renderTimer);
      renderTimer = undefined;
    }
    renderList(list, form);
  };
  const scheduleRender = (): void => {
    if (renderTimer !== undefined) window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      renderTimer = undefined;
      renderList(list, form);
    }, 120);
  };

  createBtn.onclick = () => openEditor(dialog, undefined, () => { void reload(); });
  refreshBtn.onclick = () => { void reload(); };
  form.addEventListener('input', scheduleRender);
  form.addEventListener('change', renderNow);

  list.addEventListener('click', ev => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!btn) return;
    const card = btn.closest<HTMLElement>('.task_pool-card');
    const id = card?.dataset.id ?? '';
    const taskPool = taskPools.find(x => x.id === id);
    if (!taskPool) return;
    const action = btn.dataset.action;
    if (action === 'group-manage') {
      openGroupManager(dialog, taskPool, () => { void reload(); });
    } else if (action === 'edit') {
      openEditor(dialog, taskPool, () => { void reload(); });
    } else if (action === 'start') {
      btn.disabled = true;
      btn.textContent = t('task_pool.starting');
      void (async () => {
        try {
          const r = await fetch(`/api/task_pool/${encodeURIComponent(id)}/start`, { method: 'POST' });
          const body = await r.json().catch(() => ({}));
          if (!r.ok && r.status !== 401) alert(`${t('task_pool.startFailed')}: ${body?.error ?? r.status}`);
        } catch (e) {
          alert(`${t('task_pool.startFailed')}: ${e}`);
        } finally {
          await reload();
        }
      })();
    } else if (action === 'archive') {
      void (async () => {
        await patchTaskPool(id, { status: 'archived' });
        await reload();
      })();
    } else if (action === 'delete') {
      if (!confirm(t('task_pool.deleteConfirm'))) return;
      void (async () => {
        const r = await fetch(`/api/task_pool/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!r.ok && r.status !== 401) {
          const body = await r.json().catch(() => ({}));
          alert(`${t('task_pool.deleteFailed')}: ${body?.error ?? r.status}`);
        }
        await reload();
      })();
    }
  });

  list.addEventListener('change', ev => {
    const select = (ev.target as HTMLElement).closest<HTMLSelectElement>('select[data-action]');
    if (!select) return;
    const card = select.closest<HTMLElement>('.task_pool-card');
    const id = card?.dataset.id ?? '';
    if (!taskPools.some(x => x.id === id)) return;
    const action = select.dataset.action;
    const value = select.value;
    select.disabled = true;
    void (async () => {
      if (action === 'status') await patchTaskPool(id, { status: value as TaskPoolStatus });
      else if (action === 'priority') await patchTaskPool(id, { priority: value as TaskPoolPriority });
      await reload();
    })();
  });

  list.addEventListener('focusout', ev => {
    const textarea = (ev.target as HTMLElement).closest<HTMLTextAreaElement>('textarea[data-action=prompt]');
    if (!textarea) return;
    const card = textarea.closest<HTMLElement>('.task_pool-card');
    const id = card?.dataset.id ?? '';
    const taskPool = taskPools.find(x => x.id === id);
    if (!taskPool) return;
    const prompt = textarea.value.trim();
    if (!prompt) {
      alert(t('task_pool.errPrompt'));
      textarea.value = taskPool.prompt;
      return;
    }
    if (prompt === taskPool.prompt) return;
    textarea.disabled = true;
    void (async () => {
      const saved = await patchTaskPool(id, { prompt });
      if (saved) await reload();
      else textarea.disabled = false;
    })();
  });

  list.innerHTML = `<div class="empty">${escapeHtml(t('task_pool.loading'))}</div>`;
  void reload();
  return () => {
    disposed = true;
    if (renderTimer !== undefined) window.clearTimeout(renderTimer);
  };
}
