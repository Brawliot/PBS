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
