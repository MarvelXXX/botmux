import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFileSync } from '../utils/atomic-write.js';
import { config } from '../config.js';

export type DashboardIssueStatus = 'draft' | 'pending' | 'in_progress' | 'done' | 'archived';
export type DashboardIssuePriority = 'P0' | 'P1' | 'P2' | 'P3';
export type DashboardIssueMode = 'lead' | 'all';
export type DashboardIssueColumn = 'in_progress' | 'backlog';

export interface DashboardIssueStartFailure {
  larkAppId: string;
  error: string;
}

export interface DashboardIssue {
  id: string;
  title: string;
  prompt: string;
  larkAppIds: string[];
  mode: DashboardIssueMode;
  column: DashboardIssueColumn;
  leadLarkAppId?: string;
  groupName?: string;
  bindWorkingDir?: string;
  status: DashboardIssueStatus;
  priority: DashboardIssuePriority;
  chatId?: string;
  shareLink?: string;
  spawned?: string[];
  failed?: DashboardIssueStartFailure[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  closedAt?: string;
}

export interface DashboardIssueStoreFile {
  version: 1;
  issues: DashboardIssue[];
}

export type DashboardIssueCreateInput = Pick<
  DashboardIssue,
  'title' | 'prompt' | 'larkAppIds' | 'mode' | 'column'
> & Pick<Partial<DashboardIssue>, 'priority' | 'leadLarkAppId' | 'groupName' | 'bindWorkingDir'>;

export type DashboardIssueUpdatePatch = Partial<Pick<
  DashboardIssue,
  'title' | 'prompt' | 'larkAppIds' | 'mode' | 'column' | 'priority' | 'leadLarkAppId' | 'groupName' | 'bindWorkingDir' | 'status'
>>;

function storePath(dataDir: string = config.session.dataDir): string {
  return join(dataDir, 'issues.json');
}

function emptyStore(): DashboardIssueStoreFile {
  return { version: 1, issues: [] };
}

function normalizeString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeStringArray(value: unknown, maxItem: number): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((x): x is string => typeof x === 'string')
      .map(x => x.trim().slice(0, maxItem))
      .filter(Boolean),
  ));
}

function normalizeFailure(value: unknown): DashboardIssueStartFailure | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const larkAppId = normalizeString(row.larkAppId, 128);
  if (!larkAppId) return null;
  return {
    larkAppId,
    error: normalizeString(row.error, 500) || 'unknown',
  };
}

function normalizeStatus(value: unknown): DashboardIssueStatus {
  if (value === 'draft' || value === 'pending' || value === 'in_progress' || value === 'done' || value === 'archived') {
    return value;
  }
  if (value === 'active') return 'in_progress';
  if (value === 'closed') return 'done';
  if (value === 'failed') return 'pending';
  return 'draft';
}

function normalizePriority(value: unknown): DashboardIssuePriority {
  return value === 'P0' || value === 'P1' || value === 'P2' || value === 'P3' ? value : 'P2';
}

