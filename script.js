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

  // The signed-in user, or null. The server writes it into <body data-user> with the header already in its state
  // (server.ts, auth/home-page.ts), so the first paint is right; the session check below only confirms it.
  const initialUser = (() => {
    try {
      const parsed = JSON.parse(document.body.dataset.user ?? 'null');
      return typeof parsed?.name === 'string' ? parsed : null;
    } catch {
      return null;
    }
  })();
  let currentUser = initialUser;
  const renderHeader = () => {
    const guest = document.getElementById('nav-guest');
    const user = document.getElementById('nav-user');
    guest.hidden = currentUser !== null;
    user.hidden = currentUser === null;
    document.getElementById('avatar').textContent = (Array.from(currentUser?.name.trim() ?? '')[0] ?? '?').toUpperCase();
  };
  renderHeader();

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
  // Search form: the idea text. The person's situation is asked after it, as fixed questions.
  // ---------------------------------------------------------------------------
  const search = document.querySelector('.search');
  const idea = search.querySelector('.search__input');

  // The idea field uses the error element that already exists in the markup
  errors.set(idea, document.getElementById('search-error'));
  idea.addEventListener('input', () => {
    clearFieldError(idea);
    resetFlow();
  });

  // --- The fixed questions: free text, with buttons as suggested answers ----------------
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

  // The fixed questions, in the order they are asked. Each choice is a button, and a typed answer is read to the same
  // value: the values are the ones the server takes (server/planner/fixed-answers.ts).
  const BUDGET_CHOICES = [
    { label: 'Under 10,000 \u20ac', value: 5000 },
    { label: '10,000-30,000 \u20ac', value: 20000 },
    { label: '30,000-75,000 \u20ac', value: 50000 },
    { label: '75,000-150,000 \u20ac', value: 110000 },
    { label: 'Over 150,000 \u20ac', value: 200000 },
  ];
  const START_CHOICES = [
    { label: 'From scratch', value: 'scratch', words: /scratch|from zero|nuevo|desde cero/i },
    { label: 'Taking over an existing business', value: 'takeover', words: /take ?over|traspaso|buy an? (existing|business)/i },
    { label: 'Franchise', value: 'franchise', words: /franchis|franquicia/i },
    { label: 'Already open', value: 'already_open', words: /already open|ya (estoy )?abierto|open already/i },
    { label: 'Not decided yet', value: 'undecided', words: /not decided|undecided|no lo he decidido|todav[ií]a no/i },
  ];
  const PREMISES_CHOICES = [
    { label: 'I have them', value: 'have', words: /\bi have|tengo/i },
    { label: 'Looking for them', value: 'looking', words: /looking|buscando|busco/i },
    { label: 'Not needed', value: 'not_needed', words: /not needed|no (lo )?necesito/i },
    { label: 'Not sure if I need one', value: 'unsure', words: /not sure|unsure|no estoy seguro/i },
  ];
  const ONLINE_LABEL = 'Online / no fixed place';
  // The choice a typed text means: the same label (any case), or one of its words; undefined when none
  const choiceOf = (choices, text) => {
    const typed = text.trim().toLowerCase();
    const exact = choices.find(({ label }) => label.toLowerCase() === typed);
    if (exact) return exact;
    return choices.find(({ words }) => words?.test(typed));
  };

  // The order they are asked in: the ones a description rarely states come first, the place last
  const PROFILE_QUESTIONS = [
    {
      key: 'premises',
      question: 'Do you have premises?',
      options: PREMISES_CHOICES.map(({ label }) => label),
      parse: (text) => choiceOf(PREMISES_CHOICES, text)?.value ?? null,
      error: 'Choose one of the options, or write whether you have premises.',
    },
    {
      key: 'start_mode',
      question: 'How are you starting?',
      options: START_CHOICES.map(({ label }) => label),
      parse: (text) => choiceOf(START_CHOICES, text)?.value ?? null,
      error: 'Choose one of the options, or write how you are starting.',
    },
    {
      key: 'budget',
      question: 'How much can you invest?',
      options: BUDGET_CHOICES.map(({ label }) => label),
      parse: (text) => {
        const choice = choiceOf(BUDGET_CHOICES, text);
        if (choice) return choice.value;
        const n = readAmount(text);
        if (n !== null) return clamp(Math.round(n), 0, 1_000_000);
        return NONE.test(text) ? 0 : null;
      },
      error: 'Write an amount, for example 25,000 \u20ac.',
    },
    {
      key: 'location',
      question: 'Where will the business be?',
      placeholder: 'City, and neighbourhood if you know it',
      options: [ONLINE_LABEL],
      parse: (text) => {
        if (/^online\b|^no fixed place/i.test(text.trim())) return 'online';
        // A city is enough; the server keeps up to 200 characters
        const place = text.trim().slice(0, 200);
        return place || null;
      },
      error: 'Write a city, for example Madrid.',
    },
  ];
  // The labels of the chosen values, for the report's screen
  const START_LABEL = Object.fromEntries(START_CHOICES.map(({ label, value }) => [value, label]));
  const PREMISES_LABEL = Object.fromEntries(PREMISES_CHOICES.map(({ label, value }) => [value, label]));
  // "I don't know" is offered on each fixed question and counts as answered: the server gets the key in `unknown`
  // and no number for it (see parsePlannerRequest). Typed or clicked, the same words mean the same.
  const DONT_KNOW = "I don't know";
  const isDontKnow = (text) => /^(i\s*don[’']?t\s*know|not sure|no s[eé])\.?$/i.test(text.trim());
  // The answers to the fixed questions, as the server takes them ({ location, budget, start_mode, premises });
  // null for an "I don't know"
  let profileInput = {};
  // The fixed questions answered so far, with the text typed, in order (for Back)
  let profileAsked = [];
  const MODEL_QUESTIONS = 4; // most the server asks after them (MAX_QUESTIONS in planner-phase2-handler.ts)
  const profileComplete = () => PROFILE_QUESTIONS.every(({ key }) => Object.hasOwn(profileInput, key));
  // The fixed answers as the request takes them: the values known, and the keys answered "I don't know"
  const profilePayload = () => {
    const unknown = PROFILE_QUESTIONS.map(({ key }) => key).filter((key) => profileInput[key] === null);
    const values = Object.fromEntries(Object.entries(profileInput).filter(([, value]) => value !== null));
    return { ...values, ...(unknown.length && { unknown }) };
  };

  // Example ideas: a click fills the idea field with the full idea (data-idea), as if the person had typed it
  document.querySelectorAll('.hints__chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      idea.value = chip.dataset.idea;
      idea.dispatchEvent(new Event('input', { bubbles: true }));
      idea.focus();
    });
  });

  // The header shows one of two states: Log In / Register, or the profile circle with "View my projects" on its right.
  // The server has already drawn the state it found; this check confirms it and re-renders only when it differs.
  // If the check cannot be made, the state the server drew stays.
  const sessionReady = fetch('/api/auth/session', { cache: 'no-store' })
    .then((res) => res.json())
    .then((data) => {
      const verified = data.user ?? null;
      if ((verified?.name ?? null) === (currentUser?.name ?? null)) return;
      currentUser = verified;
      renderHeader();
    })
    .catch(() => {});

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
  const PREFILL_TIMEOUT_MS = 10_000; // the server's own limit for the description call
  const EXIT_MS = 850;        // subtitle exit + title-to-loader travel to the centre (keep in sync with CSS)
  const FIRST_QUESTION_MS = 600; // entrance of the first question (keep in sync with .question.is-entering in CSS)
  const MIN_LOADER_MS = 1500; // visible time of the loader, so it never flashes
  const FADE_MS = 700;        // loader travels back and fades out (keep in sync with CSS)
  const FINISH_MS = 350;      // loader fades out in place before the result (keep in sync with CSS)
  const START_TIMEOUT_MS = 15_000; // the POST only starts the job, so it answers fast
  const POLL_MS = 1500;            // wait between status checks
  // What the browser says while the server works, by the step the server reports (PLANNER_STAGES in server/planner/stages.ts)
  const STAGE_TEXT = {
    reading: 'Reading your business\u2026',
    costs: 'Estimating costs and what it needs\u2026',
    explaining: 'Checking risks and next steps\u2026',
    saving: 'Putting your report together\u2026',
  };
  const STAGES = Object.keys(STAGE_TEXT);
  const GENERIC_STAGE_TEXT = 'Preparing your report\u2026';
  const SLOW_NOTE_MS = 20_000;     // a step longer than this shows the "taking longer" note
  const STEP_FADE_MS = 200;        // the step text fades out, then the next one fades in
  const progressNote = document.getElementById('progress-note');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
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
    if (profileComplete()) submitIdea({ final: lastFinal });
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

  // The step shown while a job is pending. It only moves forward (an unknown or earlier step changes nothing), and
  // it fades to the new text unless reduced motion is on. A step that lasts too long shows the note under it.
  const makeProgress = () => {
    let shown = -1;      // index in STAGES of the step on screen; -1 before the first one
    let generic = false; // the generic text is on screen
    let fade = null;
    let slow = null;
    const say = (text) => {
      clearTimeout(fade);
      clearTimeout(slow);
      progressNote.hidden = true;
      slow = setTimeout(() => { progressNote.hidden = false; }, SLOW_NOTE_MS);
      status.classList.add('is-progress');
      if (status.textContent === text) return;
      if (reduceMotion.matches) {
        status.textContent = text;
        return;
      }
      status.classList.add('is-fading');
      fade = setTimeout(() => {
        status.textContent = text;
        status.classList.remove('is-fading');
      }, STEP_FADE_MS);
    };
    return {
      show(stage) {
        const rank = STAGES.indexOf(stage);
        if (rank === -1) {
          if (shown === -1 && !generic) { generic = true; say(GENERIC_STAGE_TEXT); }
          return;
        }
        if (rank <= shown) return;
        shown = rank;
        generic = false;
        say(STAGE_TEXT[stage]);
      },
      stop() {
        clearTimeout(fade);
        clearTimeout(slow);
        progressNote.hidden = true;
        status.classList.remove('is-progress', 'is-fading');
      },
    };
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

    const progress = makeProgress();
    try {
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
        if (poll.data.status === 'pending') progress.show(poll.data.stage);
      }
      throw userError('The request took too long. Please try again.', true);
    } finally {
      progress.stop();
    }
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

  // Question flow: first the fixed questions (PROFILE_QUESTIONS), asked here without the server.
  // Then the first request sends the idea and those answers and carries the server's questions, asked
  // one by one. Once they are all answered, one final request sends the answers and returns the profile.
  let answers = [];   // { topic, question, answer } given so far
  let asked = [];     // the question objects answered so far, in the same order as answers (for Back)
  let queue = [];     // received questions not asked yet
  let current = null; // question on screen
  let total = 0;      // number of questions in this session
  let analysis = null; // phase 2 analysis from the first response
  let firstGlance = null; // the glance the server built in the first round: sent back as it is with the final request
  let reportId = null; // id of the report the server kept for this analysis (see POST /api/plan)
  let prefillResult = null; // what the description already says for the fixed questions (null until it arrives)
  let detectToken = null;   // names the Jev result of that detection, sent with the first request
  let reviewReady = false;     // the server has answered the first request: from now on the card comes, not the report
  let editing = null;          // an answer reopened from the card while it is asked: { kind, index }
  let profileDirty = false;    // a fixed answer changed since the first request: generating repeats that request first
  let pendingGenerate = false; // generate was pressed and the first request is repeated before the report
  let lastFinal = false;       // whether the last request was the final one (a retry sends the same kind)
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
    // Where the other fields came from, for the clarity of the report
    sources: Object.fromEntries(['target_customer', 'value_proposition', 'revenue_model', 'stage', 'competition']
      .map((key) => [key, phase2[key]?.source])),
  };

  const resetFlow = () => {
    answers = [];
    asked = [];
    profileInput = {};
    profileAsked = [];
    queue = [];
    current = null;
    analysis = null;
    firstGlance = null;
    reportId = null;
    reviewReady = false;
    editing = null;
    profileDirty = false;
    pendingGenerate = false;
    lastFinal = false;
  };

  // The value the description gives for a fixed question, with the text the question takes for it; undefined
  // when nothing is detected (yet). A value that arrives later only counts for the questions not yet reached.
  const detectedFor = (key) => {
    const value = prefillResult?.[key];
    if (value === null || value === undefined) return undefined;
    if (key === 'location') return { value, text: value === 'online' ? ONLINE_LABEL : value };
    if (key === 'budget') {
      const choice = BUDGET_CHOICES.find((band) => band.value === value);
      return { value, text: choice ? choice.label : `${value.toLocaleString('en-US')} \u20ac` };
    }
    if (key === 'start_mode') return { value, text: START_LABEL[value] };
    return { value, text: PREMISES_LABEL[value] };
  };

  // The fixed questions answered (not counting the ones the description answered): the numbers the progress shows
  const shownFixed = () => profileAsked.filter((item) => !item.detected).length;

  // A fixed question the description answered is not asked: its value is kept, marked as from the description.
  // A question Back brought back (reopened) is always asked, so its value can be changed.
  const skipDetected = () => {
    while (queue[0]?.fixed && !queue[0].reopened) {
      const detected = detectedFor(queue[0].key);
      if (!detected) break;
      const question = queue.shift();
      profileInput[question.key] = detected.value;
      profileAsked.push({ question, text: detected.text, detected: true });
    }
  };

  const nextQuestion = () => {
    skipDetected();
    current = queue.shift() ?? null;
    if (!current) return false;
    // Fixed questions the description answered are not counted in the total, so the numbers stay in step
    const skipped = profileAsked.length - shownFixed();
    const progress = current.fixed
      ? `Question ${shownFixed() + 1} of ${PROFILE_QUESTIONS.length - skipped + MODEL_QUESTIONS}`
      : `Question ${shownFixed() + (editing?.kind === 'ai' ? editing.index : answers.length) + 1} of ${total}`;
    showQuestion(current.question, progress, current.options ?? []);
    answer.value = '';
    refreshQuestionFoot();
    status.textContent = current.question;
    return true;
  };

  // The description is read in parallel with the first questions; it never fails (any problem is no prefill)
  const requestPrefill = async (text) => {
    try {
      const res = await fetch('/api/planner/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: text }),
        cache: 'no-store',
        signal: AbortSignal.timeout(PREFILL_TIMEOUT_MS),
      });
      return res.ok ? await res.json() : null; // { detected, jevToken }
    } catch {
      return null;
    }
  };

  // Starts a session: the loader, then the fixed questions over it. The last answer sends the idea.
  // The first question waits for the search block to leave and the loader to reach the centre, so the
  // popup does not open over the moving title; then it comes in with a slower entrance (is-entering).
  let flowRun = 0; // a Cancel during that wait ends the run, and the question is not shown
  const startFlow = async () => {
    resetFlow();
    hideSubmitError();
    startLoading();
    status.textContent = 'A few questions about your situation.';
    const run = ++flowRun;
    // The description is read from the idea as it is sent, in parallel with the first questions
    prefillResult = null;
    detectToken = null;
    requestPrefill(idea.value.trim()).then((result) => {
      prefillResult = result?.detected ?? null;
      detectToken = result?.jevToken ?? null;
    });
    await wait(EXIT_MS);
    if (run !== flowRun || !sending) return;
    queue = PROFILE_QUESTIONS.map((q) => ({ ...q, fixed: true }));
    total = PROFILE_QUESTIONS.length + MODEL_QUESTIONS; // corrected when the server says how many it asks
    question.classList.add('is-entering');
    void question.offsetWidth; // the lower start position applies before the popup opens
    if (!nextQuestion()) {
      // The description answered them all: nothing is asked, the first request goes now
      question.classList.remove('is-entering');
      submitIdea();
      return;
    }
    setTimeout(() => question.classList.remove('is-entering'), FIRST_QUESTION_MS);
  };

  // final: the request that builds the report. The first request (not final) asks the questions and returns what was understood.
  const submitIdea = async ({ final = answers.length > 0 } = {}) => {
    lastFinal = final;
    const input = {
      idea: idea.value.trim(),
      ...profilePayload(),
    };
    const payload = {
      ...input,
      answers,
      final,
      // The final request validates the analysis, so it needs the values the first one produced
      analysis: Object.fromEntries(CLAIM_KEYS.map((key) => [key, analysis?.[key]?.value])),
      // The same first round also gives the top of the report (the server keeps it only if it passes)
      ...(final && { glance: firstGlance ?? glanceFrom(analysis) }),
      // The detection's Jev result, when it arrived: the first request reuses it instead of asking Jev again
      ...(!final && detectToken && { jevToken: detectToken }),
    };
    let failed = false;
    let profile = null;
    let validation = null;
    let explanations = null;
    let glance = null;
    let clarity = null;
    let diagnosis = null;
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
      if (!profile && glance) firstGlance = glance;
      clarity = result.clarity ?? null;
      diagnosis = result.diagnosis ?? null;
      if (profile) reportId = result.reportId ?? null;
      if (profile) {
        improveSession = {
          idea: input.idea,
          profileInput: { ...profileInput },
          answers: [...answers],
          analysis,
          glance: glance ?? firstGlance,
          rounds: 0,
          asked: [],
        };
      }
      // The browser keeps the report's id (and what a new round needs) in this history entry: going back shows it again
      if (profile && reportId) saveHistory();
      if (!profile) {
        reviewReady = true;
        queue = result.phase2?.questions ?? [];
        total = shownFixed() + (result.questionTotal ?? queue.length);
        if (nextQuestion()) return; // the loader stays under the popup
        // No questions left: after an edit that changed nothing new, the report is asked straight away
        if (pendingGenerate) {
          pendingGenerate = false;
          submitIdea({ final: true });
          return;
        }
        await showReview(); // what was understood, to check before the report is generated
        return;
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
        clarity,
        diagnosis,
        answers: answers.length,
        budget: input.budget,
        startMode: input.start_mode,
        premises: input.premises,
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

  // The budget question is in euros, so only euro amounts are placed against the person's budget
  // A model sometimes writes "unknown" (or "n/a", "not specified") where it has nothing: that is no value to show
  const isBlank = (text) => typeof text !== 'string' || /^\s*(unknown|n\/?a|none|not specified|not known|not defined|-)?\s*\.?\s*$/i.test(text);
  const isEuros = (currency) => ['EUR', '€'].includes(String(currency).trim().toUpperCase());
  const isDollars = (currency) => ['USD', '$'].includes(String(currency).trim().toUpperCase());
  // Euros and dollars with their symbol (€5,000, $5,000); another code gets a space (GBP 5,000), a symbol none (£5,000)
  const money = (value, currency) => {
    const number = value.toLocaleString('en-US');
    if (isEuros(currency)) return `€${number}`;
    if (isDollars(currency)) return `$${number}`;
    if (!currency) return number;
    return /^[A-Za-z]+$/.test(currency) ? `${currency} ${number}` : `${currency}${number}`;
  };
  const rangeText = ({ min, max, currency }) => {
    if (min !== null && max !== null) return `${money(min, currency)} – ${money(max, currency)}`;
    return min !== null ? `from ${money(min, currency)}` : `up to ${money(max, currency)}`;
  };

  // Clarity: two levels with what is missing (at most three each, from the server). Nothing without it (old reports).
  // After an "Improve my report" round, a level that changed shows where it came from (Medium → High).
  const CLARITY_LEVELS = { low: 'Low', medium: 'Medium', high: 'High' };
  const showClarity = (clarity, previous) => {
    const box = document.getElementById('result-clarity');
    box.hidden = !clarity;
    if (!clarity) return;
    [['concept', clarity.concept], ['person', clarity.person]].forEach(([name, metric]) => {
      const level = document.getElementById(`result-clarity-${name}`);
      const before = previous?.[name]?.level;
      level.replaceChildren();
      if (before && before !== metric.level && CLARITY_LEVELS[before]) {
        const now = document.createElement('span');
        now.className = 'clarity__up';
        now.textContent = CLARITY_LEVELS[metric.level] ?? '';
        level.append(`${CLARITY_LEVELS[before]} \u2192 `, now);
      } else {
        level.textContent = CLARITY_LEVELS[metric.level] ?? '';
      }
      const missing = document.getElementById(`result-clarity-${name}-missing`);
      const lead = readinessOf(clarity) === 'green' ? 'To verify in your plan' : 'Missing';
      // Two at most on the card, in lower case after the lead: a short line, not a list
      const shown = metric.missing.slice(0, 2).map((label, index) => (index ? label.toLowerCase() : label));
      missing.textContent = shown.length ? `${lead}: ${shown.join(', ')}${metric.missing.length > 2 ? '\u2026' : ''}` : '';
      missing.hidden = !metric.missing.length;
    });
  };

  // --- Readiness and "Improve my report" ---------------------------------------------------------------------
  // The server says how ready the report is to build a plan (clarity.readiness, clarity.ts). A report kept before
  // it existed gets the same rule from its levels alone. The round asks up to three questions about what is missing,
  // then sends the final request again with the new answers: a new report, with its clarity computed again.
  const IMPROVE = { perRound: 3, rounds: 2, maxAnswers: 12 }; // maxAnswers: MAX_ANSWERS in server/request.ts
  const readinessOf = (clarity) => {
    if (!clarity) return null;
    if (clarity.readiness) return clarity.readiness;
    if (clarity.concept.level === 'low') return 'red';
    return clarity.concept.level === 'high' && clarity.person.level === 'high' ? 'green' : 'yellow';
  };
  const READINESS = {
    red: ['I need more to build your plan', 'The business itself is still unclear.'],
    yellow: ['I can build a plan, but a generic one', 'A few answers would fit it to you.'],
    green: ['Ready for a plan made for you', 'Anything still open goes into the plan as something to verify.'],
  };
  // One question for each clarity label the person can answer. The topics are the ones clarity.ts counts;
  // the fixed questions are asked again with their own parsing.
  const IMPROVE_QUESTIONS = {
    'What you offer': { topic: 'offering', question: 'What exactly will you sell?', options: [] },
    'Value proposition': { topic: 'value_proposition', question: 'What problem do you solve for your customers?', options: [] },
    'Target customer': { topic: 'customer', question: 'Who is your main customer?', options: ['Consumers', 'Small businesses', 'Large companies', 'Public sector'] },
    'How it makes money': { topic: 'revenue', question: 'How will it make money?', options: ['One-off sales', 'Subscription', 'Commission', 'Advertising'] },
    'Where it operates': { topic: 'location', question: 'Where will it operate?', options: ['Online only', 'My city', 'My country', 'Several countries'] },
    'How it reaches customers': { topic: 'acquisition', question: 'How will customers find you?', options: ['Word of mouth', 'Social media', 'Online ads', 'Direct sales'] },
    'Stage and validation': { topic: 'existing_customers', question: 'Do you already have customers, a portfolio or followers?', options: ['Not yet', 'A few', 'Many', 'Not sure yet'] },
    'Known competition': { topic: 'competition', question: 'Who else offers something similar?', options: ['No one I know of', 'A few local ones', 'Big known brands'] },
    'What you can do yourself': { topic: 'trade_experience', question: 'Have you worked in this trade or sector before?', options: ['Yes, for years', 'A little', 'No, I will hire it'] },
    'Fixed deadline': { topic: 'opening_deadline', question: 'Is there a fixed date to open?', options: ['No fixed date', 'In a few months', 'A firm date (lease, season)'] },
  };
  const FIXED_BY_LABEL = { Budget: 'budget', 'How you start': 'start_mode', Premises: 'premises' };

  // What a new round needs from this session: the idea, the fixed answers, the answers, the first analysis.
  // Kept in the history entry with the report's id, so a reload can still improve the report.
  let improveSession = null; // { idea, profileInput, answers, analysis, rounds, asked }
  // A report with a diagnosis asks the planning questions of its weak checks (GET /api/reports/:id/improve-questions)
  let currentDiagnosis = null;
  let diagnosisQuestions = [];
  let currentClarity = null;
  let improving = false;
  const saveHistory = () => history.replaceState({ reportId, ...(improveSession && { session: improveSession }) }, '');

  // The questions of the next round: what is missing, alternating business and person, never asked before
  const improveQuestions = (clarity) => {
    if (!improveSession || !clarity) return [];
    const asked = new Set(improveSession.asked);
    const room = IMPROVE.maxAnswers - improveSession.answers.length;
    const concept = clarity.concept.missing;
    const person = clarity.person.missing;
    // The business goes first while it is the blocker
    const order = [];
    const first = clarity.concept.level === 'low' ? [concept, person] : [person, concept];
    for (let i = 0; i < 3; i++) first.forEach((list) => list[i] && order.push(list[i]));
    return order
      .filter((label) => !asked.has(label) && (FIXED_BY_LABEL[label] || IMPROVE_QUESTIONS[label]))
      .slice(0, Math.min(IMPROVE.perRound, Math.max(0, room)))
      .map((label) => (FIXED_BY_LABEL[label]
        ? { label, fixed: PROFILE_QUESTIONS.find(({ key }) => key === FIXED_BY_LABEL[label]) }
        : { label, ...IMPROVE_QUESTIONS[label] }));
  };
  const canImprove = (clarity) => !!improveSession && improveSession.rounds < IMPROVE.rounds && improveQuestions(clarity).length > 0;

  const quiz = document.getElementById('result-quiz');
  const quizList = document.getElementById('result-quiz-list');
  const improveBox = document.getElementById('result-improve');
  const planButton = document.getElementById('result-plan');
  const planAnyway = document.getElementById('result-plan-anyway');

  // The light, the improve offer and the plan buttons, from the readiness. A red report that cannot be improved
  // any more is not a dead end: it can still be built, like a yellow one.
  const showReadiness = (clarity) => {
    const state = readinessOf(clarity);
    const box = document.getElementById('result-ready');
    box.hidden = !state;
    const improvable = canImprove(clarity);
    planButton.hidden = false;
    planAnyway.hidden = true;
    planButton.className = 'btn btn--dark';
    if (state) {
      const [title, sub] = READINESS[state];
      box.dataset.state = state;
      document.getElementById('result-ready-title').textContent = title;
      document.getElementById('result-ready-sub').textContent = state === 'yellow' && !improvable ? 'The plan will mark what is still open as something to verify.' : sub;
      if (state === 'red' && improvable) {
        planButton.disabled = true;
      } else if (state !== 'green' && improvable) {
        planButton.hidden = true;
        planAnyway.hidden = false;
        planAnyway.disabled = !reportId;
      }
    }
    const diagnosisMode = !!currentDiagnosis;
    const questions = improvable ? improveQuestions(clarity).length : 0;
    improveBox.hidden = diagnosisMode ? !improveSession || !diagnosisQuestions.length || !quiz.hidden : !improvable || !quiz.hidden;
    document.getElementById('result-improve-open').className = state === 'green' ? 'btn btn--outline' : 'btn btn--dark';
    if (diagnosisMode && diagnosisQuestions.length) {
      const count = diagnosisQuestions.length;
      document.getElementById('result-improve-text').textContent = `${count === 1 ? '1 quick question' : `${count} quick questions`} \u00b7 about 1 min`;
    } else if (improvable) {
      const left = IMPROVE.rounds - improveSession.rounds;
      document.getElementById('result-improve-text').textContent =
        `${state === 'green' ? 'Optional \u00b7 ' : ''}${questions === 1 ? '1 quick question' : `${questions} quick questions`} \u00b7 ${left === 1 ? 'last round' : 'about 1 min'}`;
    }
  };

  // The questions of the weak checks, from the server, for the report on screen. Only the report that is shown counts.
  const CATEGORY_NAMES = { concept: 'Concept', location: 'Location', reach: 'Reach', money: 'Money', experience: 'Experience', competition: 'Competition' };
  const loadDiagnosisQuestions = async () => {
    const id = reportId;
    diagnosisQuestions = [];
    showReadiness(currentClarity);
    if (!currentDiagnosis || !id) return;
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(id)}/improve-questions`, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const body = await response.json();
      if (id !== reportId) return; // another report is on screen by now
      diagnosisQuestions = (Array.isArray(body?.questions) ? body.questions : []).filter(
        (item) => typeof item?.key === 'string' && typeof item.question === 'string' && Array.isArray(item.options),
      );
      showReadiness(currentClarity);
    } catch {
      // Without the questions the link stays hidden and the report is as it is
    }
  };

  // The closed questions: each option is a button, one answer per question, the groups in the order the server gives
  const openDiagnosisQuiz = () => {
    quizList.replaceChildren();
    let group = null;
    diagnosisQuestions.forEach((item) => {
      if (item.category !== group) {
        group = item.category;
        const caption = document.createElement('p');
        caption.className = 'quiz__group';
        const [word, symbol] = CHECK_STATES[item.status] ?? CHECK_STATES.watch;
        caption.textContent = `${CATEGORY_NAMES[item.category] ?? item.category} \u00b7 ${symbol} ${word}`;
        quizList.append(caption);
      }
      const set = document.createElement('fieldset');
      set.className = 'quiz__item';
      set.dataset.label = item.key;
      set.dataset.value = '';
      const legend = document.createElement('legend');
      legend.textContent = item.question;
      const options = document.createElement('div');
      options.className = 'quiz__opts';
      item.options.forEach((label) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.setAttribute('aria-pressed', 'false');
        if (label.startsWith("I don't know")) button.className = 'is-unsure';
        button.addEventListener('click', () => {
          set.dataset.value = label;
          options.querySelectorAll('button').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
        });
        options.append(button);
      });
      set.append(legend, options);
      quizList.append(set);
    });
    improveBox.hidden = true;
    quiz.hidden = false;
    quizList.querySelector('button')?.focus();
  };

  const closeQuiz = () => {
    quiz.hidden = true;
    quizList.replaceChildren();
    showReadiness(currentClarity);
  };

  const openQuiz = () => {
    if (currentDiagnosis) {
      openDiagnosisQuiz();
      return;
    }
    const questions = improveQuestions(currentClarity);
    if (!questions.length) return;
    quizList.replaceChildren();
    questions.forEach((item, index) => {
      const set = document.createElement('fieldset');
      set.className = 'quiz__item';
      set.dataset.label = item.label;
      const legend = document.createElement('legend');
      legend.textContent = item.fixed ? item.fixed.question : item.question;
      const field = document.createElement('input');
      field.type = 'text';
      field.maxLength = ANSWER_MAX;
      field.placeholder = item.fixed?.placeholder ?? 'Or write your answer';
      field.setAttribute('aria-label', legend.textContent);
      field.id = `result-quiz-${index}`;
      const error = document.createElement('p');
      error.className = 'quiz__error';
      error.hidden = true;
      const options = document.createElement('div');
      options.className = 'quiz__opts';
      const choices = [...(item.fixed ? item.fixed.options : item.options.slice(0, 4)), DONT_KNOW];
      const mark = () => options.querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', String(button.textContent === field.value)));
      choices.forEach((choice) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = choice;
        if (choice === DONT_KNOW) button.className = 'is-unsure';
        button.addEventListener('click', () => {
          field.value = choice;
          error.hidden = true;
          mark();
        });
        options.append(button);
      });
      field.addEventListener('input', () => {
        error.hidden = true;
        mark();
      });
      mark();
      set.append(legend, options, field, error);
      quizList.append(set);
    });
    improveBox.hidden = true;
    quiz.hidden = false;
    quizList.querySelector('button')?.focus();
  };
  document.getElementById('result-improve-open').addEventListener('click', openQuiz);
  document.getElementById('result-quiz-cancel').addEventListener('click', closeQuiz);

  // Update report: the answers are added, an "I don't know" only marks the question as asked, and the final
  // request runs again from the same first analysis. The new report replaces the one on screen.
  quiz.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (improving || !improveSession) return;
    const items = [...quizList.querySelectorAll('.quiz__item')];
    const questions = improveQuestions(currentClarity);
    const newAnswers = [];
    const newInput = { ...improveSession.profileInput };
    let invalid = null;
    if (currentDiagnosis) {
      items.forEach((set) => {
        const item = diagnosisQuestions.find(({ key }) => key === set.dataset.label);
        if (item && set.dataset.value) newAnswers.push({ topic: item.key, question: item.question, answer: set.dataset.value });
      });
    }
    items.forEach((set) => {
      if (currentDiagnosis) return;
      const item = questions.find(({ label }) => label === set.dataset.label);
      const field = set.querySelector('input');
      const error = set.querySelector('.quiz__error');
      const text = field.value.trim();
      if (!item || !text || isDontKnow(text)) return; // left empty or "I don't know": nothing to send
      if (item.fixed) {
        const value = item.fixed.parse(text);
        if (value === null) {
          error.textContent = item.fixed.error;
          error.hidden = false;
          invalid ??= field;
          return;
        }
        newInput[item.fixed.key] = value;
        return;
      }
      newAnswers.push({ topic: item.topic, question: item.question, answer: text });
    });
    if (invalid) {
      invalid.focus();
      return;
    }

    improving = true;
    const send = document.getElementById('result-quiz-send');
    send.disabled = true;
    send.textContent = 'Updating\u2026';
    quiz.inert = true;
    resultSection.setAttribute('aria-busy', 'true');
    resultSection.classList.add('is-updating');
    status.textContent = 'Updating your report\u2026';
    const added = newAnswers.length + Object.keys(newInput).filter((key) => newInput[key] !== improveSession.profileInput[key]).length;
    const session = improveSession;
    const answersNow = [...session.answers, ...newAnswers];
    const unknown = PROFILE_QUESTIONS.map(({ key }) => key).filter((key) => newInput[key] === null);
    const values = Object.fromEntries(Object.entries(newInput).filter(([, value]) => value !== null));
    try {
      const result = await sendIdea({
        idea: session.idea,
        ...values,
        ...(unknown.length && { unknown }),
        answers: answersNow,
        final: true,
        analysis: Object.fromEntries(CLAIM_KEYS.map((key) => [key, session.analysis?.[key]?.value])),
        glance: session.glance ?? glanceFrom(session.analysis),
      });
      if (!result?.profile) throw new Error('No profile');
      const previous = currentClarity;
      improveSession = {
        ...session,
        profileInput: newInput,
        answers: answersNow,
        rounds: session.rounds + 1,
        asked: [...session.asked, ...items.map((set) => set.dataset.label)],
      };
      reportId = result.reportId ?? null;
      if (reportId) saveHistory();
      quiz.hidden = true;
      quizList.replaceChildren();
      const previousChecks = currentDiagnosis?.checks ?? null;
      showResult(session.analysis, result.profile, result.validation ?? null, result.explanations ?? null, {
        glance: result.glance ?? null,
        clarity: result.clarity ?? null,
        diagnosis: result.diagnosis ?? null,
        previous,
        answers: answersNow.length,
        budget: values.budget,
        startMode: values.start_mode,
        premises: values.premises,
      });
      announceChanges(previousChecks);
      // The change is the answer to the round: it is said, and brought into view
      const now = result.clarity ?? null;
      const raised = [['concept', 'your business'], ['person', 'you']]
        .filter(([key]) => previous?.[key]?.level && now?.[key]?.level && previous[key].level !== now[key].level)
        .map(([key, name]) => `${name} ${CLARITY_LEVELS[now[key].level]?.toLowerCase()}`);
      const what = added === 0 ? 'nothing new added' : added === 1 ? '1 answer added' : `${added} answers added`;
      showToast(`Report updated: ${what}${raised.length ? ` \u00b7 ${raised.join(', ')}` : ''}.`);
      document.getElementById('result-clarity').scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (err) {
      if (err?.signedOut) {
        currentUser = null;
        renderHeader();
        gate.showModal();
        syncModalState();
      } else {
        showToast(err?.userMessage || 'We could not update the report. Try again.');
      }
    } finally {
      activeJob = null;
      improving = false;
      send.disabled = false;
      send.textContent = 'Update report';
      quiz.inert = false;
      resultSection.removeAttribute('aria-busy');
      resultSection.classList.remove('is-updating');
    }
  });

  // The bar is drawn only with both ends of the range; the mark of the person's budget only for dollars
  const showBudget = (glance, yours) => {
    const box = document.getElementById('result-budget');
    const budget = glance?.budget;
    const hasRange = !!budget && (budget.min !== null || budget.max !== null);
    const hasFits = !isBlank(budget?.fits);
    box.hidden = !hasRange && !hasFits;
    if (box.hidden) return;

    document.getElementById('result-budget-row').hidden = !hasRange;
    if (hasRange) document.getElementById('result-budget-range').textContent = rangeText(budget);
    const bothEnds = budget.min !== null && budget.max !== null;
    const mine = isEuros(budget.currency) && typeof yours === 'number' ? yours : null;
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
    if (mine !== null) spoken.push(`Your budget: ${money(mine, '€')}.`);
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

  // What the business asks against what the person has: the money (the estimated range against the budget, euros only,
  // as the budget question is in euros) and the time to first revenue. Capital and regulation are in the full detail.
  const showNeeds = (profile, glance, view) => {
    const grid = document.getElementById('result-needs');
    grid.replaceChildren();
    const addCell = (label, value, notes) => {
      const cell = document.createElement('div');
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      term.textContent = label;
      detail.textContent = value;
      notes.filter(Boolean).forEach(({ text, tone }) => {
        const note = document.createElement('small');
        note.textContent = text;
        if (tone) note.className = `needs__${tone}`;
        detail.append(note);
      });
      cell.append(term, detail);
      grid.append(cell);
    };

    // Always the same four cells, so the row reads as one comparison; a value not known yet says so, quietly
    const UNKNOWN = 'Not known yet';
    const head = (key) => {
      const value = profile.values[key];
      if (isBlank(value) || value === NOT_DEFINED) return null;
      const cut = value.indexOf(' (');
      return cut === -1 ? value : value.slice(0, cut);
    };

    // With the parts of the business (glance.execution), the money is what the person pays, Mando's parts left out;
    // without them (older reports), the range the idea needs
    const execution = glance?.execution ?? null;
    const budget = execution?.pay ? { ...execution.pay, currency: 'EUR' } : glance?.budget;
    const hasRange = !!budget && (budget.min !== null || budget.max !== null);
    const mine = typeof view.budget === 'number' ? view.budget : null;
    let fit = mine === null ? { text: 'Your budget: not given' } : { text: `You have ${money(mine, '€')}` };
    if (hasRange && mine !== null && isEuros(budget.currency)) {
      const low = budget.min ?? budget.max;
      if (budget.max !== null && mine >= budget.max) fit = { text: `You have ${money(mine, '€')}: covers it`, tone: 'ok' };
      else if (mine >= low) fit = { text: `You have ${money(mine, '€')}: the low end`, tone: 'warn' };
      else fit = { text: `You have ${money(mine, '€')}: short by ~${money(low - mine, '€')}`, tone: 'short' };
    }
    const mandoParts = execution?.items.filter(({ who }) => who === 'mando') ?? [];
    const saving = execution?.saved
      ? { text: `Mando covers ${mandoParts.map(({ name }) => name).slice(0, 2).join(', ')}${mandoParts.length > 2 ? '\u2026' : ''}: saves ~${rangeText({ ...execution.saved, currency: 'EUR' })}`, tone: 'ok' }
      : null;
    addCell('Money', hasRange ? rangeText(budget) : UNKNOWN, [fit, saving]);

    // The time the person's own parts ask, and the team the business needs: estimates from the parts and the idea
    addCell('Your time', execution?.hours ? `~${execution.hours} h a week` : UNKNOWN, [{ text: 'For your own parts' }]);
    addCell('Team', head('team_requirement') ?? UNKNOWN, [{ text: 'Estimate' }]);

    addCell('First revenue', head('time_to_revenue') ?? UNKNOWN, [{ text: 'Estimate' }]);
    grid.querySelectorAll('dd').forEach((dd) => dd.classList.toggle('is-unknown', dd.firstChild?.textContent === UNKNOWN));
    document.getElementById('result-needs-block').hidden = !grid.children.length;
  };

  // Who does what (full detail): the parts of the business in three groups, each with its money or hours and,
  // for what is hired out, why. Mando's money is what the part would cost without Mando.
  const EXECUTION_GROUPS = [
    ['mando', 'Mando does it', 'Included'],
    ['you', 'You do it', ''],
    ['outsource', 'Hire it out', ''],
  ];
  const showExecution = (execution) => {
    const box = document.getElementById('detail-execution');
    box.replaceChildren();
    document.getElementById('detail-execution-block').hidden = !execution?.items?.length;
    if (!execution?.items?.length) return;
    EXECUTION_GROUPS.forEach(([who, title, note]) => {
      const items = execution.items.filter((item) => item.who === who);
      if (!items.length) return;
      const group = document.createElement('section');
      group.className = `execution__group execution__group--${who}`;
      const head = document.createElement('h4');
      head.textContent = title;
      const list = document.createElement('ul');
      items.forEach((item) => {
        const row = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'execution__name';
        name.textContent = item.name;
        const range = item.costMin !== null || item.costMax !== null
          ? rangeText({ min: item.costMin ?? item.costMax, max: item.costMax ?? item.costMin, currency: 'EUR' }).replace(/^(€[\d,]+) – \1$/, '$1')
          : '';
        const amount = document.createElement('span');
        amount.className = 'execution__amount';
        amount.textContent = who === 'mando'
          ? (range ? `${note} \u00b7 saves ~${range}` : note)
          : [range, item.hoursWeek ? `~${item.hoursWeek} h a week` : ''].filter(Boolean).join(' \u00b7 ');
        row.append(name, amount);
        if (item.reason) {
          const reason = document.createElement('small');
          reason.textContent = item.reason;
          row.append(reason);
        }
        list.append(row);
      });
      group.append(head, list);
      box.append(group);
    });
  };

  // What I understood, in two lines: the business (what, for whom, where, how it earns) and the person (money, how they
  // start, premises). Only values that are known are said; a value the description does not back up is left out.
  const showUnderstood = (phase2, profile, validation, view) => {
    const unsupported = validation?.unsupported ?? [];
    const value = (key) => (profile.values[key] && profile.values[key] !== NOT_DEFINED && !isBlank(profile.values[key]) ? profile.values[key] : null);
    const field = (key) => (!isBlank(phase2?.[key]?.value) && !unsupported.includes(key) ? phase2[key] : null);
    const subsector = field('subsector');
    const location = !isBlank(view.glance?.location?.value) ? view.glance.location : null;
    const business = [
      subsector ? { text: subsector.value, source: view.glance?.subsectorSource } : value('offering_type') && { text: value('offering_type') },
      value('customer_segment') ? { prefix: 'for ', text: value('customer_segment') } : field('target_customer') && { prefix: 'for ', text: field('target_customer').value, source: field('target_customer').source },
      location && { text: location.value, source: location.source },
      value('validation_stage') && { text: value('validation_stage') },
      value('revenue_model') && { prefix: 'earns by ', text: value('revenue_model') },
    ].filter(Boolean);
    const you = [
      typeof view.budget === 'number' && { text: `${money(view.budget, '€')} to invest` },
      view.startMode && START_LABEL[view.startMode] && { text: START_LABEL[view.startMode] },
      view.premises && PREMISES_LABEL[view.premises] && { text: PREMISES_LABEL[view.premises] },
    ].filter(Boolean);
    const draw = (line, parts, lead) => {
      line.replaceChildren();
      if (lead) {
        const label = document.createElement('span');
        label.className = 'understood__lead';
        label.textContent = lead;
        line.append(label);
      }
      parts.forEach(({ prefix, text, source }, index) => {
        if (index) line.append(' \u00b7 ');
        if (prefix) line.append(prefix);
        const strong = document.createElement('b');
        strong.textContent = text;
        line.append(strong);
        const tag = sourceTag(source);
        if (tag) line.append(' ', tag);
      });
      line.hidden = !parts.length;
    };
    const businessLine = document.getElementById('result-understood-business');
    draw(businessLine, business);
    if (!business.length) {
      businessLine.textContent = 'Not enough information yet. Start over and add more detail to your idea.';
      businessLine.hidden = false;
    }
    draw(document.getElementById('result-understood-you'), you, 'You: ');
  };


  // The diagnosis: the eyebrow, the idea, the five checks (symbol, name, status word, reason), then the risks and
  // who does what. Old reports (no diagnosis) keep the previous view: the blocks below are shown only for them.
  const CHECK_NAMES = { concept: 'Concept', location: 'Location', reach: 'Reach', money: 'Money', experience: 'Experience', competition: 'Competition' };
  const CHECK_STATES = { strong: ['Strong', '\u2713'], watch: ['Watch', '!'], risk: ['Risk', '\u2715'] };
  const SPLIT_LABELS = { mando: 'Mando builds: ', you: 'You handle: ', outsource: 'Hire out: ' };
  const showDiagnosis = (diagnosis, glance) => {
    // The older blocks are hidden by the class in the stylesheet, so their own logic stays as it was
    const legacy = !diagnosis;
    resultSection.classList.toggle('is-diagnosis', !legacy);
    document.getElementById('diagnosis').hidden = legacy;
    document.getElementById('diagnosis-rest').hidden = legacy;
    if (legacy) return;

    const location = glance && glance.location.source !== 'unknown' && glance.location.value.trim() !== '' ? glance.location.value : null;
    document.getElementById('diagnosis-eyebrow').textContent = location ? `Business analysis \u00b7 ${location}` : 'Business analysis';
    document.getElementById('diagnosis-idea').textContent = diagnosis.idea;

    const checks = document.getElementById('diagnosis-checks');
    checks.replaceChildren();
    diagnosis.checks.forEach(({ key, status, why, estimated, identified }) => {
      const [word, symbol] = CHECK_STATES[status];
      const item = document.createElement('li');
      item.dataset.key = key;
      const mark = document.createElement('span');
      mark.className = `mark mark--${status}`;
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = symbol;
      const head = document.createElement('div');
      head.className = 'head';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = CHECK_NAMES[key];
      const state = document.createElement('span');
      state.className = 'state';
      state.textContent = word;
      head.append(name, state);
      const text = document.createElement('p');
      text.className = 'why';
      text.textContent = why;
      if (estimated) {
        const chip = document.createElement('span');
        chip.className = 'tier tier--light';
        chip.textContent = 'estimated';
        text.append(' ', chip);
      }
      item.append(mark, head, text);
      if (identified) {
        const note = document.createElement('p');
        note.className = 'identified';
        note.textContent = 'Identified: your plan will work on it';
        item.append(note);
      }
      checks.append(item);
    });

    const risks = document.getElementById('diagnosis-risks');
    risks.replaceChildren(...diagnosis.risks.map((risk) => {
      const item = document.createElement('li');
      item.textContent = risk;
      return item;
    }));

    // Only the lines with something in them: an empty group is not shown
    const split = document.getElementById('diagnosis-split');
    split.replaceChildren(...Object.entries(SPLIT_LABELS).flatMap(([who, label]) => {
      const names = diagnosis.split[who];
      if (!names.length) return [];
      const item = document.createElement('li');
      item.textContent = `${label}${names.join(', ')}`;
      return [item];
    }));
    document.getElementById('diagnosis-plan-block').hidden = !split.children.length;
  };

  // A new report after "Improve my report": each check whose state changed is said in words (the status line is a
  // live region) and its row is marked for a moment; the mark is not animated when the system asks for less motion
  const announceChanges = (previous) => {
    if (!previous || !currentDiagnosis) return;
    const changed = currentDiagnosis.checks.flatMap((check) => {
      const before = previous.find(({ key }) => key === check.key);
      if (!before || before.status === check.status) return [];
      return [{ key: check.key, text: `${CHECK_NAMES[check.key]}: ${CHECK_STATES[before.status][0]} to ${CHECK_STATES[check.status][0]}` }];
    });
    changed.forEach(({ key }) => {
      const row = document.querySelector(`#diagnosis-checks > li[data-key="${key}"]`);
      if (!row) return;
      row.classList.add('is-changed');
      setTimeout(() => row.classList.remove('is-changed'), 1600);
    });
    if (changed.length) status.textContent = changed.map(({ text }) => text).join('. ');
  };

  const showResult = (phase2, profile, validation, explanations, view = {}) => {
    const detail = document.getElementById('result-detail');
    const warnings = document.getElementById('result-warnings');
    const topDepartments = document.getElementById('result-departments-top');
    const departmentList = document.getElementById('result-departments');
    const detailPending = document.getElementById('detail-pending');
    [detail, detailPending, warnings, topDepartments, departmentList].forEach((el) => el.replaceChildren());

    // What I understood: the business and the person in two lines, from the same values as before
    showUnderstood(phase2, profile, validation, view);

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
    // Lists show a few items; the rest are said in words, so nothing is cut without notice
    const addMore = (list, count, text) => {
      if (count <= 0) return;
      const item = document.createElement('li');
      item.className = 'is-more';
      item.textContent = text ?? `and ${count} more`;
      list.append(item);
    };

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
    currentClarity = view.clarity ?? null;
    showClarity(currentClarity, view.previous ?? null);
    showBudget(glance, view.budget);
    showCosts(explanations);
    showNeeds(profile, glance, view);
    showExecution(glance?.execution ?? null);
    templatePicks = explanations?.templates ?? [];
    templateGlance = glance;
    templatesOpen.hidden = !templatePicks.length;

    document.getElementById('detail-meta').textContent = `${profile.known} of ${profile.total} topics defined`;
    // A plan is built from the saved report only; without one the button says why it cannot be used
    document.getElementById('result-plan').disabled = !reportId;
    document.getElementById('result-plan-note').hidden = !!reportId;
    currentDiagnosis = view.diagnosis ?? null;
    diagnosisQuestions = [];
    showReadiness(currentClarity);
    showDiagnosis(view.diagnosis ?? null, glance);
    loadDiagnosisQuestions();
    // The header stays usable (profile menu, projects, theme); the report takes the focus when it opens: its
    // title when it is the diagnosis, the section otherwise
    document.body.classList.add('has-result');
    resultSection.hidden = false;
    status.textContent = 'Your analysis is ready.';
    (view.diagnosis ? document.getElementById('diagnosis-title') : resultSection).focus({ preventScroll: true });
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
  document.getElementById('result-understood-fix').addEventListener('click', () => {
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

  planAnyway.addEventListener('click', () => planButton.click());

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
    questionNote.classList.remove('is-hint');
    questionNote.textContent = message;
    questionNote.hidden = !message;
    answer.toggleAttribute('aria-invalid', !!message);
  };

  // A quiet note in the same place, that is not an error (the field stays valid)
  const showHint = (message) => {
    showNote(message);
    answer.removeAttribute('aria-invalid');
    questionNote.classList.add('is-hint');
  };

  // Keeps the counter, the Back button and the option marks in step with the field
  const refreshQuestionFoot = () => {
    const length = answer.value.length;
    questionCount.textContent = `${length} / ${ANSWER_MAX}`;
    questionCount.hidden = length < COUNT_FROM;
    // Back stays within its part: the server's questions were made from the fixed answers, so they cannot be changed then
    questionBack.hidden = !!editing || (current?.fixed ? profileAsked.length === 0 : answers.length === 0);
    optionsContainer.querySelectorAll('.question__option').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.textContent === answer.value));
    });
  };

  const showQuestion = (text, progress = '', options = []) => {
    if (text) questionText.textContent = text;
    questionProgress.textContent = progress;
    answer.placeholder = current?.placeholder ?? 'Type your answer';

    optionsContainer.replaceChildren();
    // The fixed questions also take "I don't know": it counts as answered, and Back can change it
    if (current?.fixed) options = [...options, DONT_KNOW];
    if (options.length > 0) {
      (current?.fixed ? options : options.slice(0, 4)).forEach((option) => {
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
      const unsure = isDontKnow(text);
      const value = unsure ? null : current.parse(text);
      if (value === null && !unsure) {
        showNote(current.error);
        answer.focus();
        return;
      }
      profileInput[current.key] = value; // null for "I don't know"
      const entry = { question: current, text: unsure ? DONT_KNOW : text };
      // An edited answer goes back to its place; a new one is added at the end
      if (editing?.kind === 'fixed') {
        profileAsked.splice(editing.index, 0, entry);
        editing = null;
      } else {
        profileAsked.push(entry);
      }
      current = null;
      answer.value = '';
      if (nextQuestion()) return;
      finishQuestions();
      return;
    }
    const entry = { topic: current.topic, question: current.question, answer: text };
    if (editing?.kind === 'ai') {
      asked.splice(editing.index, 0, current);
      answers.splice(editing.index, 0, entry);
      editing = null;
    } else {
      asked.push(current);
      answers.push(entry);
    }
    current = null;
    answer.value = '';
    if (nextQuestion()) return; // the next one is ready: the popup stays open
    finishQuestions();
  });

  // All the questions of this round are answered. Before the server has answered, the first request goes; after that,
  // what was understood comes, and the report is generated only from there.
  const finishQuestions = () => {
    if (reviewReady) {
      showReview();
      return;
    }
    hideQuestion();
    submitIdea();
  };

  // --- What was understood: the answers, to check before the report is generated -----------------
  const reviewSection = document.getElementById('review');
  const reviewTitle = document.getElementById('review-title');
  const reviewIdea = document.getElementById('review-idea');
  const reviewList = document.getElementById('review-list');
  const FIXED_ROW = { location: 'Location', budget: 'Budget', start_mode: 'Starting', premises: 'Premises' };

  // The fixed answers in the order they are asked, then the server's answers; each row has its Edit
  const reviewRows = () => {
    const rows = [];
    for (const { key } of PROFILE_QUESTIONS) {
      const index = profileAsked.findIndex((item) => item.question.key === key);
      if (index === -1) continue;
      const item = profileAsked[index];
      rows.push({ label: FIXED_ROW[key], value: item.text === DONT_KNOW ? 'Not sure yet' : item.text, from: !!item.detected, edit: { kind: 'fixed', index } });
    }
    answers.forEach((entry, index) => rows.push({ label: entry.question, value: entry.answer, from: false, edit: { kind: 'ai', index } }));
    return rows;
  };

  const renderReview = () => {
    reviewIdea.textContent = idea.value.trim();
    reviewList.replaceChildren();
    for (const row of reviewRows()) {
      const term = document.createElement('dt');
      term.textContent = row.label;
      const detail = document.createElement('dd');
      const value = document.createElement('span');
      value.className = 'review__value';
      value.textContent = row.value;
      detail.append(value);
      if (row.from) {
        const from = document.createElement('span');
        from.className = 'review__from';
        from.textContent = 'From your description';
        detail.append(from);
      }
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'review__edit';
      edit.textContent = 'Edit';
      edit.setAttribute('aria-label', `Edit: ${row.label}`);
      edit.addEventListener('click', () => editRow(row.edit));
      detail.append(edit);
      reviewList.append(term, detail);
    }
  };

  const hideReview = () => {
    reviewSection.hidden = true;
    document.body.classList.remove('has-review');
  };

  const showReview = async () => {
    hideQuestion();
    editing = null;
    pendingGenerate = false;
    if (loader) await stopLoading();
    renderReview();
    document.body.classList.add('has-review');
    reviewSection.hidden = false;
    status.textContent = 'Check what I understood. Edit anything that is wrong, then generate the report.';
    reviewTitle.focus({ preventScroll: true });
  };

  // Edit reopens that one answer with its value in the field; the card comes back when it is sent
  const editRow = (edit) => {
    let text;
    if (edit.kind === 'fixed') {
      const [item] = profileAsked.splice(edit.index, 1);
      delete profileInput[item.question.key];
      profileDirty = true; // the first request is repeated with the new value before the report
      editing = { kind: 'fixed', index: edit.index };
      queue = [{ ...item.question, reopened: true }];
      text = item.text;
    } else {
      const [question] = asked.splice(edit.index, 1);
      const [entry] = answers.splice(edit.index, 1);
      editing = { kind: 'ai', index: edit.index };
      queue = [question];
      text = entry.answer;
    }
    hideReview();
    current = null;
    nextQuestion();
    answer.value = text;
    refreshQuestionFoot();
  };

  document.getElementById('review-generate').addEventListener('click', () => {
    if (sending) return;
    hideReview();
    if (profileDirty) {
      // A fixed answer changed: the first request is repeated, and the report follows if nothing new is asked
      profileDirty = false;
      pendingGenerate = true;
      submitIdea({ final: false });
    } else {
      submitIdea({ final: true });
    }
  });
  document.getElementById('review-restart').addEventListener('click', () => restartDialog.showModal());

  // Back: the previous question comes again with its answer in the field, so it can be changed.
  // The question on screen (if any) goes back to the queue, so nothing is lost.
  questionBack.addEventListener('click', () => {
    if (current?.fixed) {
      if (!profileAsked.length) return;
      const previous = profileAsked.pop();
      delete profileInput[previous.question.key];
      previous.question.reopened = true;
      queue.unshift(previous.question, current);
      current = null;
      nextQuestion();
      answer.value = previous.text;
      refreshQuestionFoot();
      // An "I don't know" is not final: say so where the answer can be changed
      if (previous.text === DONT_KNOW) showHint('You said you don\u2019t know. You can change it now, or keep it.');
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
    flowRun++; // a first question still waiting for the loader is not shown
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
      // The round needs the first analysis, which only the history entry has; without it the report cannot be improved
      const session = history.state?.session;
      improveSession = session && typeof session.idea === 'string' && Array.isArray(session.answers) && session.analysis ? session : null;
      // The same view as the reveal: the glance, the answers given, and the budget and team of the form
      // A final report keeps no phase 2: the first analysis of the history entry stands in, for what was understood
      showResult(report.phase2 ?? improveSession?.analysis ?? null, report.profile, report.validation, report.explanations, {
        glance: report.glance,
        clarity: report.clarity,
        diagnosis: report.diagnosis ?? null,
        answers: report.answers.length,
        // An "I don't know" has only a placeholder value: it is not shown as the person's budget, start or premises
        budget: report.input.unknown?.includes('budget') ? undefined : report.input.budget,
        startMode: report.input.unknown?.includes('start_mode') ? undefined : report.input.start_mode,
        premises: report.input.unknown?.includes('premises') ? undefined : report.input.premises,
      });
    } catch {
      history.replaceState(null, '');
      showToast('We could not find that report. Start a new analysis.');
    }
  };
  restoreReport();

})();
