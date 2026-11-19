/*
  teamRatings.js
  Sortable Team Ratings table.

  Data: data/ratings.json (one row per team, joined to teams.json for
  names) for the selected competition, latest season only.

  Rank is each team's position by Overall rating. It is fixed when the
  data loads, so it stays the same whichever column the table is sorted by.
*/

import { compareWithBlanksLast, getTeamLogoURL } from './utils.js';
import { getRatings, getTeamsById, RATING_SCALE } from './leagueData.js';
import { FINISHING_STYLE, getCellShading, getColumnRanges } from './shading.js';

// Which direction a column sorts the first time it's clicked.
// Anything not listed here starts descending (biggest first).
// 'def' is lower-is-better, so its best teams come first when ascending.
const SORT_ASCENDING_FIRST = ['rank', 'team', 'def'];

// Columns that get their min/max worked out for the shading function (shading.js).
const NUMERIC_COLUMNS = ['overall', 'off', 'def', 'points', 'goal_diff', 'champion_pct', 'top4_pct', 'relegation_pct'];

let rows = [];
let columnRanges = {};   // column -> { min, max }, worked out once per load
let sortKey = 'rank';
let sortDir = 1;         // 1 = ascending, -1 = descending

/* ---------- loading ---------- */

/** Joins ratings with team names and prepares the fields the table shows. */
async function loadRows() {
  const [ratings, teamsById] = await Promise.all([getRatings(), getTeamsById()]);

  const tableRows = ratings.map((r) => {
    const team = teamsById.get(r.team_id);
    const name = team?.team ?? `Team ${r.team_id}`;

    return {
      team_id: r.team_id,
      team: name,
      team_short: team?.team_short ?? name,
      n: r.n,
      overall: r.spi * RATING_SCALE,
      off: r.off * RATING_SCALE,
      def: r.def * RATING_SCALE, // lower is better
      points: r.points,
      goal_diff: r.goal_diff,
      champion_pct: r.champion_pct * 100,
      top4_pct: r.top4_pct * 100,
      relegation_pct: r.relegation_pct * 100,
      as_of_gw: r.as_of_gw,
    };
  });

  // Rank by Overall rating, best first.
  tableRows.sort((a, b) => b.overall - a.overall);
  tableRows.forEach((row, i) => { row.rank = i + 1; });

  return tableRows;
}

/* ---------- formatting ---------- */

function formatRating(value) {
  return value.toFixed(2);
}

function formatOverallRating(value) {
  return value.toFixed(1);
}

function formatGoalDiff(value) {
  return value > 0 ? `+${value}` : String(value);
}

function formatPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '–'; // missing in the data
  return value < 1 ? '<1%' : `${value.toFixed(1)}%`;
}

/* ---------- table ---------- */

/** One <td> for a numeric column, with optional shading. */
function numberCell(key, row, text) {
  const shading = getCellShading(key, row[key], columnRanges[key]);
  const style = shading ? ` style="${shading}"` : '';
  return `<td${style}>${text}</td>`;
}

function renderRow(row) {
  return `
    <tr>
      <td class="sticky-col" style="--stick-left:0px;">${row.rank}</td>
      <td class="col-left sticky-col sticky-col--edge" style="--stick-left:60px;">
        <div class="team-cell">
          <img class="crest" src="${getTeamLogoURL(row.team_id)}" alt="">
          <span class="team-name-full">${row.team}</span>
          <span class="team-name-short">${row.team_short}</span>
        </div>
      </td>
      <td>${row.n}</td>
      ${numberCell('overall', row, formatOverallRating(row.overall))}
      ${numberCell('off', row, formatRating(row.off))}
      ${numberCell('def', row, formatRating(row.def))}
      ${numberCell('points', row, row.points)}
      ${numberCell('goal_diff', row, formatGoalDiff(row.goal_diff))}
      ${numberCell('champion_pct', row, formatPercent(row.champion_pct))}
      ${numberCell('top4_pct', row, formatPercent(row.top4_pct))}
      ${numberCell('relegation_pct', row, formatPercent(row.relegation_pct))}
    </tr>
  `;
}

function renderTable() {
  const sorted = [...rows].sort((a, b) => compareWithBlanksLast(a, b, sortKey, sortDir)); // missing values sort last
  document.querySelector('#ratingsTable tbody').innerHTML = sorted.map(renderRow).join('');

  document.querySelectorAll('#ratingsTable thead th').forEach((th) => {
    const isSorted = th.dataset.key === sortKey;
    th.classList.toggle('sorted', isSorted);
    th.querySelector('.arrow').textContent = isSorted ? (sortDir === 1 ? '▲' : '▼') : '';
  });
}

function renderNote() {
  const gw = rows[0]?.as_of_gw;
  const asOf = gw ? `ratings as of GW ${gw}` : 'ratings';
  const finishing = FINISHING_STYLE === 'bars' ? 'bars show chance (0–100%)' : 'high chances are shaded';
  document.getElementById('ratingsNote').textContent =
    `${asOf} · click any header to sort · shading marks above-average ratings · ${finishing}`;
}

/* ---------- public ---------- */

/** Loads the data for the selected competition and draws the table. */
export async function renderTeamRatings() {
  rows = await loadRows();
  columnRanges = getColumnRanges(rows, NUMERIC_COLUMNS);
  renderNote();
  renderTable();
}

/** Makes the column headers clickable. */
export function initTeamRatings() {
  document.querySelectorAll('#ratingsTable thead th').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;

      if (key === sortKey) {
        sortDir *= -1;
      } else {
        sortKey = key;
        sortDir = SORT_ASCENDING_FIRST.includes(key) ? 1 : -1;
      }
      renderTable();
    });
  });
}
