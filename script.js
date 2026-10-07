const form = document.querySelector('.search');
const input = form.querySelector('.search__input');
const ranges = [...form.querySelectorAll('.range')];
const submit = form.querySelector('.search__submit');

const fmt = (range) => {
  const v = Number(range.value);
  return range.max >= 1000000 ? '$' + v.toLocaleString('es-ES') : v + ' años';
};

const validate = () => {
  const ok = input.value.trim() !== '' && ranges.every((r) => r.classList.contains('is-set'));
  submit.disabled = !ok;
  return ok;
};

ranges.forEach((range) => {
  range.addEventListener('input', () => {
    range.classList.add('is-set');
    range.closest('.filter').querySelector('.filter__head span').textContent = fmt(range);
    validate();
  });
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
  modal.querySelector(`[data-form="${mode}"] input`).focus();
};
const closeModal = () => { modal.hidden = true; };

document.querySelectorAll('[data-auth]').forEach((el) => {
  el.addEventListener('click', (e) => { e.preventDefault(); openModal(el.dataset.auth); });
});
modal.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeModal));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
modal.querySelectorAll('.auth').forEach((f) => f.addEventListener('submit', (e) => e.preventDefault()));