function normalizeIssue(raw: unknown): DashboardIssue | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Partial<DashboardIssue>;
  const id = normalizeString(r.id, 80);
  const prompt = normalizeString(r.prompt, 40_000);
  const larkAppIds = normalizeStringArray(r.larkAppIds, 128);
  if (!id || !prompt || larkAppIds.length === 0) return null;
  const title = normalizeString(r.title, 120) || defaultIssueTitle(prompt);
  const mode: DashboardIssueMode = r.mode === 'all' ? 'all' : 'lead';
  const column: DashboardIssueColumn = r.column === 'backlog' ? 'backlog' : 'in_progress';
  const createdAt = normalizeString(r.createdAt, 64) || new Date().toISOString();
  const updatedAt = normalizeString(r.updatedAt, 64) || createdAt;
  const issue: DashboardIssue = {
    id,
    title,
    prompt,
    larkAppIds,
    mode,
    column,
    status: normalizeStatus(r.status),
    priority: normalizePriority(r.priority),
    createdAt,
    updatedAt,
  };
  const lead = normalizeString(r.leadLarkAppId, 128);
  if (lead && larkAppIds.includes(lead)) issue.leadLarkAppId = lead;
  const groupName = normalizeString(r.groupName, 60);
  if (groupName) issue.groupName = groupName;
  const bindWorkingDir = normalizeString(r.bindWorkingDir, 500);
  if (bindWorkingDir) issue.bindWorkingDir = bindWorkingDir;
  const chatId = normalizeString(r.chatId, 128);
  if (chatId) issue.chatId = chatId;
  const shareLink = normalizeString(r.shareLink, 1000);
  if (shareLink) issue.shareLink = shareLink;
  const spawned = normalizeStringArray(r.spawned, 128);
  if (spawned.length > 0) issue.spawned = spawned;
  const failed = Array.isArray(r.failed)
    ? r.failed.map(normalizeFailure).filter((x): x is DashboardIssueStartFailure => !!x)
    : [];
  if (failed.length > 0) issue.failed = failed;
  const startedAt = normalizeString(r.startedAt, 64);
  if (startedAt) issue.startedAt = startedAt;
  const closedAt = normalizeString(r.closedAt, 64);
  if (closedAt) issue.closedAt = closedAt;
  return issue;
}

function normalizeStore(raw: unknown): DashboardIssueStoreFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyStore();
  const r = raw as Partial<DashboardIssueStoreFile>;
  return {
    version: 1,
    issues: Array.isArray(r.issues)
      ? r.issues.map(normalizeIssue).filter((x): x is DashboardIssue => !!x)
      : [],
  };
}

