/*
  forecastTable.js
  The table above the score matrix on the Match Forecast tab: every
  fixture in the next gameweek (state.gameweek + 1), one row per team, so
  each team's numbers can be sorted on their own.

    Kickoff        UK time (the data is in UTC). The default sort.
    Team           the team the row is about
    Opponent       who they play, with (H) / (A)
    xG / xGA       projected expected goals for and against
    Clean sheet    projected clean sheet probability
    DefCon hits    projected DefCon hits

  Data: data/projections.json (team-perspective rows); xGA is the
  opponent's projected xG in the same fixture.

  Clicking a row highlights that match (both teams' rows). Click it again to
  clear the highlight.
*/

import { state } from './state.js';
import { compareWithBlanksLast, crestHtml } from './utils.js';
import { getProjections, getTeamsById } from './leagueData.js';
import { getCellShading, getColumnRanges } from './shading.js';

const NUMERIC_COLUMNS = ['xg', 'xga', 'cs', 'dcHits'];

// First click sorts these smallest first (lower is better / A-Z / earliest);
// everything else starts with the biggest number.
const SORT_ASCENDING_FIRST = ['kickoff', 'team', 'opponent', 'xga'];

let rows = [];
let columnRanges = {};
let teamsLookup = new Map();
let sortKey = 'kickoff';
let sortDir = 1;                 // 1 = ascending, -1 = descending
let highlightedFixtureId = null;

/* ---------- kickoff times ---------- */

/** The data's times are UTC but have no "Z" on the end, so add it before parsing. */
function parseUtc(text) {
  return new Date(/Z$|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`);
}

const ukFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', // switches between GMT and BST on its own
  weekday: 'short', day: 'numeric', month: 'short',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** "Sat 17 Oct · 12:30" in UK time. */
function formatKickoff(date) {
  const part = Object.fromEntries(ukFormat.formatToParts(date).map((p) => [p.type, p.value]));
  return `${part.weekday} ${part.day} ${part.month} · ${part.hour}:${part.minute}`;
}

/* ---------- loading ---------- */

async function loadRows() {
  const [projections, teamsById] = await Promise.all([getProjections(), getTeamsById()]);
  teamsLookup = teamsById;

  const nextGw = state.gameweek + 1;
  const nextRows = projections.filter((p) => p.gw === nextGw);
  const byFixtureAndTeam = new Map(nextRows.map((p) => [`${p.fixture_id}-${p.team_id}`, p]));

  return nextRows.map((p) => {
    const team = teamsById.get(p.team_id);
    const opponent = teamsById.get(p.opponent_id);
    const kickoff = parseUtc(p.match_date);

    return {
      fixtureId: p.fixture_id,
      team_id: p.team_id,
      team: team?.team ?? `Team ${p.team_id}`,
      team_short: team?.team_short ?? '?',
      opponentId: p.opponent_id,
      opponent: opponent?.team ?? `Team ${p.opponent_id}`,
      opponentShort: opponent?.team_short ?? '?',
      isHome: p.home,
      kickoff: kickoff.getTime(),
      kickoffText: formatKickoff(kickoff),
      xg: p.xg,
      xga: byFixtureAndTeam.get(`${p.fixture_id}-${p.opponent_id}`)?.xg ?? null,
      cs: p.xcs,
      dcHits: p.dc_hits,
    };
  });
}

/* ---------- sorting ---------- */

/** Kickoff ties keep a match's two teams together, home team first. */
function compareRows(a, b) {
  const primary = compareWithBlanksLast(a, b, sortKey, sortDir);
  if (primary !== 0) return primary;
  return a.kickoff - b.kickoff || a.fixtureId - b.fixtureId || Number(b.isHome) - Number(a.isHome);
}

/* ---------- drawing ---------- */

/** A number to `places` decimals, or a dash when it is missing (null / undefined / NaN). */
function formatNumber(value, places) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(places) : '–';
}

/** 0.434 -> "43%", or a dash when missing. */
function formatChance(probability) {
  return typeof probability === 'number' && Number.isFinite(probability) ? `${(probability * 100).toFixed(0)}%` : '–';
}

function numberCell(key, row, text) {
  const shading = getCellShading(key, row[key], columnRanges[key]);
  const style = shading ? ` style="${shading}"` : '';
  return `<td${style}>${text}</td>`;
}

function renderRow(row) {
  const selected = row.fixtureId === highlightedFixtureId ? ' class="row-highlight"' : '';

  return `
    <tr data-fixture="${row.fixtureId}"${selected}>
      <td class="col-left forecast-kickoff">${row.kickoffText}</td>
      <td class="col-left"><div class="team-cell">${crestHtml(row.team_id, teamsLookup)}<span class="team-name-full">${row.team}</span><span class="team-name-short">${row.team_short}</span></div></td>
      <td class="col-left"><span class="fixture-opponent">${crestHtml(row.opponentId, teamsLookup)}<span class="fixture-name">${row.opponentShort}</span> <span class="fixture-venue">(${row.isHome ? 'H' : 'A'})</span></span></td>
      ${numberCell('xg', row, formatNumber(row.xg, 2))}
      ${numberCell('xga', row, formatNumber(row.xga, 2))}
      ${numberCell('cs', row, formatChance(row.cs))}
      ${numberCell('dcHits', row, formatNumber(row.dcHits, 2))}
    </tr>
  `;
}

function renderTable() {
  const body = document.getElementById('forecastBody');
  const sorted = [...rows].sort(compareRows);

  body.innerHTML = sorted.length
    ? sorted.map(renderRow).join('')
    : `<tr><td colspan="7" class="col-left">No fixtures to forecast.</td></tr>`;

  document.querySelectorAll('#forecastTable thead th[data-key]').forEach((th) => {
    const isSorted = th.dataset.key === sortKey;
    th.classList.toggle('sorted', isSorted);
    th.querySelector('.arrow').textContent = isSorted ? (sortDir === 1 ? '▲' : '▼') : '';
  });
}

/* ---------- public ---------- */

/** Shown in place of the table if it could not be drawn (see renderMatchForecasts). */
export function showForecastTableError() {
  document.getElementById('forecastBody').innerHTML =
    `<tr><td colspan="7" class="col-left">This table could not be drawn (see the browser console).</td></tr>`;
}

/** Loads the next gameweek's projections for the selected competition and draws the table. */
export async function renderForecastTable() {
  rows = await loadRows();
  columnRanges = getColumnRanges(rows, NUMERIC_COLUMNS);
  renderTable();
}

/** Wires up the sortable headers and the click-to-highlight. */
export function initForecastTable() {
  document.querySelectorAll('#forecastTable thead th[data-key]').forEach((th) => {
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

  // Click a match to highlight both its rows; click it again to clear.
  document.getElementById('forecastBody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-fixture]');
    if (!tr) return;

    const fixtureId = Number(tr.dataset.fixture);
    highlightedFixtureId = highlightedFixtureId === fixtureId ? null : fixtureId;

    document.querySelectorAll('#forecastBody tr[data-fixture]').forEach((row) => {
      row.classList.toggle('row-highlight', Number(row.dataset.fixture) === highlightedFixtureId);
    });
  });
}
