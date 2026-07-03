import { escapeHtml, relTime, t } from './ui.js';
import { renderAddBotsResultSummary, renderBotCheckboxes } from './groups.js';

type IssueStatus = 'draft' | 'pending' | 'in_progress' | 'done' | 'archived';
type IssuePriority = 'P0' | 'P1' | 'P2' | 'P3';
type IssueMode = 'lead' | 'all';
type IssueColumn = 'in_progress' | 'backlog';
type IssueGroupBy = 'status' | 'priority';
type IssuePatch = Partial<Pick<DashboardIssue, 'status' | 'priority' | 'prompt' | 'larkAppIds' | 'groupName'>>;

const ISSUE_STATUSES: IssueStatus[] = ['draft', 'pending', 'in_progress', 'done', 'archived'];
const ISSUE_PRIORITIES: IssuePriority[] = ['P0', 'P1', 'P2', 'P3'];

interface DashboardIssue {
  id: string;
  title: string;
  prompt: string;
  larkAppIds: string[];
  mode: IssueMode;
  column: IssueColumn;
  leadLarkAppId?: string;
  groupName?: string;
  bindWorkingDir?: string;
  status: IssueStatus;
  priority: IssuePriority;
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

interface IssueGroupBot {
  larkAppId: string;
  botName?: string;
  inChat?: boolean;
  error?: string;
  oncallChat?: { workingDir?: string } | null;
}

interface IssueGroupChat {
  chatId: string;
  name?: string;
  ownerId?: string | null;
  memberBots?: IssueGroupBot[];
}

let issues: DashboardIssue[] = [];
let bots: PickerBot[] = [];
let groupChats: IssueGroupChat[] = [];

function statusLabel(status: string): string {
  const key = `issues.status.${status}`;
  const label = t(key);
  return label === key ? status : label;
}

function priorityLabel(priority: string): string {
  const key = `issues.priority.${priority}`;
  const label = t(key);
  return label === key ? priority : label;
}

function columnLabel(column: IssueColumn): string {
  return column === 'backlog' ? t('issues.column.backlog') : t('issues.column.inProgress');
}

function modeLabel(mode: IssueMode): string {
  return mode === 'all' ? t('issues.mode.all') : t('issues.mode.lead');
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

function statusOptions(current: IssueStatus): string {
  return ISSUE_STATUSES.map(status => optionHtml(status, statusLabel(status), status === current)).join('');
}

function priorityOptions(current: IssuePriority): string {
  return ISSUE_PRIORITIES.map(priority => optionHtml(priority, priorityLabel(priority), priority === current)).join('');
}

async function loadIssues(): Promise<void> {
  const r = await fetch('/api/issues');
  const body = await r.json().catch(() => ({}));
  issues = Array.isArray(body?.issues) ? body.issues : [];
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

function groupChatFromMatrix(issue: DashboardIssue): IssueGroupChat | null {
  return issue.chatId ? groupChats.find(chat => chat.chatId === issue.chatId) ?? null : null;
}

function groupChatForIssue(issue: DashboardIssue): IssueGroupChat | null {
  if (!issue.chatId) return null;
  const found = groupChatFromMatrix(issue);
  if (found) return found;
  const expected = new Set([...(issue.spawned ?? []), ...issue.larkAppIds]);
  return {
    chatId: issue.chatId,
    name: issue.groupName || issue.title || issue.chatId,
    ownerId: null,
    memberBots: bots.map(bot => ({
      ...bot,
      inChat: expected.has(bot.larkAppId),
      oncallChat: null,
    })),
  };
}

function groupOpenUrl(issue: DashboardIssue): string | null {
  if (issue.shareLink) return issue.shareLink;
  return issue.chatId ? `https://applink.feishu.cn/client/chat/open?openChatId=${encodeURIComponent(issue.chatId)}` : null;
}

function groupDisplayName(issue: DashboardIssue, chat: IssueGroupChat | null): string {
  return chat?.name || issue.groupName || issue.title || issue.chatId || '';
}

function inChatBots(chat: IssueGroupChat | null): IssueGroupBot[] {
  return (chat?.memberBots ?? []).filter(bot => bot?.inChat);
}

function associatedBotIds(issue: DashboardIssue): string[] {
  if (!issue.chatId) return issue.larkAppIds;
  const ids = inChatBots(groupChatForIssue(issue)).map(bot => bot.larkAppId);
  return ids.length ? ids : issue.larkAppIds;
}

function groupTruthBotIds(issue: DashboardIssue): string[] {
  return inChatBots(groupChatFromMatrix(issue)).map(bot => bot.larkAppId);
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function groupOncallCount(chat: IssueGroupChat | null): number {
  return inChatBots(chat).filter(bot => !!bot.oncallChat).length;
}

function botChips(ids: string[]): string {
  return ids.map(id => `<span class="issue-chip">${escapeHtml(botName(id))}</span>`).join('');
}

function issueGroupCard(issue: DashboardIssue): string {
  const chat = groupChatForIssue(issue);
  if (!issue.chatId || !chat) return '';
  const synced = !!groupChatFromMatrix(issue);
  const members = inChatBots(chat);
  const openUrl = groupOpenUrl(issue);
  const memberChips = members.slice(0, 4).map(bot => `<span class="issue-chip">${escapeHtml(bot.botName ?? bot.larkAppId)}</span>`).join('');
  const more = members.length > 4 ? `<span class="issue-chip">+${escapeHtml(String(members.length - 4))}</span>` : '';
  return `<section class="issue-group-card">
    <div class="issue-group-card-head">
      <span>${escapeHtml(t('issues.group.title'))}</span>
      <code>${escapeHtml(groupDisplayName(issue, chat))}</code>
    </div>
    <div class="issue-group-members">
      ${memberChips || `<span class="muted">${escapeHtml(t('issues.group.notSynced'))}</span>`}
      ${more}
    </div>
    <div class="issue-group-card-meta">
      <span>${escapeHtml(t('issues.group.memberCount', { count: members.length }))}</span>
      <span>${escapeHtml(t('issues.group.oncallCount', { count: groupOncallCount(chat) }))}</span>
      <span>${escapeHtml(t(synced ? 'issues.group.linked' : 'issues.group.syncPending'))}</span>
    </div>
    <div class="issue-group-actions">
      ${openUrl ? `<a class="issue-chat-link" href="${escapeHtml(openUrl)}" target="_blank" rel="noopener">${escapeHtml(t('issues.openChat'))}</a>` : ''}
      <button type="button" data-action="group-manage">${escapeHtml(t('groups.manage'))}</button>
    </div>
  </section>`;
}

function issueGroupManagementHtml(issue: DashboardIssue): string {
  const chat = groupChatForIssue(issue);
  if (!issue.chatId || !chat) return '';
  const members = inChatBots(chat);
  const inChatSet = new Set(members.map(bot => bot.larkAppId));
  const missing = bots.filter(bot => !inChatSet.has(bot.larkAppId));
  const ownerAppId = typeof chat.ownerId === 'string' ? chat.ownerId : '';
  const openUrl = groupOpenUrl(issue);
  const title = groupDisplayName(issue, chat);
  return `<section class="issue-group-management" data-chat-id="${escapeHtml(issue.chatId)}">
    <header>
      <div>
        <h4>${escapeHtml(t('groups.manageTitle', { name: title }))}</h4>
        <p><b>chatId:</b> <code>${escapeHtml(issue.chatId)}</code></p>
        <p><b>${escapeHtml(t('groups.owner'))}:</b> <code>${escapeHtml(chat.ownerId ?? t('common.unknown'))}</code></p>
      </div>
      ${openUrl ? `<a class="btn-link primary" href="${escapeHtml(openUrl)}" target="_blank" rel="noopener">${escapeHtml(t('issues.openChat'))}</a>` : ''}
    </header>

    <fieldset>
      <legend>${escapeHtml(t('issues.group.addBots'))}</legend>
      ${missing.length
        ? `${renderBotCheckboxes(bots, inChatSet)}
          <button type="button" data-action="group-add-selected">${escapeHtml(t('issues.group.addSelected'))}</button>`
        : `<p class="empty">${escapeHtml(t('issues.group.noMissing'))}</p>`}
    </fieldset>

    <fieldset>
      <legend>${escapeHtml(t('groups.oncall'))}</legend>
      <p><small>${escapeHtml(t('groups.oncallHelp'))}</small></p>
      ${members.length === 0
        ? `<p class="empty">${escapeHtml(t('issues.group.noMembers'))}</p>`
        : members.map(bot => {
          const enabled = !!bot.oncallChat;
          const workingDir = bot.oncallChat?.workingDir ?? '';
          return `<div class="oncall-row issue-group-oncall-row" data-bot="${escapeHtml(bot.larkAppId)}">
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
        ? `<p class="empty">${escapeHtml(t('issues.group.noMembers'))}</p>`
        : members.map(bot => `<label class="checkbox-row">
          <input type="checkbox" name="group-leave-bot" value="${escapeHtml(bot.larkAppId)}">
          ${escapeHtml(bot.botName ?? bot.larkAppId)}
          <small>${bot.larkAppId === ownerAppId ? '· 群主' : ''}</small>
        </label>`).join('')}
    </fieldset>

    <div class="actions issue-group-danger-actions">
      <button type="button" data-action="group-leave-selected" ${members.length === 0 ? 'disabled' : ''}>${escapeHtml(t('groups.leaveSelected'))}</button>
      <button type="button" data-action="group-disband" class="contrast" ${members.length === 0 ? 'disabled' : ''}>${escapeHtml(t('groups.disband'))}</button>
    </div>
    <p class="hint-warn"><small>${escapeHtml(t('groups.dangerHint'))}</small></p>
    <div class="issue-group-status" data-group-status aria-live="polite"></div>
  </section>`;
}

function filtered(form: HTMLFormElement): DashboardIssue[] {
  const fd = new FormData(form);
  const q = String(fd.get('q') ?? '').trim().toLowerCase();
  const status = String(fd.get('status') ?? '');
  const priority = String(fd.get('priority') ?? '');
  return issues.filter(issue => {
    if (status && issue.status !== status) return false;
    if (priority && issue.priority !== priority) return false;
    if (!q) return true;
    const hay = [
      issue.title,
      issue.prompt,
      issue.chatId ?? '',
      associatedBotIds(issue).map(botName).join(' '),
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function issueCard(issue: DashboardIssue): string {
  const started = issue.status === 'in_progress' && !!issue.chatId;
  const failedCount = issue.failed?.length ?? 0;
  const spawnedCount = issue.spawned?.length ?? 0;
  const associatedIds = associatedBotIds(issue);
  return `<article class="issue-card" data-id="${escapeHtml(issue.id)}">
    <header>
      <div>
        <span class="issue-status issue-status-${escapeHtml(issue.status)}">${escapeHtml(statusLabel(issue.status))}</span>
        <span class="issue-priority issue-priority-${escapeHtml(issue.priority)}">${escapeHtml(priorityLabel(issue.priority))}</span>
        <h2>${escapeHtml(issue.title)}</h2>
      </div>
      <div class="issue-card-actions">
        <button type="button" data-action="start" ${started ? 'disabled' : ''}>${escapeHtml(t(started ? 'issues.started' : 'issues.start'))}</button>
        <button type="button" data-action="edit">${escapeHtml(t('issues.edit'))}</button>
        <button type="button" data-action="archive" ${issue.status === 'archived' ? 'disabled' : ''}>${escapeHtml(t('issues.archive'))}</button>
        <button type="button" data-action="delete" class="contrast">${escapeHtml(t('issues.delete'))}</button>
      </div>
    </header>
    <div class="issue-card-controls">
      <label>
        <span>${escapeHtml(t('issues.form.status'))}</span>
        <select data-action="status">${statusOptions(issue.status)}</select>
      </label>
      <label>
        <span>${escapeHtml(t('issues.form.priority'))}</span>
        <select data-action="priority">${priorityOptions(issue.priority)}</select>
      </label>
    </div>
    <label class="issue-prompt-box">
      <span>${escapeHtml(t('issues.form.prompt'))}</span>
      <textarea data-action="prompt" rows="4" required>${escapeHtml(issue.prompt)}</textarea>
    </label>
    <div class="issue-meta">
      <span>${escapeHtml(modeLabel(issue.mode))}</span>
      <span>${escapeHtml(columnLabel(issue.column))}</span>
      <span>${escapeHtml(t('issues.updated', { time: fmtTime(issue.updatedAt) }))}</span>
      ${spawnedCount ? `<span>${escapeHtml(t('issues.spawned', { count: spawnedCount }))}</span>` : ''}
      ${failedCount ? `<span class="issue-failed">${escapeHtml(t('issues.failedCount', { count: failedCount }))}</span>` : ''}
    </div>
    <div class="issue-bots">${botChips(associatedIds) || `<span class="muted">${escapeHtml(t('issues.group.noMembers'))}</span>`}</div>
    ${issueGroupCard(issue)}
  </article>`;
}

function renderList(list: HTMLElement, form: HTMLFormElement): void {
  const rows = filtered(form);
  const fd = new FormData(form);
  const groupBy: IssueGroupBy = fd.get('groupBy') === 'priority' ? 'priority' : 'status';
  const selectedStatus = String(fd.get('status') ?? '') as IssueStatus | '';
  const selectedPriority = String(fd.get('priority') ?? '') as IssuePriority | '';
  list.classList.toggle('issue-list-grouped', rows.length > 0);
  if (rows.length === 0) {
    list.innerHTML = `<div class="empty">${escapeHtml(t('issues.empty'))}</div>`;
    return;
  }
  const groups = groupBy === 'priority'
    ? (selectedPriority ? [selectedPriority] : ISSUE_PRIORITIES)
    : (selectedStatus ? [selectedStatus] : ISSUE_STATUSES);
  const buckets = new Map<string, DashboardIssue[]>(groups.map(group => [group, []]));
  for (const issue of rows) {
    const key = groupBy === 'priority' ? issue.priority : issue.status;
    buckets.get(key)?.push(issue);
  }
  list.innerHTML = `<div class="issue-board">${groups.map(group => {
    const groupedRows = buckets.get(group) ?? [];
    const title = groupBy === 'priority' ? priorityLabel(group) : statusLabel(group);
    return `<section class="issue-column-group">
      <header>
        <h2>${escapeHtml(title)}</h2>
        <span>${escapeHtml(String(groupedRows.length))}</span>
      </header>
      <div class="issue-column-items">
        ${groupedRows.length ? groupedRows.map(issueCard).join('') : `<div class="empty">${escapeHtml(t('issues.emptyGroup'))}</div>`}
      </div>
    </section>`;
  }).join('')}</div>`;
}

function selectedBotIds(form: HTMLFormElement): string[] {
  return Array.from(form.querySelectorAll<HTMLInputElement>('input[name=bot]:checked')).map(input => input.value);
}

function issueFormHtml(issue?: DashboardIssue): string {
  const groupManaged = !!issue?.chatId;
  const picked = new Set(issue ? associatedBotIds(issue) : []);
  const mode = issue?.mode ?? 'lead';
  const column = issue?.column ?? 'in_progress';
  const priority = issue?.priority ?? 'P2';
  const formGroupName = issue
    ? groupManaged ? groupDisplayName(issue, groupChatForIssue(issue)) : issue.groupName ?? ''
    : '';
  const botRows = bots.map(bot => `
    <label class="checkbox-row issue-bot-row">
      <input type="checkbox" name="bot" value="${escapeHtml(bot.larkAppId)}"${picked.has(bot.larkAppId) ? ' checked' : ''}${groupManaged ? ' disabled' : ''}>
      <span>${escapeHtml(bot.botName)}</span>
      <small>${escapeHtml(bot.larkAppId)}</small>
    </label>`).join('');
  return `<article class="issue-editor">
    <header><h3>${escapeHtml(t(issue ? 'issues.editTitle' : 'issues.newTitle'))}</h3></header>
    <form id="issue-form">
      <label class="form-row">
        <span>${escapeHtml(t('issues.form.title'))}</span>
        <input type="text" name="title" maxlength="120" value="${escapeHtml(issue?.title ?? '')}" placeholder="${escapeHtml(t('issues.form.titlePlaceholder'))}">
      </label>
      <label class="form-row">
        <span>${escapeHtml(t('issues.form.prompt'))}</span>
        <textarea name="prompt" rows="9" required placeholder="${escapeHtml(t('issues.form.promptPlaceholder'))}">${escapeHtml(issue?.prompt ?? '')}</textarea>
      </label>
      <fieldset class="issue-bot-picker">
        <legend>${escapeHtml(t('issues.form.bots'))}</legend>
        ${groupManaged ? `<p class="issue-group-edit-note">${escapeHtml(t('issues.group.managedByGroup'))}</p>` : ''}
        ${botRows || `<p class="empty">${escapeHtml(t('issues.noBots'))}</p>`}
      </fieldset>
      <label class="form-row">
        <span>${escapeHtml(t('issues.form.priority'))}</span>
        <select name="priority">${priorityOptions(priority)}</select>
      </label>
      <fieldset>
        <legend>${escapeHtml(t('issues.form.mode'))}</legend>
        <label><input type="radio" name="mode" value="lead"${mode === 'lead' ? ' checked' : ''}> ${escapeHtml(t('issues.mode.lead'))}</label>
        <label><input type="radio" name="mode" value="all"${mode === 'all' ? ' checked' : ''}> ${escapeHtml(t('issues.mode.all'))}</label>
      </fieldset>
      <label class="form-row issue-lead-row">
        <span>${escapeHtml(t('issues.form.lead'))}</span>
        <select name="leadLarkAppId"></select>
      </label>
      <fieldset>
        <legend>${escapeHtml(t('issues.form.column'))}</legend>
        <label><input type="radio" name="column" value="in_progress"${column === 'in_progress' ? ' checked' : ''}> ${escapeHtml(t('issues.column.inProgress'))}</label>
        <label><input type="radio" name="column" value="backlog"${column === 'backlog' ? ' checked' : ''}> ${escapeHtml(t('issues.column.backlog'))}</label>
      </fieldset>
      <details class="issue-advanced">
        <summary>${escapeHtml(t('issues.form.advanced'))}</summary>
        <label class="form-row">
          <span>${escapeHtml(t('issues.form.groupName'))}</span>
          <input type="text" name="groupName" maxlength="60" value="${escapeHtml(formGroupName)}"${groupManaged ? ' readonly' : ''}>
        </label>
        <label class="form-row">
          <span>${escapeHtml(t('issues.form.workingDir'))}</span>
          <input type="text" name="bindWorkingDir" value="${escapeHtml(issue?.bindWorkingDir ?? '')}">
        </label>
      </details>
      <div class="actions issue-editor-actions">
        <button type="submit" class="primary">${escapeHtml(t(issue ? 'issues.save' : 'issues.create'))}</button>
        <button type="button" id="issue-cancel">${escapeHtml(t('issues.cancel'))}</button>
      </div>
    </form>
    ${issue ? issueGroupManagementHtml(issue) : ''}
  </article>`;
}

function wireIssueForm(
  dialog: HTMLDialogElement,
  issue: DashboardIssue | undefined,
  onSaved: () => void,
): void {
  const form = dialog.querySelector<HTMLFormElement>('#issue-form')!;
  const leadRow = dialog.querySelector<HTMLElement>('.issue-lead-row')!;
  const leadSelect = dialog.querySelector<HTMLSelectElement>('select[name=leadLarkAppId]')!;
  const mode = () => form.querySelector<HTMLInputElement>('input[name=mode]:checked')?.value ?? 'lead';

  function syncLead(): void {
    const ids = selectedBotIds(form);
    const leadNeeded = mode() === 'lead';
    leadRow.hidden = !leadNeeded;
    if (!leadNeeded) return;
    leadSelect.disabled = ids.length === 0;
    leadSelect.innerHTML = ids.length
      ? ids.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(botName(id))}</option>`).join('')
      : `<option value="">${escapeHtml(t('issues.form.pickBotFirst'))}</option>`;
    const preferred = issue?.leadLarkAppId && ids.includes(issue.leadLarkAppId) ? issue.leadLarkAppId : ids[0];
    if (preferred) leadSelect.value = preferred;
  }

  form.querySelectorAll<HTMLInputElement>('input[name=mode], input[name=bot]').forEach(input => {
    input.addEventListener('change', syncLead);
  });
  syncLead();

  dialog.querySelector<HTMLButtonElement>('#issue-cancel')!.onclick = () => dialog.close();
  form.onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(form);
    const larkAppIds = selectedBotIds(form);
    const issueMode = String(fd.get('mode') ?? 'lead') as IssueMode;
    const body = {
      title: String(fd.get('title') ?? '').trim(),
      prompt: String(fd.get('prompt') ?? '').trim(),
      larkAppIds,
      mode: issueMode,
      leadLarkAppId: issueMode === 'lead' ? String(fd.get('leadLarkAppId') ?? '') : undefined,
      column: String(fd.get('column') ?? 'in_progress') as IssueColumn,
      priority: String(fd.get('priority') ?? 'P2') as IssuePriority,
      groupName: String(fd.get('groupName') ?? '').trim(),
      bindWorkingDir: String(fd.get('bindWorkingDir') ?? '').trim(),
    };
    if (!body.prompt) { alert(t('issues.errPrompt')); return; }
    if (body.larkAppIds.length === 0) { alert(t('issues.errBot')); return; }
    if (body.mode === 'lead' && !body.leadLarkAppId) { alert(t('issues.errLead')); return; }
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type=submit]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      const r = await fetch(issue ? `/api/issues/${encodeURIComponent(issue.id)}` : '/api/issues', {
        method: issue ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resp = await r.json().catch(() => ({}));
      if (r.ok && resp?.ok) {
        dialog.close();
        onSaved();
      } else if (r.status !== 401) {
        alert(`${t('issues.saveFailed')}: ${resp?.error ?? r.status}`);
      }
    } catch (e) {
      alert(`${t('issues.saveFailed')}: ${e}`);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  };
}

function openEditor(dialog: HTMLDialogElement, issue: DashboardIssue | undefined, onSaved: () => void): void {
  dialog.innerHTML = issueFormHtml(issue);
  dialog.showModal();
  wireIssueForm(dialog, issue, onSaved);
  if (issue?.chatId) wireIssueGroupManagement(dialog, issue, onSaved);
}

async function patchIssue(id: string, patch: IssuePatch, options?: { silent?: boolean }): Promise<boolean> {
  const r = await fetch(`/api/issues/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok && r.status !== 401) {
    const body = await r.json().catch(() => ({}));
    if (!options?.silent) alert(`${t('issues.saveFailed')}: ${body?.error ?? r.status}`);
    return false;
  }
  return r.ok;
}

async function syncIssueGroupFields(issue: DashboardIssue): Promise<boolean> {
  const chat = groupChatFromMatrix(issue);
  if (!chat) return false;
  const patch: IssuePatch = {};
  const memberIds = groupTruthBotIds(issue).sort();
  const currentIds = [...issue.larkAppIds].sort();
  if (memberIds.length > 0 && !arraysEqual(memberIds, currentIds)) {
    patch.larkAppIds = memberIds;
  }
  const groupName = typeof chat.name === 'string' ? chat.name.trim() : '';
  if (groupName && groupName !== (issue.groupName ?? '')) {
    patch.groupName = groupName;
  }
  return Object.keys(patch).length > 0
    ? patchIssue(issue.id, patch, { silent: true })
    : false;
}

async function syncAllIssueGroupFields(): Promise<void> {
  const changed = await Promise.all(issues.map(issue => syncIssueGroupFields(issue)));
  if (changed.some(Boolean)) await loadIssues();
}

async function refreshIssueGroupLink(issue: DashboardIssue): Promise<void> {
  await loadBots();
  await syncIssueGroupFields(issue);
}

function setGroupStatus(panel: HTMLElement, html: string): void {
  const status = panel.querySelector<HTMLElement>('[data-group-status]');
  if (status) status.innerHTML = html;
}

function groupError(title: string, reason: unknown): string {
  return `<p class="hint-warn"><strong>${escapeHtml(title)}</strong><br><small>${escapeHtml(String(reason ?? 'unknown'))}</small></p>`;
}

function openGroupManager(dialog: HTMLDialogElement, issue: DashboardIssue, onChanged: () => void): void {
  dialog.innerHTML = `<article class="issue-editor issue-group-manager-dialog">
    ${issueGroupManagementHtml(issue)}
    <form method="dialog"><button>${escapeHtml(t('sessions.dismiss'))}</button></form>
  </article>`;
  if (!dialog.open) dialog.showModal();
  wireIssueGroupManagement(dialog, issue, onChanged);
}

function wireIssueGroupManagement(root: HTMLElement, issue: DashboardIssue, onChanged: () => void): void {
  const panel = root.querySelector<HTMLElement>('.issue-group-management');
  if (!panel || !issue.chatId) return;
  const chatId = issue.chatId;

  panel.querySelectorAll<HTMLDivElement>('.issue-group-oncall-row').forEach(row => {
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
            await refreshIssueGroupLink(issue);
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
        const row = btn.closest<HTMLElement>('.issue-group-oncall-row');
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
            await refreshIssueGroupLink(issue);
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
          await refreshIssueGroupLink(issue);
          onChanged();
        } catch (e) {
          alert('Network error: ' + e);
        } finally {
          btn.disabled = false;
        }
      })();
    } else if (action === 'group-disband') {
      void (async () => {
        const chat = groupChatForIssue(issue);
        const members = inChatBots(chat);
        const ownerAppId = typeof chat?.ownerId === 'string' ? chat.ownerId : '';
        if (members.length === 0) return;
        if (!confirm(`确定解散群聊「${groupDisplayName(issue, chat)}」？此操作不可恢复，本群所有机器人会话也会一并关闭。`)) return;
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
              await refreshIssueGroupLink(issue);
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

export function wireIssuesPage(root: HTMLElement): () => void {
  let disposed = false;
  let renderTimer: number | undefined;
  const list = root.querySelector<HTMLElement>('#issue-list')!;
  const form = root.querySelector<HTMLFormElement>('#issue-filters')!;
  const dialog = root.querySelector<HTMLDialogElement>('#issue-dialog')!;
  const createBtn = root.querySelector<HTMLButtonElement>('#issue-create')!;
  const refreshBtn = root.querySelector<HTMLButtonElement>('#issue-refresh')!;

  const reload = async (): Promise<void> => {
    await Promise.all([loadIssues(), loadBots()]);
    await syncAllIssueGroupFields();
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
    const card = btn.closest<HTMLElement>('.issue-card');
    const id = card?.dataset.id ?? '';
    const issue = issues.find(x => x.id === id);
    if (!issue) return;
    const action = btn.dataset.action;
    if (action === 'group-manage') {
      openGroupManager(dialog, issue, () => { void reload(); });
    } else if (action === 'edit') {
      openEditor(dialog, issue, () => { void reload(); });
    } else if (action === 'start') {
      btn.disabled = true;
      btn.textContent = t('issues.starting');
      void (async () => {
        try {
          const r = await fetch(`/api/issues/${encodeURIComponent(id)}/start`, { method: 'POST' });
          const body = await r.json().catch(() => ({}));
          if (!r.ok && r.status !== 401) alert(`${t('issues.startFailed')}: ${body?.error ?? r.status}`);
        } catch (e) {
          alert(`${t('issues.startFailed')}: ${e}`);
        } finally {
          await reload();
        }
      })();
    } else if (action === 'archive') {
      void (async () => {
        await patchIssue(id, { status: 'archived' });
        await reload();
      })();
    } else if (action === 'delete') {
      if (!confirm(t('issues.deleteConfirm'))) return;
      void (async () => {
        const r = await fetch(`/api/issues/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!r.ok && r.status !== 401) {
          const body = await r.json().catch(() => ({}));
          alert(`${t('issues.deleteFailed')}: ${body?.error ?? r.status}`);
        }
        await reload();
      })();
    }
  });

  list.addEventListener('change', ev => {
    const select = (ev.target as HTMLElement).closest<HTMLSelectElement>('select[data-action]');
    if (!select) return;
    const card = select.closest<HTMLElement>('.issue-card');
    const id = card?.dataset.id ?? '';
    if (!issues.some(x => x.id === id)) return;
    const action = select.dataset.action;
    const value = select.value;
    select.disabled = true;
    void (async () => {
      if (action === 'status') await patchIssue(id, { status: value as IssueStatus });
      else if (action === 'priority') await patchIssue(id, { priority: value as IssuePriority });
      await reload();
    })();
  });

  list.addEventListener('focusout', ev => {
    const textarea = (ev.target as HTMLElement).closest<HTMLTextAreaElement>('textarea[data-action=prompt]');
    if (!textarea) return;
    const card = textarea.closest<HTMLElement>('.issue-card');
    const id = card?.dataset.id ?? '';
    const issue = issues.find(x => x.id === id);
    if (!issue) return;
    const prompt = textarea.value.trim();
    if (!prompt) {
      alert(t('issues.errPrompt'));
      textarea.value = issue.prompt;
      return;
    }
    if (prompt === issue.prompt) return;
    textarea.disabled = true;
    void (async () => {
      const saved = await patchIssue(id, { prompt });
      if (saved) await reload();
      else textarea.disabled = false;
    })();
  });

  list.innerHTML = `<div class="empty">${escapeHtml(t('issues.loading'))}</div>`;
  void reload();
  return () => {
    disposed = true;
    if (renderTimer !== undefined) window.clearTimeout(renderTimer);
  };
}
