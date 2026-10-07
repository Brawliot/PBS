const form = document.querySelector('.search');
const input = form.querySelector('.search__input');
const ranges = [...form.querySelectorAll('.range')];
const submit = form.querySelector('.search__submit');

const fmt = (range) => {
  const v = Number(range.value);
  if (range.dataset.labels) return range.dataset.labels.split('|')[v];
  if (range.id === 'experiencia') return v >= 20 ? '20+ años' : v + (v === 1 ? ' año' : ' años');
  return '$' + v.toLocaleString('es-ES');
};

const validate = () => {
  const ok = input.value.trim() !== '' && ranges.every((r) => r.classList.contains('is-set'));
  submit.disabled = !ok;
  return ok;
};

ranges.forEach((range) => {
  const update = () => {
    range.classList.add('is-set');
    range.closest('.filter').querySelector('output').value = fmt(range);
    validate();
  };
  range.addEventListener('input', update);
  update();
});
input.addEventListener('input', validate);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!validate()) return;
  // TODO: enviar datos
});

// Auth modal
const modal = document.getElementById('auth-modal');
const title = document.getElementById('auth-title');
const titles = { login: 'Log In', register: 'Register' };

const openModal = (mode) => {
  modal.querySelectorAll('[data-form]').forEach((f) => { f.hidden = f.dataset.form !== mode; });
  title.textContent = titles[mode];
  modal.hidden = false;
  document.body.classList.add('modal-open');
  modal.querySelector(`[data-form="${mode}"] input`).focus();
};
const closeModal = () => {
  modal.hidden = true;
  document.body.classList.remove('modal-open');
};

document.querySelectorAll('[data-auth]').forEach((el) => {
  el.addEventListener('click', (e) => { e.preventDefault(); openModal(el.dataset.auth); });
});
modal.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeModal));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
modal.querySelectorAll('.auth').forEach((f) => f.addEventListener('submit', (e) => e.preventDefault()));
