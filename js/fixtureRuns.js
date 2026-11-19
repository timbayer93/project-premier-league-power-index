/*
  fixtureRuns.js
  The "Runs" layout of the Fixtures tab: for every team, its easiest and
  its hardest run of upcoming fixtures, in two tables side by side
  (one at a time on a phone). Each table starts sorted by soonest run
  first, and can be re-sorted by clicking Team, Run or Avg.

  A run is a set of consecutive gameweeks (the "Run length" input, 3 to 8,
  default 5), searched over the whole rest of the season, starting at
  state.gameweek + 1. A run's difficulty is the average difficulty of its
  gameweeks (how fixture difficulty is worked out: fixtureData.js).

  - A gameweek with two fixtures counts as the average of the two.
  - A blank gameweek counts as the hardest fixture in the league, so runs
    with blanks rank as harder.
  - If fewer gameweeks remain than the run length, the run is shortened.
*/

import { state } from './state.js';
import { bindSegmented } from './ui.js';
import { compareRows, crestHtml } from './utils.js';
import { getCellShading } from './shading.js';

const MIN_RUN_LENGTH = 3;
const MAX_RUN_LENGTH = 8;
const DEFAULT_RUN_LENGTH = 5;

let data = null;                    // from fixtureData.js
let runLength = DEFAULT_RUN_LENGTH;
let tables = { easiest: [], hardest: [] }; // one row per team, for each table

// Each table's current sort. Both start with the soonest runs first
// (earliest start gameweek). Ties go to the more extreme run (see renderTable).
const sorts = {
  easiest: { key: 'startGw', dir: 1 },
  hardest: { key: 'startGw', dir: 1 },
};

/* ---------- finding each team's runs ---------- */

/** One gameweek's difficulty for a team: the average of its fixtures that
 *  gameweek, or the league's hardest fixture if it has none. */
function gwDifficulty(fixtures) {
  if (fixtures.length === 0) return data.hardestDifficulty;
  return fixtures.reduce((sum, f) => sum + f.difficulty, 0) / fixtures.length;
}

/**
 * WHAT COUNTS AS THE "EASIEST" / "HARDEST" RUN — change it here.
 *
 * `windows` is every possible run for one team. Today the easiest run is
 * the single window with the lowest average difficulty, and the hardest is
 * the single window with the highest. On a tie the earliest wins.
 * (To mean something else, e.g. "the earliest run below a threshold",
 * only this function needs to change.)
 */
function pickRun(windows, which) {
  let chosen = windows[0];

  for (const window of windows) {
    const isBetter = which === 'easiest' ? window.avg < chosen.avg : window.avg > chosen.avg;
    if (isBetter) chosen = window; // strict comparison keeps the earliest on a tie
  }
  return chosen;
}

/** Builds both tables' rows for the current run length. */
function buildRuns() {
  const firstGw = state.gameweek + 1;
  const gws = [];
  for (let gw = firstGw; gw <= data.lastGw; gw++) gws.push(gw);

  const length = Math.min(runLength, gws.length); // shorten near the end of the season
  if (length === 0 || data.hardestDifficulty === null) return { easiest: [], hardest: [] };

  const easiest = [];
  const hardest = [];

  for (const team of data.teams) {
    const byGw = data.fixturesByTeam.get(team.team_id);
    const entries = gws.map((gw) => {
      const fixtures = byGw?.get(gw) ?? [];
      return { gw, fixtures, difficulty: gwDifficulty(fixtures) };
    });

    // Every run of `length` consecutive gameweeks.
    const windows = [];
    for (let i = 0; i + length <= entries.length; i++) {
      const run = entries.slice(i, i + length);
      windows.push({
        startGw: run[0].gw,
        endGw: run[run.length - 1].gw,
        avg: run.reduce((sum, e) => sum + e.difficulty, 0) / run.length,
        entries: run,
      });
    }

    const base = { team_id: team.team_id, team: team.team, team_short: team.team_short };
    easiest.push({ ...base, ...pickRun(windows, 'easiest') });
    hardest.push({ ...base, ...pickRun(windows, 'hardest') });
  }
  return { easiest, hardest };
}

/* ---------- drawing ---------- */

/** One gameweek of a run: the opponent's crest and H/A (stacked if there are two). */
function chipHtml(entry) {
  if (entry.fixtures.length === 0) {
    return `<span class="run-chip run-chip--blank" title="GW${entry.gw} · blank">–</span>`;
  }

  const fixtures = entry.fixtures
    .map((f) => `<span class="run-fixture">${crestHtml(f.opponentId, data.teamsById)}<span class="run-venue">${f.isHome ? 'H' : 'A'}</span></span>`)
    .join('');

  const names = entry.fixtures
    .map((f) => `${data.teamsById.get(f.opponentId)?.team ?? '?'} (${f.isHome ? 'H' : 'A'})`)
    .join(', ');

  return `<span class="run-chip" title="GW${entry.gw} · ${names}">${fixtures}</span>`;
}

