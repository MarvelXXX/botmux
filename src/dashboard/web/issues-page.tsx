import { useEffect, useRef } from 'react';
import { mountReactPage, type PageDisposer } from './react-mount.js';
import { useT } from './react-hooks.js';
import { wireIssuesPage } from './issues.js';

function IssuesPage() {
  const tr = useT();
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!rootRef.current) return undefined;
    return wireIssuesPage(rootRef.current);
  }, []);

  return (
    <section className="page issues-page" ref={rootRef}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{tr('nav.issues')}</p>
          <h1>{tr('issues.title')}</h1>
          <p>{tr('issues.subtitle')}</p>
        </div>
        <button type="button" id="issue-create" className="primary">{tr('issues.create')}</button>
      </div>
      <form id="issue-filters" className="filters issue-filters">
        <input type="search" name="q" placeholder={tr('issues.search')} />
        <select name="status" defaultValue="">
          <option value="">{tr('issues.status.all')}</option>
          <option value="draft">{tr('issues.status.draft')}</option>
          <option value="pending">{tr('issues.status.pending')}</option>
          <option value="in_progress">{tr('issues.status.in_progress')}</option>
          <option value="done">{tr('issues.status.done')}</option>
          <option value="archived">{tr('issues.status.archived')}</option>
        </select>
        <select name="priority" defaultValue="">
          <option value="">{tr('issues.priority.all')}</option>
          <option value="P0">{tr('issues.priority.P0')}</option>
          <option value="P1">{tr('issues.priority.P1')}</option>
          <option value="P2">{tr('issues.priority.P2')}</option>
          <option value="P3">{tr('issues.priority.P3')}</option>
        </select>
        <select name="groupBy" defaultValue="status" aria-label={tr('issues.groupBy.label')} title={tr('issues.groupBy.label')}>
          <option value="status">{tr('issues.groupBy.status')}</option>
          <option value="priority">{tr('issues.groupBy.priority')}</option>
        </select>
        <button type="button" id="issue-refresh">{tr('issues.refresh')}</button>
      </form>
      <div id="issue-list" className="issue-list" />
      <dialog id="issue-dialog" className="issue-dialog" />
    </section>
  );
}

export function renderIssuesPage(root: HTMLElement): PageDisposer {
  return mountReactPage(root, <IssuesPage />);
}
