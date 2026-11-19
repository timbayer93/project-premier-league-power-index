/*
  defcons.js
  Defensive Contributions tab (Team view; the Player view is a placeholder).
  The Team view has two modes, switched by the Actuals | Projections toggle:

    Actuals       this file: one row per team, built from data/results.json
    Projections   defconsProjections.js: projected numbers for one future
                  gameweek

  ACTUALS, one row per team for the selected competition:
    - Last GW: the opponent and the team's DefCon hits and DefCons in its
      match in the last completed gameweek
    - the window columns: the team's DefCon hits and DefCons, and what its
      opponents had, over the window (the "Last N matches" box, or "This
      season only"). The Per game | Total toggle shows averages or totals.
    - a trend line: DefCons per match, as a 10-match moving average,
      over the last 38 matches (always 38, whatever the window says)
    - the opponent(s) in the next gameweek (state.gameweek + 1)

  A team's history only counts back to the first season it was missing
  from the competition (see keepConsecutiveSeasons), so a team that was
  relegated and came back doesn't borrow matches from before the gap.
  A team with fewer matches than the window asks for (e.g. a newly
  promoted side) uses what it has, and those columns get an asterisk.
*/

import { state, MAX_LAST_N } from './state.js';
import { bindSegmented } from './ui.js';
import {
  BLANK_CELL,
  compareWithBlanksLast,
  crestHtml,
  matchesText,
  rollingAverages,
  seasonDividers,
  sparklineSvg,
} from './utils.js';
import {
  getTeamHistory,
  getRatings,
  getTeamsById,
  getProjections,
  getLastCompletedGw,
  describeCoverage,
  getWindowSample,
  getWindowSpan,
  isPartialSample,
  windowText,
  windowTitle,
} from './leagueData.js';
import { initDefconsProjections, renderDefconsProjections } from './defconsProjections.js';
import { getCellShading, getColumnRanges } from './shading.js';

const LINE_COLOR = '#1B3A2B';

let rows = [];              // one object per team, with totals over the window
let teamsLookup = new Map();
let lastGw = 0;             // last completed gameweek
let columnRanges = {};      // min / max / mean of the shaded columns (see shading.js)
let statsMode = 'perGame';  // 'perGame' | 'total'
let sortKey = 'hits';
let sortDir = -1;           // 1 = ascending, -1 = descending

/* ---------- loading ---------- */

const sum = (matches, getValue) => matches.reduce((total, m) => total + getValue(m), 0);

async function loadRows() {
  const [history, ratings, teamsById, projections] = await Promise.all([
    getTeamHistory(),
    getRatings(),
    getTeamsById(),
    getProjections(),
  ]);
  lastGw = await getLastCompletedGw();
  teamsLookup = teamsById;

  // The opponents in the next gameweek, per team (a list, in case of doubles).
  const nextGw = state.gameweek + 1;
  const nextOpponents = new Map();
  for (const p of projections.filter((p) => p.gw === nextGw)) {
    if (!nextOpponents.has(p.team_id)) nextOpponents.set(p.team_id, []);
    nextOpponents.get(p.team_id).push(p.opponent_id);
  }

  return ratings.map((rating) => {
    const team = teamsById.get(rating.team_id);
    const name = team?.team ?? `Team ${rating.team_id}`;

    const matches = history.get(rating.team_id) ?? []; // most recent first
    const sample = getWindowSample(matches);

    // The team's most recent match in the last completed gameweek.
    const lastMatch = matches.find((m) => m.season === state.latest_season && m.gw === lastGw);

    return {
      team_id: rating.team_id,
      team: name,
      team_short: team?.team_short ?? name,
      lastOpponentId: lastMatch?.opponent_id ?? null,
      lastHits: lastMatch?.dc_hits ?? null,
      lastDefcons: lastMatch?.defcons ?? null,
      sampleSize: sample.length,
      span: getWindowSpan(sample),
      hitsTotal: sum(sample, (m) => m.dc_hits),
      defconsTotal: sum(sample, (m) => m.defcons),
      oppHitsTotal: sum(sample, (m) => m.opponent.dc_hits),
      oppDefconsTotal: sum(sample, (m) => m.opponent.defcons),
      trend: rollingAverages(matches, (m) => m.defcons, MAX_LAST_N),
      trendDividers: seasonDividers(matches, MAX_LAST_N),
      nextOpponentIds: nextOpponents.get(rating.team_id) ?? [],
    };
  });
}

/** Adds the four window columns as the toggle wants them: per game or total. */
function withWindowColumns(row) {
  const value = (total) => {
    if (row.sampleSize === 0) return null;
    return statsMode === 'perGame' ? total / row.sampleSize : total;
  };

  return {
    ...row,
    hits: value(row.hitsTotal),
    defcons: value(row.defconsTotal),
    oppHits: value(row.oppHitsTotal),
    oppDefcons: value(row.oppDefconsTotal),

    // Always per match, for the shading, whichever mode is showing.
    hitsPerMatch: row.sampleSize === 0 ? null : row.hitsTotal / row.sampleSize,
    defconsPerMatch: row.sampleSize === 0 ? null : row.defconsTotal / row.sampleSize,
  };
}

/* ---------- drawing ---------- */

function formatNumber(value, decimals) {
  return value === null ? '–' : value.toFixed(decimals);
}