function renderRow(row, i, columnRange) {
  // The average gets shaded once getCellShading is designed (shading.js).
  const shading = getCellShading('runAvg', row.avg, columnRange);
  const style = shading ? ` style="${shading}"` : '';

  return `
    <tr>
      <td class="sticky-col" style="--stick-left:0px;">${i + 1}</td>
      <td class="col-left sticky-col sticky-col--edge" style="--stick-left:40px;">
        <div class="team-cell">${crestHtml(row.team_id, data.teamsById)}<span class="team-name-full">${row.team}</span><span class="team-name-short">${row.team_short}</span></div>
      </td>
      <td class="col-left">GW${row.startGw}–${row.endGw}</td>
      <td${style}>${row.avg.toFixed(1)}</td>
      <td class="col-left"><div class="run-chips">${row.entries.map(chipHtml).join('')}</div></td>
    </tr>
  `;
}

function renderTable(which) {
  const { key, dir } = sorts[which];
  // Ties (e.g. two runs starting the same gameweek) fall back to the average,
  // most extreme first for this table.
  const tieBreak = which === 'easiest' ? 1 : -1;
  const rows = [...tables[which]].sort((a, b) => compareRows(a, b, key, dir) || (a.avg - b.avg) * tieBreak);
  const name = which[0].toUpperCase() + which.slice(1);

  // min and max average across this table, for the shading function
  const averages = rows.map((r) => r.avg);
  const columnRange = { min: Math.min(...averages), max: Math.max(...averages) };

  document.getElementById(`runs${name}Body`).innerHTML = rows.map((row, i) => renderRow(row, i, columnRange)).join('');

  document.querySelectorAll(`#runs${name}Table thead th[data-key]`).forEach((th) => {
    const isSorted = th.dataset.key === key;
    th.classList.toggle('sorted', isSorted);
    th.querySelector('.arrow').textContent = isSorted ? (dir === 1 ? '▲' : '▼') : '';
  });
}

function renderTables() {
  tables = data ? buildRuns() : { easiest: [], hardest: [] };

  const length = tables.easiest[0]?.entries.length ?? runLength;
  document.getElementById('runsEasiestTitle').textContent = `Easiest ${length}-gameweek run`;
  document.getElementById('runsHardestTitle').textContent = `Hardest ${length}-gameweek run`;

  renderTable('easiest');
  renderTable('hardest');
}

/* ---------- public ---------- */

/** Redraws both tables with freshly loaded fixture data. */
export function renderFixtureRuns(fixtureData) {
  data = fixtureData;
  renderTables();
}

/** Wires up the run-length input, the phone toggle and the sortable headers. */
export function initFixtureRuns() {
  const lengthInput = document.getElementById('runsLength');
  lengthInput.min = MIN_RUN_LENGTH;
  lengthInput.max = MAX_RUN_LENGTH;
  lengthInput.value = runLength;

  lengthInput.addEventListener('change', () => {
    if (lengthInput.value !== '') {
      runLength = Math.min(MAX_RUN_LENGTH, Math.max(MIN_RUN_LENGTH, Math.round(Number(lengthInput.value))));
    }
    lengthInput.value = runLength; // show the corrected value (or restore it if blank)
    if (data) renderTables();
  });

  // On a phone only one table shows at a time (the CSS does the hiding).
  bindSegmented('runsMobileTab', (val) => {
    document.getElementById('runsLayout').dataset.mobileTab = val;
  });

  // Click a header to sort that table. First click: Team and Run (start
  // gameweek) go A-Z / earliest first; the average goes to whichever end
  // is "most extreme" for that table.
  for (const which of ['easiest', 'hardest']) {
    const name = which[0].toUpperCase() + which.slice(1);

    document.getElementById(`runs${name}Table`).querySelector('thead').addEventListener('click', (e) => {
      const th = e.target.closest('th[data-key]');
      if (!th) return;

      const sort = sorts[which];
      if (th.dataset.key === sort.key) {
        sort.dir *= -1;
      } else {
        sort.key = th.dataset.key;
        sort.dir = th.dataset.key === 'avg' && which === 'hardest' ? -1 : 1;
      }
      renderTable(which);
    });
  }
}
