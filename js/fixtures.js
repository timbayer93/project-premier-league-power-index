/*
  fixtures.js
  The Fixtures tab. It has two layouts, switched by the toggle in the
  section header (Fixture Runs | Fixture Tickers). Fixture Runs shows first:

    Fixture Tickers (this file)
        The grid: Rank / Team / Overall sticky on the left, one column per
        upcoming gameweek. The view toggle changes what each cell shows,
        what Overall means, and what each GW column sorts by. Click a team's
        row to highlight it (click again to clear).
    Fixture Runs (fixtureRuns.js)
        Each team's easiest and hardest run of fixtures.

  Data: loaded once by fixtureData.js (which also holds the DIFFICULTY
  formula). Only unplayed gameweeks are shown: they start at
  state.gameweek + 1.

  Fixture Tickers views (the `view` variable):
    'difficulty'  how hard the opponent is (see DIFFICULTY in fixtureData.js)
    'xg'          projected expected goals
    'cs'          projected clean sheet probability
    'dc_hits'     projected defensive contribution hits
*/

import { state } from './state.js';
import { bindSegmented } from './ui.js';
import { compareWithBlanksLast, crestHtml, getTeamLogoURL } from './utils.js';
import { loadFixtureData } from './fixtureData.js';
import { initFixtureRuns, renderFixtureRuns } from './fixtureRuns.js';
import { getCellShading, getValueRange } from './shading.js';

const MAX_COLUMNS = 10;
const DEFAULT_COLUMNS = 5;

/* ---------- state ---------- */

let data = { teams: [], teamsById: new Map(), fixturesByTeam: new Map(), lastGw: 0, hardestDifficulty: null }; // see fixtureData.js

let view = 'difficulty';
let highlightedTeamId = null; // the team picked by clicking its row (stays picked as the table changes)
let sortKey = 'overall';     // 'overall' | 'team' | 'gw7' ...
let sortDir = 1;             // 1 = ascending, -1 = descending

/* ---------- gameweek range ---------- */

function getFirstGw() {
  return state.gameweek + 1;
}

/** Reads and tidies the "From GW" / "Columns" inputs and returns the gameweeks to show. */
function getGwRange() {
  const startInput = document.getElementById('fixturesStartGw');
  const countInput = document.getElementById('fixturesNumGw');

  const start = Math.max(getFirstGw(), Number(startInput.value) || getFirstGw());
  const count = Math.min(MAX_COLUMNS, Math.max(1, Number(countInput.value) || DEFAULT_COLUMNS));

  startInput.value = start; // show any correction back in the input

  const gwList = [];
  for (let gw = start; gw < start + count && gw <= data.lastGw; gw++) gwList.push(gw);
  return gwList;
}

/* ---------- numbers ---------- */

/** True for null, undefined, NaN or anything else that isn't a usable number. */
function isMissing(value) {
  return typeof value !== 'number' || !Number.isFinite(value);
}

/** One gameweek's value for a metric. Difficulty is averaged across that
 *  gameweek's fixtures; everything else is added up.
 *
 *  null means "no value to show": either no fixture that gameweek, or a
 *  fixture whose number is missing in the data. A missing number is never
 *  added up as 0, and a double gameweek with one half missing is unknown,
 *  not half the total. (To tell the two cases apart, check fixtures.length.) */
function gwValue(fixtures, metric) {
  if (fixtures.length === 0) return null;
  if (fixtures.some((f) => isMissing(f[metric]))) return null;

  const total = fixtures.reduce((sum, f) => sum + f[metric], 0);
  return metric === 'difficulty' ? total / fixtures.length : total;
}

/** The Overall column: difficulty is averaged across the gameweeks shown,
 *  everything else is totalled. null = nothing to show.
 *
 *  In the Difficulty view a blank gameweek counts as the hardest fixture in
 *  the league (see fixtureData.js), so teams with blanks rank as harder. */
function overallValue(series, metric) {
  if (series.length === 0) return null;

  // A gameweek that has fixtures but a missing number makes the overall unknown.
  // Showing a total of just the gameweeks that do have numbers would look
  // like a real (and misleadingly low) figure.
  const hasMissingData = series.some((gw) => gw.fixtures.length > 0 && gwValue(gw.fixtures, metric) === null);
  if (hasMissingData) return null;

  const values = series.map((gw) => gwValue(gw.fixtures, metric));

  if (metric === 'difficulty') {
    const filled = values.map((v) => v ?? data.hardestDifficulty);
    if (filled.includes(null)) return null; // no fixtures anywhere, so no "hardest" to use
    return filled.reduce((sum, v) => sum + v, 0) / filled.length;
  }

  const present = values.filter((v) => v !== null);
  if (present.length === 0) return null;
  return present.reduce((sum, v) => sum + v, 0);
}

