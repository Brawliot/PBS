const formatters = {
  currency: (v) => '$' + v.toLocaleString('en-US'),
  years: (v, max) => (v >= max ? `${max}+ years` : `${v} ${v === 1 ? 'year' : 'years'}`),
};

const formatValue = (range) => {
  const v = Number(range.value);
  if (range.dataset.labels) return range.dataset.labels.split('|')[v];
  return formatters[range.dataset.format](v, Number(range.max));
};

// Search form
const search = document.querySelector('.search');
const idea = search.querySelector('.search__input');
const ideaError = document.getElementById('search-error');

// Sliders always hold a value, so "untouched" is tracked separately (is-set).
// The first user input marks a slider as set; the initial value is only an example.
const ranges = [...search.querySelectorAll('.range')];

ranges.forEach((range) => {
  const output = range.closest('.filter').querySelector('output');
  output.classList.add('is-example');

  const error = document.createElement('p');
  error.className = 'filter__error';
  error.id = `${range.id}-error`;
  error.hidden = true;
  range.after(error);

  range.addEventListener('input', () => {
    range.classList.add('is-set');
    output.classList.remove('is-example');
    output.value = formatValue(range);
    range.removeAttribute('aria-describedby');
    range.removeAttribute('aria-invalid');
    error.hidden = true;
  });
});

idea.addEventListener('input', () => {
  ideaError.hidden = true;
  idea.removeAttribute('aria-invalid');
});

// TODO: replace with the real session state once there is a backend
const isLoggedIn = false;

search.addEventListener('submit', (e) => {
  e.preventDefault();
  const invalid = [];

  if (idea.value.trim() === '') {
    ideaError.hidden = false;
    idea.setAttribute('aria-invalid', 'true');
    invalid.push(idea);
  }
  ranges.filter((r) => !r.classList.contains('is-set')).forEach((range) => {
    const error = document.getElementById(`${range.id}-error`);
    error.textContent = `Select a value for ${range.labels[0].textContent}.`;
    error.hidden = false;
    range.setAttribute('aria-invalid', 'true');
    range.setAttribute('aria-describedby', error.id);
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

// Giant wordmark: duplicate the group so the loop is seamless
const track = document.querySelector('.giant__track');
const group = track.firstElementChild.cloneNode(true);
group.setAttribute('aria-hidden', 'true');
track.append(group);
track.classList.add('is-looping');

// Dialogs
const dialog = document.getElementById('auth-modal');
const gate = document.getElementById('gate-modal');
const title = document.getElementById('auth-title');
const titles = { login: 'Log In', register: 'Register' };
const authForms = [...dialog.querySelectorAll('.auth')];

// Pause the background loop while any dialog is open
const syncModalState = () => {
  document.body.classList.toggle('modal-open', !!document.querySelector('dialog[open]'));
};

[dialog, gate].forEach((d) => {
  d.addEventListener('close', syncModalState);
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.querySelector('[data-close]').addEventListener('click', () => d.close());
});

// One error message per field, linked to its input with aria-describedby
authForms.forEach((form) => {
  form.querySelectorAll('input').forEach((input) => {
    const field = input.closest('label');
    const error = document.createElement('p');
    error.className = 'auth__error';
    error.id = `${form.dataset.form}-${input.name}-error`;
    error.hidden = true;
    const hint = field.nextElementSibling;
    (hint && hint.classList.contains('auth__hint') ? hint : field).after(error);
    input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '));
  });
});

const errorOf = (input) => document.getElementById(`${input.form.dataset.form}-${input.name}-error`);

const setError = (input, message) => {
  const error = errorOf(input);
  error.textContent = message;
  error.hidden = false;
  input.setAttribute('aria-invalid', 'true');
};

const clearField = (input) => {
  errorOf(input).hidden = true;
  input.removeAttribute('aria-invalid');
};

const clearErrors = (form) => form.querySelectorAll('input').forEach(clearField);

const fieldName = (input) => input.closest('label').firstChild.textContent.trim();

const validateAuth = (form) => {
  const register = form.dataset.form === 'register';
  const { email, password, password2 } = form.elements;
  const invalid = [];
  const fail = (input, message) => { setError(input, message); invalid.push(input); };

  form.querySelectorAll('input').forEach((input) => {
    if (input.value.trim() === '') fail(input, `${fieldName(input)} is required.`);
  });
  if (email.value && !email.checkValidity()) fail(email, 'Enter a valid email address.');
  if (register && password.value && password.value.length < 8) fail(password, 'Password must be at least 8 characters.');
  if (register && password.value && password2.value && password.value !== password2.value) fail(password2, 'Passwords do not match.');

  if (invalid.length) invalid[0].focus();
  return invalid.length === 0;
};

const openAuth = (mode) => {
  authForms.forEach((f) => { f.hidden = f.dataset.form !== mode; });
  title.textContent = titles[mode];
  dialog.showModal();
  syncModalState();
};

dialog.addEventListener('close', () => {
  authForms.forEach((f) => { f.reset(); clearErrors(f); });
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

authForms.forEach((form) => {
  form.addEventListener('input', (e) => clearField(e.target));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors(form);
    if (!validateAuth(form)) return;
    // TODO: send data
  });
});
