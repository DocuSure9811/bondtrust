// Buscador del centro de ayuda: filtra los artículos en la misma página.
const input = document.getElementById('help-q');
const empty = document.getElementById('help-empty');
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

input.addEventListener('input', () => {
  const words = norm(input.value).split(/\s+/).filter(Boolean);
  let shown = 0;
  document.querySelectorAll('.help-topic').forEach((topic) => {
    let visible = 0;
    topic.querySelectorAll('.help-item').forEach((item) => {
      const text = norm(item.dataset.text);
      const match = words.every((w) => text.includes(w));
      item.hidden = !match;
      if (match) visible += 1;
    });
    topic.hidden = visible === 0;
    shown += visible;
  });
  empty.hidden = shown > 0;
});
