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
    version_conflict: 'The plan changed in another window. It has been reloaded; check the step and try again.',
    not_allowed: 'This action is not allowed for this step right now.',
    not_ready: 'This step is waiting for another step. It cannot start yet.',
    rounds_exceeded: 'This step has used all its rounds.',
    missing_proof: 'This step needs a proof before it can be closed.',
    output_not_confirmed: 'The output must be confirmed first.',
    executor_in_use: "Another step uses this step's result, so its executor cannot change.",
    invalid_payload: 'The information does not fit this action. Check the fields and try again.',
    invalid_executor_change: 'That executor change is not valid.',
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
    duplicate_pending: 'A suggestion for this task is already waiting for a decision.',
    id_taken: 'A suggestion for this task was already made.',
    already_decided: 'This suggestion was already decided.',
    needs_ai: 'There is no ready-made suggestion for this decision yet.',
    not_available: 'This is not available right now.',
  };
  const FACT_KEY_LABEL = {
    product_type: 'Product type',
    target_customer: 'Target customer',
    revenue_model: 'Revenue model',
    launch_channel: 'Launch channel',
  };
  const GENERIC_ERROR = 'Something went wrong on the server. Try again.';
  const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';

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
  let notice = null;
  let lastHash = null;

  // ---- DOM helpers: children are text or nodes, never HTML
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'on') {
        for (const [type, handler] of Object.entries(value)) node.addEventListener(type, handler);
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
    if (rawPath === '/' || rawPath === '') return { name: 'general' };
    if (rawPath === '/timeline') return { name: 'timeline' };
    if (rawPath === '/decisions') return { name: 'decisions' };
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
    return { name: match[1], id, from: parseFrom(params.get('from')) };
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
      link('decisions', '#/decisions', 'Decisions'),
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
  function generalView() {
    const { plan, derived } = data;
    const waiting = pendingFacts(plan).length + pendingProposals(plan).length;
    const decisionsNote = waiting
      ? el(
          'p',
          { class: 'notice' },
          `${waiting} ${plural(waiting, 'decision')} ${waiting === 1 ? 'is' : 'are'} waiting for you. `,
          el('a', { href: '#/decisions' }, 'Review them'),
        )
      : null;
    const body = plan.departments.length
      ? el(
          'ul',
          { class: 'list' },
          plan.departments.map((department) =>
            el(
              'li',
              { class: 'row' },
              el('a', { class: 'row__name', href: deptHref(department.id) }, department.name),
              badge(TIER[department.tier]),
              el('span', { class: 'row__meta' }, progressText(derived.departments[department.id])),
            ),
          ),
        )
      : el('p', {}, 'This plan has no departments.');
    return { title: data.title, trail: null, heading: data.title, body: [decisionsNote, el('h2', { class: 'section' }, 'Departments'), body] };
  }

  function deptView(id) {
    const { plan, derived } = data;
    const department = byId(plan.departments, id);
    const responsible = plan.tasks.filter((task) => task.primaryDepartmentId === id && visible(task));
    const participates = plan.tasks.filter(
      (task) => visible(task) && task.primaryDepartmentId !== id && derived.tasks[task.id]?.departments.secondary.includes(id),
    );
    const taskList = (tasks, from) =>
      tasks.length
        ? el(
            'ul',
            { class: 'list' },
            tasks.map((task) =>
              el(
                'li',
                { class: 'row' },
                el('a', { class: 'row__name', href: taskHref(task, from) }, task.title),
                badge(TASK_STATUS[derived.tasks[task.id].status]),
                el('span', { class: 'row__meta' }, phaseName(task.phaseId)),
              ),
            ),
          )
        : el('p', { class: 'empty' }, 'None.');
    return {
      title: department.name,
      trail: [{ label: 'Overview', href: '#/' }, { label: department.name }],
      heading: department.name,
      body: [
        el('p', { class: 'meta' }, badge(TIER[department.tier])),
        el('h2', { class: 'section' }, 'Responsible for'),
        taskList(responsible, `dept:${id}`),
        el('h2', { class: 'section' }, 'Takes part in'),
        taskList(participates, `dept:${id}`),
      ],
    };
  }

  function phaseView(id) {
    const { plan, derived } = data;
    const phase = byId(plan.phases, id);
    const status = derived.phases[id];
    const groups = plan.departments
      .map((department) => ({
        department,
        tasks: plan.tasks.filter((task) => task.phaseId === id && task.primaryDepartmentId === department.id && visible(task)),
      }))
      .filter((group) => group.tasks.length > 0);
    const body = groups.length
      ? groups.map((group) =>
          el(
            'section',
            { class: 'group' },
            el('h2', { class: 'section' }, group.department.name),
            el(
              'ul',
              { class: 'list' },
              group.tasks.map((task) =>
                el(
                  'li',
                  { class: 'row' },
                  el('a', { class: 'row__name', href: taskHref(task, `phase:${id}`) }, task.title),
                  badge(TASK_STATUS[derived.tasks[task.id].status]),
                ),
              ),
            ),
          ),
        )
      : el('p', { class: 'empty' }, 'This phase has no tasks yet.');
    return {
      title: phase.name,
      trail: [{ label: 'Timeline', href: '#/timeline' }, { label: phase.name }],
      heading: phase.name,
      body: [
        el('p', { class: 'meta' }, badge(TASK_STATUS[status.status]), el('span', {}, ` ${progressText(status.progress)}`)),
        body,
      ],
    };
  }

  function timelineView() {
    const { plan } = data;
    const phases = [...plan.phases].sort((a, b) => a.order - b.order);
    const placed = plan.timeline ? phases.filter((phase) => phase.startUnit !== undefined && phase.lengthUnits !== undefined) : [];
    const scale = Math.max(1, ...placed.map((phase) => phase.startUnit + phase.lengthUnits));
    const unit = plan.timeline?.unit;

    const items = phases.map((phase) => {
      const status = data.derived.phases[phase.id];
      const bar = placed.includes(phase)
        ? el(
            'div',
            { class: 'bar-track', 'aria-hidden': 'true' },
            el('div', {
              class: 'bar',
              style: `left: ${(phase.startUnit / scale) * 100}%; width: ${(phase.lengthUnits / scale) * 100}%`,
            }),
          )
        : null;
      const placement = placed.includes(phase)
        ? `Starts at ${UNIT[unit]} ${phase.startUnit}, lasts ${phase.lengthUnits} ${plural(phase.lengthUnits, UNIT[unit])}`
        : plan.timeline
          ? 'Not placed on the timeline'
          : '';
      return el(
        'li',
        { class: 'phase-item' },
        el('a', { class: 'row__name', href: phaseHref(phase.id) }, phase.name),
        badge(TASK_STATUS[status.status]),
        placement ? el('p', { class: 'meta' }, placement) : null,
        bar,
      );
    });

    const relations = plan.relations
      .filter((relation) => relation.level === 'phase')
      .map((relation) => el('li', {}, `${phaseName(relation.from)} ${relation.type === 'blocks' ? 'blocks' : 'follows'} ${phaseName(relation.to)}`));

    return {
      title: 'Timeline',
      trail: null,
      heading: 'Timeline',
      body: [
        el('p', { class: 'meta' }, plan.timeline ? `Unit: ${UNIT[unit]}` : 'This plan has no timeline; phases are listed in order.'),
        phases.length ? el('ol', { class: 'list phases' }, items) : el('p', { class: 'empty' }, 'This plan has no phases.'),
        el('h2', { class: 'section' }, 'Relations between phases'),
        relations.length ? el('ul', { class: 'plain-list' }, relations) : el('p', { class: 'empty' }, 'None.'),
      ],
    };
  }

  function taskView(id, from) {
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
        task.placeholder ? toDefineNote(task) : null,
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
          ? el('ol', { class: 'steps' }, steps.map((step) => el('li', {}, stepCard(step))))
          : el('p', { class: 'empty' }, 'This task has no steps.'),
      ],
    };
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
        ? 'To define: the suggestion for this task came from a decision that has changed. Reject it to suggest again.'
        : waiting.length
          ? 'To define: a suggestion for this task is waiting for your decision.'
          : 'To define: every decision it waits for is confirmed. You can suggest tasks on the decisions page.';
    return el('p', { class: 'notice' }, `${text} `, el('a', { href: '#/decisions' }, 'Go to decisions'));
  }

  function stepCard(step) {
    const derivedStep = data.derived.steps[step.id] ?? { readiness: 'not_applicable', availableActions: [] };
    const waitingForAssistant = step.executor === 'ai' && step.status === 'running';
    const latest = step.outputs?.at(-1);
    const rows = [
      ['Executor', step.mode ? `${EXECUTOR[step.executor]}, ${MODE[step.mode]}` : EXECUTOR[step.executor]],
      ['Status', badge(STATUS[step.status])],
    ];
    if (step.status === 'not_started') rows.push(['Readiness', READINESS[derivedStep.readiness] ?? '']);
    rows.push(['Evidence', EVIDENCE[step.evidence.kind]], ['Proof', step.proof ? step.proof.text : 'None yet']);

    return el(
      'article',
      { class: 'step', tabindex: '-1', 'data-step-id': step.id },
      el('h3', { class: 'step__title' }, step.text),
      facts(rows),
      waitingForAssistant ? el('p', { class: 'waiting' }, 'Waiting for the assistant') : null,
      step.outputs?.length ? outputList(step.outputs) : null,
      actionArea(step, derivedStep.availableActions.filter((action) => action !== 'attach_output'), latest),
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

  function actionArea(step, available, latest) {
    const buttons = available.filter((action) => BUTTON_ACTIONS.includes(action));
    const parts = [];
    if (available.includes('answer') && latest?.state === 'draft' && latest.questions.length) {
      parts.push(answerForm(step.id, latest.questions));
    }
    if (available.includes('submit_proof')) parts.push(proofForm(step.id));
    if (available.includes('change_executor')) parts.push(executorForm(step));
    if (buttons.length) {
      parts.push(
        el(
          'div',
          { class: 'actions', role: 'group', 'aria-label': 'Step actions' },
          buttons.map((action) =>
            el('button', { type: 'button', class: 'btn btn--outline', disabled: busy ? true : undefined, on: { click: () => send(step.id, { action }) } }, ACTION_LABEL[action]),
          ),
        ),
      );
    }
    if (!parts.length) return el('p', { class: 'empty' }, 'No actions available right now.');
    return el('div', { class: 'step__actions' }, parts);
  }

  function answerForm(stepId, questions) {
    return el(
      'form',
      {
        class: 'form',
        on: {
          submit: (event) => {
            event.preventDefault();
            const answers = questions.map((_, index) => event.currentTarget.elements[`answer-${index}`].value.trim());
            send(stepId, { action: 'answer', payload: { answers } });
          },
        },
      },
      el('fieldset', { class: 'form__fieldset' }, [
        el('legend', { class: 'form__legend' }, 'Answer the questions'),
        questions.map((question, index) =>
          el('div', { class: 'field' }, [
            el('label', { for: `${stepId}-answer-${index}` }, question.question),
            el('textarea', { id: `${stepId}-answer-${index}`, name: `answer-${index}`, required: true, maxlength: 1000, rows: 2 }),
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

  // ---- Decisions: facts to confirm, a new decision, gaps, and suggestions
  function decisionsView() {
    const { plan, derived, catalog } = data;
    const planFacts = plan.facts ?? [];
    const confirmed = planFacts.filter((fact) => fact.status === 'confirmed');
    const waiting = pendingFacts(plan);
    const closed = planFacts.filter((fact) => fact.status === 'superseded' || fact.status === 'rejected');
    const pending = pendingProposals(plan);
    const decided = (plan.proposals ?? []).filter((item) => item.status !== 'pending');
    const gaps = plan.tasks.filter((task) => task.placeholder);
    const staleTitles = derived.stale.taskIds.map((id) => byId(plan.tasks, id)?.title).filter(Boolean);
    const sourceText = (fact) => (fact.from.kind === 'user' ? 'Entered by you' : 'Suggested by the assistant');

    const stale = staleTitles.length
      ? el(
          'section',
          { class: 'notice', 'aria-label': 'Items that need a review' },
          el('p', {}, 'These items came from a decision that has changed.'),
          el('ul', { class: 'plain-list' }, staleTitles.map((title) => el('li', {}, title))),
        )
      : null;

    const confirmedList = confirmed.length
      ? el('ul', { class: 'list' }, confirmed.map((fact) => el('li', { class: 'row', 'data-fact-id': fact.id }, el('span', { class: 'row__name' }, factLabel(fact)), el('span', { class: 'row__meta' }, sourceText(fact)))))
      : el('p', { class: 'empty' }, 'No decisions confirmed yet.');

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
      : el('p', { class: 'empty' }, 'Nothing is waiting for you.');

    const closedFold = closed.length
      ? el(
          'details',
          { class: 'fold' },
          el('summary', {}, `Replaced or rejected (${closed.length})`),
          el('ul', { class: 'plain-list' }, closed.map((fact) => el('li', {}, `${factLabel(fact)}: ${fact.status === 'rejected' ? 'Rejected' : 'Replaced'}`))),
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

    const proposalItems = pending.length
      ? pending.map((item) => {
          const summary = derived.proposals[item.id] ?? { tasks: 0, steps: 0, titles: [], obsolete: false };
          const forTask = item.reason.taskId ? byId(plan.tasks, item.reason.taskId)?.title : null;
          // An obsolete suggestion can only be rejected: accepting it would be refused
          return el(
            'article',
            { class: 'step', 'data-proposal-id': item.id },
            el('h3', { class: 'step__title' }, 'Suggested tasks'),
            summary.obsolete ? el('p', { class: 'notice' }, 'This suggestion came from a decision that has changed.') : null,
            facts([
              ['For', forTask ?? 'A decision'],
              ['Adds', `${summary.tasks} ${plural(summary.tasks, 'task')} and ${summary.steps} ${plural(summary.steps, 'step')}`],
            ]),
            el('ol', { class: 'list' }, summary.titles.map((title) => el('li', { class: 'output' }, title))),
            el(
              'div',
              { class: 'actions', role: 'group', 'aria-label': 'Suggestion decision' },
              summary.obsolete ? null : el('button', { type: 'button', class: 'btn btn--dark', disabled: busy ? true : undefined, on: { click: () => post(`/proposals/${enc(item.id)}/accept`, {}) } }, 'Accept'),
              el('button', { type: 'button', class: 'btn btn--outline', disabled: busy ? true : undefined, on: { click: () => post(`/proposals/${enc(item.id)}/reject`, {}) } }, 'Reject'),
            ),
          );
        })
      : [el('p', { class: 'empty' }, 'No suggestions are waiting.')];

    const decidedFold = decided.length
      ? el(
          'details',
          { class: 'fold' },
          el('summary', {}, `Decided suggestions (${decided.length})`),
          el('ul', { class: 'plain-list' }, decided.map((item) => el('li', {}, `${item.status === 'accepted' ? 'Accepted' : 'Rejected'}: ${derived.proposals[item.id]?.titles.join(', ') ?? item.id}`))),
        )
      : null;

    return {
      title: 'Decisions',
      trail: null,
      heading: 'Decisions',
      body: [
        stale,
        el('h2', { class: 'section' }, 'Facts'),
        el('h3', { class: 'step__sub' }, 'Confirmed'),
        confirmedList,
        el('h3', { class: 'step__sub' }, 'Waiting for your decision'),
        waitingList,
        closedFold,
        el('h2', { class: 'section' }, 'Add a decision'),
        decisionForm(catalog),
        el('h2', { class: 'section' }, 'To define'),
        gapItems,
        el('h2', { class: 'section' }, 'Suggestions'),
        proposalItems,
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
      heading: 'Not found',
      body: [el('p', {}, 'There is nothing at this address.'), el('p', {}, el('a', { href: '#/' }, 'Go to the plan overview'))],
    };
  }

  function buildPage(route) {
    switch (route.name) {
      case 'general':
        return generalView();
      case 'timeline':
        return timelineView();
      case 'decisions':
        return decisionsView();
      case 'dept':
        return deptView(route.id);
      case 'phase':
        return phaseView(route.id);
      case 'task':
        return taskView(route.id, route.from);
      default:
        return notFoundPage();
    }
  }

  /** Paints the page for the current hash. Focus moves to the heading when the view changes. */
  function render({ focusSelector } = {}) {
    if (!data) return;
    const hash = location.hash || '#/';
    const routeChanged = hash !== lastHash;
    lastHash = hash;
    if (routeChanged) notice = null;

    const route = parseRoute(hash);
    const page = buildPage(route);
    const heading = el('h1', { class: 'page__title', tabindex: '-1' }, page.heading);
    const nodes = [
      el('p', { class: 'page__plan' }, data.title),
      tabs(route.name === 'general' ? 'overview' : route.name === 'timeline' ? 'timeline' : route.name === 'decisions' ? 'decisions' : null),
      page.trail ? crumbs(page.trail) : null,
      notice ? el('p', { class: notice.error ? 'notice notice--error' : 'notice' }, notice.text) : null,
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
  function messagePage(title, text) {
    view.replaceChildren(el('h1', { class: 'page__title', tabindex: '-1' }, title), el('p', { class: 'empty' }, text));
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
  async function post(path, body, focusSelector = null) {
    if (busy || !data) return;
    busy = true;
    view.inert = true;
    Loader.show();
    try {
      const response = await fetch(`${planUrl()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ ...body, expectedVersion: data.version }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        data = { ...data, version: result.version, plan: result.plan, derived: result.derived };
        notice = { text: `Saved. The plan is at version ${result.version}.` };
      } else if (response.status === 409 && result.code === 'version_conflict') {
        await reload();
        notice = { text: ERROR_TEXT.version_conflict, error: true };
      } else {
        notice = { text: ERROR_TEXT[result.code] ?? GENERIC_ERROR, error: true };
      }
    } catch {
      notice = { text: NETWORK_ERROR, error: true };
    } finally {
      busy = false;
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

  async function init() {
    planId = new URLSearchParams(location.search).get('id');
    if (!planId) return messagePage('Your plan', 'No plan to show.');
    if (!UUID.test(planId)) return messagePage('Not found', ERROR_TEXT.not_found);

    Loader.show();
    let failure = null;
    try {
      data = await fetchPlan();
    } catch (error) {
      failure = error.status === 404 ? ERROR_TEXT.not_found : GENERIC_ERROR;
    } finally {
      await Loader.hide();
    }
    if (!data) return messagePage('Plan not found', failure);
    render();
  }

  window.addEventListener('hashchange', () => render());
  init();
})();