function buildRows(gwList) {
  return data.teams.map((team) => {
    const byGw = data.fixturesByTeam.get(team.team_id);
    const series = gwList.map((gw) => ({ gw, fixtures: byGw?.get(gw) ?? [] }));

    const row = {
      team_id: team.team_id,
      team: team.team,
      team_short: team.team_short,
      series,
      overall: overallValue(series, view),
    };
    series.forEach((entry) => { row['gw' + entry.gw] = gwValue(entry.fixtures, view); });
    return row;
  });
}

/* ---------- formatting ---------- */

/** One opponent: crest, short name and (H) / (A). To show logos only, hide
 *  .fixture-name in the CSS. */
function opponentHtml(fixture) {
  const opponent = data.teamsById.get(fixture.opponentId);

  return `<div class="fixture-line"><span class="fixture-opponent">${crestHtml(fixture.opponentId, data.teamsById)}<span class="fixture-name">${opponent?.team_short ?? '?'}</span> <span class="fixture-venue">(${fixture.isHome ? 'H' : 'A'})</span></span></div>`;
}

/** The contents of one gameweek cell. A double gameweek lists both
 *  opponents, one under the other. In the Difficulty view that is all
 *  there is (its Overall column averages the two). In the other views the
 *  number on top is the total of both fixtures, with the opponents below. */
function cellHtml(entry) {
  if (entry.fixtures.length === 0) return `<span class="fixture-blank">–</span>`;

  const opponents = entry.fixtures.map(opponentHtml).join('');
  if (view === 'difficulty') return opponents;

  const value = gwValue(entry.fixtures, view);
  let primary = '–'; // the number is missing in the data
  if (value !== null) primary = view === 'cs' ? `${(value * 100).toFixed(0)}%` : value.toFixed(2);

  return `<div class="fixture-primary">${primary}</div><div class="fixture-secondary">${opponents}</div>`;
}

function overallText(value) {
  if (value === null) return '–';
  return view === 'difficulty' ? value.toFixed(1) : value.toFixed(2);
}

/* ---------- shading (see shading.js) ---------- */

// The column key shading.js uses for each view.
const SHADING_KEYS = { difficulty: 'fixtureDifficulty', xg: 'fixtureXg', cs: 'fixtureCs', dc_hits: 'fixtureDcHits' };

/** The number a cell is shaded by: per match, so a double gameweek (whose cell shows
 *  the total of both fixtures) is judged on the same scale as a single one.
 *  null when there is nothing to shade (blank gameweek, or a number missing in the data). */
function shadingValue(fixtures, metric) {
  const value = gwValue(fixtures, metric);
  if (value === null) return null;
  return metric === 'difficulty' ? value : value / fixtures.length; // difficulty is already an average
}

/** One scale for the whole grid: every upcoming fixture, not just the columns on screen,
 *  so a fixture keeps its colour whichever gameweeks are showing. */
function getShadingRange() {
  const values = [];
  for (const byGw of data.fixturesByTeam.values()) {
    for (const [gw, fixtures] of byGw) {
      if (gw >= getFirstGw()) values.push(shadingValue(fixtures, view));
    }
  }
  return getValueRange(values);
}

/** ` style="..."` for a cell, or '' when it isn't shaded. */
function styleAttr(columnKey, value, range) {
  const shading = getCellShading(columnKey, value, range);
  return shading ? ` style="${shading}"` : '';
}

/* ---------- sorting ---------- */

/** Which way a column sorts the first time it's clicked. Team is A-Z;
 *  in the Difficulty view the easiest fixtures come first; for every
 *  other view the biggest number comes first. */
function defaultDirFor(key) {
  if (key === 'team') return 1;
  return view === 'difficulty' ? 1 : -1;
}

/* ---------- table ---------- */

/** The style for one gameweek cell. A blank gameweek is never shaded. */
function gwCellStyle(entry, range) {
  if (entry.fixtures.length === 0) return '';
  return styleAttr(SHADING_KEYS[view], shadingValue(entry.fixtures, view), range);
}

