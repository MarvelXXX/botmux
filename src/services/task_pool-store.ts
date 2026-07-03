import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFileSync } from '../utils/atomic-write.js';
import { config } from '../config.js';

export type DashboardTaskPoolStatus = 'draft' | 'pending' | 'in_progress' | 'done' | 'archived';
export type DashboardTaskPoolPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type DashboardTaskPoolMode = 'lead' | 'all';
export type DashboardTaskPoolColumn = 'in_progress' | 'backlog';

export interface DashboardTaskPoolStartFailure {
  larkAppId: string;
  error: string;
}

export interface DashboardTaskPool {
  id: string;
  title: string;
  prompt: string;
  larkAppIds: string[];
  mode: DashboardTaskPoolMode;
  column: DashboardTaskPoolColumn;
  leadLarkAppId?: string;
  groupName?: string;
  bindWorkingDir?: string;
  status: DashboardTaskPoolStatus;
  priority: DashboardTaskPoolPriority;
  chatId?: string;
  shareLink?: string;
  spawned?: string[];
  failed?: DashboardTaskPoolStartFailure[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  closedAt?: string;
}

export interface DashboardTaskPoolStoreFile {
  version: 1;
  taskPools: DashboardTaskPool[];
}

export type DashboardTaskPoolCreateInput = Pick<
  DashboardTaskPool,
  'title' | 'prompt' | 'larkAppIds' | 'mode' | 'column'
> & Pick<Partial<DashboardTaskPool>, 'priority' | 'leadLarkAppId' | 'groupName' | 'bindWorkingDir'>;

export type DashboardTaskPoolUpdatePatch = Partial<Pick<
  DashboardTaskPool,
  'title' | 'prompt' | 'larkAppIds' | 'mode' | 'column' | 'priority' | 'leadLarkAppId' | 'groupName' | 'bindWorkingDir' | 'status'
>>;

interface TaskPoolStoreCacheEntry {
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  store: DashboardTaskPoolStoreFile;
}

const taskPoolStoreCache = new Map<string, TaskPoolStoreCacheEntry>();

function storePath(dataDir: string = config.session.dataDir): string {
  return join(dataDir, 'task_pool.json');
}

function emptyStore(): DashboardTaskPoolStoreFile {
  return { version: 1, taskPools: [] };
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

function normalizeFailure(value: unknown): DashboardTaskPoolStartFailure | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const larkAppId = normalizeString(row.larkAppId, 128);
  if (!larkAppId) return null;
  return {
    larkAppId,
    error: normalizeString(row.error, 500) || 'unknown',
  };
}

function normalizeStatus(value: unknown): DashboardTaskPoolStatus {
  if (value === 'draft' || value === 'pending' || value === 'in_progress' || value === 'done' || value === 'archived') {
    return value;
  }
  if (value === 'active') return 'in_progress';
  if (value === 'closed') return 'done';
  if (value === 'failed') return 'pending';
  return 'draft';
}

function normalizePriority(value: unknown): DashboardTaskPoolPriority {
  return value === 'P0' || value === 'P1' || value === 'P2' || value === 'P3' ? value : 'P2';
}

function normalizeTaskPool(raw: unknown): DashboardTaskPool | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Partial<DashboardTaskPool>;
  const id = normalizeString(r.id, 80);
  const prompt = normalizeString(r.prompt, 40_000);
  const larkAppIds = normalizeStringArray(r.larkAppIds, 128);
  if (!id || !prompt || larkAppIds.length === 0) return null;
  const title = normalizeString(r.title, 120) || defaultTaskPoolTitle(prompt);
  const mode: DashboardTaskPoolMode = r.mode === 'all' ? 'all' : 'lead';
  const column: DashboardTaskPoolColumn = r.column === 'backlog' ? 'backlog' : 'in_progress';
  const createdAt = normalizeString(r.createdAt, 64) || new Date().toISOString();
  const updatedAt = normalizeString(r.updatedAt, 64) || createdAt;
  const taskPool: DashboardTaskPool = {
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
  if (lead && larkAppIds.includes(lead)) taskPool.leadLarkAppId = lead;
  const groupName = normalizeString(r.groupName, 60);
  if (groupName) taskPool.groupName = groupName;
  const bindWorkingDir = normalizeString(r.bindWorkingDir, 500);
  if (bindWorkingDir) taskPool.bindWorkingDir = bindWorkingDir;
  const chatId = normalizeString(r.chatId, 128);
  if (chatId) taskPool.chatId = chatId;
  const shareLink = normalizeString(r.shareLink, 1000);
  if (shareLink) taskPool.shareLink = shareLink;
  const spawned = normalizeStringArray(r.spawned, 128);
  if (spawned.length > 0) taskPool.spawned = spawned;
  const failed = Array.isArray(r.failed)
    ? r.failed.map(normalizeFailure).filter((x): x is DashboardTaskPoolStartFailure => !!x)
    : [];
  if (failed.length > 0) taskPool.failed = failed;
  const startedAt = normalizeString(r.startedAt, 64);
  if (startedAt) taskPool.startedAt = startedAt;
  const closedAt = normalizeString(r.closedAt, 64);
  if (closedAt) taskPool.closedAt = closedAt;
  return taskPool;
}

function normalizeStore(raw: unknown): DashboardTaskPoolStoreFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyStore();
  const r = raw as Partial<DashboardTaskPoolStoreFile>;
  return {
    version: 1,
    taskPools: Array.isArray(r.taskPools)
      ? r.taskPools.map(normalizeTaskPool).filter((x): x is DashboardTaskPool => !!x)
      : [],
  };
}

