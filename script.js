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
  const authTitle = document.getElementById('auth-title');
  const authForms = [...authDialog.querySelectorAll('.auth')];
  const titles = { login: 'Log In', register: 'Register' };

  // The page styles itself differently while any dialog is open (see body.modal-open)
  const syncModalState = () => {
    document.body.classList.toggle('modal-open', !!document.querySelector('dialog[open]'));
  };

  [authDialog, gate].forEach((dialog) => {
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

  const validateAuth = (form) => {
    const { email, password, password2 } = form.elements;
    const register = form.dataset.form === 'register';
    const invalid = [];
    const fail = (input, message) => { showFieldError(input, message); invalid.push(input); };

    form.querySelectorAll('input').forEach((input) => {
      if (input.value.trim() === '') fail(input, `${labelOf(input)} is required.`);
    });
    if (email.value && !email.checkValidity()) {
      fail(email, 'Enter a valid email address.');
    }
    if (register && password.value && password.value.length < password.minLength) {
      fail(password, `Password must be at least ${password.minLength} characters.`);
    }
    if (register && password.value && password2.value && password.value !== password2.value) {
      fail(password2, 'Passwords do not match.');
    }

    invalid[0]?.focus();
    return invalid.length === 0;
  };

  authForms.forEach((form) => {
    form.addEventListener('input', (e) => {
      clearFieldError(e.target);
      // Fixing the first password should re-check an existing "do not match" error
      const { password, password2 } = form.elements;
      if (e.target === password && password2?.hasAttribute('aria-invalid') && password2.value) {
        if (password.value === password2.value) clearFieldError(password2);
        else showFieldError(password2, 'Passwords do not match.');
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      form.querySelectorAll('input').forEach(clearFieldError);
      if (!validateAuth(form)) return;
      // TODO: send data
    });
  });

  authDialog.addEventListener('close', () => {
    authForms.forEach((form) => {
      form.reset();
      form.querySelectorAll('input').forEach(clearFieldError);
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
  idea.addEventListener('input', () => clearFieldError(idea));

  // Sliders always hold a value, so "untouched" is tracked separately (is-set).
  // The first user input marks a slider as set; the initial value is only an example.
  ranges.forEach((range) => {
    const output = range.closest('.filter').querySelector('output');
    output.classList.add('is-example');

    range.addEventListener('input', () => {
      range.classList.add('is-set');
      output.classList.remove('is-example');
      output.value = formatValue(range);
      toggleToken(range, 'aria-describedby', 'slider-hint', false);
      clearFieldError(range);
    });
  });

  // TODO: replace with the real session state once there is a backend.
  const isLoggedIn = false;

  // TESTING ONLY: the login requirement is switched off so the send flow (title exit,
  // loader, request) can be tried without a session. Set to true to bring the
  // "log in to continue" popup back. Remove this flag when the real login exists.
  const REQUIRE_LOGIN = false;

  // --- Sending: title leaves, loader runs while the request is pending -------
  const EXIT_MS = 850;        // subtitle exit + title-to-loader travel to the centre (keep in sync with CSS)
  const MIN_LOADER_MS = 1500; // visible time of the loader, so it never flashes
  const FADE_MS = 700;        // loader travels back and fades out (keep in sync with CSS)
  const status = document.getElementById('status');
  const loaderSlot = document.querySelector('.hero__loader');
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let loader = null;
  let sending = false;

  // Real POST request to the backend planner API
  const sendIdea = async (payload) => {
    const res = await fetch('/api/planner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Request failed');
    }
    return await res.json();
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
    // Same typography as the page title (not the giant background wordmark)
    const titleStyle = getComputedStyle(document.querySelector('.hero__title'));
    loader = window.createTechText(loaderSlot, {
      text: document.querySelector('.hero__title').textContent,
      fontWeight: Number(titleStyle.fontWeight),
      fontSize: parseFloat(titleStyle.fontSize),
      letterSpacing: parseFloat(titleStyle.letterSpacing) / parseFloat(titleStyle.fontSize),
      reveal: 'letter',
      dashLength: 4,
      dashGap: 2,
      specks: 15,
      color: '#000000',
      accentColor: '#272727',
    });
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

  // Question flow: the backend returns a list of questions, asked one by one. Once the
  // list is answered, the answers go back to get refinements (at most MAX_ROUNDS requests).
  const MAX_ROUNDS = 3;
  let answers = [];   // { topic, question, answer } given so far
  let queue = [];     // received questions not asked yet
  let current = null; // question on screen
  let rounds = 0;

  const nextQuestion = () => {
    current = queue.shift() ?? null;
    if (!current) return false;
    showQuestion(current.question);
    status.textContent = current.question;
    return true;
  };

  const submitIdea = async () => {
    const payload = {
      idea: idea.value.trim(),
      ...Object.fromEntries(ranges.map((range) => [range.id, Number(range.value)])),
      answers,
    };
    let failed = false;

    if (!loader) startLoading();
    status.textContent = 'Sending your idea…';
    try {
      // The first request also waits for the animation and the minimum loader time
      const [result] = await Promise.all([
        sendIdea(payload),
        rounds === 0 ? wait(EXIT_MS + MIN_LOADER_MS) : null,
      ]);
      rounds++;
      queue = rounds < MAX_ROUNDS ? (result?.phase2?.questions ?? []) : [];
      if (nextQuestion()) return; // the loader stays under the popup
      status.textContent = 'Your idea was sent.';
      // TODO: show the result when there is nothing left to ask
    } catch {
      failed = true;
      showFieldError(idea, 'Something went wrong. Please try again.');
      status.textContent = 'Something went wrong. Please try again.';
    }
    await stopLoading();
    if (failed) idea.focus();
  };

  search.addEventListener('submit', (e) => {
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
    if (REQUIRE_LOGIN && !isLoggedIn) {
      gate.showModal();
      syncModalState();
      return;
    }
    answers = [];
    queue = [];
    current = null;
    rounds = 0;
    submitIdea();
  });

  // ---------------------------------------------------------------------------
  // Question popup: a prompt and a text field, centred above the loader.
  // Opened by submitIdea (via nextQuestion) with the questions the backend returns.
  // ---------------------------------------------------------------------------
  const question = document.getElementById('question');
  const questionText = document.getElementById('question-text');
  const answer = question.elements.answer;

  const showQuestion = (text) => {
    if (text) questionText.textContent = text;
    question.classList.add('is-open');
    requestAnimationFrame(() => answer.focus({ preventScroll: true }));
  };

  const hideQuestion = () => {
    question.classList.remove('is-open');
    answer.value = '';
    answer.blur();
  };

  question.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = answer.value.trim();
    if (!text || !current) {
      answer.focus();
      return;
    }
    answers.push({ topic: current.topic, question: current.question, answer: text });
    current = null;
    answer.value = '';
    if (nextQuestion()) return; // the next one is ready: the popup stays open
    hideQuestion();
    submitIdea(); // list answered: send the answers and check for more questions
  });

  // TESTING ONLY: open the page with ?preview=question to see the popup above the loader.
  // The loader runs and no request is made, so it stays on screen. Remove when the flow exists.
  if (new URLSearchParams(location.search).get('preview') === 'question') {
    startLoading();
    wait(EXIT_MS).then(() => showQuestion('Question goes here'));
  }

  // ---------------------------------------------------------------------------
  // Giant wordmark: duplicate the group so the loop is seamless
  // ---------------------------------------------------------------------------
  const track = document.querySelector('.giant__track');
  const copy = track.firstElementChild.cloneNode(true);
  copy.setAttribute('aria-hidden', 'true');
  track.append(copy);
  track.classList.add('is-looping');
})();
