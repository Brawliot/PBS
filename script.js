(() => {
  // ---------------------------------------------------------------------------
  // Field errors: one helper pair for every form (search, auth dialogs)
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

  [authDialog, gate, detailDialog, restartDialog, document.getElementById('templates-modal')].forEach((dialog) => {
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
  // Search form: the idea text. The person's situation is asked after it, as four fixed questions.
  // ---------------------------------------------------------------------------
  const search = document.querySelector('.search');
  const idea = search.querySelector('.search__input');

  // The idea field uses the error element that already exists in the markup
  errors.set(idea, document.getElementById('search-error'));
  idea.addEventListener('input', () => {
    clearFieldError(idea);
    resetFlow();
  });

  // --- The four fixed questions: free text, with buttons as suggested answers ----------------
  // The server takes numbers (see RANGES in server/request.ts), so each answer is read into one.
  // parse returns null when the text cannot be read, and the question is asked again.
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  // "10.000 €", "10,000", "10k", "1.5M", "50 mil": the first amount in the text, with its multiplier
  const readAmount = (text) => {
    const match = text.toLowerCase().match(/(\d[\d.,\s]*)\s*(k|mil|m|million|millón|millones)?\b/);
    if (!match) return null;
    let digits = match[1].replace(/\s/g, '');
    // A comma or dot followed by exactly three digits groups thousands; any other one is a decimal mark
    digits = digits.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.');
    const n = Number.parseFloat(digits);
    if (!Number.isFinite(n)) return null;
    const mult = { k: 1e3, mil: 1e3, m: 1e6, million: 1e6, 'millón': 1e6, millones: 1e6 }[match[2]] ?? 1;
    return n * mult;
  };
  const NONE = /\b(none|nothing|zero|cero|nada|ninguno|ninguna)\b/i;

  const TEAM_LABELS = ['Solo', 'Small (2-3)', 'Medium (4-10)', 'Large (10+)'];
  const HOURS_LABELS = ['Under 10 h', '10-20 h', '30+ h', 'Full time'];

  const PROFILE_QUESTIONS = [
    {
      key: 'budget',
      question: 'How much money can you invest in this business?',
      options: ['0 €', '10,000 €', '50,000 €', '200,000 €'],
      parse: (text) => {
        const n = readAmount(text);
        if (n !== null) return clamp(Math.round(n), 0, 1_000_000);
        return NONE.test(text) ? 0 : null;
      },
      error: 'Write an amount, for example 25,000 €.',
    },
    {
      key: 'experience',
      question: 'How many years of experience do you have in this industry?',
      options: ['None', '1-2 years', '3-5 years', 'More than 5 years'],
      parse: (text) => {
        const n = readAmount(text);
        if (n !== null) return clamp(Math.round(n), 0, 20);
        return NONE.test(text) ? 0 : null;
      },
      error: 'Write a number of years, for example 3.',
    },
    {
      key: 'team',
      question: 'How many people will work on it, counting you?',
      options: TEAM_LABELS,
      parse: (text) => {
        const known = TEAM_LABELS.findIndex((label) => label.toLowerCase() === text.trim().toLowerCase());
        if (known !== -1) return known;
        if (/\b(solo|alone|just me|only me|yo solo|sol[oa])\b/i.test(text)) return 0;
        if (/\b(large|big|grande)\b/i.test(text)) return 3;
        if (/\b(medium|mediano)\b/i.test(text)) return 2;
        if (/\b(small|pequeño)\b/i.test(text)) return 1;
        const n = readAmount(text);
        if (n === null) return null;
        if (n <= 1) return 0;
        if (n <= 3) return 1;
        return n <= 10 ? 2 : 3;
      },
      error: 'Write how many people, for example 2.',
    },
    {
      key: 'hours',
      question: 'How many hours a week can you put into it?',
      options: HOURS_LABELS,
      parse: (text) => {
        const known = HOURS_LABELS.findIndex((label) => label.toLowerCase() === text.trim().toLowerCase());
        if (known !== -1) return known;
        if (/\b(full[- ]?time|tiempo completo|jornada completa)\b/i.test(text)) return 3;
        const n = readAmount(text);
        if (n === null) return null;
        if (n < 10) return 0;
        if (n < 30) return 1;
        return n < 40 ? 2 : 3;
      },
      error: 'Write a number of hours, for example 15.',
    },
  ];
  // The answers to the fixed questions, as the numbers the server takes ({ budget, experience, team, hours })
  let profileInput = {};
  // The fixed questions answered so far, with the text typed, in order (for Back)
  let profileAsked = [];
  const MODEL_QUESTIONS = 4; // most the server asks after them (MAX_QUESTIONS in planner-phase2-handler.ts)
  const profileComplete = () => PROFILE_QUESTIONS.every(({ key }) => typeof profileInput[key] === 'number');

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
  // The planner job being waited for: { id, cancelled }. Cancel marks it, and the wait stops at its next check.
  let activeJob = null;
  const cancelledError = () => Object.assign(new Error('Analysis cancelled'), { cancelled: true });
  // Tells the server to stop the job. Best effort: the wait has already stopped on this side.
  const stopServerJob = (id) => {
    fetch(`/api/planner/${encodeURIComponent(id)}`, { method: 'DELETE', cache: 'no-store', keepalive: true }).catch(() => {});
  };
  // Cancel is offered for any wait, but not under the question popup, which has its own Cancel
  const waitCancel = document.getElementById('wait-cancel');
  const syncWaitCancel = () => { waitCancel.hidden = !sending || document.getElementById('question').classList.contains('is-open'); };
  waitCancel.addEventListener('click', () => cancelWait());

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
    // The fixed answers are dropped when the idea changes: then the questions start again
    if (profileComplete()) submitIdea();
    else startFlow();
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

  // Starts the planner job, then polls it until the result is ready. Cancel (cancelWait) stops both.
  const sendIdea = async (payload) => {
    const job = { id: null, cancelled: false };
    activeJob = job;
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
    job.id = start.data.jobId;
    // Cancelled while the start request was in flight: the job exists now, so it is stopped too
    if (job.cancelled) {
      stopServerJob(job.id);
      throw cancelledError();
    }

    const deadline = Date.now() + JOB_TIMEOUT_MS;
    let networkErrors = 0;
    while (Date.now() < deadline) {
      await wait(POLL_MS);
      if (job.cancelled) throw cancelledError();
      let poll;
      try {
        poll = await requestJson(`/api/planner/${job.id}`, {}, POLL_TIMEOUT_MS);
      } catch {
        if (job.cancelled) throw cancelledError();
        if (++networkErrors >= MAX_NETWORK_ERRORS) {
          throw userError('Could not reach the server. Check your connection.', true);
        }
        continue;
      }
      if (job.cancelled) throw cancelledError();
      networkErrors = 0;

      // 404: the server restarted or the job expired, so it cannot be recovered
      if (poll.res.status === 401) throw signedOutError();
      if (poll.res.status === 404) {
        throw userError('The analysis was lost, usually because the server restarted. Your idea is still there. Please try again.', true);
      }
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
    syncWaitCancel();
  };

  const stopLoading = async () => {
    document.body.classList.remove('is-loading');
    await wait(FADE_MS);
    loader.destroy();
    loader = null;
    search.inert = false;
    search.removeAttribute('aria-busy');
    sending = false;
    syncWaitCancel();
  };

  // Question flow: first the four fixed questions (PROFILE_QUESTIONS), asked here without the server.
  // Then the first request sends the idea and those answers and carries the server's questions, asked
  // one by one. Once they are all answered, one final request sends the answers and returns the profile.
  let answers = [];   // { topic, question, answer } given so far
  let asked = [];     // the question objects answered so far, in the same order as answers (for Back)
  let queue = [];     // received questions not asked yet
  let current = null; // question on screen
  let total = 0;      // number of questions in this session
  let analysis = null; // phase 2 analysis from the first response
  let reportId = null; // id of the report the server kept for this analysis (see POST /api/plan)
  const CLAIM_KEYS = ['subsector', 'location', 'target_customer', 'value_proposition', 'revenue_model', 'stage', 'competition'];
  // The facts the top of the report shows, from the first round's analysis. The server checks them and keeps them
  // only if they pass, so this is sent as it is: the same fields, in the same shape.
  const glanceFrom = (phase2) => phase2 && {
    maturity: phase2.maturity,
    subsectorSource: phase2.subsector?.source,
    location: { value: phase2.location?.value, source: phase2.location?.source },
    budget: {
      min: phase2.constraints?.budget?.min,
      max: phase2.constraints?.budget?.max,
      currency: phase2.constraints?.budget?.currency,
      fits: phase2.constraints?.budget?.fits,
    },
  };

  const resetFlow = () => {
    answers = [];
    asked = [];
    profileInput = {};
    profileAsked = [];
    queue = [];
    current = null;
    analysis = null;
    reportId = null;
  };

  const nextQuestion = () => {
    current = queue.shift() ?? null;
    if (!current) return false;
    const done = profileAsked.length + answers.length;
    showQuestion(current.question, `Question ${done + 1} of ${total}`, current.options ?? []);
    status.textContent = current.question;
    return true;
  };

  // Starts a session: the loader, then the fixed questions over it. The last answer sends the idea.
  const startFlow = () => {
    resetFlow();
    hideSubmitError();
    startLoading();
    status.textContent = 'A few questions about your situation.';
    queue = PROFILE_QUESTIONS.map((q) => ({ ...q, fixed: true }));
    total = PROFILE_QUESTIONS.length + MODEL_QUESTIONS; // corrected when the server says how many it asks
    nextQuestion();
  };

  const submitIdea = async () => {
    const input = {
      idea: idea.value.trim(),
      ...profileInput,
    };
    const final = answers.length > 0;
    const payload = {
      ...input,
      answers,
      final,
      // The final request validates the analysis, so it needs the values the first one produced
      analysis: Object.fromEntries(CLAIM_KEYS.map((key) => [key, analysis?.[key]?.value])),
      // The same first round also gives the top of the report (the server keeps it only if it passes)
      ...(final && { glance: glanceFrom(analysis) }),
    };
    let failed = false;
    let profile = null;
    let validation = null;
    let explanations = null;
    let glance = null;
    let error = null;

    hideSubmitError();
    // The loader may already be up (under the fixed questions); a new one waits for its animation
    const freshLoader = !loader;
    if (freshLoader) startLoading();
    status.textContent = 'Sending your idea…';
    try {
      // The first request also waits for the animation and the minimum loader time
      const [result] = await Promise.all([
        sendIdea(payload),
        freshLoader ? wait(EXIT_MS + MIN_LOADER_MS) : null,
      ]);
      analysis = result.phase2 ?? analysis;
      profile = result.profile ?? null;
      validation = result.validation ?? null;
      explanations = result.explanations ?? null;
      glance = result.glance ?? null;
      if (profile) reportId = result.reportId ?? null;
      // The browser keeps only the report's id, in this history entry: going back shows the report again
      if (profile && reportId) history.replaceState({ reportId }, '');
      if (!profile) {
        queue = result.phase2?.questions ?? [];
        total = PROFILE_QUESTIONS.length + (result.questionTotal ?? queue.length);
        if (nextQuestion()) return; // the loader stays under the popup
        throw new Error('No questions and no profile');
      }
    } catch (err) {
      // Cancelled: cancelWait has already put the page back, so there is nothing more to show
      if (err?.cancelled) return;
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
      await revealResult(analysis, profile, validation, explanations, {
        glance,
        answers: answers.length,
        budget: input.budget,
        team: input.team,
      });
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
  const SUMMARY_KEYS = ['customer_segment', 'revenue_model', 'offering_type', 'competition', 'differentiator'];
  const PENDING_KEYS = ['validation_stage', 'customer_segment', 'revenue_model', 'acquisition_channel', 'regulatory_load', 'money_handling'];
  const NOT_DEFINED = 'Not specified';

  // Where a value came from: what the person said, or what the model inferred. Nothing for an unknown source.
  const SOURCES = { stated: 'you said', inferred: 'inferred' };
  const sourceTag = (source) => {
    if (!Object.hasOwn(SOURCES, source)) return null;
    const tag = document.createElement('span');
    tag.className = 'src';
    tag.textContent = SOURCES[source];
    return tag;
  };

  const addRow = (list, term, value, empty = false, source) => {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = term;
    dd.textContent = value;
    const tag = sourceTag(source);
    if (tag) dd.append(' ', tag);
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

  // --- The top of the report: where the idea stands, the budget range, what the business asks -----------
  // Each part is drawn only with its data. The same view comes from the reveal and from a saved report.
  const MATURITY = { vague: 'Still vague', developing: 'In development', advanced: 'Well developed' };
  const NEEDS = [
    ['time_to_revenue', 'Time to first revenue'],
    ['capital_intensity', 'Capital'],
    ['team_requirement', 'Team'],
    ['regulatory_load', 'Regulation'],
  ];

  // The form is in dollars, so only dollar amounts are placed against the person's budget
  const isDollars = (currency) => ['USD', '$'].includes(String(currency).trim().toUpperCase());
  // Dollars as the form shows them ($5,000); a code gets a space (GBP 5,000), a symbol none (£5,000)
  const money = (value, currency) => {
    const number = value.toLocaleString('en-US');
    if (isDollars(currency)) return `$${number}`;
    if (!currency) return number;
    return /^[A-Za-z]+$/.test(currency) ? `${currency} ${number}` : `${currency}${number}`;
  };
  const rangeText = ({ min, max, currency }) => {
    if (min !== null && max !== null) return `${money(min, currency)} – ${money(max, currency)}`;
    return min !== null ? `from ${money(min, currency)}` : `up to ${money(max, currency)}`;
  };

  const showChips = (profile, glance) => {
    const chips = document.getElementById('result-glance');
    chips.replaceChildren();
    const addChip = (label, value, source) => {
      const item = document.createElement('li');
      const strong = document.createElement('b');
      strong.textContent = value;
      item.append(`${label}: `, strong);
      const tag = sourceTag(source);
      if (tag) item.append(' ', tag);
      chips.append(item);
    };
    if (MATURITY[glance?.maturity]) addChip('Idea', MATURITY[glance.maturity]);
    // The stage comes from the profile, which is built after the answers
    const stage = profile.values.validation_stage;
    if (stage && stage !== NOT_DEFINED) addChip('Stage', stage);
    if (glance?.location.value) addChip('Location', glance.location.value, glance.location.source);
    chips.hidden = !chips.children.length;
  };

  // The bar is drawn only with both ends of the range; the mark of the person's budget only for dollars
  const showBudget = (glance, yours) => {
    const box = document.getElementById('result-budget');
    const budget = glance?.budget;
    const hasRange = !!budget && (budget.min !== null || budget.max !== null);
    const hasFits = !!budget?.fits;
    box.hidden = !hasRange && !hasFits;
    if (box.hidden) return;

    document.getElementById('result-budget-row').hidden = !hasRange;
    if (hasRange) document.getElementById('result-budget-range').textContent = rangeText(budget);
    const bothEnds = budget.min !== null && budget.max !== null;
    const mine = isDollars(budget.currency) && typeof yours === 'number' ? yours : null;
    document.getElementById('result-budget-scale').hidden = !bothEnds;
    document.getElementById('result-budget-you').hidden = !bothEnds || mine === null;
    if (bothEnds) {
      // The scale runs from 0 to the largest figure shown, so every mark is inside it
      const top = Math.max(budget.max, mine ?? 0, 1);
      const zone = document.getElementById('result-budget-zone');
      zone.style.left = `${(budget.min / top) * 100}%`;
      zone.style.width = `${((budget.max - budget.min) / top) * 100}%`;
      if (mine !== null) document.getElementById('result-budget-you').style.left = `${(mine / top) * 100}%`;
    }
    // The bar is decorative: the same figures are said in words for a screen reader
    const spoken = [];
    if (hasRange) spoken.push(`Estimated budget: ${rangeText(budget)}.`);
    if (mine !== null) spoken.push(`Your budget: ${money(mine, '$')}.`);
    document.getElementById('result-budget-note').textContent = spoken.join(' ');

    const fits = document.getElementById('result-budget-fits');
    fits.textContent = budget.fits;
    fits.hidden = !hasFits;
  };

  // Time & cost: the time to open (an estimate, in weeks or months) and the split of the upfront cost in percentages.
  // The bar is decorative: the same split is written under it, so a screen reader reads the text.
  const TIME_UNITS = { weeks: ['week', 'weeks'], months: ['month', 'months'] };
  const showCosts = (explanations) => {
    const time = explanations?.timeToOpen;
    const cost = explanations?.costBreakdown;
    const timeRow = document.getElementById('result-time-row');
    const costRow = document.getElementById('result-cost-row');
    timeRow.hidden = !time;
    if (time) {
      const [singular, plural] = TIME_UNITS[time.unit];
      const span = time.min === time.max
        ? `${time.min} ${time.min === 1 ? singular : plural}`
        : `${time.min}–${time.max} ${time.max === 1 ? singular : plural}`;
      document.getElementById('result-time-value').textContent = span;
      document.getElementById('result-time-note').textContent = `${time.confidence} confidence · estimate`;
    }
    costRow.hidden = !cost;
    if (cost) {
      const stack = document.getElementById('result-cost-stack');
      stack.replaceChildren();
      cost.forEach(({ percent }, index) => {
        const segment = document.createElement('span');
        segment.className = `costs__segment costs__segment--${index + 1}`;
        segment.style.width = `${percent}%`;
        stack.append(segment);
      });
      document.getElementById('result-cost-note').textContent = cost.map(({ label, percent }) => `${label} ${percent}%`).join(' · ');
    }
    document.getElementById('result-costs-block').hidden = timeRow.hidden && costRow.hidden;
  };

  // Starter templates: the model picks three ids; the text is the fixed catalog from the server. The only automatic
  // part is {{location}}, filled here. The catalog is loaded the first time and kept in memory.
  const templatesOpen = document.getElementById('result-templates-open');
  const templatesDialog = document.getElementById('templates-modal');
  let templateCatalog = null;
  let templatePicks = [];
  let templateGlance = null;

  const fillTemplate = (body) => {
    const place = templateGlance?.location?.value?.trim();
    return body.replaceAll('{{location}}', place && place !== 'unknown' ? place : '[your city]');
  };

  const loadTemplates = async () => {
    if (templateCatalog) return templateCatalog;
    const response = await fetch('/api/report-templates', { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('templates');
    const data = await response.json();
    templateCatalog = data.templates;
    return templateCatalog;
  };

  const copyTemplate = async (button, text) => {
    try {
      await navigator.clipboard.writeText(text);
      clearTimeout(button.resetTimer);
      button.textContent = 'Copied';
      button.resetTimer = setTimeout(() => { button.textContent = 'Copy'; }, 2000);
    } catch {
      showToast('Could not copy. Select the text and copy it by hand.');
    }
  };

  const openTemplates = async () => {
    templatesOpen.disabled = true;
    let catalog;
    try {
      catalog = await loadTemplates();
    } catch {
      showToast('We could not load the templates. Try again.');
      return;
    } finally {
      templatesOpen.disabled = false;
    }
    const list = document.getElementById('templates-list');
    list.replaceChildren();
    // An id the catalog does not know is skipped
    templatePicks.forEach((id) => {
      const template = catalog.find((item) => item.id === id);
      if (!template) return;
      const section = document.createElement('section');
      section.className = 'template';
      const title = document.createElement('h3');
      title.className = 'template__title';
      title.textContent = template.title;
      const purpose = document.createElement('p');
      purpose.className = 'template__purpose';
      purpose.textContent = template.purpose;
      const body = document.createElement('pre');
      body.className = 'template__body';
      body.textContent = fillTemplate(template.body);
      const copy = document.createElement('button');
      copy.className = 'btn btn--outline template__copy';
      copy.type = 'button';
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => copyTemplate(copy, body.textContent));
      section.append(title, purpose, body, copy);
      list.append(section);
    });
    templatesDialog.showModal();
  };
  templatesOpen.addEventListener('click', openTemplates);

  // What the business asks, from the profile. The team line adds what the person offers, with the form's labels.
  const showNeeds = (profile, team) => {
    const grid = document.getElementById('result-needs');
    grid.replaceChildren();
    NEEDS.forEach(([key, label]) => {
      const value = profile.values[key];
      if (!value || value === NOT_DEFINED) return;
      // "Heavy (health, finance, food)": the value first, the part in brackets as small text under it
      const cut = value.indexOf(' (');
      const cell = document.createElement('div');
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      term.textContent = label;
      detail.textContent = cut === -1 ? value : value.slice(0, cut);
      if (cut !== -1) {
        const rest = document.createElement('small');
        rest.textContent = value.slice(cut + 2, -1);
        detail.append(rest);
      }
      if (key === 'team_requirement' && team !== undefined) {
        const offer = document.createElement('small');
        offer.textContent = `You offer: ${TEAM_LABELS[team]}`;
        detail.append(offer);
      }
      cell.append(term, detail);
      grid.append(cell);
    });
    document.getElementById('result-needs-block').hidden = !grid.children.length;
  };

  const showNext = (answerCount) => {
    const basis = answerCount === 0 ? 'From your idea.' : `From your idea and ${answerCount === 1 ? '1 answer' : `${answerCount} answers`}.`;
    document.getElementById('result-next').textContent = `${basis} Next: phases, departments, tasks, calendar.`;
  };

  const showResult = (phase2, profile, validation, explanations, view = {}) => {
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
    if (subsectorShown) addRow(summary, 'Business', subsector, false, view.glance?.subsectorSource);
    SUMMARY_KEYS.filter((key) => profile.values[key] !== NOT_DEFINED)
      .forEach((key) => addRow(summary, LABELS[key], profile.values[key]));
    if (!summary.children.length) addRow(summary, 'Business', 'Not enough information yet', true);

    // Reasons from the model for the warnings and the areas on screen: a quiet line under the item, as text
    const warningReasons = new Map((explanations?.warningReasons ?? []).map(({ key, reason }) => [key, reason]));
    const areaReasons = new Map((explanations?.areaReasons ?? []).map(({ name, reason }) => [name, reason]));
    const reasonNote = (reason) => {
      const note = document.createElement('span');
      note.className = 'result__reason';
      note.textContent = reason;
      return note;
    };

    const addItem = (list, text, reason) => {
      const item = document.createElement('li');
      item.textContent = text;
      if (reason) item.append(reasonNote(reason));
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
    warningKeys.slice(0, 3).forEach((key) => addItem(warnings, WARNINGS[key], warningReasons.get(key)));
    addMore(warnings, warningKeys.length - 3, `and ${warningKeys.length - 3} more to check in the full detail`);
    document.getElementById('result-warnings-block').hidden = !warnings.children.length;

    // Small businesses see the groups, larger ones the departments. Light areas stay in the popup
    const TIERS = { core: 'Essential', important: 'Recommended', light: 'Optional' };
    const addArea = (list, name, tier, reason) => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      const chip = document.createElement('span');
      label.textContent = name;
      chip.className = `tier tier--${tier}`;
      chip.textContent = TIERS[tier];
      if (reason) {
        const text = document.createElement('div');
        text.append(label, reasonNote(reason));
        item.append(text, chip);
      } else {
        item.append(label, chip);
      }
      list.append(item);
    };
    const areas = validation ? (validation.level === 2 ? validation.departments : validation.groups) : [];
    const mainAreas = areas.filter(({ tier }) => tier !== 'light');
    mainAreas.slice(0, 4).forEach(({ name, tier }) => addArea(topDepartments, name, tier, areaReasons.get(name)));
    addMore(topDepartments, areas.length - Math.min(mainAreas.length, 4), `and ${areas.length - Math.min(mainAreas.length, 4)} more in the full detail`);
    document.getElementById('result-departments-block').hidden = !topDepartments.children.length;
    // The same tier marks as the card, one row per area
    areas.forEach(({ name, tier }) => addArea(departmentList, name, tier, areaReasons.get(name)));
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

    // The top of the report: the chips, the budget and what the business asks, then the line about the basis
    const glance = view.glance ?? null;
    showChips(profile, glance);
    showBudget(glance, view.budget);
    showCosts(explanations);
    showNeeds(profile, view.team);
    templatePicks = explanations?.templates ?? [];
    templateGlance = glance;
    templatesOpen.hidden = !templatePicks.length;
    showNext(view.answers ?? 0);

    document.getElementById('result-meta').textContent = `${profile.known} of ${profile.total} topics defined`;
    document.getElementById('detail-meta').textContent = `${profile.known} of ${profile.total} topics defined`;
    document.getElementById('result-hint').hidden = profile.known > 0;
    // A plan is built from the saved report only; without one the button says why it cannot be used
    document.getElementById('result-plan').disabled = !reportId;
    document.getElementById('result-plan-note').hidden = !!reportId;
    // The header stays usable (profile menu, projects, theme); the report takes the focus when it opens
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
  const revealResult = async (phase2, profile, validation, explanations, view) => {
    document.body.classList.add('is-finishing');
    await wait(FINISH_MS);

    const giant = document.querySelector('.giant');
    const letter = giant.querySelector('.giant__letter');
    const before = letter.getBoundingClientRect().top;

    showResult(phase2, profile, validation, explanations, view);
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
  document.getElementById('restart-confirm').addEventListener('click', () => {
    // The saved id goes first: the reload must not bring the old report back
    history.replaceState(null, '');
    location.reload();
  });
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
    startFlow();
  });

  // ---------------------------------------------------------------------------
  // Question popup: a prompt and a text field, centred above the loader.
  // Opened by startFlow with the fixed questions, then by submitIdea (via nextQuestion) with the backend's.
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
    // Back stays within its part: the server's questions were made from the fixed answers, so they cannot be changed then
    questionBack.hidden = current?.fixed ? profileAsked.length === 0 : answers.length === 0;
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
    syncWaitCancel();
    refreshQuestionFoot();
    requestAnimationFrame(() => answer.focus({ preventScroll: true }));
  };

  const hideQuestion = () => {
    question.classList.remove('is-open');
    syncWaitCancel();
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
    if (current.fixed) {
      const value = current.parse(text);
      if (value === null) {
        showNote(current.error);
        answer.focus();
        return;
      }
      profileInput[current.key] = value;
      profileAsked.push({ question: current, text });
      current = null;
      answer.value = '';
      if (nextQuestion()) return;
      hideQuestion();
      submitIdea(); // the four are answered: the first request sends them with the idea
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
    if (current?.fixed) {
      if (!profileAsked.length) return;
      const previous = profileAsked.pop();
      delete profileInput[previous.question.key];
      queue.unshift(previous.question, current);
      current = null;
      nextQuestion();
      answer.value = previous.text;
      refreshQuestionFoot();
      return;
    }
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

  // Cancel (the wait's button, the question's Cancel, or Escape): stops the wait and the job on the server,
  // leaves the questions and the loader, and returns to the idea with the text kept
  let cancelling = false;
  const cancelWait = async () => {
    // One cancel at a time: Escape with the questions open reaches both the popup and the page
    if (cancelling || (!sending && !question.classList.contains('is-open'))) return;
    cancelling = true;
    if (activeJob) {
      activeJob.cancelled = true;
      if (activeJob.id) stopServerJob(activeJob.id);
      activeJob = null;
    }
    hideQuestion();
    resetFlow();
    await stopLoading();
    hideSubmitError();
    status.textContent = 'Analysis cancelled. Your idea is still there.';
    idea.focus();
    cancelling = false;
  };
  document.getElementById('question-cancel').addEventListener('click', cancelWait);
  question.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelWait();
    }
  });
  // Escape also cancels a wait that is not under the questions (the loader alone)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sending) cancelWait();
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

  // View my projects: the list of the person's plans (projects.html)
  document.querySelector('.nav__projects').addEventListener('click', () => {
    location.assign('/projects');
  });

  // Coming back (the browser's back button, or a reload) shows the saved report again. The report is read
  // from the server by its id; if it cannot be read, the start page stays as it is and says so.
  const restoreReport = async () => {
    const saved = history.state?.reportId;
    if (typeof saved !== 'string') return;
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(saved)}`, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('report not found');
      const { id, report } = await response.json();
      reportId = id;
      // The same view as the reveal: the glance, the answers given, and the budget and team of the form
      showResult(report.phase2, report.profile, report.validation, report.explanations, {
        glance: report.glance,
        answers: report.answers.length,
        budget: report.input.budget,
        team: report.input.team,
      });
    } catch {
      history.replaceState(null, '');
      showToast('We could not find that report. Start a new analysis.');
    }
  };
  restoreReport();

  // Giant wordmark: duplicate the group so the loop is seamless
  // ---------------------------------------------------------------------------
  const track = document.querySelector('.giant__track');
  const copy = track.firstElementChild.cloneNode(true);
  copy.setAttribute('aria-hidden', 'true');
  track.append(copy);
  track.classList.add('is-looping');
})();
