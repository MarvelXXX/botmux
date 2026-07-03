import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createIssue,
  getIssue,
  listIssues,
  recordIssueStart,
  updateIssue,
} from '../src/services/issue-store.js';

let dirs: string[] = [];

function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'botmux-issue-store-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('issue-store', () => {
  it('creates, updates, and records start results', () => {
    const dataDir = tempDataDir();
    const issue = createIssue({
      title: '',
      prompt: 'Fix dashboard issue\n\nDetails',
      larkAppIds: ['bot_a', 'bot_b', 'bot_a'],
      mode: 'lead',
      column: 'in_progress',
      leadLarkAppId: 'bot_a',
      groupName: 'Dashboard Issue',
    }, dataDir);

    expect(issue.title).toBe('Fix dashboard issue');
    expect(issue.status).toBe('draft');
    expect(issue.priority).toBe('P2');
    expect(issue.larkAppIds).toEqual(['bot_a', 'bot_b']);

    const updated = updateIssue(issue.id, {
      title: 'Dashboard issue',
      priority: 'P0',
      bindWorkingDir: '/repo/botmux',
    }, dataDir);
    expect(updated?.title).toBe('Dashboard issue');
    expect(updated?.priority).toBe('P0');
    expect(updated?.bindWorkingDir).toBe('/repo/botmux');

    const started = recordIssueStart(issue.id, {
      status: 'in_progress',
      chatId: 'oc_123',
      shareLink: 'https://example.test/chat',
      spawned: ['bot_a'],
      failed: [{ larkAppId: 'bot_b', error: 'offline' }],
    }, dataDir);
    expect(started?.chatId).toBe('oc_123');
    expect(started?.spawned).toEqual(['bot_a']);
    expect(started?.failed).toEqual([{ larkAppId: 'bot_b', error: 'offline' }]);
    expect(getIssue(issue.id, dataDir)?.status).toBe('in_progress');
    expect(listIssues(dataDir)).toHaveLength(1);
  });

  it('normalizes legacy statuses and missing priorities', () => {
    const dataDir = tempDataDir();
    writeFileSync(join(dataDir, 'issues.json'), JSON.stringify({
      version: 1,
      issues: [
        {
          id: 'iss_active',
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
          id: 'iss_failed',
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

    expect(getIssue('iss_active', dataDir)?.status).toBe('in_progress');
    expect(getIssue('iss_active', dataDir)?.priority).toBe('P2');
    expect(getIssue('iss_failed', dataDir)?.status).toBe('pending');
    expect(getIssue('iss_failed', dataDir)?.priority).toBe('P1');
  });
});