function renderTable() {
  const gwList = getGwRange();
  const rows = buildRows(gwList).sort((a, b) => compareWithBlanksLast(a, b, sortKey, sortDir));
  const shadingRange = getShadingRange();

  document.getElementById('fixturesHeadRow').innerHTML = `
    <th class="sticky-col" style="--stick-left:0px; width:40px;">#</th>
    <th data-key="team" class="sortable col-left sticky-col sticky-col--edge" style="--stick-left:40px; width:160px;">Team<span class="arrow"></span></th>
    <th data-key="overall" class="sortable">Overall<span class="arrow"></span></th>
    ${gwList.map((gw) => `<th data-key="gw${gw}" class="sortable gw-col">GW${gw}<span class="arrow"></span></th>`).join('')}
  `;

  document.getElementById('fixturesBody').innerHTML = rows
    .map((row, i) => `
      <tr data-team="${row.team_id}"${row.team_id === highlightedTeamId ? ' class="row-highlight"' : ''}>
        <td class="sticky-col" style="--stick-left:0px;">${i + 1}</td>
        <td class="col-left sticky-col sticky-col--edge" style="--stick-left:40px; width:160px;">
          <div class="team-cell">
            <img class="crest" src="${getTeamLogoURL(row.team_id)}" alt="">
            <span class="team-name-full">${row.team}</span>
            <span class="team-name-short">${row.team_short}</span>
          </div>
        </td>
        <td${styleAttr('fixtureOverall', row.overall)}>${overallText(row.overall)}</td>
        ${row.series.map((entry) => `<td class="gw-col"${gwCellStyle(entry, shadingRange)}>${cellHtml(entry)}</td>`).join('')}
      </tr>`)
    .join('');

  updateSortIndicators();
}

function updateSortIndicators() {
  document.querySelectorAll('#fixturesHeadRow th[data-key]').forEach((th) => {
    const isSorted = th.dataset.key === sortKey;
    th.classList.toggle('sorted', isSorted);
    th.querySelector('.arrow').textContent = isSorted ? (sortDir === 1 ? '▲' : '▼') : '';
  });
}

function renderNote() {
  document.getElementById('fixturesNote').textContent =
    `difficulty from opponent rating · projections from GW ${getFirstGw()}`;
}

/** Shows the Fixture Tickers (grid) or the Fixture Runs layout. */
function showLayout(next) {
  document.getElementById('fixturesGridView').style.display = next === 'grid' ? '' : 'none';
  document.getElementById('fixturesRunsView').style.display = next === 'runs' ? '' : 'none';
}

/* ---------- public ---------- */

/** Loads the data for the selected competition and draws both layouts. */
export async function renderFixtures() {
  data = await loadFixtureData();
  renderNote();
  renderTable();
  renderFixtureRuns(data);
}

/** Wires up the layout toggle, the grid's toggle and inputs, and the sortable headers. */
export function initFixtures() {
  const startInput = document.getElementById('fixturesStartGw');
  const countInput = document.getElementById('fixturesNumGw');

  startInput.min = getFirstGw();
  startInput.value = getFirstGw();
  countInput.max = MAX_COLUMNS;
  countInput.value = DEFAULT_COLUMNS;

  bindSegmented('fixturesLayout', showLayout);

  bindSegmented('fixturesView', (val) => {
    view = val;
    sortKey = 'overall';
    sortDir = defaultDirFor('overall');
    renderTable();
  });

  startInput.addEventListener('change', renderTable);
  countInput.addEventListener('change', renderTable);

  // Click a team to highlight its row; click it again to clear. The highlight
  // stays as you change the number of gameweeks, the view or the sort, so you
  // can follow where the team moves.
  document.getElementById('fixturesBody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-team]');
    if (!tr) return;

    const teamId = Number(tr.dataset.team);
    highlightedTeamId = highlightedTeamId === teamId ? null : teamId;

    document.querySelectorAll('#fixturesBody tr[data-team]').forEach((row) => {
      row.classList.toggle('row-highlight', Number(row.dataset.team) === highlightedTeamId);
    });
  });

  // The header row is redrawn on every render, so listen on the row itself.
  document.getElementById('fixturesHeadRow').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-key]');
    if (!th) return;

    const key = th.dataset.key;
    if (key === sortKey) {
      sortDir *= -1;
    } else {
      sortKey = key;
      sortDir = defaultDirFor(key);
    }
    renderTable();
  });

  initFixtureRuns();
}