/** A window column, with an asterisk if the team has fewer matches than the window asks for. */
function windowCell(row, field) {
  const text = formatNumber(row[field], statsMode === 'perGame' ? 2 : 0);
  if (row[field] === null || !isPartialSample(row.sampleSize)) return text;

  return `${text}<span class="sample-flag" title="Based on ${row.sampleSize} matches (the window is ${state.lastN})">*</span>`;
}

// The window columns that are shaded: column -> [the key shading.js uses, the row field to shade by].
const SHADED_BY_PER_MATCH = { hits: ['defconsHits', 'hitsPerMatch'], defcons: ['defconsDefcons', 'defconsPerMatch'] };

/** A window column's <td>: shaded if it is one of the shaded ones and the team is among the best. */
function windowTd(row, field) {
  const [shadingKey, shadeField] = SHADED_BY_PER_MATCH[field] ?? [];
  const shading = shadingKey ? getCellShading(shadingKey, row[shadeField], columnRanges[shadeField]) : '';
  return `<td${shading ? ` style="${shading}"` : ''}>${windowCell(row, field)}</td>`;
}

function renderRow(row, i) {
  return `
    <tr>
      <td class="sticky-col" style="--stick-left:0px;">${i + 1}</td>
      <td class="col-left sticky-col sticky-col--edge" style="--stick-left:40px;">
        <div class="team-cell">${crestHtml(row.team_id, teamsLookup)}<span class="team-name-full">${row.team}</span><span class="team-name-short">${row.team_short}</span></div>
      </td>
      <td>${row.lastOpponentId ? crestHtml(row.lastOpponentId, teamsLookup, { mono: true }) : BLANK_CELL}</td>
      <td>${formatNumber(row.lastHits, 0)}</td>
      <td>${formatNumber(row.lastDefcons, 0)}</td>
      ${windowTd(row, 'hits')}
      ${windowTd(row, 'defcons')}
      <td>${sparklineSvg([{ values: row.trend, color: LINE_COLOR }], { dividers: row.trendDividers })}</td>
      ${windowTd(row, 'oppHits')}
      ${windowTd(row, 'oppDefcons')}
      <td>${row.nextOpponentIds.length ? row.nextOpponentIds.map((id) => crestHtml(id, teamsLookup)).join('') : BLANK_CELL}</td>
    </tr>
  `;
}

function renderTable() {
  document.getElementById('defconsLastGwLabel').textContent = lastGw ? `Last GW (GW${lastGw})` : 'Last GW';
  document.getElementById('defconsWindowLabel').textContent = windowTitle();
  document.getElementById('defconsOppWindowLabel').textContent = `Opponents (${windowText()})`;

  // Say which gameweek "Next" is. If no team has a fixture in it (e.g. the season is over), just "Next".
  const hasNextFixtures = rows.some((row) => row.nextOpponentIds.length > 0);
  document.getElementById('defconsNextLabel').textContent = hasNextFixtures ? `Next (GW${state.gameweek + 1})` : 'Next';

  const suffix = statsMode === 'perGame' ? '/Match' : '';
  document.querySelectorAll('#defconsTable .avg-label').forEach((el) => {
    el.textContent = el.dataset.base + suffix;
  });

  const displayRows = rows.map(withWindowColumns);
  columnRanges = getColumnRanges(displayRows, ['hitsPerMatch', 'defconsPerMatch']);

  const sorted = displayRows.sort((a, b) => compareWithBlanksLast(a, b, sortKey, sortDir));
  document.getElementById('defconsBody').innerHTML = sorted.map(renderRow).join('');

  document.querySelectorAll('#defconsTable thead th[data-key]').forEach((th) => {
    const isSorted = th.dataset.key === sortKey;
    th.classList.toggle('sorted', isSorted);
    th.querySelector('.arrow').textContent = isSorted ? (sortDir === 1 ? '▲' : '▼') : '';
  });
}

function renderNote() {
  const partial = rows.filter((r) => isPartialSample(r.sampleSize)).length;
  const flagNote = partial ? ` · * fewer than ${matchesText(state.lastN)}` : '';

  const coverage = describeCoverage(rows.map((r) => r.span));
  const window = coverage ? `${windowText()} (${coverage})` : windowText();

  document.getElementById('defconsNote').textContent = `${window} per team${flagNote}`;
}

/* ---------- public ---------- */

/** Loads the data for the selected competition and window, and draws both modes. */
export async function renderDefcons() {
  rows = await loadRows();
  renderNote();
  renderTable();
  await renderDefconsProjections();
}

/** Wires up the Team / Player and Actuals / Projections toggles and the sortable headers. */
export function initDefcons() {
  bindSegmented('defconsViewToggle', (val) => {
    document.getElementById('defconsTeamView').style.display = val === 'team' ? '' : 'none';
    document.getElementById('defconsPlayerView').style.display = val === 'player' ? '' : 'none';
  });

  // Actuals shows the Per game | Total toggle; Projections shows the gameweek picker.
  bindSegmented('defconsMode', (val) => {
    const actuals = val === 'actuals';
    document.getElementById('defconsActualsView').style.display = actuals ? '' : 'none';
    document.getElementById('defconsProjectionsView').style.display = actuals ? 'none' : '';
    document.getElementById('defconsStatsMode').style.display = actuals ? '' : 'none';
    document.getElementById('defconsProjControls').style.display = actuals ? 'none' : '';
  });

  bindSegmented('defconsStatsMode', (val) => {
    statsMode = val;
    renderTable();
  });

  document.querySelectorAll('#defconsTable thead th[data-key]').forEach((th) => {
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

  initDefconsProjections();
}