export function defaultIssueTitle(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/u).map(s => s.trim()).find(Boolean) ?? 'Untitled issue';
  return firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 77)}...`;
}

export function readIssueStore(dataDir: string = config.session.dataDir): DashboardIssueStoreFile {
  const fp = storePath(dataDir);
  if (!existsSync(fp)) return emptyStore();
  try {
    return normalizeStore(JSON.parse(readFileSync(fp, 'utf-8')));
  } catch {
    return emptyStore();
  }
}

function writeIssueStore(dataDir: string, store: DashboardIssueStoreFile): void {
  const fp = storePath(dataDir);
  mkdirSync(dirname(fp), { recursive: true });
  atomicWriteFileSync(fp, JSON.stringify(normalizeStore(store), null, 2) + '\n', { mode: 0o600 });
}

export function listIssues(dataDir: string = config.session.dataDir): DashboardIssue[] {
  return readIssueStore(dataDir).issues.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getIssue(id: string, dataDir: string = config.session.dataDir): DashboardIssue | null {
  return readIssueStore(dataDir).issues.find(issue => issue.id === id) ?? null;
}

export function createIssue(input: DashboardIssueCreateInput, dataDir: string = config.session.dataDir): DashboardIssue {
  const now = new Date().toISOString();
  const prompt = input.prompt.trim();
  const issue: DashboardIssue = {
    id: `iss_${randomUUID()}`,
    title: input.title.trim() || defaultIssueTitle(prompt),
    prompt,
    larkAppIds: Array.from(new Set(input.larkAppIds.map(id => id.trim()).filter(Boolean))),
    mode: input.mode,
    column: input.column,
    status: 'draft',
    priority: normalizePriority(input.priority),
    createdAt: now,
    updatedAt: now,
  };
  if (input.leadLarkAppId && issue.larkAppIds.includes(input.leadLarkAppId)) issue.leadLarkAppId = input.leadLarkAppId;
  if (input.groupName?.trim()) issue.groupName = input.groupName.trim().slice(0, 60);
  if (input.bindWorkingDir?.trim()) issue.bindWorkingDir = input.bindWorkingDir.trim();
  const store = readIssueStore(dataDir);
  store.issues.push(issue);
  writeIssueStore(dataDir, store);
  return issue;
}

export function updateIssue(
  id: string,
  patch: DashboardIssueUpdatePatch,
  dataDir: string = config.session.dataDir,
): DashboardIssue | null {
  const store = readIssueStore(dataDir);
  const idx = store.issues.findIndex(issue => issue.id === id);
  if (idx < 0) return null;
  const current = store.issues[idx];
  const next: DashboardIssue = {
    ...current,
    updatedAt: new Date().toISOString(),
  };
  if (typeof patch.title === 'string') next.title = patch.title.trim().slice(0, 120) || defaultIssueTitle(next.prompt);
  if (typeof patch.prompt === 'string' && patch.prompt.trim()) {
    next.prompt = patch.prompt.trim().slice(0, 40_000);
    if (!next.title.trim()) next.title = defaultIssueTitle(next.prompt);
  }
  if (Array.isArray(patch.larkAppIds)) {
    next.larkAppIds = Array.from(new Set(patch.larkAppIds.map(id => String(id).trim()).filter(Boolean)));
    if (next.leadLarkAppId && !next.larkAppIds.includes(next.leadLarkAppId)) delete next.leadLarkAppId;
  }
  if (patch.mode === 'lead' || patch.mode === 'all') next.mode = patch.mode;
  if (patch.column === 'in_progress' || patch.column === 'backlog') next.column = patch.column;
  if (patch.priority === 'P0' || patch.priority === 'P1' || patch.priority === 'P2' || patch.priority === 'P3') {
    next.priority = patch.priority;
  }
  if (typeof patch.leadLarkAppId === 'string') {
    const lead = patch.leadLarkAppId.trim();
    if (lead && next.larkAppIds.includes(lead)) next.leadLarkAppId = lead;
    else delete next.leadLarkAppId;
  }
  if (typeof patch.groupName === 'string') {
    const value = patch.groupName.trim().slice(0, 60);
    if (value) next.groupName = value;
    else delete next.groupName;
  }
  if (typeof patch.bindWorkingDir === 'string') {
    const value = patch.bindWorkingDir.trim();
    if (value) next.bindWorkingDir = value;
    else delete next.bindWorkingDir;
  }
  if (
    patch.status === 'draft' ||
    patch.status === 'pending' ||
    patch.status === 'in_progress' ||
    patch.status === 'done' ||
    patch.status === 'archived'
  ) {
    next.status = patch.status;
    if (patch.status === 'done' || patch.status === 'archived') next.closedAt = next.updatedAt;
    else delete next.closedAt;
  }
  store.issues[idx] = next;
  writeIssueStore(dataDir, store);
  return next;
}

export function recordIssueStart(
  id: string,
  result: {
    chatId?: string;
    shareLink?: string;
    spawned?: string[];
    failed?: DashboardIssueStartFailure[];
    status: Extract<DashboardIssueStatus, 'in_progress' | 'pending'>;
  },
  dataDir: string = config.session.dataDir,
): DashboardIssue | null {
  const store = readIssueStore(dataDir);
  const idx = store.issues.findIndex(issue => issue.id === id);
  if (idx < 0) return null;
  const now = new Date().toISOString();
  const next: DashboardIssue = {
    ...store.issues[idx],
    status: result.status,
    updatedAt: now,
    startedAt: now,
  };
  if (result.chatId) next.chatId = result.chatId;
  if (result.shareLink) next.shareLink = result.shareLink;
  next.spawned = result.spawned ?? [];
  next.failed = result.failed ?? [];
  store.issues[idx] = next;
  writeIssueStore(dataDir, store);
  return next;
}

export function deleteIssue(id: string, dataDir: string = config.session.dataDir): boolean {
  const store = readIssueStore(dataDir);
  const before = store.issues.length;
  store.issues = store.issues.filter(issue => issue.id !== id);
  if (store.issues.length === before) return false;
  writeIssueStore(dataDir, store);
  return true;
}
