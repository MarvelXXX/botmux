import { useEffect, useRef } from 'react';
import { mountReactPage, type PageDisposer } from './react-mount.js';
import { useT } from './react-hooks.js';
import { wireTaskPoolPage } from './task_pool.js';

function TaskPoolPage() {
  const tr = useT();
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!rootRef.current) return undefined;
    return wireTaskPoolPage(rootRef.current);
  }, []);

  return (
    <section className="page task_pool-page" ref={rootRef}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{tr('nav.task_pool')}</p>
          <h1>{tr('task_pool.title')}</h1>
          <p>{tr('task_pool.subtitle')}</p>
        </div>
        <button type="button" id="task_pool-create" className="primary">{tr('task_pool.create')}</button>
      </div>
      <form id="task_pool-filters" className="filters task_pool-filters">
        <input type="search" name="q" placeholder={tr('task_pool.search')} />
        <select name="status" defaultValue="">
          <option value="">{tr('task_pool.status.all')}</option>
          <option value="draft">{tr('task_pool.status.draft')}</option>
          <option value="pending">{tr('task_pool.status.pending')}</option>
          <option value="in_progress">{tr('task_pool.status.in_progress')}</option>
          <option value="done">{tr('task_pool.status.done')}</option>
          <option value="archived">{tr('task_pool.status.archived')}</option>
        </select>
        <select name="priority" defaultValue="">
          <option value="">{tr('task_pool.priority.all')}</option>
          <option value="P0">{tr('task_pool.priority.P0')}</option>
          <option value="P1">{tr('task_pool.priority.P1')}</option>
          <option value="P2">{tr('task_pool.priority.P2')}</option>
          <option value="P3">{tr('task_pool.priority.P3')}</option>
        </select>
        <select name="groupBy" defaultValue="status" aria-label={tr('task_pool.groupBy.label')} title={tr('task_pool.groupBy.label')}>
          <option value="status">{tr('task_pool.groupBy.status')}</option>
          <option value="priority">{tr('task_pool.groupBy.priority')}</option>
        </select>
        <button type="button" id="task_pool-refresh">{tr('task_pool.refresh')}</button>
      </form>
      <div id="task_pool-list" className="task_pool-list" />
      <dialog id="task_pool-dialog" className="task_pool-dialog" />
    </section>
  );
}

export function renderTaskPoolPage(root: HTMLElement): PageDisposer {
  return mountReactPage(root, <TaskPoolPage />);
}
