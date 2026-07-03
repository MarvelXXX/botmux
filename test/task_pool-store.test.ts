import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTaskPool,
  getTaskPool,
  listTaskPools,
  readTaskPoolStore,
  recordTaskPoolStart,
  updateTaskPool,
} from '../src/services/task_pool-store.js';

let dirs: string[] = [];

function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'botmux-task_pool-store-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('task_pool-store', () => {
  it('creates, updates, and records start results', () => {
    const dataDir = tempDataDir();
    const task_pool = createTaskPool({
      title: '',
      prompt: 'Fix dashboard task_pool\n\nDetails',
      larkAppIds: ['bot_a', 'bot_b', 'bot_a'],
      mode: 'lead',
      column: 'in_progress',
      leadLarkAppId: 'bot_a',
      groupName: 'Dashboard TaskPool',
    }, dataDir);

    expect(task_pool.title).toBe('Fix dashboard task_pool');
    expect(task_pool.status).toBe('draft');
    expect(task_pool.priority).toBe('P2');
    expect(task_pool.larkAppIds).toEqual(['bot_a', 'bot_b']);

    const updated = updateTaskPool(task_pool.id, {
      title: 'Dashboard task_pool',
      priority: 'P0',
      bindWorkingDir: '/repo/botmux',
    }, dataDir);
    expect(updated?.title).toBe('Dashboard task_pool');
    expect(updated?.priority).toBe('P0');
    expect(updated?.bindWorkingDir).toBe('/repo/botmux');

    const started = recordTaskPoolStart(task_pool.id, {
      status: 'in_progress',
      chatId: 'oc_123',
      shareLink: 'https://example.test/chat',
      spawned: ['bot_a'],
      failed: [{ larkAppId: 'bot_b', error: 'offline' }],
    }, dataDir);
    expect(started?.chatId).toBe('oc_123');
    expect(started?.spawned).toEqual(['bot_a']);
    expect(started?.failed).toEqual([{ larkAppId: 'bot_b', error: 'offline' }]);
    expect(getTaskPool(task_pool.id, dataDir)?.status).toBe('in_progress');
    expect(listTaskPools(dataDir)).toHaveLength(1);
  });

  it('normalizes legacy statuses and missing priorities', () => {
    const dataDir = tempDataDir();
    writeFileSync(join(dataDir, 'task_pool.json'), JSON.stringify({
      version: 1,
      taskPools: [
        {
          id: 'tp_active',
          title: 'Active legacy',
          prompt: 'legacy active',
          larkAppIds: ['bot_a'],
          mode: 'lead',
          column: 'in_progress',
          leadLarkAppId: 'bot_a',
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'tp_failed',
          title: 'Failed legacy',
          prompt: 'legacy failed',
          larkAppIds: ['bot_b'],
          mode: 'lead',
          column: 'backlog',
          leadLarkAppId: 'bot_b',
          status: 'failed',
          priority: 'P1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    }));

    expect(getTaskPool('tp_active', dataDir)?.status).toBe('in_progress');
    expect(getTaskPool('tp_active', dataDir)?.priority).toBe('P2');
    expect(getTaskPool('tp_failed', dataDir)?.status).toBe('pending');
    expect(getTaskPool('tp_failed', dataDir)?.priority).toBe('P1');
  });

  it('returns defensive copies when serving cached taskPools', () => {
    const dataDir = tempDataDir();
    const task_pool = createTaskPool({
      title: 'Cached task_pool',
      prompt: 'keep cache immutable',
      larkAppIds: ['bot_a'],
      mode: 'lead',
      column: 'in_progress',
    }, dataDir);

    const listed = listTaskPools(dataDir);
    listed[0].title = 'mutated list';
    listed[0].larkAppIds.push('bot_b');

    const store = readTaskPoolStore(dataDir);
    store.taskPools[0].title = 'mutated store';
    store.taskPools[0].larkAppIds.push('bot_c');

    expect(getTaskPool(task_pool.id, dataDir)?.title).toBe('Cached task_pool');
    expect(getTaskPool(task_pool.id, dataDir)?.larkAppIds).toEqual(['bot_a']);
  });
});
