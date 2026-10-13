/*
 * Plan page: reads one plan from the API (GET /api/plan/:id) and shows it by hash route.
 * The server computes every value (readiness, actions, progress, durations); this file reads them
 * and never repeats their rules. Everything from the API goes into the page as text (textContent).
 *
 *   /plan?id=<uuid>#/            overview of the departments
 *   /plan?id=<uuid>#/timeline    phases on the timeline
 *   /plan?id=<uuid>#/dept/:id    one department
 *   /plan?id=<uuid>#/phase/:id   one phase
 *   /plan?id=<uuid>#/task/:id    one task (?from=dept:<id> or ?from=phase:<id> sets the breadcrumbs)
 *   /plan?id=<uuid>#/decisions  facts to confirm, a new decision, gaps, and the suggestions to accept
 */
(() => {
  'use strict';

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Fixed English text for every code the API can send. The screen never shows a server message.
  const ERROR_TEXT = {
    unauthenticated: 'Log in to see your plan.',
    version_conflict: 'The plan changed in another window. It has been reloaded; check the step and try again.',
    not_allowed: 'This action is not allowed for this step right now.',
    not_ready: 'This step is waiting for another step. It cannot start yet.',
    rounds_exceeded: 'This step has used all its rounds.',
    missing_proof: 'This step needs a proof before it can be closed.',
    output_not_confirmed: 'The output must be confirmed first.',
    executor_in_use: "Another step uses this step's result, so its executor cannot change.",
    invalid_payload: 'The information does not fit this action. Check the fields and try again.',
    invalid_executor_change: 'That executor change is not valid.',
    events_full: 'This step has reached the limit of its history and cannot change.',
    plan_too_large: 'This change would make the plan too large to store.',
    wrong_actor: 'You cannot do this action.',
    unknown_step: 'This step no longer exists. Reload the page.',
    not_found: 'This plan could not be found.',
    invalid_body: 'The request was not valid. Try again.',
    unknown_fact: 'This decision no longer exists. Reload the page.',
    invalid_fact: 'That decision does not fit the catalogue. Check the key and the value.',
    not_proposed: 'This decision was already answered.',
    not_confirmed: 'This decision is not confirmed.',
    unknown_task: 'This task no longer exists. Reload the page.',
    not_expandable: 'This task cannot be expanded yet.',
    unknown_proposal: 'This suggestion no longer exists. Reload the page.',
    invalid_proposal: 'This suggestion is not valid.',
    unknown_reason: 'This suggestion refers to something that is no longer in the plan.',
    too_large: 'This suggestion is too large to add.',
    duplicate_pending: 'A suggestion of this kind is already waiting for a decision.',
    assistant_unavailable: 'The assistant is not available right now. Try again later.',
    suggestion_invalid: "The assistant's suggestion was not usable. Try again.",
    no_report: 'This plan was not made from a report, so there is no idea to work from.',
    id_taken: 'A suggestion for this task was already made.',
    already_decided: 'This suggestion was already decided.',
    needs_ai: 'There is no ready-made suggestion for this decision yet.',
    not_available: 'This is not available right now.',
    no_confirmed_facts: 'Confirm at least one decision first, so the assistant has something to build on.',
    storage_unavailable: 'The plan storage is not available right now. Try again later.',
    internal_error: 'Something went wrong on the server. Try again.',
    report_not_found: 'The report this plan was made from could not be found.',
    skeleton_failed: 'The plan could not be built from its report. Try again.',
  };
  const FACT_KEY_LABEL = {
    product_type: 'Product type',
    target_customer: 'Target customer',
    revenue_model: 'Revenue model',
    launch_channel: 'Launch channel',
  };
  const GENERIC_ERROR = 'Something went wrong on the server. Try again.';
  const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';
  const TIMEOUT_ERROR = 'The request took too long. Please try again.';
  const PLAN_WAIT_MS = 120_000; // longest wait for one change; the assistant's own calls end before this

  const STATUS = {
    not_started: 'Not started',
    running: 'Running',
    waiting_user: 'Waiting for you',
    waiting_third_party: 'Waiting for a third party',
    done: 'Done',
    rejected: 'Rejected',
  };
  const TASK_STATUS = { not_started: 'Not started', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };
  const EXECUTOR = { ai: 'AI assistant', user: 'You', third_party: 'Third party' };
  const MODE = { online: 'Online', in_person: 'In person' };
  const AUTOMATION = { automatic: 'Automatic', manual: 'Manual', hybrid: 'Hybrid' };
  const TIER = { core: 'Core', important: 'Important', light: 'Light' };
  const EVIDENCE = {
    none: 'No evidence needed',
    accepted_output: 'Accepted AI output',
    written_confirmation: 'Written confirmation',
    receipt: 'Receipt',
  };
  const READINESS = { ready: 'Ready', blocked: 'Blocked' };
  const OUTPUT_STATE = { draft: 'Draft', confirmed: 'Confirmed', rejected: 'Rejected', superseded: 'Replaced' };
  const UNIT = { day: 'day', week: 'week', month: 'month' };
  const ACTION_LABEL = {
    launch: 'Start',
    confirm_output: 'Confirm output',
    reject_output: 'Reject',
    wait_third_party: 'Waiting for a third party',
    third_party_responded: 'Third party responded',
    reopen: 'Reopen',
  };
  // Buttons the person can press. attach_output is the assistant's job and is never offered.
  const BUTTON_ACTIONS = Object.keys(ACTION_LABEL);
  const EXECUTORS = ['ai', 'user', 'third_party'];
  const EVIDENCE_CHOICES = ['none', 'written_confirmation', 'receipt'];

  const view = document.getElementById('view');
  const live = document.getElementById('live');

  /** The loaded plan: { id, title, version, plan, derived }. Replaced by every answer of the server. */
  let data = null;
  let planId = null;
  let busy = false;
  // The Cancel of a wait: its controller stops the request, and waitCancelled tells the catch that it was the person
  let waitController = null;
  let waitCancelled = false;
  const waitCancel = document.getElementById('wait-cancel');
  waitCancel.addEventListener('click', () => {
    if (!waitController) return;
    waitCancelled = true;
    waitController.abort();
  });
  let notice = null;
  let lastHash = null;
  // The AI step the assistant is working on (its Start or its answers), and the answers typed so far, kept across renders
  let working = null;
  let workingSince = null;
  let clock = null;
  /** Updates the seconds of the assistant's notice once a second, without repainting the page */
  const startClock = () => {
    workingSince = Date.now();
    clearInterval(clock);
    clock = setInterval(() => {
      const node = view.querySelector('[data-elapsed]');
      if (node) node.textContent = `${elapsedSeconds()} s`;
    }, 1000);
  };
  const stopClock = () => {
    clearInterval(clock);
    clock = null;
    workingSince = null;
  };
  const answerDrafts = {};

  // ---- DOM helpers: children are text or nodes, never HTML
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'on') {
        for (const [type, handler] of Object.entries(value)) node.addEventListener(type, handler);
      } else if (key === 'style') {
        // Set as properties, not as a style attribute: the page's Content-Security-Policy forbids the attribute
        Object.assign(node.style, value);
      } else if (key === 'class') {
        node.className = value;
      } else {
        node.setAttribute(key, value === true ? '' : String(value));
      }
    }
    for (const child of children.flat(Infinity)) {
      if (child === undefined || child === null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const enc = encodeURIComponent;
  const plural = (count, unit) => (count === 1 ? unit : `${unit}s`);
  /** "mobile_game" -> "Mobile game"; free text is shown as it was written */
  const humanize = (id) => {
    const words = id.replaceAll('_', ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  };
  const keyLabel = (id) => FACT_KEY_LABEL[id] ?? humanize(id);
  const termLabel = (term) => (term.kind === 'catalog' ? humanize(term.id) : term.text);
  const factLabel = (fact) => `${fact.key.kind === 'catalog' ? keyLabel(fact.key.id) : fact.key.text}: ${termLabel(fact.value)}`;
  const pendingFacts = (plan) => (plan.facts ?? []).filter((fact) => fact.status === 'proposed');
  const pendingProposals = (plan) => (plan.proposals ?? []).filter((item) => item.status === 'pending');
  /** A suggestion of steps for one task (the steps of a task, from the assistant): it has steps and no tasks */
  const isStepProposal = (item) => item.structure === undefined && item.add.tasks.length === 0 && item.add.steps.length > 0;
  const planUrl = () => `/api/plan/${enc(planId)}`;
  const visible = (item) => item.feedback !== 'deleted';
  const byId = (list, id) => list.find((item) => item.id === id);

  function announce(text) {
    if (live) live.textContent = text;
  }

  // ---- Routes
  function parseRoute(hash) {
    const [rawPath, query = ''] = (hash.replace(/^#/, '') || '/').split('?');
    const params = new URLSearchParams(query);
    if (rawPath === '/' || rawPath === '') return { name: 'general', all: params.get('departments') === 'all', allDecisions: params.get('decisions') === 'all' };
    if (rawPath === '/timeline') return { name: 'timeline' };
    if (rawPath === '/decisions') return { name: 'decisions' };
    if (rawPath === '/search') return { name: 'search', query: params.get('q') ?? '', status: params.get('status') ?? 'all' };
    const match = rawPath.match(/^\/(dept|phase|task)\/([^/]+)$/);
    // #/group/:id is reserved: there is no grouping of departments in the front yet, so it has no view
    if (!match) return { name: 'notfound' };
    let id;
    try {
      id = decodeURIComponent(match[2]);
    } catch {
      return { name: 'notfound' };
    }
    const { plan } = data;
    const list = { dept: plan.departments, phase: plan.phases, task: plan.tasks }[match[1]];
    const item = byId(list, id);
    if (!item || (match[1] === 'task' && !visible(item))) return { name: 'notfound' };
    return { name: match[1], id, from: parseFrom(params.get('from')), step: params.get('step'), status: params.get('status') };
  }

  /** "dept:legal" or "phase:f1", only if that record exists; anything else is ignored */
  function parseFrom(value) {
    const [kind, id] = (value || '').split(':');
    if (kind === 'dept' && byId(data.plan.departments, id)) return { kind, id };
    if (kind === 'phase' && byId(data.plan.phases, id)) return { kind, id };
    return undefined;
  }

  const taskHref = (task, from) => `#/task/${enc(task.id)}${from ? `?from=${enc(from)}` : ''}`;
  const deptHref = (id) => `#/dept/${enc(id)}`;
  const phaseHref = (id) => `#/phase/${enc(id)}`;

  // ---- Shared pieces
  function badge(text) {
    return el('span', { class: 'badge' }, text);
  }

  function facts(rows) {
    return el(
      'dl',
      { class: 'facts' },
      rows.map(([label, value]) => [el('dt', {}, label), el('dd', {}, value)]),
    );
  }

  function crumbs(trail) {
    return el(
      'nav',
      { class: 'crumbs', 'aria-label': 'Breadcrumb' },
      el(
        'ol',
        { class: 'crumbs__list' },
        trail.map((item, index) => {
          const last = index === trail.length - 1;
          return el(
            'li',
            { class: 'crumbs__item' },
            last
              ? el('span', { 'aria-current': 'page' }, item.label)
              : el('a', { href: item.href }, item.label),
          );
        }),
      ),
    );
  }

  /** Plan-wide navigation, on every view; the view it belongs to is marked */
  function tabs(active) {
    const link = (key, href, label) =>
      el('a', { class: 'tab', href, 'aria-current': active === key ? 'page' : undefined }, label);
    return el(
      'nav',
      { class: 'tabs', 'aria-label': 'Plan views' },
      link('overview', '#/', 'Overview'),
      link('timeline', '#/timeline', 'Timeline'),
    );
  }

  const progressText = (progress) =>
    progress && progress.total > 0 ? `${progress.done} of ${progress.total} tasks done` : 'No tasks yet';

  function phaseName(id) {
    return byId(data.plan.phases, id)?.name ?? '';
  }

  function deptName(id) {
    return byId(data.plan.departments, id)?.name ?? '';
  }

  // ---- Views: each returns the nodes of the page and the heading that takes the focus
  /** The items that need the person now: the facts the plan asks for and the suggestions it waits on */
  function needsYou() {
    const { plan } = data;
    const facts = pendingFacts(plan).map((fact) => {
      const keyId = fact.key.kind === 'catalog' ? fact.key.id : null;
      const blocked = keyId ? plan.tasks.filter((task) => task.placeholder?.waitsFor.includes(keyId) && visible(task)) : [];
      return {
        title: factLabel(fact),
        text: blocked.length ? `Blocks: ${blocked.map((task) => task.title).join(', ')}` : 'Suggested by the assistant',
        href: blocked.length ? taskHref(blocked[0]) : '#/decisions',
        label: blocked.length ? 'Answer it on the task' : 'Review in Proposals',
      };
    });
    // Decisions a gap waits for that nobody has suggested yet: the person answers them on the task
    const missing = [...new Set(plan.tasks.filter((task) => task.placeholder && visible(task)).flatMap((task) => task.placeholder.waitsFor))]
      .filter((keyId) => !data.derived.confirmedFacts[keyId] && !pendingFacts(plan).some((fact) => fact.key.kind === 'catalog' && fact.key.id === keyId))
      .map((keyId) => {
        const blocked = plan.tasks.filter((task) => task.placeholder?.waitsFor.includes(keyId) && visible(task));
        return { key: keyId, title: `${keyLabel(keyId)} is needed`, text: `Blocks: ${blocked.map((task) => task.title).join(', ')}`, href: taskHref(blocked[0]), label: 'Answer it on the task' };
      });
    const suggestions = pendingProposals(plan)
      .filter(isDepartmentProposal)
      .map((item) => {
        const department = item.add.tasks[0].primaryDepartmentId;
        const count = item.add.tasks.length;
        return {
          title: `${count} suggested ${plural(count, 'task')} for ${deptName(department)}`,
          text: 'Waiting for you',
          href: deptHref(department),
          label: `Answer them on ${deptName(department)}`,
        };
      });
    return [...facts, ...missing, ...suggestions];
  }

  /** The line under a department on the overview: what it needs next, in plain words */
  function departmentLine(department) {
    const { plan, derived } = data;
    const waiting = pendingProposals(plan).filter(isDepartmentProposal).some((item) => item.add.tasks[0].primaryDepartmentId === department.id);
    if (waiting) return 'Needs you: suggested tasks to answer';
    const tasks = plan.tasks.filter((task) => task.primaryDepartmentId === department.id && visible(task));
    if (!tasks.length) return 'No tasks yet';
    const blocked = tasks.find((task) => derived.tasks[task.id].status === 'blocked');
    if (blocked) return `Blocked: ${blocked.title}`;
    const next = nextStepOf(tasks);
    if (next) return `Next: ${next.step.text}`;
    if (tasks.every((task) => derived.tasks[task.id].status === 'not_started')) return 'Nothing started';
    return progressText(derived.departments[department.id]);
  }

  /** What each level means, under the departments: a short line per level */
  function tierLegend() {
    return el(
      'p',
      { class: 'row__meta tier-legend' },
      el('b', {}, 'Core'), ': needed for most decisions. ',
      el('b', {}, 'Important'), ': needed for some. ',
      el('b', {}, 'Light'), ': supports the others.',
    );
  }

  /** How many decisions the overview lists before "Show all" */
  const OVERVIEW_DECISIONS = 5;

  /** How many departments the overview shows before "Show all" */
  const OVERVIEW_DEPARTMENTS = 6;

  function generalView(showAll, showAllDecisions) {
    const { plan } = data;
    const items = needsYou();
    const shown = items.slice(0, 2);
    // Tasks in the order of the phases: the first one to do when nothing needs the person
    const ordered = [...plan.phases].sort((a, b) => a.order - b.order).flatMap((phase) => plan.tasks.filter((task) => task.phaseId === phase.id && visible(task)));
    const next = nextStepOf(ordered);
    const lead = items.length
      ? `Start with the ${items.length === 1 ? 'thing that needs' : `${items.length} things that need`} you. Then pick a department.`
      : next
        ? `Nothing needs you right now. Next: ${next.step.text}, in ${deptName(next.task.primaryDepartmentId)}.`
        : 'Nothing needs you right now.';

    const needs = shown.length
      ? el(
          'section',
          { class: 'overview-needs', 'aria-label': 'Needs you' },
          shown.map((item, index) =>
            el(
              'a',
              { class: 'overview-card', href: item.href },
              el('span', { class: 'overview-card__title' }, `${index + 1}. ${item.title}`),
              el('span', { class: 'row__meta' }, item.text),
              el('span', { class: 'overview-card__action' }, `${item.label} →`),
            ),
          ),
          items.length > shown.length ? el('p', { class: 'row__meta' }, el('a', { href: '#/decisions' }, `${items.length - shown.length} more in Proposals`)) : null,
        )
      : null;

    const phaseOrder = [...plan.phases].sort((a, b) => a.order - b.order);
    const phaseSentences = plan.relations
      .filter((relation) => relation.level === 'phase')
      .map((relation) => (relation.type === 'blocks' ? `${phaseName(relation.to)} waits for ${phaseName(relation.from)}` : `${phaseName(relation.from)} comes after ${phaseName(relation.to)}`));
    const timeline = phaseOrder.length
      ? el(
          'section',
          { class: 'overview-timeline' },
          el('h2', { class: 'section' }, 'Timeline'),
          el('p', { class: 'overview-timeline__phases' }, phaseOrder.map((phase) => phase.name).join(' → ')),
          phaseSentences.length ? el('p', { class: 'row__meta' }, `${phaseSentences.join('. ')}. `) : null,
          el('a', { href: '#/timeline' }, 'Open the timeline'),
        )
      : null;

    const listed = showAll ? plan.departments : plan.departments.slice(0, OVERVIEW_DEPARTMENTS);
    const departments = plan.departments.length
      ? el(
          'section',
          {},
          el('h2', { class: 'section' }, 'Departments'),
          el(
            'ul',
            { class: 'overview-grid' },
            listed.map((department) =>
              el(
                'li',
                { class: 'overview-tile' },
                el('a', { class: 'overview-tile__name', href: deptHref(department.id) }, department.name),
                badge(`${TIER[department.tier]} level`),
                el('span', { class: 'row__meta' }, departmentLine(department)),
              ),
            ),
          ),
          plan.departments.length > OVERVIEW_DEPARTMENTS
            ? el('p', { class: 'more' }, el('a', { href: showAll ? '#/' : '#/?departments=all' }, showAll ? 'Show fewer departments' : `Show all ${plan.departments.length} departments`))
            : null,
        )
      : el('p', {}, 'This plan has no departments.');

    return {
      title: data.title,
      trail: null,
      heading: data.title,
      body: [el('p', { class: 'dept-summary' }, lead), planProgress(), needs, timeline, departments, tierLegend(), decisionsRegistry(showAllDecisions)],
    };
  }

  /** The decisions the plan uses, what it replaced or rejected, the suggestions answered, and a form to add one */
  function decisionsRegistry(showAll) {
    const { plan, catalog } = data;
    const allConfirmed = (plan.facts ?? []).filter((fact) => fact.status === 'confirmed');
    const confirmed = showAll ? allConfirmed : allConfirmed.slice(0, OVERVIEW_DECISIONS);
    const earlier = (plan.facts ?? []).filter((fact) => fact.status === 'superseded' || fact.status === 'rejected');
    const answered = (plan.proposals ?? []).filter((item) => item.status !== 'pending');
    const sourceText = (fact) => (fact.from.kind === 'user' ? 'Entered by you' : 'Suggested by the assistant');
    return el(
      'section',
      { class: 'registry', 'aria-label': 'Decisions' },
      el('h2', { class: 'section' }, 'Decisions'),
      el('p', { class: 'row__meta' }, 'What the plan uses now. You answer a decision where it affects the plan: on the task, department or phase.'),
      confirmed.length
        ? el('ul', { class: 'list' }, confirmed.map((fact) => el('li', { class: 'row', 'data-fact-id': fact.id }, el('span', { class: 'row__name' }, factLabel(fact)), el('span', { class: 'row__meta' }, sourceText(fact)))))
        : el('p', { class: 'empty' }, 'No decisions confirmed yet.'),
      allConfirmed.length > OVERVIEW_DECISIONS
        ? el('p', { class: 'more' }, el('a', { href: showAll ? '#/' : '#/?decisions=all' }, showAll ? 'Show fewer decisions' : `Show all ${allConfirmed.length} decisions`))
        : null,
      earlier.length
        ? el('details', { class: 'fold' }, el('summary', {}, `Replaced or rejected (${earlier.length})`), el('ul', { class: 'plain-list' }, earlier.map((fact) => el('li', {}, `${factLabel(fact)}: ${fact.status === 'rejected' ? 'Rejected' : 'Replaced'}`))))
        : null,
      answered.length
        ? el('details', { class: 'fold' }, el('summary', {}, `Answered suggestions (${answered.length})`), el('ul', { class: 'plain-list' }, answered.map((item) => el('li', {}, `${item.status === 'accepted' ? 'Accepted' : 'Rejected'}: ${decidedTitle(item)}`))))
        : null,
      el('details', { class: 'fold' }, el('summary', {}, 'Add a decision'), decisionForm(catalog)),
      el('p', { class: 'row__meta' }, el('a', { href: '#/decisions' }, 'Ask the assistant for more proposals')),
    );
  }

  const DEPT_FILTERS = [
    ['all', 'All'],
    ['not_started', 'Not started'],
    ['in_progress', 'In progress'],
    ['blocked', 'Blocked'],
    ['done', 'Done'],
  ];
  /** From this many tasks, the department shows its status filter */
  const FILTER_FROM = 6;

  /** Tasks this department is suggested by the assistant and that wait for a decision (in Decisions) */
  function pendingDeptTasks(id) {
    return pendingProposals(data.plan)
      .filter(isDepartmentProposal)
      .filter((item) => item.add.tasks[0].primaryDepartmentId === id)
      .reduce((count, item) => count + item.add.tasks.length, 0);
  }

  /** The tasks this task waits for, from the order between tasks of the plan */
  function taskWaitsFor(task) {
    return data.plan.relations
      .filter((relation) => relation.level === 'task' && ((relation.type === 'blocks' && relation.to === task.id) || (relation.type === 'follows' && relation.from === task.id)))
      .map((relation) => byId(data.plan.tasks, relation.type === 'follows' ? relation.to : relation.from))
      .filter((other) => other && visible(other) && data.derived.tasks[other.id]?.status !== 'done');
  }

  /** The first step not yet done, that can start now, in the order of the tasks given */
  function nextStepOf(tasks) {
    for (const task of tasks) {
      const step = data.plan.steps.find(
        (item) => item.taskId === task.id && visible(item) && item.status !== 'done' && item.status !== 'rejected' && data.derived.steps[item.id]?.readiness === 'ready',
      );
      if (step) return { task, step };
    }
    return null;
  }

  /** The line under a task in a department: what it waits for, or the step to do next */
  function taskLine(task) {
    const status = data.derived.tasks[task.id].status;
    if (status === 'done') return null;
    if (status === 'blocked') {
      const waits = taskWaitsFor(task).map((other) => other.title);
      return waits.length ? `Waits for: ${waits.join(', ')}` : 'Waits for steps in other tasks';
    }
    const steps = data.plan.steps.filter((step) => step.taskId === task.id && visible(step));
    if (!steps.length) return 'No steps yet';
    const next = nextStepOf([task]);
    return next ? `Next: ${next.step.text}, ${EXECUTOR[next.step.executor]}` : null;
  }

  function deptView(id, filter) {
    const { plan, derived } = data;
    const department = byId(plan.departments, id);
    const responsible = plan.tasks.filter((task) => task.primaryDepartmentId === id && visible(task));
    const participates = plan.tasks.filter(
      (task) => visible(task) && task.primaryDepartmentId !== id && derived.tasks[task.id]?.departments.secondary.includes(id),
    );
    const activeFilter = DEPT_FILTERS.some(([key]) => key === filter) ? filter : 'all';
    const statusOf = (task) => derived.tasks[task.id].status;
    const phases = [...plan.phases].sort((a, b) => a.order - b.order);
    // The tasks in the order of the phases, then of the plan: the order the person reads them in
    const inOrder = phases.flatMap((phase) => responsible.filter((task) => task.phaseId === phase.id));
    const done = responsible.filter((task) => statusOf(task) === 'done').length;
    const blocked = responsible.filter((task) => statusOf(task) === 'blocked').length;
    const next = nextStepOf(inOrder);
    const waiting = pendingDeptTasks(id);

    const summary = [`${done} of ${responsible.length} ${plural(responsible.length, 'task')} done`];
    if (blocked) summary.push(`${blocked} blocked`);
    if (next) summary.push(`Next: ${next.step.text}`);

    // The tasks suggested for this department are decided here, as they are in Decisions
    const suggested = pendingProposals(plan)
      .filter(isDepartmentProposal)
      .filter((item) => item.add.tasks[0].primaryDepartmentId === id);
    const notice = waiting
      ? el('section', { class: 'suggested', 'aria-label': 'Suggested tasks waiting for you' }, el('h2', { class: 'section' }, `Suggested tasks waiting for you (${waiting})`), suggested.map((item) => departmentCard(item)))
      : null;

    const filters =
      responsible.length >= FILTER_FROM
        ? el(
            'nav',
            { class: 'filters', 'aria-label': 'Show tasks with status' },
            DEPT_FILTERS.map(([key, label]) => {
              const count = responsible.filter((task) => key === 'all' || statusOf(task) === key).length;
              return el(
                'a',
                { class: 'chip', href: `#/dept/${enc(id)}?status=${key}`, 'aria-current': key === activeFilter ? 'true' : undefined },
                `${label} ${count}`,
              );
            }),
          )
        : null;

    const shown = inOrder.filter((task) => activeFilter === 'all' || statusOf(task) === activeFilter);
    const groups = phases
      .map((phase) => ({ phase, tasks: shown.filter((task) => task.phaseId === phase.id) }))
      .filter((group) => group.tasks.length > 0)
      .map(({ phase, tasks }) => {
        const doneHere = tasks.filter((task) => statusOf(task) === 'done').length;
        return el(
          'details',
          { class: 'phase-group', open: tasks.some((task) => statusOf(task) !== 'done') ? true : undefined },
          el(
            'summary',
            {},
            el('span', {}, phase.name),
            el('span', {}, `${tasks.length} ${plural(tasks.length, 'task')} · ${doneHere} done`),
          ),
          tasks.map((task) =>
            el(
              'div',
              { class: 'row' },
              el('a', { class: 'row__name', href: taskHref(task, `dept:${id}`) }, task.title),
              badge(TASK_STATUS[statusOf(task)]),
              taskLine(task) ? el('span', { class: 'row__meta row__meta--full' }, taskLine(task)) : null,
            ),
          ),
        );
      });

    const body = !responsible.length
      ? el(
          'div',
          { class: 'empty-box' },
          el('p', { class: 'empty-box__title' }, `${department.name} has no tasks yet`),
          el('p', { class: 'row__meta' }, 'Tasks for every department are suggested together from Decisions. Nothing changes until you accept them.'),
          el('a', { class: 'btn btn--outline', href: '#/decisions' }, 'Go to proposals'),
        )
      : groups.length
        ? groups
        : el('p', { class: 'empty' }, 'No tasks with this status.');

    const takesPart = participates.length
      ? el(
          'details',
          { class: 'fold' },
          el('summary', {}, `Also takes part in (${participates.length})`),
          el(
            'ul',
            { class: 'list' },
            participates.map((task) =>
              el('li', { class: 'row' }, el('a', { class: 'row__name', href: taskHref(task, `dept:${id}`) }, task.title), badge(TASK_STATUS[statusOf(task)]), el('span', { class: 'row__meta' }, phaseName(task.phaseId))),
            ),
          ),
        )
      : null;

    return {
      title: department.name,
      trail: [{ label: 'Overview', href: '#/' }, { label: department.name }],
      heading: department.name,
      body: [
        notice,
        el('p', { class: 'meta' }, badge(`${TIER[department.tier]} level`)),
        responsible.length ? el('p', { class: 'dept-summary' }, summary.join(' · ')) : null,
        filters,
        body,
        takesPart,
      ],
    };
  }

  /** Tasks of this phase that wait for a decision (in Decisions): the suggestions of the departments */
  function pendingPhaseTasks(id) {
    return pendingProposals(data.plan)
      .filter(isDepartmentProposal)
      .reduce((count, item) => count + item.add.tasks.filter((task) => task.phaseId === id).length, 0);
  }

  /** The order between this phase and the others, in plain words */
  function phaseOrder(id) {
    return data.plan.relations
      .filter((relation) => relation.level === 'phase' && (relation.from === id || relation.to === id))
      .map((relation) => {
        if (relation.type === 'follows') return relation.from === id ? `Comes after ${phaseName(relation.to)}` : `${phaseName(relation.from)} comes after this phase`;
        return relation.from === id ? `Must be finished before ${phaseName(relation.to)}` : `Waits for ${phaseName(relation.from)} to be finished`;
      });
  }

  function phaseView(id, filter) {
    const { plan, derived } = data;
    const phase = byId(plan.phases, id);
    const status = derived.phases[id];
    const tasks = plan.tasks.filter((task) => task.phaseId === id && visible(task));
    const activeFilter = DEPT_FILTERS.some(([key]) => key === filter) ? filter : 'all';
    const statusOf = (task) => derived.tasks[task.id].status;
    // Tasks grouped by department, in the order of the plan's departments
    const inOrder = plan.departments.flatMap((department) => tasks.filter((task) => task.primaryDepartmentId === department.id));
    const done = tasks.filter((task) => statusOf(task) === 'done').length;
    const next = nextStepOf(inOrder);
    const hasDates = plan.timeline && phase.startUnit !== undefined && phase.lengthUnits !== undefined;
    const dates = hasDates
      ? `${humanize(UNIT[plan.timeline.unit])}s ${phase.startUnit} to ${phase.startUnit + phase.lengthUnits}`
      : null;

    const summary = [`${TASK_STATUS[status.status]}`, progressText(status.progress)];
    if (next) summary.push(`Next: ${next.step.text}`);

    const order = phaseOrder(id);
    const notice = order.length
      ? el('p', { class: 'notice' }, `${order.join('. ')}. `, el('a', { href: '#/timeline' }, 'See the timeline'))
      : null;

    const waiting = pendingPhaseTasks(id);
    // The suggestions that add tasks to this phase are decided here, as they are in Decisions
    const suggested = pendingProposals(plan).filter(isDepartmentProposal).filter((item) => item.add.tasks.some((task) => task.phaseId === id));
    const pendingNotice = waiting
      ? el('section', { class: 'suggested', 'aria-label': 'Suggested tasks waiting for you' }, el('h2', { class: 'section' }, `Suggested tasks waiting for you (${waiting})`), suggested.map((item) => departmentCard(item, id)))
      : null;

    const filters =
      tasks.length >= FILTER_FROM
        ? el(
            'nav',
            { class: 'filters', 'aria-label': 'Show tasks with status' },
            DEPT_FILTERS.map(([key, label]) => {
              const count = tasks.filter((task) => key === 'all' || statusOf(task) === key).length;
              return el('a', { class: 'chip', href: `#/phase/${enc(id)}?status=${key}`, 'aria-current': key === activeFilter ? 'true' : undefined }, `${label} ${count}`);
            }),
          )
        : null;

    const shown = inOrder.filter((task) => activeFilter === 'all' || statusOf(task) === activeFilter);
    const groups = plan.departments
      .map((department) => ({ department, tasks: shown.filter((task) => task.primaryDepartmentId === department.id) }))
      .filter((group) => group.tasks.length > 0)
      .map(({ department, tasks: groupTasks }) => {
        const doneHere = groupTasks.filter((task) => statusOf(task) === 'done').length;
        return el(
          'details',
          { class: 'phase-group', open: groupTasks.some((task) => statusOf(task) !== 'done') ? true : undefined },
          el('summary', {}, el('span', {}, department.name), el('span', {}, `${groupTasks.length} ${plural(groupTasks.length, 'task')} · ${doneHere} done`)),
          groupTasks.map((task) =>
            el(
              'div',
              { class: 'row' },
              el('a', { class: 'row__name', href: taskHref(task, `phase:${id}`) }, task.title),
              badge(TASK_STATUS[statusOf(task)]),
              taskLine(task) ? el('span', { class: 'row__meta row__meta--full' }, taskLine(task)) : null,
            ),
          ),
        );
      });

    const body = !tasks.length
      ? el(
          'div',
          { class: 'empty-box' },
          el('p', { class: 'empty-box__title' }, 'This phase has no tasks yet'),
          el('p', { class: 'row__meta' }, 'Tasks reach a phase when a department suggests them and you accept. Nothing changes until you accept.'),
          el('a', { class: 'btn btn--outline', href: '#/decisions' }, 'Go to proposals'),
        )
      : groups.length
        ? groups
        : el('p', { class: 'empty' }, 'No tasks with this status.');

    return {
      title: phase.name,
      trail: [{ label: 'Timeline', href: '#/timeline' }, { label: phase.name }],
      heading: phase.name,
      body: [
        pendingNotice,
        notice,
        dates ? el('p', { class: 'meta' }, badge(dates)) : el('p', { class: 'row__meta' }, plan.timeline ? 'No dates for this phase.' : 'This plan has no dates. Phases are listed in order.'),
        el('p', { class: 'dept-summary' }, summary.join(' · ')),
        filters,
        body,
      ],
    };
  }

  /** Tick steps of the scale: the smallest one that keeps the scale to about eight marks */
  const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50, 100];

  /** The phases on a scale of the plan's unit (weeks, months…): one bar per phase, the order between phases in words */
  function timelineView() {
    const { plan, derived } = data;
    const phases = [...plan.phases].sort((a, b) => a.order - b.order);
    const placed = plan.timeline ? phases.filter((phase) => phase.startUnit !== undefined && phase.lengthUnits !== undefined) : [];
    const unit = plan.timeline?.unit;
    const scale = Math.max(1, ...placed.map((phase) => phase.startUnit + phase.lengthUnits));
    const percent = (value) => `${(value / scale) * 100}%`;
    const done = phases.filter((phase) => derived.phases[phase.id].status === 'done').length;
    const count = `${phases.length} ${plural(phases.length, 'phase')}`;

    // Without dates the phases are only a list, in the order they happen
    if (!plan.timeline) {
      return {
        title: 'Timeline',
        trail: null,
        heading: 'Timeline',
        body: [
          el('p', { class: 'dept-summary' }, `This plan has no dates. Phases are listed in the order they happen. ${count}, ${done} done.`),
          phases.length
            ? el(
                'ol',
                { class: 'timeline-card timeline-card--list' },
                phases.map((phase) => {
                  const status = derived.phases[phase.id];
                  return el(
                    'li',
                    { class: 'timeline__row' },
                    el('div', { class: 'timeline__label' }, el('a', { class: 'row__name', href: phaseHref(phase.id) }, phase.name), el('div', { class: 'row__meta' }, badge(TASK_STATUS[status.status]), ` ${progressText(status.progress)}`)),
                  );
                }),
              )
            : el('p', { class: 'empty' }, 'This plan has no phases.'),
          relationsList(),
        ],
      };
    }

    // A scale mark every few units, so the axis has about eight labels at most
    const step = TICK_STEPS.find((candidate) => scale / candidate <= 8) ?? TICK_STEPS.at(-1);
    const marks = [];
    for (let value = 0; value <= scale; value += step) marks.push(value);
    const ticks = marks.map((value) => el('span', { class: 'timeline__tick', style: { left: percent(value) } }, String(value)));
    const grid = marks.map((value) => el('span', { class: 'timeline__grid', style: { left: percent(value) } }));

    const rows = phases.map((phase) => {
      const status = derived.phases[phase.id];
      const isPlaced = placed.includes(phase);
      const bar = isPlaced
        ? el('div', {
            class: status.status === 'blocked' ? 'bar timeline__bar timeline__bar--blocked' : 'bar timeline__bar',
            style: { left: percent(phase.startUnit), width: percent(phase.lengthUnits) },
          })
        : null;
      const lane = isPlaced
        ? el(
            'div',
            { class: 'timeline__lane', role: 'img', 'aria-label': `Starts at ${UNIT[unit]} ${phase.startUnit}, lasts ${phase.lengthUnits} ${plural(phase.lengthUnits, UNIT[unit])}` },
            grid,
            bar,
          )
        : el('div', { class: 'timeline__lane timeline__lane--empty' }, el('span', { class: 'row__meta' }, 'No dates for this phase'));
      return el(
        'li',
        { class: 'timeline__row' },
        el(
          'div',
          { class: 'timeline__label' },
          el('a', { class: 'row__name', href: phaseHref(phase.id) }, phase.name),
          el('div', { class: 'row__meta' }, badge(TASK_STATUS[status.status]), ` ${progressText(status.progress)}`),
        ),
        lane,
      );
    });

    const unplaced = phases.filter((phase) => !placed.includes(phase));
    return {
      title: 'Timeline',
      trail: null,
      heading: 'Timeline',
      body: [
        el('p', { class: 'dept-summary' }, `${scale} ${plural(scale, UNIT[unit])} in ${count} · ${done} of ${phases.length} done`),
        el(
          'ol',
          { class: 'timeline-card' },
          el('li', { class: 'timeline__head', 'aria-hidden': 'true' }, el('span', {}, 'Phase'), el('div', { class: 'timeline__scale' }, ticks)),
          rows,
        ),
        unplaced.length ? el('p', { class: 'notice' }, `Not on the timeline: ${unplaced.map((phase) => phase.name).join(', ')}.`) : null,
        relationsList(),
      ],
    };
  }

  /** The order between phases, in plain words */
  function relationsList() {
    const relations = data.plan.relations.filter((relation) => relation.level === 'phase');
    return el(
      'section',
      {},
      el('h2', { class: 'section' }, 'Order between phases'),
      relations.length
        ? el(
            'ul',
            { class: 'plain-list' },
            relations.map((relation) =>
              el('li', {}, relation.type === 'blocks' ? `${phaseName(relation.from)} must be finished before ${phaseName(relation.to)}` : `${phaseName(relation.from)} comes after ${phaseName(relation.to)}`),
            ),
          )
        : el('p', { class: 'empty' }, 'No order between phases.'),
    );
  }

  function taskView(id, from, requestedStep) {
    const { plan, derived } = data;
    const task = byId(plan.tasks, id);
    const summary = derived.tasks[id];
    const primary = byId(plan.departments, task.primaryDepartmentId);
    const phase = byId(plan.phases, task.phaseId);
    const secondary = summary.departments.secondary.map((deptId) =>
      el('a', { href: deptHref(deptId) }, deptName(deptId)),
    );

    let trail;
    if (from?.kind === 'phase') {
      trail = [{ label: 'Timeline', href: '#/timeline' }, { label: phase.name, href: phaseHref(phase.id) }, { label: task.title }];
    } else if (from?.kind === 'dept') {
      trail = [{ label: 'Overview', href: '#/' }, { label: deptName(from.id), href: deptHref(from.id) }, { label: task.title }];
    } else {
      trail = [{ label: 'Overview', href: '#/' }, { label: primary.name, href: deptHref(primary.id) }, { label: task.title }];
    }

    const elapsed = summary.elapsed.ok
      ? `${Number(summary.elapsed.days.toFixed(2))} days`
      : 'Cannot be measured: the steps have a circular dependency.';

    const steps = plan.steps.filter((step) => step.taskId === id && visible(step));
    const derivedFrom = (task.derivedFrom ?? [])
      .map((factId) => (plan.facts ?? []).find((fact) => fact.id === factId))
      .filter(Boolean)
      .map((fact) => factLabel(fact));
    return {
      title: task.title,
      trail,
      heading: task.title,
      body: [
        task.placeholder ? gapDecisions(task) : null,
        facts([
          ['Primary department', el('a', { href: deptHref(primary.id) }, primary.name)],
          ['Other departments', secondary.length ? secondary : 'None'],
          ['Phase', el('a', { href: phaseHref(phase.id) }, phase.name)],
          ['Status', badge(TASK_STATUS[summary.status])],
          ['Mode', AUTOMATION[summary.automation] ?? 'No steps yet'],
          ['Effort', `${summary.effortHours} hours`],
          ['Time', elapsed],
          derivedFrom.length ? ['Derived from', el('a', { href: '#/decisions' }, derivedFrom.join(', '))] : null,
        ].filter(Boolean)),
        el('h2', { class: 'section' }, 'Steps'),
        steps.length
          ? stepsLayout(task, steps, selectedStep(steps, requestedStep), from)
          : el('div', {}, el('p', { class: 'empty' }, 'This task has no steps.'), stepSuggestion(task)),
      ],
    };
  }

  /** The step shown on the right: the one asked for in the address, else the first one not finished */
  function selectedStep(steps, requestedId) {
    return (
      steps.find((step) => step.id === requestedId) ??
      steps.find((step) => step.status !== 'done' && step.status !== 'rejected') ??
      steps[0]
    );
  }

  /** The steps of a task as a list of links on the left, and the chosen step on the right */
  function stepsLayout(task, steps, current, from) {
    const linkTo = (step) => {
      const params = new URLSearchParams();
      if (from) params.set('from', `${from.kind}:${from.id}`);
      params.set('step', step.id);
      return `#/task/${enc(task.id)}?${params.toString()}`;
    };
    const list = el(
      'nav',
      { class: 'step-list', 'aria-label': 'Steps of this task' },
      el(
        'ol',
        { class: 'step-list__items' },
        steps.map((step, index) =>
          el(
            'li',
            {},
            el(
              'a',
              { class: 'step-row', href: linkTo(step), 'aria-current': step.id === current.id ? 'step' : undefined },
              el('span', { class: 'step-row__title' }, `${index + 1}. ${step.text}`),
              badge(STATUS[step.status]),
              el('span', { class: 'step-row__meta' }, stepSummary(step)),
            ),
          ),
        ),
      ),
    );
    return el('div', { class: 'steps-layout' }, list, stepDetail(current));
  }

  /** One line under a step in the list: who does it, and what it is doing now */
  function stepSummary(step) {
    const readiness = data.derived.steps[step.id]?.readiness;
    if (step.status === 'running') return `${EXECUTOR[step.executor]}, working now`;
    if (step.status === 'not_started' && readiness === 'blocked') return `${EXECUTOR[step.executor]}, waits for another step`;
    return EXECUTOR[step.executor];
  }

  /** The steps that must come before this one, and the ones that wait for it, from the relations between steps */
  function stepLinks(step) {
    const relations = data.plan.relations.filter((relation) => relation.level === 'step');
    const needs = relations
      .filter((relation) => (relation.type === 'blocks' && relation.to === step.id) || (relation.type === 'follows' && relation.from === step.id) || (relation.type === 'feeds' && relation.to === step.id))
      .map((relation) => (relation.type === 'follows' ? relation.to : relation.from));
    const unlocks = relations
      .filter((relation) => (relation.type === 'blocks' && relation.from === step.id) || (relation.type === 'follows' && relation.to === step.id) || (relation.type === 'feeds' && relation.from === step.id))
      .map((relation) => (relation.type === 'follows' ? relation.from : relation.to));
    return { needs: needs.map(byStep).filter(Boolean), unlocks: unlocks.map(byStep).filter(Boolean) };
  }

  const byStep = (id) => {
    const step = byId(data.plan.steps, id);
    return step && visible(step) ? step : null;
  };

  /** A link to another step: its task, with the step opened */
  function stepLink(step) {
    return el('a', { href: `#/task/${enc(step.taskId)}?step=${enc(step.id)}` }, step.text);
  }

  /** Seconds since this window started the assistant's work on the step; the counter in the notice reads it */
  const elapsedSeconds = () => (workingSince ? Math.floor((Date.now() - workingSince) / 1000) : 0);

  /** The line that says what the step is doing or waiting for, above its actions */
  function nowNotice(step, derivedStep) {
    if (working === step.id) {
      return el(
        'div',
        { class: 'now now--working', role: 'status' },
        el('p', {}, 'The assistant is working on this step.'),
        el('p', { class: 'row__meta' }, 'Started ', el('span', { 'data-elapsed': true }, `${elapsedSeconds()} s`), ' ago. This can take up to 4 minutes. Keep this page open until it finishes.'),
      );
    }
    if (step.status === 'running') {
      return el('div', { class: 'now now--working', role: 'status' }, el('p', {}, 'The assistant is working on this step. Keep this page open until it finishes.'));
    }
    if (step.status === 'waiting_user') return el('div', { class: 'now' }, el('p', {}, 'Waiting for you.'));
    if (step.status === 'waiting_third_party') return el('div', { class: 'now' }, el('p', {}, 'Waiting for a third party.'));
    if (step.status !== 'not_started') return null;
    if (derivedStep.readiness === 'blocked') {
      const { needs } = stepLinks(step);
      return el(
        'div',
        { class: 'now' },
        el('p', {}, 'It cannot start yet. Waiting for: ', needs.length ? needs.flatMap((other, index) => (index ? [', ', stepLink(other)] : [stepLink(other)])) : 'another step', '.'),
      );
    }
    if (step.executor === 'ai') {
      return el('div', { class: 'now' }, el('p', {}, 'The assistant runs this step when you press Start. It can take up to 4 minutes.'));
    }
    return el('div', { class: 'now' }, el('p', {}, 'It is your step. Start it when you are ready.'));
  }
  /** A task without steps: the assistant can propose them, only when the person asks. A gap has none yet; a waiting suggestion is shown instead */
  function stepSuggestion(task) {
    if (task.placeholder) return null;
    const proposal = pendingProposals(data.plan).find((item) => isStepProposal(item) && item.add.steps.some((step) => step.taskId === task.id));
    if (proposal) return stepsCard(proposal);
    return el(
      'div',
      { class: 'actions' },
      el('button', { type: 'button', class: 'btn btn--outline', disabled: busy ? true : undefined, on: { click: () => post(`/agents/tasks/${enc(task.id)}/steps`, {}) } }, 'Suggest steps'),
      el('p', { class: 'row__meta' }, 'Asks the assistant for the steps of this task. Nothing changes until you accept them.'),
    );
  }

  /** The decisions a gap waits for, answered on the task: the assistant's suggestion as Confirm / Reject, or a value to choose */
  function gapDecisions(task) {
    const { plan, derived, catalog } = data;
    const missing = task.placeholder.waitsFor.filter((keyId) => !derived.confirmedFacts[keyId]);
    const values = (keyId) => catalog.factValues[keyId] ?? [];
    const answerable = missing.filter((keyId) => values(keyId).length > 0 || pendingFacts(plan).some((fact) => fact.key.kind === 'catalog' && fact.key.id === keyId));
    // Something the page cannot answer here (or nothing missing): the note and its link, as before
    if (!answerable.length || answerable.length !== missing.length || pendingProposals(plan).some((item) => item.reason.taskId === task.id)) {
      return toDefineNote(task);
    }
    return el(
      'section',
      { class: 'dec-box', 'aria-label': 'Decisions for this task' },
      el('h3', { class: 'step__title' }, `Waiting for ${missing.map(keyLabel).join(', ')}`),
      el('p', { class: 'row__meta' }, 'This task cannot be defined until these are known. Answer them here.'),
      missing.map((keyId) => {
        const proposed = pendingFacts(plan).find((fact) => fact.key.kind === 'catalog' && fact.key.id === keyId);
        if (proposed) {
          return el(
            'div',
            { class: 'actions', role: 'group', 'aria-label': `Answer: ${keyLabel(keyId)}` },
            el('span', {}, `${keyLabel(keyId)}: ${termLabel(proposed.value)} (suggested by the assistant) `),
            el('button', { type: 'button', class: 'btn btn--dark', disabled: busy ? true : undefined, on: { click: () => post(`/facts/${enc(proposed.id)}/confirm`, {}) } }, 'Confirm'),
            el('button', { type: 'button', class: 'btn btn--outline', disabled: busy ? true : undefined, on: { click: () => post(`/facts/${enc(proposed.id)}/reject`, {}) } }, 'Reject'),
          );
        }
        const select = el('select', { id: `${task.id}-${keyId}`, name: 'value' }, values(keyId).map((value) => el('option', { value }, humanize(value))));
        return el(
          'form',
          {
            class: 'form',
            on: {
              submit: (event) => {
                event.preventDefault();
                post('/facts', { key: { kind: 'catalog', id: keyId }, value: { kind: 'catalog', id: select.value }, confirm: true }, null);
              },
            },
          },
          el('div', { class: 'field' }, el('label', { for: `${task.id}-${keyId}` }, keyLabel(keyId)), select),
          el('button', { type: 'submit', class: 'btn btn--dark', disabled: busy ? true : undefined }, 'Confirm'),
        );
      }),
    );
  }

  /** A gap: what it waits for, and where to answer it */
  function toDefineNote(task) {
    const { derived } = data;
    const waitsFor = task.placeholder.waitsFor;
    const missing = waitsFor.filter((keyId) => !derived.confirmedFacts[keyId]);
    const waiting = pendingProposals(data.plan).filter((item) => item.reason.taskId === task.id);
    const obsolete = waiting.some((item) => derived.proposals[item.id]?.obsolete);
    const text = missing.length
      ? `To define: waiting for ${missing.map(keyLabel).join(', ')}.`
      : obsolete
        ? 'To define: the suggestion for this task came from a decision that has changed. Retire it to suggest again.'
        : waiting.length
          ? 'To define: a suggestion for this task is waiting for your decision.'
          : 'To define: every decision it waits for is confirmed. You can suggest tasks on the decisions page.';
    return el('p', { class: 'notice' }, `${text} `, el('a', { href: '#/decisions' }, 'Go to proposals'));
  }

  const EVENT_ACTOR = { user: 'You', ai: 'AI assistant', system: 'System' };
  const EVENT_TEXT = {
    launch: 'started the step',
    attach_output: 'attached a result',
    answer: 'answered the questions',
    submit_proof: 'sent the proof',
    confirm_output: 'confirmed the result',
    reject_output: 'rejected the result',
    wait_third_party: 'is waiting for a third party',
    third_party_responded: 'the third party responded',
    reopen: 'reopened the step',
    change_executor: 'changed who does the step',
  };

  /** The events of a step, newest first, folded: who did what and when */
  function historyOf(step) {
    const events = step.events ?? [];
    if (!events.length) return null;
    const when = (value) => new Date(value).toLocaleString();
    return el(
      'details',
      { class: 'fold' },
      el('summary', {}, `History (${events.length})`),
      el(
        'ul',
        { class: 'plain-list' },
        [...events].reverse().map((event) =>
          el('li', {}, `${when(event.at)}: ${EVENT_ACTOR[event.actor] ?? event.actor} ${EVENT_TEXT[event.action] ?? humanize(event.action)}`),
        ),
      ),
    );
  }

  /** The selected step: what it is, what to do now, how it fits with the others, and its results and actions */
  function stepDetail(step) {
    const derivedStep = data.derived.steps[step.id] ?? { readiness: 'not_applicable', availableActions: [] };
    const latest = step.outputs?.at(-1);
    const available = derivedStep.availableActions.filter((action) => action !== 'attach_output');
    const forms = stepForms(step, available, latest);
    const { needs, unlocks } = stepLinks(step);
    const join = (list) => list.flatMap((other, index) => (index ? [', ', stepLink(other)] : [stepLink(other)]));
    const rows = [
      ['Who', step.mode ? `${EXECUTOR[step.executor]}, ${MODE[step.mode]}` : EXECUTOR[step.executor]],
      ['Status', badge(STATUS[step.status])],
      ['Needs', needs.length ? join(needs) : 'Nothing before it'],
      ['Unlocks', unlocks.length ? join(unlocks) : 'Nothing after it'],
      ['To finish', EVIDENCE[step.evidence.kind]],
      ['Proof', step.proof ? step.proof.text : 'None yet'],
      ['Effort', `${step.effortHours} hours, ${step.waitDays > 0 ? `waits ${step.waitDays} ${plural(step.waitDays, 'day')}` : 'no waiting time'}`],
    ];

    return el(
      'article',
      { class: 'step step--detail', tabindex: '-1', 'data-step-id': step.id },
      el('h3', { class: 'step__title' }, step.text),
      nowNotice(step, derivedStep),
      stepButtons(step, available),
      facts(rows),
      historyOf(step),
      step.outputs?.length ? outputList(step.outputs) : null,
      forms.length ? el('div', { class: 'step__actions' }, forms) : null,
    );
  }

  function outputList(outputs) {
    return el(
      'section',
      { class: 'outputs' },
      el('h4', { class: 'step__sub' }, 'Outputs'),
      el(
        'ol',
        { class: 'list' },
        outputs.map((output) =>
          el(
            'li',
            { class: 'output' },
            el('p', {}, `Version ${output.version}: ${OUTPUT_STATE[output.state]}`),
            el('p', {}, output.summary),
            output.document ? el('pre', { class: 'document' }, output.document) : null,
            output.requests?.length
              ? [
                  el('h5', { class: 'step__sub' }, 'Requests'),
                  el('ul', { class: 'plain-list' }, output.requests.map((request) => el('li', {}, `Request to ${request.to === 'plan' ? 'Plan' : deptName(request.to) || request.to}: ${request.text}`))),
                ]
              : null,
            output.questions.length
              ? el(
                  'ul',
                  { class: 'plain-list questions' },
                  output.questions.map((question) =>
                    el(
                      'li',
                      {},
                      el('p', {}, `Question: ${question.question}`),
                      el('p', {}, question.answer ? `Answer: ${question.answer}` : 'No answer yet'),
                    ),
                  ),
                )
              : null,
          ),
        ),
      ),
    );
  }

  /** The buttons of a step, right under its notice: the one thing to do now */
  function stepButtons(step, available) {
    const buttons = available.filter((action) => BUTTON_ACTIONS.includes(action));
    if (!buttons.length) return null;
    return el(
      'div',
      { class: 'actions', role: 'group', 'aria-label': 'Step actions' },
      buttons.map((action) =>
        el(
          'button',
          {
            type: 'button',
            class: 'btn btn--outline',
            disabled: busy ? true : undefined,
            // Starting an AI step runs the assistant: the server does it in the same request as the start
            on: { click: () => (action === 'launch' && step.executor === 'ai' ? runStep(step.id, { action }) : send(step.id, { action })) },
          },
          ACTION_LABEL[action],
        ),
      ),
    );
  }

  /** The forms of a step (its answers, its proof, its executor), below its details and results */
  function stepForms(step, available, latest) {
    const parts = [];
    if (available.includes('answer') && latest?.state === 'draft' && latest.questions.length) {
      parts.push(answerForm(step.id, latest));
    }
    if (available.includes('submit_proof')) parts.push(proofForm(step.id));
    if (available.includes('change_executor')) parts.push(el('details', { class: 'fold' }, el('summary', {}, 'Who does this step'), executorForm(step)));
    return parts;
  }

  function answerForm(stepId, output) {
    const { questions } = output;
    // The typed answers are kept by round, so a failed send does not lose them
    const draftKey = (index) => `${stepId}:${output.version}:${index}`;
    return el(
      'form',
      {
        class: 'form',
        on: {
          submit: (event) => {
            event.preventDefault();
            const answers = questions.map((_, index) => event.currentTarget.elements[`answer-${index}`].value.trim());
            runStep(stepId, { action: 'answer', payload: { answers } });
          },
        },
      },
      el('fieldset', { class: 'form__fieldset' }, [
        el('legend', { class: 'form__legend' }, 'Answer the questions'),
        questions.map((question, index) =>
          el('div', { class: 'field' }, [
            el('label', { for: `${stepId}-answer-${index}` }, question.question),
            el(
              'textarea',
              {
                id: `${stepId}-answer-${index}`,
                name: `answer-${index}`,
                required: true,
                maxlength: 1000,
                rows: 2,
                on: { input: (event) => (answerDrafts[draftKey(index)] = event.currentTarget.value) },
              },
              answerDrafts[draftKey(index)] ?? '',
            ),
          ]),
        ),
      ]),
      el('button', { type: 'submit', class: 'btn btn--dark', disabled: busy ? true : undefined }, 'Send answers'),
    );
  }

  function proofForm(stepId) {
    return el(
      'form',
      {
        class: 'form',
        on: {
          submit: (event) => {
            event.preventDefault();
            send(stepId, { action: 'submit_proof', payload: { text: event.currentTarget.elements.text.value.trim() } });
          },
        },
      },
      el('div', { class: 'field' }, [
        el('label', { for: `${stepId}-proof` }, 'Proof of completion'),
        el('textarea', { id: `${stepId}-proof`, name: 'text', required: true, maxlength: 1000, rows: 3 }),
      ]),
      el('button', { type: 'submit', class: 'btn btn--dark', disabled: busy ? true : undefined }, 'Submit proof'),
    );
  }

  function executorForm(step) {
    const others = EXECUTORS.filter((executor) => executor !== step.executor);
    const executorSelect = el(
      'select',
      { id: `${step.id}-executor`, name: 'executor' },
      others.map((executor) => el('option', { value: executor }, EXECUTOR[executor])),
    );
    const modeSelect = el(
      'select',
      { id: `${step.id}-mode`, name: 'mode', required: true },
      Object.entries(MODE).map(([value, label]) => el('option', { value }, label)),
    );
    const evidenceNeeded = step.evidence.kind === 'accepted_output';
    const evidenceSelect = el(
      'select',
      { id: `${step.id}-evidence`, name: 'evidence', required: true },
      EVIDENCE_CHOICES.map((value) => el('option', { value }, EVIDENCE[value])),
    );
    const modeField = el('div', { class: 'field', hidden: true }, el('label', { for: `${step.id}-mode` }, 'Mode'), modeSelect);
    const evidenceField = el(
      'div',
      { class: 'field', hidden: true },
      el('label', { for: `${step.id}-evidence` }, 'Evidence'),
      evidenceSelect,
    );

    // Mode is asked only for a user step, evidence only when the old one cannot stay
    const refresh = () => {
      const executor = executorSelect.value;
      modeField.hidden = executor !== 'user';
      modeSelect.required = executor === 'user';
      evidenceField.hidden = !(evidenceNeeded && executor !== 'ai');
      evidenceSelect.required = !evidenceField.hidden;
    };
    executorSelect.addEventListener('change', refresh);
    refresh();

    return el(
      'form',
      {
        class: 'form',
        on: {
          submit: (event) => {
            event.preventDefault();
            const executor = executorSelect.value;
            const payload = { executor };
            if (executor === 'user') payload.mode = modeSelect.value;
            if (!evidenceField.hidden) payload.evidence = { kind: evidenceSelect.value };
            send(step.id, { action: 'change_executor', payload });
          },
        },
      },
      el('fieldset', { class: 'form__fieldset' }, [
        el('legend', { class: 'form__legend' }, 'Change the executor'),
        el('div', { class: 'field' }, el('label', { for: `${step.id}-executor` }, 'Executor'), executorSelect),
        modeField,
        evidenceField,
      ]),
      el('button', { type: 'submit', class: 'btn btn--dark', disabled: busy ? true : undefined }, 'Change executor'),
    );
  }

  /** A plan structure waiting for a decision: accepted or rejected as a whole. Its texts are read-only. */
  function structureCard(item, summary) {
    const structure = summary.structure;
    const list = (items) => el('ul', { class: 'list' }, items.map((text) => el('li', { class: 'output' }, text)));
    return el(
      'article',
      { class: 'step', 'data-proposal-id': item.id, 'data-structure': 'true' },
      el('h3', { class: 'step__title' }, 'Plan structure'),
      el('p', { class: 'row__meta' }, 'The phases, tiers and relations below change the plan only when you accept them.'),
      el('h3', { class: 'step__sub' }, 'Phases'),
      el('ol', { class: 'list' }, structure.phases.map((name) => el('li', { class: 'output' }, name))),
      el('h3', { class: 'step__sub' }, 'Tiers'),
      structure.tiers.length
        ? list(structure.tiers.map((change) => `${change.department}: ${TIER[change.from] ?? change.from} to ${TIER[change.to] ?? change.to}`))
        : el('p', { class: 'empty' }, 'No department changes its tier.'),
      el('h3', { class: 'step__sub' }, 'Relations between departments'),
      structure.relations.length
        ? list(structure.relations.map((link) => `${link.from} ${link.type === 'blocks' ? 'blocks' : 'follows'} ${link.to}: ${link.aspect}`))
        : el('p', { class: 'empty' }, 'No relations between departments.'),
      structure.requests.length ? [el('h3', { class: 'step__sub' }, 'Requests'), list(structure.requests)] : null,
      structure.questions.length ? [el('h3', { class: 'step__sub' }, 'Questions'), list(structure.questions)] : null,
      el(
        'div',
        { class: 'actions', role: 'group', 'aria-label': 'Structure decision' },
        el('button', { type: 'button', class: 'btn btn--dark', disabled: busy ? true : undefined, on: { click: () => post(`/proposals/${enc(item.id)}/accept`, {}) } }, 'Accept'),
        el('button', { type: 'button', class: 'btn btn--outline', disabled: busy ? true : undefined, on: { click: () => post(`/proposals/${enc(item.id)}/reject`, {}) } }, 'Reject'),
      ),
    );
  }

  /** Tasks one department proposed (the assistant's, not a template or a gap): shown in their own card */
  const isDepartmentProposal = (item) => item.structure === undefined && item.add.tasks.some((task) => task.origin.kind === 'ai');

  /** The tasks one department proposed: grouped by phase, the order between them in plain words, and the notes (read-only) */
  function departmentCard(item, phaseId) {
    const { plan, derived } = data;
    const department = item.add.tasks[0].primaryDepartmentId;
    // A relation may join a new task with a task the department already has: its title is in the plan
    const titleOf = (id) => byId(item.add.tasks, id)?.title ?? byId(plan.tasks, id)?.title ?? id;
    const groups = [...plan.phases]
      .sort((a, b) => a.order - b.order)
      .filter((phase) => !phaseId || phase.id === phaseId)
      .map((phase) => ({ phase, tasks: item.add.tasks.filter((task) => task.phaseId === phase.id) }))
      .filter((group) => group.tasks.length > 0);
    const elsewhere = phaseId ? item.add.tasks.length - groups.reduce((count, group) => count + group.tasks.length, 0) : 0;
    const orders = (item.add.relations ?? []).map((link) =>
      link.type === 'blocks' ? `${titleOf(link.from)} must be done before ${titleOf(link.to)}` : `${titleOf(link.from)} comes after ${titleOf(link.to)}`,
    );
    const obsolete = derived.proposals[item.id]?.obsolete === true;
    return el(
      'article',
      { class: 'step', 'data-proposal-id': item.id, 'data-department-id': department },
      el('h3', { class: 'step__title' }, `Tasks for ${deptName(department)}${phaseId ? ` in ${phaseName(phaseId)}` : ''}`, obsolete ? el('span', { class: 'badge' }, 'Obsolete') : null),
      elsewhere ? el('p', { class: 'row__meta' }, `Accepting adds all ${item.add.tasks.length} tasks, ${elsewhere} of them in other phases.`) : null,
      obsolete ? el('p', { class: 'notice' }, 'This suggestion came from a decision that has changed. It cannot be accepted: retire it to ask the assistant again.') : null,
      groups.map((group) => [el('h3', { class: 'step__sub' }, group.phase.name), el('ol', { class: 'list' }, group.tasks.map((task) => el('li', { class: 'output' }, task.title)))]),
      orders.length ? [el('h3', { class: 'step__sub' }, 'Order'), el('ul', { class: 'list' }, orders.map((text) => el('li', { class: 'output' }, text)))] : null,
      item.notes?.length ? [el('h3', { class: 'step__sub' }, 'Notes (read only)'), el('ul', { class: 'list' }, item.notes.map((text) => el('li', { class: 'output' }, text)))] : null,
      el(
        'div',
        { class: 'actions', role: 'group', 'aria-label': 'Department decision' },
        obsolete ? null : el('button', { type: 'button', class: 'btn btn--dark', disabled: busy ? true : undefined, on: { click: () => post(`/proposals/${enc(item.id)}/accept`, {}) } }, 'Accept'),
        el('button', { type: 'button', class: 'btn btn--outline', disabled: busy ? true : undefined, on: { click: () => post(`/proposals/${enc(item.id)}/reject`, {}) } }, obsolete ? 'Retire' : 'Reject'),
      ),
    );
  }

  /** A suggestion of steps for one task: each step, who does it, and the order between them, in plain words */
  function stepsCard(item) {
    const { plan, derived } = data;
    const taskId = item.add.steps[0].taskId;
    const title = byId(plan.tasks, taskId)?.title ?? taskId;
    const obsolete = derived.proposals[item.id]?.obsolete === true;
    const textOf = (id) => byId(item.add.steps, id)?.text ?? id;
    const orders = (item.add.relations ?? []).map((link) => {
      if (link.type === 'feeds') return `${textOf(link.from)} gives its result to ${textOf(link.to)}`;
      return link.type === 'blocks' ? `${textOf(link.from)} must be done before ${textOf(link.to)}` : `${textOf(link.from)} comes after ${textOf(link.to)}`;
    });
    return el(
      'article',
      { class: 'step', 'data-proposal-id': item.id, 'data-task-id': taskId },
      el('h3', { class: 'step__title' }, `Steps for ${title}`, obsolete ? el('span', { class: 'badge' }, 'Obsolete') : null),
      obsolete ? el('p', { class: 'notice' }, 'This suggestion came from a decision that has changed. It cannot be accepted: retire it to ask the assistant again.') : null,
      el(
        'ol',
        { class: 'list' },
        item.add.steps.map((step) =>
          el(
            'li',
            { class: 'output' },
            el('p', {}, step.text),
            facts([
              ['Who', step.mode ? `${EXECUTOR[step.executor]}, ${MODE[step.mode]}` : EXECUTOR[step.executor]],
              ['Evidence', EVIDENCE[step.evidence.kind]],
              ['Effort', `${step.effortHours} hours`],
              ['Waiting', step.waitDays > 0 ? `${step.waitDays} ${plural(step.waitDays, 'day')}` : 'None'],
            ]),
          ),
        ),
      ),
      orders.length ? [el('h3', { class: 'step__sub' }, 'Order'), el('ul', { class: 'list' }, orders.map((text) => el('li', { class: 'output' }, text)))] : null,
      el(
        'div',
        { class: 'actions', role: 'group', 'aria-label': 'Steps decision' },
        obsolete ? null : el('button', { type: 'button', class: 'btn btn--dark', disabled: busy ? true : undefined, on: { click: () => post(`/proposals/${enc(item.id)}/accept`, {}) } }, 'Accept'),
        el('button', { type: 'button', class: 'btn btn--outline', disabled: busy ? true : undefined, on: { click: () => post(`/proposals/${enc(item.id)}/reject`, {}) } }, obsolete ? 'Retire' : 'Reject'),
      ),
    );
  }

  /** The name of a decided suggestion, in the list of decided ones */
  function decidedTitle(item) {
    if (item.structure !== undefined) return 'plan structure';
    if (isStepProposal(item)) return `steps for ${byId(data.plan.tasks, item.add.steps[0].taskId)?.title ?? 'a task'}`;
    return data.derived.proposals[item.id]?.titles.join(', ') ?? item.id;
  }

  // ---- Decisions: facts to confirm, a new decision, gaps, and suggestions
  function decisionsView() {
    const { plan, derived } = data;
    const confirmed = (plan.facts ?? []).filter((fact) => fact.status === 'confirmed');
    const pending = pendingProposals(plan);
    const decided = (plan.proposals ?? []).filter((item) => item.status !== 'pending');
    const waiting = pendingFacts(plan);
    const sourceText = (fact) => (fact.from.kind === 'user' ? 'Entered by you' : 'Suggested by the assistant');
    // A fact that blocks no task has no other place to be answered: it waits here
    const waitingList = waiting.length
      ? el(
          'ul',
          { class: 'list' },
          waiting.map((fact) =>
            el(
              'li',
              { class: 'row', 'data-fact-id': fact.id },
              el('span', { class: 'row__name' }, factLabel(fact)),
              el('span', { class: 'row__meta' }, sourceText(fact)),
              el(
                'div',
                { class: 'actions', role: 'group', 'aria-label': `Answer: ${factLabel(fact)}` },
                el('button', { type: 'button', class: 'btn btn--dark', disabled: busy ? true : undefined, on: { click: () => post(`/facts/${enc(fact.id)}/confirm`, {}) } }, 'Confirm'),
                el('button', { type: 'button', class: 'btn btn--outline', disabled: busy ? true : undefined, on: { click: () => post(`/facts/${enc(fact.id)}/reject`, {}) } }, 'Reject'),
              ),
            ),
          ),
        )
      : null;
    const gaps = plan.tasks.filter((task) => task.placeholder);
    const staleTitles = derived.stale.taskIds.map((id) => byId(plan.tasks, id)?.title).filter(Boolean);

    const stale = staleTitles.length
      ? el(
          'section',
          { class: 'notice', 'aria-label': 'Items that need a review' },
          el('p', {}, 'These items came from a decision that has changed.'),
          el('ul', { class: 'plain-list' }, staleTitles.map((title) => el('li', {}, title))),
        )
      : null;

    const gapItems = gaps.length
      ? el(
          'ul',
          { class: 'list' },
          gaps.map((task) => {
            const placeholder = task.placeholder;
            const proposals = (plan.proposals ?? []).filter((item) => item.reason.taskId === task.id);
            const expandable = derived.placeholders[task.id]?.expandable === true;
            const rejected = proposals.some((item) => item.status === 'rejected');
            // A pending suggestion must be decided first; once it is rejected, the gap can ask again
            const waiting = proposals.some((item) => item.status === 'pending');
            return el(
              'li',
              { class: 'row', 'data-task-id': task.id },
              el('a', { class: 'row__name', href: taskHref(task) }, task.title),
              el(
                'span',
                { class: 'row__meta' },
                placeholder.waitsFor.map((keyId) => {
                  const done = derived.confirmedFacts[keyId];
                  return el('span', { class: 'badge' }, done ? `${keyLabel(keyId)}: ${humanize(done.value.kind === 'catalog' ? done.value.id : done.value.text)} (done)` : `${keyLabel(keyId)} (waiting)`);
                }),
              ),
              !waiting && expandable
                ? el('button', { type: 'button', class: 'btn btn--outline', disabled: busy ? true : undefined, on: { click: () => post(`/gaps/${enc(task.id)}/proposal`, {}) } }, 'Suggest tasks')
                : null,
              rejected ? el('span', { class: 'row__meta' }, 'You rejected the suggestion for this task.') : null,
            );
          }),
        )
      : el('p', { class: 'empty' }, 'Nothing is left to define.');

    // One plan structure at a time: the button asks for one only when none is waiting
    const structurePending = pending.some((item) => item.structure !== undefined);
    const structureAction = structurePending
      ? el('p', { class: 'notice' }, 'A plan structure is waiting for your decision below.')
      : el(
          'div',
          { class: 'actions' },
          el('button', { type: 'button', class: 'btn btn--outline', disabled: busy ? true : undefined, on: { click: () => post('/agents/structure', {}) } }, 'Suggest plan structure'),
          el('p', { class: 'row__meta' }, 'Asks the assistant for the phases, tiers and relations of this plan. Nothing changes until you accept it.'),
        );

    // The tasks of each department have their own section below, so the list here keeps the other suggestions
    const otherPending = pending.filter((item) => !isDepartmentProposal(item));
    const departmentCards = pending.filter(isDepartmentProposal).map(departmentCard);
    // Asked for all departments at once: not while a structure waits (the tasks sit in its phases), and only with a confirmed decision
    const departmentAction = structurePending
      ? el('p', { class: 'row__meta' }, 'Decide the plan structure first: the tasks sit in its phases.')
      : confirmed.length === 0
        ? el('p', { class: 'row__meta' }, 'Confirm at least one decision first, so the assistant has something to build on.')
        : el(
            'div',
            { class: 'actions' },
            el('button', { type: 'button', class: 'btn btn--outline', disabled: busy ? true : undefined, on: { click: () => post('/agents/departments', {}) } }, 'Suggest tasks for all departments'),
            el('p', { class: 'row__meta' }, 'Asks the assistant for the tasks of every department, in one pass. Nothing changes until you accept a department.'),
          );

    const proposalItems = otherPending.length
      ? otherPending.map((item) => {
          if (isStepProposal(item)) return stepsCard(item);
          const summary = derived.proposals[item.id] ?? { tasks: 0, steps: 0, titles: [], obsolete: false };
          if (item.structure !== undefined && summary.structure) return structureCard(item, summary);
          const forTask = item.reason.taskId ? byId(plan.tasks, item.reason.taskId)?.title : null;
          // An obsolete suggestion stays listed until it is retired: accepting it would be refused, so the
          // only action is rejecting it (the server logs it as proposal_rejected, like any rejection)
          return el(
            'article',
            { class: 'step', 'data-proposal-id': item.id },
            el('h3', { class: 'step__title' }, 'Suggested tasks', summary.obsolete ? el('span', { class: 'badge' }, 'Obsolete') : null),
            summary.obsolete ? el('p', { class: 'notice' }, 'This suggestion came from a decision that has changed. It cannot be accepted: retire it to ask the assistant again.') : null,
            facts([
              ['For', forTask ?? 'A decision'],
              ['Adds', `${summary.tasks} ${plural(summary.tasks, 'task')} and ${summary.steps} ${plural(summary.steps, 'step')}`],
            ]),
            el('ol', { class: 'list' }, summary.titles.map((title) => el('li', { class: 'output' }, title))),
            el(
              'div',
              { class: 'actions', role: 'group', 'aria-label': 'Suggestion decision' },
              summary.obsolete ? null : el('button', { type: 'button', class: 'btn btn--dark', disabled: busy ? true : undefined, on: { click: () => post(`/proposals/${enc(item.id)}/accept`, {}) } }, 'Accept'),
              el('button', { type: 'button', class: 'btn btn--outline', disabled: busy ? true : undefined, on: { click: () => post(`/proposals/${enc(item.id)}/reject`, {}) } }, summary.obsolete ? 'Retire' : 'Reject'),
            ),
          );
        })
      : pending.length
        ? []
        : [el('p', { class: 'empty' }, 'No suggestions are waiting.')];

    const decidedFold = decided.length
      ? el(
          'details',
          { class: 'fold' },
          el('summary', {}, `Decided suggestions (${decided.length})`),
          el('ul', { class: 'plain-list' }, decided.map((item) => el('li', {}, `${item.status === 'accepted' ? 'Accepted' : 'Rejected'}: ${decidedTitle(item)}`))),
        )
      : null;

    return {
      title: 'Proposals',
      trail: null,
      heading: 'Proposals',
      body: [
        stale,
        el('p', { class: 'dept-summary' }, 'The assistant proposes. Nothing changes until you accept. Decisions are answered on the task, department or phase they affect.'),
        el(
          'section',
          { class: 'proposals-ask', 'aria-label': 'Ask the assistant' },
          el('h2', { class: 'section' }, 'Ask the assistant'),
          el('div', { class: 'proposals-ask__items' }, structureAction, departmentAction),
          el('h3', { class: 'step__sub' }, 'To define'),
          gapItems,
        ),
        el(
          'section',
          { class: 'proposals-waiting', 'aria-label': 'Waiting for you' },
          el('h2', { class: 'section' }, 'Waiting for you'),
          waitingList,
          proposalItems,
          departmentCards,
        ),
        decidedFold,
      ],
    };
  }

  /** Key and value of a new decision: a catalogue value comes from a list, anything else is free text */
  function decisionForm(catalog) {
    const keyOptions = [...catalog.factKeys.map((id) => [id, keyLabel(id)]), ['other', 'Other']];
    const keySelect = el('select', { id: 'decision-key', name: 'key' }, keyOptions.map(([value, label]) => el('option', { value }, label)));
    const keyTextLabel = el('label', { for: 'decision-key-text' }, 'Name of the decision');
    const keyText = el('input', { id: 'decision-key-text', name: 'keyText', type: 'text', maxlength: 500, required: true, autocomplete: 'off' });
    const valueSelectLabel = el('label', { for: 'decision-value' }, 'Value');
    const valueSelect = el('select', { id: 'decision-value', name: 'value' });
    const valueTextLabel = el('label', { for: 'decision-value-text' }, 'Value');
    const valueText = el('input', { id: 'decision-value-text', name: 'valueText', type: 'text', maxlength: 500, required: true, autocomplete: 'off' });
    const keyField = el('div', { class: 'field' }, el('label', { for: 'decision-key' }, 'Decision'), keySelect, keyTextLabel, keyText);
    const valueField = el('div', { class: 'field' }, valueSelectLabel, valueSelect, valueTextLabel, valueText);

    // The value list follows the key: only a key with catalogue values has one; the other key is written
    const refresh = () => {
      const key = keySelect.value;
      const values = key === 'other' ? undefined : catalog.factValues[key];
      keyTextLabel.hidden = keyText.hidden = key !== 'other';
      keyText.required = key === 'other';
      valueSelect.replaceChildren(...(values ?? []).map((value) => el('option', { value }, humanize(value))));
      valueSelectLabel.hidden = valueSelect.hidden = !values;
      valueSelect.required = Boolean(values);
      valueTextLabel.hidden = valueText.hidden = Boolean(values);
      valueText.required = !values;
    };
    keySelect.addEventListener('change', refresh);
    refresh();

    return el(
      'form',
      {
        class: 'form',
        on: {
          submit: (event) => {
            event.preventDefault();
            const key = keySelect.value === 'other' ? { kind: 'other', text: keyText.value.trim() } : { kind: 'catalog', id: keySelect.value };
            const value = valueSelect.hidden ? { kind: 'other', text: valueText.value.trim() } : { kind: 'catalog', id: valueSelect.value };
            post('/facts', { key, value, confirm: true }, null);
          },
        },
      },
      el('fieldset', { class: 'form__fieldset' }, [el('legend', { class: 'form__legend' }, 'New decision'), keyField, valueField]),
      el('button', { type: 'submit', class: 'btn btn--dark', disabled: busy ? true : undefined }, 'Save and confirm'),
    );
  }

  // ---- Pages
  function notFoundPage() {
    return {
      title: 'Not found',
      trail: null,
      heading: 'This part of the plan is not here',
      body: [
        el('p', {}, 'The task, department or phase you opened does not exist any more. It may have been removed.'),
        el(
          'div',
          { class: 'actions' },
          el('a', { class: 'btn btn--dark', href: '#/' }, 'Go to the plan overview'),
          el('button', { type: 'button', class: 'btn btn--outline', on: { click: () => (history.length > 1 ? history.back() : (location.hash = '#/')) } }, 'Go back'),
        ),
      ],
    };
  }

  // ---- The plan bar: search, export or print, and the account
  function planBar(route) {
    const query = route.name === 'search' ? route.query : '';
    const themeSlot = el('div', { class: 'plan-bar__theme' });
    window.MandoTheme?.mount(themeSlot);
    return el(
      'header',
      { class: 'plan-bar' },
      el(
        'form',
        {
          class: 'plan-bar__search',
          role: 'search',
          on: {
            submit: (event) => {
              event.preventDefault();
              const value = event.currentTarget.elements.q.value.trim();
              location.hash = `#/search?q=${enc(value)}`;
            },
          },
        },
        el('label', { class: 'sr-only', for: 'plan-search' }, 'Search the plan'),
        el('input', { id: 'plan-search', name: 'q', type: 'search', value: query, maxlength: 200, autocomplete: 'off', placeholder: 'Search tasks, steps and departments' }),
        el('button', { type: 'submit', class: 'btn btn--outline' }, 'Search'),
      ),
      el(
        'details',
        { class: 'plan-bar__menu' },
        el('summary', {}, 'Export or print'),
        el(
          'div',
          { class: 'plan-bar__items' },
          el('button', { type: 'button', on: { click: () => window.print() } }, 'Print this plan'),
          el('button', { type: 'button', on: { click: exportTasksCsv } }, 'Export tasks as CSV'),
        ),
      ),
      el('a', { class: 'plan-bar__link', href: '/projects' }, 'My projects'),
      el('a', { class: 'plan-bar__link', href: '/' }, 'Start page'),
      themeSlot,
      el('button', { type: 'button', class: 'btn btn--outline', on: { click: logOut } }, 'Log out'),
    );
  }

  /** A CSV of the tasks: one row each, with the department, the phase, the status and the next step to do */
  function exportTasksCsv() {
    const { plan, derived } = data;
    // A cell that starts with a formula sign is shown as text by spreadsheets: a quote in front stops it
    const cell = (value) => {
      const text = /^[=+\-@]/.test(String(value)) ? `'${value}` : String(value);
      return `"${text.replaceAll('"', '""')}"`;
    };
    const rows = [['Task', 'Department', 'Phase', 'Status', 'Next step']];
    for (const task of plan.tasks.filter(visible)) {
      const next = nextStepOf([task]);
      rows.push([task.title, deptName(task.primaryDepartmentId), phaseName(task.phaseId), TASK_STATUS[derived.tasks[task.id].status], next ? next.step.text : '']);
    }
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }));
    const link = el('a', { href: url, download: `${data.title}-tasks.csv` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /** Ends the session on the server, then goes to the start page, where the sign-in is */
  async function logOut() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: { Accept: 'application/json' }, cache: 'no-store' });
    } catch {
      // The start page still shows whether the session is over
    }
    location.assign('/');
  }

  // ---- Search and filters over the whole plan
  const TASK_FILTERS = [
    ['all', 'All'],
    ['blocked', 'Blocked'],
    ['waiting', 'Waiting for me'],
    ['done', 'Done'],
  ];

  /** A task has a step the person does now: it waits for them, or they can start it */
  function needsMe(task) {
    return data.plan.steps.some(
      (step) =>
        step.taskId === task.id &&
        visible(step) &&
        step.executor === 'user' &&
        (step.status === 'waiting_user' || (step.status === 'not_started' && data.derived.steps[step.id]?.readiness === 'ready')),
    );
  }

  function matchesFilter(task, filter) {
    const status = data.derived.tasks[task.id].status;
    if (filter === 'blocked') return status === 'blocked';
    if (filter === 'done') return status === 'done';
    if (filter === 'waiting') return needsMe(task);
    return true;
  }

  function searchView(query, filter) {
    const { plan, derived } = data;
    const q = query.trim().toLowerCase();
    const activeFilter = TASK_FILTERS.some(([key]) => key === filter) ? filter : 'all';
    const searching = q.length > 0;

    // A task shows when its title or one of its steps matches; the step that matched is named
    const tasks = plan.tasks
      .filter((task) => visible(task) && matchesFilter(task, activeFilter))
      .map((task) => ({
        task,
        step: searching ? plan.steps.find((step) => step.taskId === task.id && visible(step) && step.text.toLowerCase().includes(q)) : undefined,
      }))
      .filter(({ task, step }) => !searching || task.title.toLowerCase().includes(q) || step);
    const departments = searching && activeFilter === 'all' ? plan.departments.filter((item) => item.name.toLowerCase().includes(q)) : [];
    const phases = searching && activeFilter === 'all' ? plan.phases.filter((item) => item.name.toLowerCase().includes(q)) : [];
    const none = !tasks.length && !departments.length && !phases.length;

    const chips = el(
      'nav',
      { class: 'filters', 'aria-label': 'Show tasks with status' },
      TASK_FILTERS.map(([key, label]) =>
        el('a', { class: 'chip', href: `#/search?q=${enc(query)}&status=${key}`, 'aria-current': key === activeFilter ? 'true' : undefined }, label),
      ),
    );

    const body = !searching && activeFilter === 'all'
      ? el('p', { class: 'empty' }, 'Type a word to search the tasks, steps, departments and phases of this plan.')
      : none
        ? el('p', { class: 'empty' }, 'Nothing matches.')
        : el(
            'div',
            {},
            tasks.length
              ? el(
                  'ul',
                  { class: 'list' },
                  tasks.map(({ task, step }) =>
                    el(
                      'li',
                      { class: 'row' },
                      el('a', { class: 'row__name', href: taskHref(task, `phase:${task.phaseId}`) }, task.title),
                      badge(TASK_STATUS[derived.tasks[task.id].status]),
                      el('span', { class: 'row__meta row__meta--full' }, `${deptName(task.primaryDepartmentId)} · ${phaseName(task.phaseId)}${step ? ` · step: ${step.text}` : ''}`),
                    ),
                  ),
                )
              : null,
            departments.length
              ? [el('h2', { class: 'section' }, 'Departments'), el('ul', { class: 'list' }, departments.map((item) => el('li', { class: 'row' }, el('a', { class: 'row__name', href: deptHref(item.id) }, item.name))))]
              : null,
            phases.length
              ? [el('h2', { class: 'section' }, 'Phases'), el('ul', { class: 'list' }, phases.map((item) => el('li', { class: 'row' }, el('a', { class: 'row__name', href: phaseHref(item.id) }, item.name))))]
              : null,
          );

    return { title: 'Search', trail: null, heading: 'Search', body: [chips, body] };
  }

  /** The progress of the whole plan: tasks done, phases finished, and a bar of the tasks done */
  function planProgress() {
    const { plan, derived } = data;
    const tasks = plan.tasks.filter(visible);
    const done = tasks.filter((task) => derived.tasks[task.id].status === 'done').length;
    const blocked = tasks.filter((task) => derived.tasks[task.id].status === 'blocked').length;
    const finished = plan.phases.filter((phase) => derived.phases[phase.id].status === 'done').length;
    const percent = tasks.length ? (done / tasks.length) * 100 : 0;
    return el(
      'section',
      { class: 'progress', 'aria-label': 'Plan progress' },
      el(
        'p',
        { class: 'progress__text' },
        `${done} of ${tasks.length} ${plural(tasks.length, 'task')} done · ${finished} of ${plan.phases.length} ${plural(plan.phases.length, 'phase')} finished${blocked ? ` · ${blocked} blocked` : ''}`,
      ),
      el(
        'div',
        { class: 'progress__track', role: 'progressbar', 'aria-label': 'Tasks done', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(percent) },
        el('div', { class: 'progress__fill', style: { width: `${percent}%` } }),
      ),
    );
  }

  function buildPage(route) {
    switch (route.name) {
      case 'general':
        return generalView(route.all, route.allDecisions);
      case 'timeline':
        return timelineView();
      case 'decisions':
        return decisionsView();
      case 'search':
        return searchView(route.query, route.status);
      case 'dept':
        return deptView(route.id, route.status);
      case 'phase':
        return phaseView(route.id, route.status);
      case 'task':
        return taskView(route.id, route.from, route.step);
      default:
        return notFoundPage();
    }
  }

  /** Paints the page for the current hash. Focus moves to the heading when the view changes. */
  function render({ focusSelector } = {}) {
    if (!data) return;
    view.classList.remove('plan--message');
    const hash = location.hash || '#/';
    const routeChanged = hash !== lastHash;
    lastHash = hash;
    if (routeChanged) notice = null;

    const route = parseRoute(hash);
    const page = buildPage(route);
    const heading = el('h1', { class: 'page__title', tabindex: '-1' }, page.heading);
    const nodes = [
      el('p', { class: 'page__plan' }, data.title),
      planBar(route),
      tabs(route.name === 'general' ? 'overview' : route.name === 'timeline' ? 'timeline' : route.name === 'decisions' ? 'decisions' : null),
      page.trail ? crumbs(page.trail) : null,
      notice ? el('div', { class: notice.error ? 'notice notice--error' : 'notice' }, el('p', {}, notice.text), notice.items?.length ? el('ul', { class: 'plain-list' }, notice.items.map((line) => el('li', {}, line))) : null) : null,
      heading,
      page.body,
    ];
    const noticeNode = nodes.find((node) => node && node.classList?.contains('notice'));
    view.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
    document.title = `${page.title} - ${data.title} - MANDO`;
    if (routeChanged) view.scrollTop = 0;

    // The step that was acted on keeps the focus without a jump; the notice above it is brought into view
    const target = focusSelector ? view.querySelector(focusSelector) : null;
    (target ?? heading).focus({ preventScroll: Boolean(target) });
    if (noticeNode && !routeChanged) noticeNode.scrollIntoView({ block: 'nearest' });
    if (routeChanged) announce(page.title);
    else if (notice) announce(notice.text);
  }

  /** A page with no plan: the empty state, or a load error. No input fields. */
  /** A full-screen message: a box on an opaque background, with its text and one way out, aligned to the left */
  function messageBox(title, text, action) {
    return el(
      'section',
      { class: 'message' },
      el('h1', { class: 'page__title', tabindex: '-1' }, title),
      el('p', { class: 'message__text' }, text),
      el('div', { class: 'message__actions' }, action),
    );
  }

  function messagePage(title, text) {
    view.classList.add('plan--message');
    view.replaceChildren(messageBox(title, text, el('a', { class: 'btn btn--dark', href: '/' }, 'Go to the start page')));
    document.title = `${title} - MANDO`;
    announce(text);
    view.querySelector('h1').focus();
  }

  // ---- Server calls
  async function fetchPlan() {
    const response = await fetch(planUrl(), { cache: 'no-store', headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error('Request failed'), { status: response.status, code: body.code });
    return body;
  }

  async function reload() {
    try {
      data = await fetchPlan();
    } catch {
      // The copy on screen stays: the notice says what happened
    }
  }

  /** Every write: the body gets the version the screen shows, and the answer is applied or explained */
  /** What a save changed, in plain words: tasks that can now be defined, suggestions that wait, and suggestions out of date */
  function changesBetween(before, after) {
    const lines = [];
    // A gap whose last decision was answered can now be given its tasks
    const waitingFor = (derived, task) => task.placeholder.waitsFor.filter((keyId) => !derived.confirmedFacts[keyId]);
    for (const task of before.plan.tasks.filter((item) => item.placeholder)) {
      const now = byId(after.plan.tasks, task.id);
      if (now?.placeholder && waitingFor(before.derived, task).length && !waitingFor(after.derived, now).length) {
        lines.push(`${now.title}: its decisions are answered. You can ask for its tasks on Proposals.`);
      }
    }
    const waitingBefore = new Set(pendingProposals(before.plan).map((item) => item.id));
    const newDepartment = pendingProposals(after.plan).filter((item) => isDepartmentProposal(item) && !waitingBefore.has(item.id));
    for (const item of newDepartment) {
      const count = item.add.tasks.length;
      lines.push(`${count} suggested ${plural(count, 'task')} for ${deptName(item.add.tasks[0].primaryDepartmentId)} ${count === 1 ? 'is' : 'are'} waiting for your decision.`);
    }
    const outdated = (id) => after.derived.proposals[id]?.obsolete === true;
    const nowOutdated = pendingProposals(after.plan).filter((item) => outdated(item.id) && !before.derived.proposals[item.id]?.obsolete);
    if (nowOutdated.length) lines.push(`${nowOutdated.length} ${plural(nowOutdated.length, 'suggestion')} ${nowOutdated.length === 1 ? 'is' : 'are'} now out of date.`);
    return lines;
  }

  async function post(path, body, focusSelector = null, workingStepId = null) {
    if (busy || !data) return;
    busy = true;
    working = workingStepId;
    if (working) startClock();
    view.inert = true;
    Loader.show();
    // Cancel stops waiting for the answer; the server may still finish, so the plan is read again afterwards
    waitController = new AbortController();
    waitCancelled = false;
    waitCancel.hidden = false;
    if (working) render({ focusSelector });
    try {
      const response = await fetch(`${planUrl()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ ...body, expectedVersion: data.version }),
        signal: AbortSignal.any([waitController.signal, AbortSignal.timeout(PLAN_WAIT_MS)]),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        // The version does not move when the assistant had nothing new to add: nothing was saved then
        const unchanged = result.version === data.version;
        const before = data;
        data = { ...data, version: result.version, plan: result.plan, derived: result.derived };
        notice = unchanged
          ? { text: 'The assistant found nothing new to add, so nothing was saved.' }
          : { text: `Saved. The plan is at version ${result.version}.`, items: changesBetween(before, data) };
      } else if (response.status === 409 && result.code === 'version_conflict') {
        await reload();
        notice = { text: ERROR_TEXT.version_conflict, error: true };
      } else {
        notice = { text: ERROR_TEXT[result.code] ?? GENERIC_ERROR, error: true };
      }
    } catch (error) {
      if (waitCancelled) {
        // What was saved is what the server now has: the plan is read again, and the copy on screen is replaced
        await reload();
        notice = { text: 'Cancelled. The plan shows what was saved.' };
      } else if (error?.name === 'TimeoutError') {
        notice = { text: TIMEOUT_ERROR, error: true };
      } else {
        notice = { text: NETWORK_ERROR, error: true };
      }
    } finally {
      busy = false;
      working = null;
      waitController = null;
      waitCancel.hidden = true;
      stopClock();
      view.inert = false;
      await Loader.hide();
    }
    // Back where the user was, so the keyboard user keeps their place; the item may be gone after a reload
    render({ focusSelector });
  }

  /** A step action: the step keeps the focus afterwards */
  function send(stepId, body) {
    return post(`/steps/${enc(stepId)}/actions`, body, `[data-step-id="${CSS.escape(stepId)}"]`);
  }

  /** A run of an AI step (Start, or the answers): the server applies the person's action and runs the assistant in one request */
  function runStep(stepId, body) {
    return post(`/agents/steps/${enc(stepId)}/run`, body, `[data-step-id="${CSS.escape(stepId)}"]`, stepId);
  }

  /** Not signed in: a fixed text and a link back to the start page, where the sign-in is */
  function signedOutPage() {
    view.classList.add('plan--message');
    view.replaceChildren(messageBox('Log in', ERROR_TEXT.unauthenticated, el('a', { class: 'btn btn--dark', href: '/' }, 'Go to the start page')));
    document.title = 'Log in - MANDO';
    announce(ERROR_TEXT.unauthenticated);
    view.querySelector('h1').focus();
  }

  async function init() {
    planId = new URLSearchParams(location.search).get('id');
    if (!planId) return messagePage('Your plan', 'No plan to show.');
    if (!UUID.test(planId)) return messagePage('Not found', ERROR_TEXT.not_found);

    Loader.show();
    let failure = null;
    let signedOut = false;
    try {
      data = await fetchPlan();
    } catch (error) {
      signedOut = error.status === 401;
      // A missing plan, a server answer with its own code, or no answer at all: each says so
      if (error.status === 404) failure = { title: 'Plan not found', text: ERROR_TEXT.not_found };
      else if (error.status) failure = { title: 'Something went wrong', text: ERROR_TEXT[error.code] ?? GENERIC_ERROR };
      else failure = { title: 'Could not load the plan', text: NETWORK_ERROR };
    } finally {
      await Loader.hide();
    }
    if (signedOut) return signedOutPage();
    if (!data) return messagePage(failure.title, failure.text);
    render();
  }

  window.addEventListener('hashchange', () => render());
  init();
})();
