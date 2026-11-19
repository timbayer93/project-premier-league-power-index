/*
  defconsProjections.js
  The Projections mode of the DefCons Team view: projected numbers for one
  future gameweek, one row per team.

  Pick the gameweek from the dropdown (future gameweeks only, starting at
  state.gameweek + 1, which is the default). Columns:
    Opponent        who the team plays that gameweek (H / A)
    Exp. hits       projected DefCon hits
    Proj. DefCons   projected total defensive contributions
    Clean sheet     projected clean sheet probability

  A double gameweek adds the two fixtures together (as on the Fixture
  Tickers). A team with no fixture that gameweek shows dashes and sorts last.

  Data: data/projections.json, for the selected competition's teams.
*/

import { state } from './state.js';
import { BLANK_CELL, compareWithBlanksLast, crestHtml } from './utils.js';
import { getRatings, getTeamsById, getProjections } from './leagueData.js';
import { getCellShading, getColumnRanges } from './shading.js';

const NUMERIC_COLUMNS = ['hits', 'defcons', 'cs'];

let rows = [];
let columnRanges = {};
let teamsLookup = new Map();
let projectionRows = [];     // all projections, for every future gameweek
let sortKey = 'hits';
let sortDir = -1;            // 1 = ascending, -1 = descending

/* ---------- gameweek dropdown ---------- */

function getSelectedGw() {
  return Number(document.getElementById('defconsProjGw').value);
}

/** Lists the future gameweeks that have projections; keeps the current pick if it is still valid. */
function fillGameweekPicker() {
  const select = document.getElementById('defconsProjGw');
  const previous = Number(select.value);

  const gws = [...new Set(projectionRows.map((p) => p.gw))]
    .filter((gw) => gw > state.gameweek)
    .sort((a, b) => a - b);

  select.innerHTML = gws.map((gw) => `<option value="${gw}">GW${gw}</option>`).join('');
  select.value = gws.includes(previous) ? previous : (gws[0] ?? '');
}

/* ---------- building the rows ---------- */

function buildRows(ratings, gw) {
  return ratings.map((rating) => {
    const team = teamsLookup.get(rating.team_id);
    const name = team?.team ?? `Team ${rating.team_id}`;
    const fixtures = projectionRows.filter((p) => p.gw === gw && p.team_id === rating.team_id);
    // A double gameweek adds both fixtures. No fixture, or any missing value
    // (null in the data), gives null so the cell shows a dash. A missing value
    // must not be added up as 0, and a double with one half missing is unknown,
    // not half the total.
    const total = (field) => {
      if (fixtures.length === 0 || fixtures.some((f) => f[field] == null)) return null;
      return fixtures.reduce((sum, f) => sum + f[field], 0);
    };

    return {
      team_id: rating.team_id,
      team: name,
      team_short: team?.team_short ?? name,
      fixtures,                // [{ opponent_id, home, ... }]
      hits: total('dc_hits'),
      defcons: total('defcons'),
      cs: total('xcs'),
    };
  });
}

/* ---------- drawing ---------- */

function opponentsHtml(fixtures) {
  if (fixtures.length === 0) return BLANK_CELL;

  return fixtures
    .map((f) => {
      const opponent = teamsLookup.get(f.opponent_id);
      return `<div class="fixture-line"><span class="fixture-opponent">${crestHtml(f.opponent_id, teamsLookup)}<span class="fixture-name">${opponent?.team_short ?? '?'}</span> <span class="fixture-venue">(${f.home ? 'H' : 'A'})</span></span></div>`;
    })
    .join('');
}

function shadedCell(key, row, text) {
  const shading = getCellShading(key === 'cs' ? 'projCs' : key === 'hits' ? 'projHits' : 'projDefcons', row[key], columnRanges[key]);
  const style = shading ? ` style="${shading}"` : '';
  return `<td${style}>${text}</td>`;
}

function renderRow(row, i) {
  return `
    <tr>
      <td class="sticky-col" style="--stick-left:0px;">${i + 1}</td>
      <td class="col-left sticky-col sticky-col--edge" style="--stick-left:40px;">
        <div class="team-cell">${crestHtml(row.team_id, teamsLookup)}<span class="team-name-full">${row.team}</span><span class="team-name-short">${row.team_short}</span></div>
      </td>
      <td class="col-left">${opponentsHtml(row.fixtures)}</td>
      ${shadedCell('hits', row, row.hits === null ? '–' : row.hits.toFixed(2))}
      ${shadedCell('defcons', row, row.defcons === null ? '–' : row.defcons.toFixed(1))}
      ${shadedCell('cs', row, row.cs === null ? '–' : `${(row.cs * 100).toFixed(0)}%`)}
    </tr>
  `;
}

function renderTable() {
  const sorted = [...rows].sort((a, b) => compareWithBlanksLast(a, b, sortKey, sortDir));
  document.getElementById('defconsProjBody').innerHTML = sorted.map(renderRow).join('');

  document.querySelectorAll('#defconsProjTable thead th[data-key]').forEach((th) => {
    const isSorted = th.dataset.key === sortKey;
    th.classList.toggle('sorted', isSorted);
    th.querySelector('.arrow').textContent = isSorted ? (sortDir === 1 ? '▲' : '▼') : '';
  });
}

/* ---------- public ---------- */

async function rebuild() {
  const ratings = await getRatings();
  rows = buildRows(ratings, getSelectedGw());
  columnRanges = getColumnRanges(rows, NUMERIC_COLUMNS);
  renderTable();
}

/** Loads the projections for the selected competition and draws the table. */
export async function renderDefconsProjections() {
  [projectionRows, teamsLookup] = await Promise.all([getProjections(), getTeamsById()]);
  fillGameweekPicker();
  await rebuild();
}

/** Wires up the gameweek dropdown and the sortable headers. */
export function initDefconsProjections() {
  document.getElementById('defconsProjGw').addEventListener('change', rebuild);

  document.querySelectorAll('#defconsProjTable thead th[data-key]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;

      if (key === sortKey) {
        sortDir *= -1;
      } else {
        sortKey = key;
        sortDir = key === 'team' ? 1 : -1; // team A-Z, everything else biggest first
      }
      renderTable();
    });
  });
}
