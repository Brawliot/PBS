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

  // TODO: replace with the real session state once there is a backend
  const isLoggedIn = false;

  search.addEventListener('submit', (e) => {
    e.preventDefault();
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
    if (!isLoggedIn) {
      gate.showModal();
      syncModalState();
      return;
    }
    // TODO: send data
  });

  // ---------------------------------------------------------------------------
  // Giant wordmark: duplicate the group so the loop is seamless
  // ---------------------------------------------------------------------------
  const track = document.querySelector('.giant__track');
  const copy = track.firstElementChild.cloneNode(true);
  copy.setAttribute('aria-hidden', 'true');
  track.append(copy);
  track.classList.add('is-looping');
})();
