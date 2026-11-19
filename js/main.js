/*
  main.js
  Entry point, loaded from index.html as <script type="module">.
  Sequence: load config.json -> populate the filter dropdowns from it ->
  wire up every tab -> draw them all (renderAll in filters.js).
*/

import { loadJSON } from './dataStore.js';
import { getLastCompletedGw } from './leagueData.js';
import { state } from './state.js';
import { initTabs } from './tabs.js';
import { initFilters, renderAll } from './filters.js';
import { initHero } from './hero.js';
import { initTrendChart } from './heroCharts.js';
import { initTeamRatings } from './teamRatings.js';
import { initFixtures } from './fixtures.js';
import { initMatchForecasts } from './matchForecasts.js';
import { initDefcons } from './defcons.js';
import { initExpectedGoals } from './expectedGoals.js';

// Placeholder tabs (no data yet)
import { initOwnership } from './ownership.js';
import { initSentiment } from './sentiment.js';

/** Builds the <option> lists for Competition/Season from config.json */
function populateFilterDropdowns(config) {
  const seasonSelect = document.getElementById('fSeason');
  seasonSelect.innerHTML = config.available_seasons
    .map((s) => {
      const label = s === config.season ? config.season_name : String(s);
      return `<option value="${s}" ${s === config.season ? 'selected' : ''}>${label}</option>`;
    })
    .join('');

  const compSelect = document.getElementById('fCompetition');
  compSelect.innerHTML = config.available_competitions
    .map((c) => `<option value="${c}" ${c === config.competition ? 'selected' : ''}>${c}</option>`)
    .join('');
}

/** activeGW is set by hand. If it falls behind the last completed gameweek
 *  in gameweeks.json, "next gameweek" lookups (Fixtures, DefCons) will find
 *  nothing, so say so in the console instead of failing silently. */
async function warnIfActiveGwIsStale() {
  const lastCompleted = await getLastCompletedGw();
  if (state.gameweek < lastCompleted) {
    console.warn(
      `data/config.json has activeGW = ${state.gameweek}, but gameweek ${lastCompleted} is already complete. ` +
      `Update activeGW so "next gameweek" columns line up.`
    );
  }
}

async function start() {
  const config = await loadJSON('data/config.json');

  state.competition = config.competition;
  state.season = config.season;
  state.latest_season = config.latest_season;
  state.gameweek = config.activeGW;

  populateFilterDropdowns(config);

  initTabs();
  initFilters();
  initHero();
  initTrendChart();
  initTeamRatings();
  initFixtures();
  initMatchForecasts();
  initDefcons();
  initExpectedGoals();
  initOwnership();
  initSentiment();
  await renderAll();
  await warnIfActiveGwIsStale();
}

start();
