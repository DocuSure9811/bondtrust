(() => {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    });
  }

  const menus = [...document.querySelectorAll('details.menu')];
  menus.forEach((m) => m.addEventListener('toggle', () => {
    if (m.open) menus.filter((o) => o !== m).forEach((o) => { o.open = false; });
  }));
  document.addEventListener('click', (e) => {
    menus.forEach((m) => { if (m.open && !m.contains(e.target)) m.open = false; });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    menus.forEach((m) => {
      if (m.open) { m.open = false; m.querySelector('summary').focus(); }
    });
  });

  const billing = document.querySelectorAll('[data-billing]');
  billing.forEach((btn) => btn.addEventListener('click', () => {
    const mode = btn.dataset.billing;
    billing.forEach((b) => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('.plan-price .amount').forEach((el) => { el.textContent = el.dataset[mode]; });
    document.querySelectorAll('.plan-billing').forEach((el) => { el.textContent = el.dataset[`${mode}Text`]; });
  }));
})();
