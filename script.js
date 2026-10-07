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

search.addEventListener('submit', (e) => {
  e.preventDefault();
  if (idea.value.trim() === '') {
    ideaError.hidden = false;
    idea.setAttribute('aria-invalid', 'true');
    idea.focus();
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

// Auth dialog
const dialog = document.getElementById('auth-modal');
const title = document.getElementById('auth-title');
const titles = { login: 'Log In', register: 'Register' };
const authForms = [...dialog.querySelectorAll('.auth')];

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

  if (form.dataset.form === 'register' && form.elements.password.value !== form.elements.password2.value) {
    return showError(form, 'Passwords do not match.', [form.elements.password2]), false;
  }
  return true;
};

document.querySelectorAll('[data-auth]').forEach((button) => {
  button.addEventListener('click', () => {
    const mode = button.dataset.auth;
    authForms.forEach((f) => { f.hidden = f.dataset.form !== mode; });
    title.textContent = titles[mode];
    document.body.classList.add('modal-open');
    dialog.showModal();
  });
});

dialog.addEventListener('close', () => {
  document.body.classList.remove('modal-open');
  authForms.forEach((f) => { f.reset(); clearErrors(f); });
});
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());

authForms.forEach((form) => {
  form.addEventListener('input', () => clearErrors(form));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors(form);
    if (!validateAuth(form)) return;
    // TODO: send data
  });
});