function cloneTaskPool(taskPool: DashboardTaskPool): DashboardTaskPool {
  return {
    ...taskPool,
    larkAppIds: [...taskPool.larkAppIds],
    spawned: taskPool.spawned ? [...taskPool.spawned] : undefined,
    failed: taskPool.failed ? taskPool.failed.map(row => ({ ...row })) : undefined,
  };
}

function cloneStore(store: DashboardTaskPoolStoreFile): DashboardTaskPoolStoreFile {
  return {
    version: 1,
    taskPools: store.taskPools.map(cloneTaskPool),
  };
}

export function defaultTaskPoolTitle(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/u).map(s => s.trim()).find(Boolean) ?? 'Untitled task_pool';
  return firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 77)}...`;
}

function readCachedTaskPoolStore(dataDir: string = config.session.dataDir): DashboardTaskPoolStoreFile {
  const fp = storePath(dataDir);
  let st;
  try {
    st = statSync(fp);
  } catch {
    taskPoolStoreCache.delete(fp);
    return emptyStore();
  }
  const cached = taskPoolStoreCache.get(fp);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.ctimeMs === st.ctimeMs && cached.size === st.size) {
    return cached.store;
  }
  try {
    const store = normalizeStore(JSON.parse(readFileSync(fp, 'utf-8')));
    taskPoolStoreCache.set(fp, { mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, size: st.size, store });
    return store;
  } catch {
    taskPoolStoreCache.delete(fp);
    return emptyStore();
  }
}

export function readTaskPoolStore(dataDir: string = config.session.dataDir): DashboardTaskPoolStoreFile {
  return cloneStore(readCachedTaskPoolStore(dataDir));
}

function writeTaskPoolStore(dataDir: string, store: DashboardTaskPoolStoreFile): void {
  const fp = storePath(dataDir);
  const normalized = normalizeStore(store);
  mkdirSync(dirname(fp), { recursive: true });
  atomicWriteFileSync(fp, JSON.stringify(normalized, null, 2) + '\n', { mode: 0o600 });
  try {
    const st = statSync(fp);
    taskPoolStoreCache.set(fp, { mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, size: st.size, store: normalized });
  } catch {
    taskPoolStoreCache.delete(fp);
  }
}

export function listTaskPools(dataDir: string = config.session.dataDir): DashboardTaskPool[] {
  return readCachedTaskPoolStore(dataDir).taskPools
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(cloneTaskPool);
}

export function getTaskPool(id: string, dataDir: string = config.session.dataDir): DashboardTaskPool | null {
  const taskPool = readCachedTaskPoolStore(dataDir).taskPools.find(row => row.id === id);
  return taskPool ? cloneTaskPool(taskPool) : null;
}

export function createTaskPool(input: DashboardTaskPoolCreateInput, dataDir: string = config.session.dataDir): DashboardTaskPool {
  const now = new Date().toISOString();
  const prompt = input.prompt.trim();
  const taskPool: DashboardTaskPool = {
    id: `tp_${randomUUID()}`,
    title: input.title.trim() || defaultTaskPoolTitle(prompt),
    prompt,
    larkAppIds: Array.from(new Set(input.larkAppIds.map(id => id.trim()).filter(Boolean))),
    mode: input.mode,
    column: input.column,
    status: 'draft',
    priority: normalizePriority(input.priority),
    createdAt: now,
    updatedAt: now,
  };
  if (input.leadLarkAppId && taskPool.larkAppIds.includes(input.leadLarkAppId)) taskPool.leadLarkAppId = input.leadLarkAppId;
  if (input.groupName?.trim()) taskPool.groupName = input.groupName.trim().slice(0, 60);
  if (input.bindWorkingDir?.trim()) taskPool.bindWorkingDir = input.bindWorkingDir.trim();
  const store = cloneStore(readCachedTaskPoolStore(dataDir));
  store.taskPools.push(taskPool);
  writeTaskPoolStore(dataDir, store);
  return cloneTaskPool(taskPool);
}

export function updateTaskPool(
  id: string,
  patch: DashboardTaskPoolUpdatePatch,
  dataDir: string = config.session.dataDir,
): DashboardTaskPool | null {
  const store = cloneStore(readCachedTaskPoolStore(dataDir));
  const idx = store.taskPools.findIndex(taskPool => taskPool.id === id);
  if (idx < 0) return null;
  const current = store.taskPools[idx];
  const next: DashboardTaskPool = {
    ...current,
    updatedAt: new Date().toISOString(),
  };
  if (typeof patch.title === 'string') next.title = patch.title.trim().slice(0, 120) || defaultTaskPoolTitle(next.prompt);
  if (typeof patch.prompt === 'string' && patch.prompt.trim()) {
    next.prompt = patch.prompt.trim().slice(0, 40_000);
    if (!next.title.trim()) next.title = defaultTaskPoolTitle(next.prompt);
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
  store.taskPools[idx] = next;
  writeTaskPoolStore(dataDir, store);
  return cloneTaskPool(next);
}

export function recordTaskPoolStart(
  id: string,
  result: {
    chatId?: string;
    shareLink?: string;
    spawned?: string[];
    failed?: DashboardTaskPoolStartFailure[];
    status: Extract<DashboardTaskPoolStatus, 'in_progress' | 'pending'>;
  },
  dataDir: string = config.session.dataDir,
): DashboardTaskPool | null {
  const store = cloneStore(readCachedTaskPoolStore(dataDir));
  const idx = store.taskPools.findIndex(taskPool => taskPool.id === id);
  if (idx < 0) return null;
  const now = new Date().toISOString();
  const next: DashboardTaskPool = {
    ...store.taskPools[idx],
    status: result.status,
    updatedAt: now,
    startedAt: now,
  };
  if (result.chatId) next.chatId = result.chatId;
  if (result.shareLink) next.shareLink = result.shareLink;
  next.spawned = result.spawned ?? [];
  next.failed = result.failed ?? [];
  store.taskPools[idx] = next;
  writeTaskPoolStore(dataDir, store);
  return cloneTaskPool(next);
}

export function deleteTaskPool(id: string, dataDir: string = config.session.dataDir): boolean {
  const store = cloneStore(readCachedTaskPoolStore(dataDir));
  const before = store.taskPools.length;
  store.taskPools = store.taskPools.filter(taskPool => taskPool.id !== id);
  if (store.taskPools.length === before) return false;
  writeTaskPoolStore(dataDir, store);
  return true;
}
