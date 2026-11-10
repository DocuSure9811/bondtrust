const form = document.getElementById('access-form');
const input = document.getElementById('access-code');
const err = document.getElementById('access-err');

input.addEventListener('input', () => {
  const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  input.value = raw.match(/.{1,4}/g)?.join('-') || '';
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = input.value.replace(/-/g, '');
  if (code.length !== 12) {
    err.textContent = 'El código tiene 12 caracteres.';
    return;
  }
  location.href = `/firmar/${code}`;
});
