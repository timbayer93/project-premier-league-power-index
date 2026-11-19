/*
  tabs.js
  Switches which <section class="panel"> is visible when a nav button
  is clicked. Doesn't touch any data, so it has no imports.
*/

export function initTabs() {
  const tabButtons = document.querySelectorAll('nav.tabs button');
  const panels = document.querySelectorAll('.panel');

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabButtons.forEach((b) => b.setAttribute('aria-selected', 'false'));
      btn.setAttribute('aria-selected', 'true');

      panels.forEach((p) => p.classList.remove('active'));
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    });
  });
}
