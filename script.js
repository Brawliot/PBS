(() => {
  // ---------------------------------------------------------------------------
  // Field errors: one helper pair for every form (search, sliders, auth dialogs)
  // ---------------------------------------------------------------------------
  const errors = new WeakMap(); // input -> its <p class="field-error">
  let errorCount = 0;

  const toggleToken = (el, attr, token, on) => {
    const tokens = new Set((el.getAttribute(attr) || '').split(' ').filter(Boolean));
    if (on) tokens.add(token); else tokens.delete(token);
    if (tokens.size) el.setAttribute(attr, [...tokens].join(' '));
    else el.removeAttribute(attr);
  };

  const getError = (input) => {
    if (!errors.has(input)) {
      const error = document.createElement('p');
      error.className = 'field-error';
      error.id = `field-error-${++errorCount}`;
      error.hidden = true;
      // Right after the label (or its hint) for fields inside a <label>; else after the input
      const anchor = input.closest('label') ?? input;
      const hint = anchor.nextElementSibling;
      (hint?.classList.contains('auth__hint') ? hint : anchor).after(error);
      errors.set(input, error);
    }
    return errors.get(input);
  };

  const showFieldError = (input, message) => {
    const error = getError(input);
    if (message) error.textContent = message;
    error.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    toggleToken(input, 'aria-describedby', error.id, true);
  };

  const clearFieldError = (input) => {
    const error = errors.get(input);
    if (error) {
      error.hidden = true;
      toggleToken(input, 'aria-describedby', error.id, false);
    }
    input.removeAttribute('aria-invalid');
  };

  const labelOf = (input) => input.labels[0].textContent.trim();

  // ---------------------------------------------------------------------------
  // Dialogs: login / register (auth-modal) and login-required (gate-modal)
  // ---------------------------------------------------------------------------
  const authDialog = document.getElementById('auth-modal');
  const gate = document.getElementById('gate-modal');
  const detailDialog = document.getElementById('detail-modal');
  const authTitle = document.getElementById('auth-title');
  const authForms = [...authDialog.querySelectorAll('.auth')];
  const titles = { login: 'Log In', register: 'Register' };

  // The page styles itself differently while any dialog is open (see body.modal-open)
  const syncModalState = () => {
    document.body.classList.toggle('modal-open', !!document.querySelector('dialog[open]'));
  };

  const restartDialog = document.getElementById('restart-modal');

  [authDialog, gate, detailDialog, restartDialog].forEach((dialog) => {
    // Close on backdrop click, but not when a drag that started inside ends outside
    let pressedOnBackdrop = false;
    dialog.addEventListener('mousedown', (e) => { pressedOnBackdrop = e.target === dialog; });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog && pressedOnBackdrop) dialog.close();
    });
    dialog.addEventListener('close', syncModalState);
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  });

  const openAuth = (mode) => {
    authForms.forEach((form) => { form.hidden = form.dataset.form !== mode; });
    authTitle.textContent = titles[mode];
    authDialog.showModal();
    syncModalState();
  };

  // The "At least 8 characters." hint repeats the length error, so it steps aside while that error shows
  const setHintShown = (form, shown) => {
    const hint = form.querySelector('.auth__hint');
    if (!hint) return;
    const { password } = form.elements;
    hint.hidden = !shown;
    toggleToken(password, 'aria-describedby', hint.id, shown);
  };

  const validateAuth = (form) => {
    const { email, password, password2, name } = form.elements;
    const register = form.dataset.form === 'register';
    const invalid = [];
    const fail = (input, message) => { showFieldError(input, message); invalid.push(input); };

    form.querySelectorAll('input').forEach((input) => {
      if (input.value.trim() === '') fail(input, `${labelOf(input)} is required.`);
    });
    if (email.value && !email.checkValidity()) {
      fail(email, 'Enter a valid email address.');
    }
    if (register && name.value.trim() !== '' && name.value.trim().length < 2) {
      fail(name, 'Name must be at least 2 characters.');
    }
    if (register && password.value && password.value.length < password.minLength) {
      fail(password, `Password must be at least ${password.minLength} characters.`);
      setHintShown(form, false);
    }
    if (register && password.value && password2.value && password.value !== password2.value) {
      fail(password2, 'Passwords do not match.');
    }

    invalid[0]?.focus();
    return invalid.length === 0;
  };

  // Fixed English texts for the codes the sign-in routes send. The server text is never shown.
  const AUTH_FIELD_TEXT = {
    email_taken: 'An account with this email already exists.',
    invalid_email: 'Enter a valid email address.',
    invalid_name: 'Name must be 2 to 100 characters.',
    invalid_password: 'Password must be 8 to 64 characters, with no control characters.',
  };
  const AUTH_FORM_TEXT = {
    invalid_credentials: 'The email or the password is not right.',
    too_many_attempts: 'Too many attempts. Try again in a few minutes.',
    storage_unavailable: 'Accounts are not available right now. Try again later.',
  };
  const NO_CONNECTION_TEXT = 'Could not reach the server. Check your connection and try again.';
  const GENERIC_AUTH_TEXT = 'Something went wrong. Please try again.';

  const formError = (form) => form.querySelector('.auth__error');
  const showFormError = (form, message) => { formError(form).textContent = message; formError(form).hidden = false; };
  const hideFormError = (form) => { formError(form).hidden = true; formError(form).textContent = ''; };

  const setBusy = (form, busy) => {
    form.setAttribute('aria-busy', String(busy));
    form.querySelector('button[type="submit"]').disabled = busy;
  };

  // The signed-in user, or null. Null until the first answer, so the header does not flash the wrong state.
  let currentUser = null;
  const renderHeader = (ready = true) => {
    const guest = document.getElementById('nav-guest');
    const user = document.getElementById('nav-user');
    guest.hidden = !ready || currentUser !== null;
    user.hidden = !ready || currentUser === null;
    document.getElementById('avatar').textContent = (currentUser?.name.trim()[0] ?? '?').toUpperCase();
  };

  const submitAuth = async (form) => {
    const register = form.dataset.form === 'register';
    const { email, password, name } = form.elements;
    const body = register
      ? { name: name.value.trim(), email: email.value.trim(), password: password.value }
      : { email: email.value.trim(), password: password.value };
    setBusy(form, true);
    let res;
    let data = {};
    try {
      res = await fetch(register ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      data = await res.json().catch(() => ({}));
    } catch {
      setBusy(form, false);
      return showFormError(form, NO_CONNECTION_TEXT);
    }
    setBusy(form, false);
    if (res.ok) {
      currentUser = data.user ?? null;
      renderHeader();
      authDialog.close();
      return;
    }
    const fieldInput = { email_taken: email, invalid_email: email, invalid_name: name, invalid_password: password }[data.code];
    if (fieldInput) {
      showFieldError(fieldInput, AUTH_FIELD_TEXT[data.code]);
      fieldInput.focus();
      return;
    }
    if (data.code === 'invalid_credentials') {
      // The password is the field to correct: it is cleared, and the focus goes to it
      password.value = '';
      showFormError(form, AUTH_FORM_TEXT.invalid_credentials);
      password.focus();
      return;
    }
    showFormError(form, AUTH_FORM_TEXT[data.code] ?? GENERIC_AUTH_TEXT);
  };

  authForms.forEach((form) => {
    form.addEventListener('input', (e) => {
      clearFieldError(e.target);
      if (e.target === form.elements.password) setHintShown(form, true);
      // Fixing the first password should re-check an existing "do not match" error
      const { password, password2 } = form.elements;
      if (e.target === password && password2?.hasAttribute('aria-invalid') && password2.value) {
        if (password.value === password2.value) clearFieldError(password2);
        else showFieldError(password2, 'Passwords do not match.');
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      form.querySelectorAll('input').forEach(clearFieldError);
      hideFormError(form);
      setHintShown(form, true);
      if (!validateAuth(form)) return;
      await submitAuth(form);
    });
  });

  authDialog.addEventListener('close', () => {
    authForms.forEach((form) => {
      form.reset();
      form.querySelectorAll('input').forEach(clearFieldError);
      setHintShown(form, true);
    });
  });

  document.querySelectorAll('[data-auth]').forEach((button) => {
    button.addEventListener('click', () => openAuth(button.dataset.auth));
  });
  document.querySelectorAll('[data-gate]').forEach((button) => {
    button.addEventListener('click', () => {
      gate.close();
      openAuth(button.dataset.gate);
    });
  });

  // ---------------------------------------------------------------------------
  // Search form: idea text + four sliders, all required
  // ---------------------------------------------------------------------------
  const formatters = {
    currency: (v) => '$' + v.toLocaleString('en-US'),
    years: (v, max) => (v >= max ? `${max}+ years` : `${v} ${v === 1 ? 'year' : 'years'}`),
  };

  const formatValue = (range) => {
    const v = Number(range.value);
    if (range.dataset.labels) return range.dataset.labels.split('|')[v] ?? String(v);
    return formatters[range.dataset.format](v, Number(range.max));
  };

  const search = document.querySelector('.search');
  const idea = search.querySelector('.search__input');
  const ranges = [...search.querySelectorAll('.range')];

  // The idea field uses the error element that already exists in the markup
  errors.set(idea, document.getElementById('search-error'));
  idea.addEventListener('input', () => {
    clearFieldError(idea);
    resetFlow();
  });

  // Sliders always hold a value, so "untouched" is tracked separately (is-set).
  // The first user input marks a slider as set; the initial value is only an example.
  // Choosing a slider: the value it shows counts as chosen, even when it does not change (Solo is the
  // start value of Team size, and a click or Home on it fires no input event). Tab does not choose it.
  const MOVE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
  const markSet = (range) => {
    range.classList.add('is-set');
    range.style.setProperty('--fill', `${((range.value - range.min) / (range.max - range.min)) * 100}%`); // dark part of the track, up to the thumb
    const output = range.closest('.filter').querySelector('output');
    output.classList.remove('is-example');
    output.value = formatValue(range);
    toggleToken(range, 'aria-describedby', 'slider-hint', false);
    clearFieldError(range);
    resetFlow();
  };

  ranges.forEach((range) => {
    range.closest('.filter').querySelector('output').classList.add('is-example');

    range.addEventListener('input', () => markSet(range));
    range.addEventListener('pointerup', () => markSet(range)); // a click on the track or the thumb
    range.addEventListener('keydown', (e) => { if (MOVE_KEYS.includes(e.key)) markSet(range); });
  });

  // Example ideas: a click fills the idea field, as if the person had typed it
  document.querySelectorAll('.hints__chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      idea.value = chip.textContent;
      idea.dispatchEvent(new Event('input', { bubbles: true }));
      idea.focus();
    });
  });

  // The header shows one of two states: Log In / Register, or the profile circle with "View my projects" on its right.
  // Both stay hidden until the server has said who is signed in (GET /api/auth/session never fails with 401).
  const sessionReady = fetch('/api/auth/session', { cache: 'no-store' })
    .then((res) => res.json())
    .then((data) => { currentUser = data.user ?? null; })
    .catch(() => { currentUser = null; })
    .then(() => renderHeader());

  // The profile circle opens a small menu with "Log out"
  const avatar = document.getElementById('avatar');
  const profileMenu = document.getElementById('profile-menu');
  const setMenu = (open) => {
    profileMenu.hidden = !open;
    avatar.setAttribute('aria-expanded', String(open));
    if (open) profileMenu.querySelector('[role="menuitem"]').focus();
  };
  avatar.addEventListener('click', () => setMenu(profileMenu.hidden));
  profileMenu.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    setMenu(false);
    avatar.focus();
  });
  // Leaving the menu with the keyboard or a click outside closes it
  document.addEventListener('click', (e) => {
    if (!profileMenu.hidden && !profileMenu.contains(e.target) && e.target !== avatar) setMenu(false);
  });
  document.getElementById('logout').addEventListener('click', async () => {
    const res = await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' }).catch(() => null);
    if (!res || res.status !== 204) return; // still signed in: the menu stays open
    currentUser = null;
    setMenu(false);
    renderHeader();
    document.querySelector('#nav-guest [data-auth="login"]').focus();
  });

  // --- Sending: title leaves, loader runs while the request is pending -------
  const EXIT_MS = 850;        // subtitle exit + title-to-loader travel to the centre (keep in sync with CSS)
  const MIN_LOADER_MS = 1500; // visible time of the loader, so it never flashes
  const FADE_MS = 700;        // loader travels back and fades out (keep in sync with CSS)
  const FINISH_MS = 350;      // loader fades out in place before the result (keep in sync with CSS)
  const START_TIMEOUT_MS = 15_000; // the POST only starts the job, so it answers fast
  const POLL_MS = 1500;            // wait between status checks
  const POLL_TIMEOUT_MS = 15_000;  // one status check
  const JOB_TIMEOUT_MS = 180_000;  // total time before giving up on the analysis
  const MAX_NETWORK_ERRORS = 3;    // failed status checks in a row before giving up
  const status = document.getElementById('status');
  const loaderSlot = document.querySelector('.hero__loader');
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let loader = null;
  let sending = false;

  // Submit error: a dismissable box under the search block
  const submitError = document.getElementById('submit-error');
  const showSubmitError = (message, { retry = false } = {}) => {
    document.getElementById('submit-error-text').textContent = message;
    document.getElementById('submit-error-retry').hidden = !retry;
    submitError.classList.add('is-open');
  };
  const hideSubmitError = () => submitError.classList.remove('is-open');
  document.getElementById('submit-error-close').addEventListener('click', () => {
    hideSubmitError();
    idea.focus();
  });
  document.getElementById('submit-error-retry').addEventListener('click', () => {
    if (sending) return;
    hideSubmitError();
    submitIdea();
  });

  // A user-facing error: the UI shows userMessage, and retryable decides on the Retry button
  const userError = (message, retryable) => {
    const error = new Error(message);
    error.userMessage = message;
    error.retryable = retryable;
    return error;
  };

  // One request with a timeout. Network failures and timeouts become user errors.
  const requestJson = async (url, options, timeoutMs) => {
    let res;
    try {
      res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw userError('The request took too long. Please try again.', true);
      }
      if (err instanceof TypeError) {
        throw userError('Could not reach the server. Check your connection.', true);
      }
      throw err;
    }
    const data = await res.json().catch(() => ({}));
    return { res, data };
  };

  // The session has ended: the send stops and the sign-in dialog opens, with no error text
  const signedOutError = () => {
    const error = userError('', false);
    error.signedOut = true;
    return error;
  };

  // Server error response (4xx, 5xx): 5xx can be retried, 4xx shows the server's message
  const httpError = (res, data) => {
    const message = (typeof data.error === 'string' && data.error.trim()) ? data.error : 'Something went wrong. Please try again.';
    return userError(message, res.status >= 500);
  };

  // Starts the planner job, then polls it until the result is ready
  const sendIdea = async (payload) => {
    const start = await requestJson('/api/planner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, START_TIMEOUT_MS);
    if (start.res.status === 401) throw signedOutError();
    if (!start.res.ok) throw httpError(start.res, start.data);
    if (start.res.status !== 202 || typeof start.data.jobId !== 'string') {
      throw userError('Something went wrong. Please try again.', true);
    }

    const deadline = Date.now() + JOB_TIMEOUT_MS;
    let networkErrors = 0;
    while (Date.now() < deadline) {
      await wait(POLL_MS);
      let poll;
      try {
        poll = await requestJson(`/api/planner/${start.data.jobId}`, {}, POLL_TIMEOUT_MS);
      } catch {
        if (++networkErrors >= MAX_NETWORK_ERRORS) {
          throw userError('Could not reach the server. Check your connection.', true);
        }
        continue;
      }
      networkErrors = 0;

      // 404: the server restarted or the job expired, so it cannot be recovered
      if (poll.res.status === 401) throw signedOutError();
      if (poll.res.status === 404) throw userError('The analysis was interrupted. Please try again.', true);
      if (!poll.res.ok) throw httpError(poll.res, poll.data);
      if (poll.data.status === 'done') return poll.data.result;
      if (poll.data.status === 'error') {
        throw userError(poll.data.message || 'Something went wrong. Please try again.', true);
      }
    }
    throw userError('The request took too long. Please try again.', true);
  };

  const startLoading = () => {
    sending = true;
    search.setAttribute('aria-busy', 'true');
    search.inert = true;
    // Distance from the title to the centre of the screen, where the loader ends up
    const slot = loaderSlot.getBoundingClientRect();
    loaderSlot.style.setProperty('--loader-dy', `${innerHeight / 2 - (slot.top + slot.height / 2)}px`);
    // The search block contracts towards the same point the loader travels to
    search.style.setProperty('--origin-y', `${innerHeight / 2 - search.getBoundingClientRect().top}px`);
    document.body.classList.add('is-loading');
    loader = Loader.mount(loaderSlot);
  };

  const stopLoading = async () => {
    document.body.classList.remove('is-loading');
    await wait(FADE_MS);
    loader.destroy();
    loader = null;
    search.inert = false;
    search.removeAttribute('aria-busy');
    sending = false;
  };

  // Question flow: the first response carries the questions, asked one by one. Once they are
  // all answered, one final request sends the answers and returns the profile.
  let answers = [];   // { topic, question, answer } given so far
  let asked = [];     // the question objects answered so far, in the same order as answers (for Back)
  let queue = [];     // received questions not asked yet
  let current = null; // question on screen
  let total = 0;      // number of questions in this session
  let analysis = null; // phase 2 analysis from the first response
  let reportId = null; // id of the report the server kept for this analysis (see POST /api/plan)
  const CLAIM_KEYS = ['subsector', 'location', 'target_customer', 'value_proposition', 'revenue_model', 'stage', 'competition'];

  const resetFlow = () => {
    answers = [];
    asked = [];
    queue = [];
    current = null;
    analysis = null;
    reportId = null;
  };

  const nextQuestion = () => {
    current = queue.shift() ?? null;
    if (!current) return false;
    showQuestion(current.question, `Question ${answers.length + 1} of ${total}`, current.options ?? []);
    status.textContent = current.question;
    return true;
  };

  const submitIdea = async () => {
    const input = {
      idea: idea.value.trim(),
      ...Object.fromEntries(ranges.map((range) => [range.id, Number(range.value)])),
    };
    const payload = {
      ...input,
      answers,
      final: answers.length > 0,
      // The final request validates the analysis, so it needs the values the first one produced
      analysis: Object.fromEntries(CLAIM_KEYS.map((key) => [key, analysis?.[key]?.value])),
    };
    let failed = false;
    let profile = null;
    let validation = null;
    let error = null;

    hideSubmitError();
    if (!loader) startLoading();
    status.textContent = 'Sending your idea…';
    try {
      // The first request also waits for the animation and the minimum loader time
      const [result] = await Promise.all([
        sendIdea(payload),
        answers.length === 0 ? wait(EXIT_MS + MIN_LOADER_MS) : null,
      ]);
      analysis = result.phase2 ?? analysis;
      profile = result.profile ?? null;
      validation = result.validation ?? null;
      if (profile) reportId = result.reportId ?? null;
      if (!profile) {
        queue = result.phase2?.questions ?? [];
        total = result.questionTotal ?? queue.length;
        if (nextQuestion()) return; // the loader stays under the popup
        throw new Error('No questions and no profile');
      }
    } catch (err) {
      failed = true;
      error = err;
      if (!err.signedOut) status.textContent = err.userMessage || 'Something went wrong. Please try again.';
    }
    if (failed && error?.signedOut) {
      await stopLoading();
      currentUser = null;
      renderHeader();
      resetFlow();
      gate.showModal();
      syncModalState();
      return;
    }
    if (failed) {
      await stopLoading();
      showSubmitError(error.userMessage || 'Something went wrong. Please try again.', { retry: error?.retryable });
      idea.focus();
    } else {
      await revealResult(analysis, profile, validation);
    }
  };

  // --- Result: what we understood, what is still open, and the full detail -------
  const resultSection = document.getElementById('result');
  const LABELS = {
    customer_segment: 'Customers',
    revenue_model: 'Revenue model',
    offering_type: 'What you offer',
    acquisition_channel: 'Getting customers',
    competition: 'Competition',
    differentiator: 'What sets you apart',
    validation_stage: 'Validation',
    founder_profile: 'Your background',
    deadline_rigidity: 'Deadline',
    capital_intensity: 'Capital needed',
    team_requirement: 'Team needed',
    time_to_revenue: 'Time to first revenue',
    regulatory_load: 'Regulation',
    third_party_dependency: 'Dependence on others',
    money_handling: 'Handling other people\u2019s money',
  };
  const SUMMARY_KEYS = ['customer_segment', 'revenue_model', 'offering_type', 'validation_stage', 'competition', 'differentiator'];
  const PENDING_KEYS = ['validation_stage', 'customer_segment', 'revenue_model', 'acquisition_channel', 'regulatory_load', 'money_handling'];
  const NOT_DEFINED = 'Not specified';

  const addRow = (list, term, value, empty = false) => {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = term;
    dd.textContent = value;
    dd.classList.toggle('is-empty', empty);
    row.append(dt, dd);
    list.append(row);
  };

  // Values come from the models: always inserted as text, never as HTML
  const WARNINGS = {
    budget_fit: 'The budget may not be enough for this business.',
    timeline_realistic: 'The timeline looks tight for the current stage.',
    team_fit: 'The team or the weekly hours may fall short.',
    experience_fit: 'The business may need more experience than you have.',
    model_fit: 'The revenue model may not fit the type of customer.',
    regulation_fit: 'The regulation may be hard to meet with these resources.',
    consistency: 'Some details of the description seem to contradict each other.',
  };

  const showResult = (phase2, profile, validation) => {
    const summary = document.getElementById('result-summary');
    const pending = document.getElementById('result-pending');
    const detail = document.getElementById('result-detail');
    const warnings = document.getElementById('result-warnings');
    const topDepartments = document.getElementById('result-departments-top');
    const departmentList = document.getElementById('result-departments');
    const detailPending = document.getElementById('detail-pending');
    [summary, pending, detail, detailPending, warnings, topDepartments, departmentList].forEach((el) => el.replaceChildren());

    // A value the description does not back up is never shown as fact: it goes to "still to define"
    const unsupported = validation?.unsupported ?? [];
    const subsector = phase2?.subsector?.value;
    const subsectorShown = subsector && subsector.toLowerCase() !== 'unknown' && !unsupported.includes('subsector');
    if (subsectorShown) addRow(summary, 'Business', subsector);
    SUMMARY_KEYS.filter((key) => profile.values[key] !== NOT_DEFINED)
      .forEach((key) => addRow(summary, LABELS[key], profile.values[key]));
    if (!summary.children.length) addRow(summary, 'Business', 'Not enough information yet', true);

    const addItem = (list, text) => {
      const item = document.createElement('li');
      item.textContent = text;
      list.append(item);
    };
    const pendingLabels = [
      ...(unsupported.includes('subsector') ? ['Business details'] : []),
      ...PENDING_KEYS.filter((key) => profile.unknown.includes(key)).map((key) => LABELS[key]),
    ];
    // Lists show a few items; the rest are said in words, so nothing is cut without notice
    const addMore = (list, count, text) => {
      if (count <= 0) return;
      const item = document.createElement('li');
      item.className = 'is-more';
      item.textContent = text ?? `and ${count} more`;
      list.append(item);
    };
    const pendingShown = pendingLabels.slice(0, 5);
    pendingShown.forEach((label) => addItem(pending, label));
    addMore(pending, pendingLabels.length - pendingShown.length);
    document.getElementById('result-pending-block').hidden = !pending.children.length;

    const warningKeys = validation?.warnings ?? [];
    warningKeys.slice(0, 3).forEach((key) => addItem(warnings, WARNINGS[key]));
    addMore(warnings, warningKeys.length - 3, `and ${warningKeys.length - 3} more to check in the full detail`);
    document.getElementById('result-warnings-block').hidden = !warnings.children.length;

    // Small businesses see the groups, larger ones the departments. Light areas stay in the popup
    const TIERS = { core: 'Essential', important: 'Recommended', light: 'Optional' };
    const areas = validation ? (validation.level === 2 ? validation.departments : validation.groups) : [];
    const mainAreas = areas.filter(({ tier }) => tier !== 'light');
    mainAreas.slice(0, 4).forEach(({ name, tier }) => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      const chip = document.createElement('span');
      label.textContent = name;
      chip.className = `tier tier--${tier}`;
      chip.textContent = TIERS[tier];
      item.append(label, chip);
      topDepartments.append(item);
    });
    addMore(topDepartments, areas.length - Math.min(mainAreas.length, 4), `and ${areas.length - Math.min(mainAreas.length, 4)} more in the full detail`);
    document.getElementById('result-departments-block').hidden = !topDepartments.children.length;
    // The same tier marks as the card, one row per area
    areas.forEach(({ name, tier }) => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      const chip = document.createElement('span');
      label.textContent = name;
      chip.className = `tier tier--${tier}`;
      chip.textContent = TIERS[tier];
      item.append(label, chip);
      departmentList.append(item);
    });
    document.getElementById('detail-areas-block').hidden = !areas.length;

    // What is known is listed in full; what is still open is only a list of names
    const openLabels = [];
    Object.entries(LABELS).forEach(([key, label]) => {
      const value = profile.values[key];
      if (value && value !== NOT_DEFINED) addRow(detail, label, value);
      else openLabels.push(label);
    });
    openLabels.forEach((label) => addItem(detailPending, label));
    // A long sentence reads better under its label than squeezed to the right
    [...detail.children].forEach((row) => row.classList.toggle('is-long', row.querySelector('dd').textContent.length > 40));
    document.getElementById('detail-defined-block').hidden = !detail.children.length;
    document.getElementById('detail-pending-block').hidden = !openLabels.length;

    document.getElementById('result-meta').textContent = `${profile.known} of ${profile.total} topics defined`;
    document.getElementById('detail-meta').textContent = `${profile.known} of ${profile.total} topics defined`;
    document.getElementById('result-hint').hidden = profile.known > 0;
    // A plan is built from the saved report only; without one the button says why it cannot be used
    document.getElementById('result-plan').disabled = !reportId;
    document.getElementById('result-plan-note').hidden = !!reportId;
    // The report is the only thing to read now: the header behind it cannot take the focus
    document.querySelector('.header').inert = true;
    document.getElementById('result-bar').style.width = '0';
    document.body.classList.add('has-result');
    resultSection.hidden = false;
    status.textContent = 'Your analysis is ready.';
    resultSection.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      document.getElementById('result-bar').style.width = `${Math.round((profile.known / profile.total) * 100)}%`;
    });
  };

  // Loader -> result without going back to the initial page: the loader fades out where it is,
  // then the hero goes away, the giant wordmark slides up to its new place and the result fades in
  const revealResult = async (phase2, profile, validation) => {
    document.body.classList.add('is-finishing');
    await wait(FINISH_MS);

    const giant = document.querySelector('.giant');
    const letter = giant.querySelector('.giant__letter');
    const before = letter.getBoundingClientRect().top;

    showResult(phase2, profile, validation);
    document.body.classList.remove('is-loading', 'is-finishing');
    loader.destroy();
    loader = null;
    search.inert = false;
    search.removeAttribute('aria-busy');
    sending = false;

    // The hero is gone, so the wordmark's box grew and its letters jumped up: slide them instead
    const shift = before - letter.getBoundingClientRect().top;
    if (shift && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      giant.animate(
        [{ transform: `translateY(${shift}px)` }, { transform: 'translateY(0)' }],
        { duration: 700, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' },
      );
    }
  };

  // Start over asks first: it reloads the page, and the report is gone after that
  document.getElementById('result-restart').addEventListener('click', () => {
    restartDialog.showModal();
    syncModalState();
  });
  document.getElementById('restart-cancel').addEventListener('click', () => restartDialog.close());
  document.getElementById('restart-confirm').addEventListener('click', () => location.reload());
  document.getElementById('result-detail-open').addEventListener('click', () => {
    detailDialog.showModal();
    syncModalState();
  });
  // Build my plan: the loader appears where it always does, the result leaves and the plan page opens.
  // The plan is made by the server from the report it kept; the page only sends the report's id.
  const PLAN_LOADER_MS = 150; // head start of the loader (it fades in behind the result)
  const RESULT_OUT_MS = 400;  // result leaves (keep in sync with CSS)
  const PLAN_ERROR = 'Could not open the plan. Please try again.';
  let planning = false;

  const requestPlan = async (id) => {
    const { res, data } = await requestJson('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId: id }),
    }, START_TIMEOUT_MS);
    if (!res.ok || typeof data.id !== 'string') throw userError(PLAN_ERROR, false);
    return data.id;
  };

  document.getElementById('result-plan').addEventListener('click', async () => {
    if (planning) return;
    if (!reportId) {
      showToast('Plans are not available right now.');
      return;
    }
    planning = true;
    resultSection.inert = true;
    status.textContent = 'Building your plan…';
    try {
      const planRequest = requestPlan(reportId);
      planRequest.catch(() => {}); // handled below; this only stops the rejection from being reported early
      Loader.show();
      await wait(PLAN_LOADER_MS);
      resultSection.classList.add('is-leaving');
      const [planId] = await Promise.all([planRequest, wait(RESULT_OUT_MS)]);
      location.assign(`/plan?id=${encodeURIComponent(planId)}`);
    } catch {
      // Back to the result: the loader goes, the result comes back, and the user can try again
      await Loader.hide();
      resultSection.classList.remove('is-leaving');
      resultSection.inert = false;
      planning = false;
      showToast(PLAN_ERROR);
    }
  });

  // Coming back with the browser's back button must not show a stale loader
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload();
  });

  search.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    const invalid = [];

    if (idea.value.trim() === '') {
      showFieldError(idea);
      invalid.push(idea);
    }
    ranges.filter((range) => !range.classList.contains('is-set')).forEach((range) => {
      showFieldError(range, `Select a value for ${labelOf(range)}.`);
      invalid.push(range);
    });

    if (invalid.length) {
      invalid[0].focus();
      return;
    }
    await sessionReady;
    if (!currentUser) {
      gate.showModal();
      syncModalState();
      return;
    }
    resetFlow();
    submitIdea();
  });

  // ---------------------------------------------------------------------------
  // Question popup: a prompt and a text field, centred above the loader.
  // Opened by submitIdea (via nextQuestion) with the questions the backend returns.
  // ---------------------------------------------------------------------------
  const question = document.getElementById('question');
  const questionText = document.getElementById('question-text');
  const answer = question.elements.answer;

  const questionProgress = document.getElementById('question-progress');

  const questionNote = document.getElementById('question-note');
  const questionCount = document.getElementById('question-count');
  const questionBack = document.getElementById('question-back');
  const optionsContainer = document.getElementById('question-options');
  const ANSWER_MAX = Number(answer.maxLength); // 1000: the server's limit for one answer
  const COUNT_FROM = 900;                      // the counter appears this close to the limit

  // The note under the field: one message at a time (empty answer, limit reached)
  const showNote = (message) => {
    questionNote.textContent = message;
    questionNote.hidden = !message;
    answer.toggleAttribute('aria-invalid', !!message);
  };

  // Keeps the counter, the Back button and the option marks in step with the field
  const refreshQuestionFoot = () => {
    const length = answer.value.length;
    questionCount.textContent = `${length} / ${ANSWER_MAX}`;
    questionCount.hidden = length < COUNT_FROM;
    questionBack.hidden = answers.length === 0;
    optionsContainer.querySelectorAll('.question__option').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.textContent === answer.value));
    });
  };

  const showQuestion = (text, progress = '', options = []) => {
    if (text) questionText.textContent = text;
    questionProgress.textContent = progress;

    optionsContainer.replaceChildren();
    if (options.length > 0) {
      options.slice(0, 4).forEach((option) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'question__option';
        button.textContent = option;
        button.setAttribute('aria-pressed', 'false');
        // A click marks the option and fills the field; the arrow (or Enter) sends it
        button.addEventListener('click', () => {
          answer.value = option;
          showNote('');
          refreshQuestionFoot();
          answer.focus();
        });
        optionsContainer.append(button);
      });
      optionsContainer.hidden = false;
    } else {
      optionsContainer.hidden = true;
    }

    showNote('');
    question.classList.add('is-open');
    refreshQuestionFoot();
    requestAnimationFrame(() => answer.focus({ preventScroll: true }));
  };

  const hideQuestion = () => {
    question.classList.remove('is-open');
    answer.value = '';
    answer.blur();
    optionsContainer.replaceChildren();
    optionsContainer.hidden = true;
    showNote('');
    questionCount.hidden = true;
    questionBack.hidden = true;
  };

  // Typing clears the message and the option marks; the counter follows the length
  answer.addEventListener('input', () => {
    if (answer.value.length >= ANSWER_MAX) showNote(`You have reached the ${ANSWER_MAX}-character limit.`);
    else showNote('');
    refreshQuestionFoot();
  });

  question.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = answer.value.trim();
    if (!current) return;
    if (!text) {
      showNote('Type an answer to continue.');
      answer.focus();
      return;
    }
    asked.push(current);
    answers.push({ topic: current.topic, question: current.question, answer: text });
    current = null;
    answer.value = '';
    if (nextQuestion()) return; // the next one is ready: the popup stays open
    hideQuestion();
    submitIdea(); // all answered: the final request returns the profile
  });

  // Back: the previous question comes again with its answer in the field, so it can be changed.
  // The question on screen (if any) goes back to the queue, so nothing is lost.
  questionBack.addEventListener('click', () => {
    if (!answers.length) return;
    const previous = asked.pop();
    const { answer: previousAnswer } = answers.pop();
    if (current) queue.unshift(current);
    queue.unshift(previous);
    current = null;
    nextQuestion();
    answer.value = previousAnswer;
    refreshQuestionFoot();
  });

  // Cancel (button or Escape): leaves the questions and the loader, and returns to the idea with the text kept
  const cancelQuestions = async () => {
    if (!question.classList.contains('is-open')) return;
    hideQuestion();
    resetFlow();
    await stopLoading();
    hideSubmitError();
    status.textContent = 'Analysis cancelled. Your idea is still there.';
    idea.focus();
  };
  document.getElementById('question-cancel').addEventListener('click', cancelQuestions);
  question.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelQuestions();
    }
  });

  // ---------------------------------------------------------------------------
  // Toast notifications
  // ---------------------------------------------------------------------------
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toast-text');
  let toastTimeout = null;

  const showToast = (message) => {
    if (toastTimeout) clearTimeout(toastTimeout);
    toastText.textContent = message;
    toast.classList.add('is-open');
    toastTimeout = setTimeout(() => {
      toast.classList.remove('is-open');
    }, 4000);
  };

  document.getElementById('toast-close').addEventListener('click', () => {
    if (toastTimeout) clearTimeout(toastTimeout);
    toast.classList.remove('is-open');
  });

  // View my projects: show coming soon notice
  document.querySelector('.nav__projects').addEventListener('click', () => {
    showToast('Projects are not available yet.');
  });

  // Giant wordmark: duplicate the group so the loop is seamless
  // ---------------------------------------------------------------------------
  const track = document.querySelector('.giant__track');
  const copy = track.firstElementChild.cloneNode(true);
  copy.setAttribute('aria-hidden', 'true');
  track.append(copy);
  track.classList.add('is-looping');
})();
