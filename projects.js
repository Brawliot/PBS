/*
 * My projects: the person's plans, the latest change first. The server sends a summary of each one
 * (title, last change, steps done); this file only shows it. Everything from the server goes in as text.
 */
(() => {
  'use strict';

  const list = document.getElementById('project-list');
  const count = document.getElementById('projects-count');
  const blocks = {
    empty: document.getElementById('projects-empty'),
    signedOut: document.getElementById('projects-signed-out'),
    error: document.getElementById('projects-error'),
  };

  const STATUS = { not_started: 'Not started', in_progress: 'In progress', done: 'Done' };
  const date = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' });

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const row = (project) => {
    const item = element('li', 'project');

    const title = element('h2', 'project__title');
    const link = element('a', '', project.title);
    link.href = `/plan?id=${encodeURIComponent(project.id)}`;
    title.append(link);

    const status = element('span', 'project__status', STATUS[project.status] ?? STATUS.in_progress);
    const meta = element('p', 'project__meta', `Updated ${date.format(new Date(project.updatedAt))} · ${project.done} of ${project.total} steps done`);

    const bar = element('div', 'project__bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', `Progress of ${project.title}`);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(project.percent));
    const fill = element('i');
    fill.style.width = `${project.percent}%`;
    bar.append(fill);

    item.append(title, status, meta, bar);
    return item;
  };

  const showOnly = (name) => {
    for (const [key, block] of Object.entries(blocks)) block.hidden = key !== name;
  };

  const load = async () => {
    try {
      const response = await fetch('/api/projects', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (response.status === 401) return showOnly('signedOut');
      if (!response.ok) throw new Error('projects failed');
      const { projects } = await response.json();
      count.textContent = projects.length === 1 ? '1 project' : `${projects.length} projects`;
      if (projects.length === 0) return showOnly('empty');
      list.replaceChildren(...projects.map(row));
    } catch {
      count.textContent = '';
      showOnly('error');
    }
  };

  load();
})();
