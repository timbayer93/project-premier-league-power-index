/*
  ui.js
  One shared helper for the pill-style toggle groups used throughout the
  app — the global filter bar toggles, and every tab-local toggle (table
  filter, form window, fixtures view, etc). Keeps the aria-pressed
  bookkeeping in one place instead of repeating it in every file.
*/

export function bindSegmented(id, onChange) {
  const el = document.getElementById(id);
  el.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      onChange(btn.dataset.val);
    });
  });
}
