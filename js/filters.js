/*
  filters.js
  Wires up the global filter bar (Competition / Season / Last N matches) and
  holds renderAll(), which redraws every data-driven part of the page.
  Overview, Team Ratings, Fixtures, Match Forecasts, DefCons and Expected
  Goals (team view) are data-driven so far — as other tabs are refactored, import
  their render functions and add them to renderAll().
*/

import { state, MAX_LAST_N } from './state.js';
import { renderHero } from './hero.js';
import { renderTrendChart } from './heroCharts.js';
import { renderTeamRatings } from './teamRatings.js';
import { renderFixtures } from './fixtures.js';
import { renderMatchForecasts } from './matchForecasts.js';
import { renderDefcons } from './defcons.js';
import { renderExpectedGoals } from './expectedGoals.js';

export async function renderAll() {
  await Promise.all([
    renderHero(),
    renderTrendChart(),
    renderTeamRatings(),
    renderFixtures(),
    renderMatchForecasts(),
    renderWindowTables(),
  ]);
}

/** The tables that use the "Last N matches" window. */
function renderWindowTables() {
  return Promise.all([renderDefcons(), renderExpectedGoals()]);
}

export function initFilters() {
  document.getElementById('fCompetition').addEventListener('change', (e) => {
    state.competition = e.target.value;
    renderAll();
  });

  document.getElementById('fSeason').addEventListener('change', (e) => {
    state.season = Number(e.target.value);
    renderAll();
  });

  // Last N matches: a whole number from 1 to MAX_LAST_N.
  const lastNInput = document.getElementById('fLastN');
  lastNInput.max = MAX_LAST_N;
  lastNInput.value = state.lastN;

  lastNInput.addEventListener('change', () => {
    if (lastNInput.value !== '') {
      state.lastN = Math.min(MAX_LAST_N, Math.max(1, Math.round(Number(lastNInput.value))));
    }
    lastNInput.value = state.lastN; // show the corrected value (or restore it if it was blank)
    renderWindowTables();
  });

  // "This season only": each team's window becomes its matches this season,
  // so the N box is greyed out until it is unticked.
  const seasonOnlyBox = document.getElementById('fSeasonOnly');
  seasonOnlyBox.addEventListener('change', () => {
    state.seasonOnly = seasonOnlyBox.checked;
    lastNInput.disabled = state.seasonOnly;
    renderWindowTables();
  });
}
