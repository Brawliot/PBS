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

search.querySelectorAll('.range').forEach((range) => {
  range.addEventListener('input', () => {
    range.closest('.filter').querySelector('output').value = formatValue(range);
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
  if (idea.value.trim() === '') {
    ideaError.hidden = false;
    idea.setAttribute('aria-invalid', 'true');
    idea.focus();
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

const showError = (form, message, fields = []) => {
  const box = form.querySelector('.auth__error');
  box.textContent = message;
  box.hidden = false;
  fields.forEach((f) => f.setAttribute('aria-invalid', 'true'));
  (fields[0] || form.querySelector('input')).focus();
};

const clearErrors = (form) => {
  form.querySelector('.auth__error').hidden = true;
  form.querySelectorAll('[aria-invalid]').forEach((f) => f.removeAttribute('aria-invalid'));
};

const validateAuth = (form) => {
  const inputs = [...form.querySelectorAll('input')];
  const empty = inputs.filter((i) => i.value.trim() === '');
  if (empty.length) return showError(form, 'Please fill in all fields.', empty), false;

  const email = form.elements.email;
  if (!email.checkValidity()) return showError(form, 'Enter a valid email address.', [email]), false;

  if (form.dataset.form === 'register' && form.elements.password.value.length < 8) {
    return showError(form, 'Password must be at least 8 characters.', [form.elements.password]), false;
  }
  if (form.dataset.form === 'register' && form.elements.password.value !== form.elements.password2.value) {
    return showError(form, 'Passwords do not match.', [form.elements.password2]), false;
  }
  return true;
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
  form.addEventListener('input', () => clearErrors(form));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors(form);
    if (!validateAuth(form)) return;
    // TODO: send data
  });
});
