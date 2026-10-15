(() => {
  'use strict';
  const headers = document.querySelectorAll('.top');
  headers.forEach((header) => {
    const button = header.querySelector('.nav-toggle');
    const nav = header.querySelector('#public-site-navigation');
    if (!button || !nav) return;
    const close = () => {
      header.classList.remove('is-menu-open');
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', 'باز کردن منوی اصلی');
    };
    button.addEventListener('click', () => {
      const opening = !header.classList.contains('is-menu-open');
      header.classList.toggle('is-menu-open', opening);
      button.setAttribute('aria-expanded', String(opening));
      button.setAttribute('aria-label', opening ? 'بستن منوی اصلی' : 'باز کردن منوی اصلی');
    });
    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });
    document.addEventListener('pointerdown', (event) => {
      if (!header.contains(event.target)) close();
    });
  });
})();
