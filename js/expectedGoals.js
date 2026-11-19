/*
  expectedGoals.js
  Expected Goals tab (Team view; the Player view is a placeholder).
  A look at each team's underlying performance, for the selected
  competition. It has a scatter chart (xgScatter.js) above a table with one
  row per team, built from data/results.json:

    Last GW            opponent, score, xG created, xG conceded
    The window         xG, xGA and xGD over the window: the "Last N matches"
                       box, or "This season only". The Per game | Total toggle
                       shows averages or totals.
    Goals − xG         actual goals minus what the chances were worth, per
                       match (or in total). Offense: goals scored − xG, so
                       positive = scoring more than expected (good). Defense:
                       goals conceded − xGA, so positive = conceding more than
                       expected (bad); negative = conceding fewer (good).
    Trend              10-match moving averages of xG (green) and xGA
                       (orange) over the last 38 matches (always 38,
                       whatever the window says)
    Next               next-gameweek opponent, with projected xG for and
                       against (from projections.json)

  xGA is the xG the opponent created in the same match.
  History uses each team's unbroken run of seasons (keepConsecutiveSeasons),
  and a team with fewer matches than the window asks for is marked with an
  asterisk.

  The tab has two layouts, switched by the Scatter | Table toggle (scatter
  first): the scatter chart (xgScatter.js) or the table.

  "Remove each team's best & worst match" (a tick box, off by default) takes
  out two matches per team: the one with the highest xG difference (xG minus
  xGA) and the one with the lowest, so a one-off result doesn't skew the
  picture. They are taken out of the window, and then every window number
  (averages, totals, Goals − xG), the scatter dot and line, and the trend are
  built from what is left. Last GW and Next are about single matches and are
  not affected. A team with fewer than MIN_MATCHES_TO_TRIM matches is left as
  it is.
*/

import { state, MAX_LAST_N } from './state.js';
import { bindSegmented } from './ui.js';
import {
  BLANK_CELL,
  compareWithBlanksLast,
  crestHtml,
  expandingAverages,
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
import { getCellShading, getColumnRanges } from './shading.js';
import { getTeamColor } from './teamColors.js';
import { initXgScatter, renderXgScatter } from './xgScatter.js';

// The line drawn when you click a team on the scatter:
//   'expanding'  the average of the window so far (1 match, 2 matches ... N matches),
//                so the line ends exactly on the team's dot
//   'moving'     10-match moving average, one point per match in the window
//                (it does not end on the dot)
// (If you switch it, also update the wording in xgScatter.js's info line and the legend in index.html.)
const SCATTER_TRAIL = 'expanding';

// An average of 1, 2 or 3 matches is mostly noise and can sit far from everything
// else, so the 'expanding' line starts after this many matches. Set to 0 to draw them all.
const TRAIL_SKIP_FIRST = 4;

// "Remove best & worst match" needs enough matches left to mean something.
const MIN_MATCHES_TO_TRIM = 5;

const FOR_COLOR = '#1B3A2B';     // xG created
const AGAINST_COLOR = '#C2600E'; // xG conceded (dark orange, as the table's trend note says)

// First click sorts these smallest first (lower is better); everything
// else starts with the biggest number.
const SORT_ASCENDING_FIRST = ['team', 'lastXga', 'xga', 'nextXga', 'defenceDiff'];

// Columns that get their min/max worked out for the shading function (shading.js).
const NUMERIC_COLUMNS = ['lastXg', 'lastXga', 'xg', 'xga', 'xgd', 'attackDiff', 'defenceDiff', 'nextXg', 'nextXga',
  'xgPerMatch', 'xgaPerMatch'];

// Window columns that are shaded by their per-match value (always per match, whatever the
// Per game | Total toggle shows): column -> [the key shading.js uses, the row field to shade by].
const SHADED_BY_PER_MATCH = { xg: ['teamXg', 'xgPerMatch'], xga: ['teamXga', 'xgaPerMatch'] };

// Columns built from the window (these get the asterisk).
const SAMPLE_COLUMNS = ['xg', 'xga', 'xgd', 'attackDiff', 'defenceDiff'];

let rows = [];
let columnRanges = {};
let teamsLookup = new Map();
let lastGw = 0;             // last completed gameweek
let statsMode = 'perGame';  // 'perGame' | 'total'
let trimOutliers = false;   // "Remove each team's best & worst match" ticked
let sortKey = 'xgd';
let sortDir = -1;           // 1 = ascending, -1 = descending

/* ---------- loading ---------- */

/** Next gameweek's fixtures per team, with projected xG for and against. */
function getNextFixtures(projections) {
  const nextGw = state.gameweek + 1;
  const nextRows = projections.filter((p) => p.gw === nextGw);

  // Each fixture has one projection row per team; xG against is the
  // opponent's projected xG in the same fixture.
  const byFixtureAndTeam = new Map(nextRows.map((p) => [`${p.fixture_id}-${p.team_id}`, p]));

  const byTeam = new Map(); // team_id -> [{ opponentId, xg, xga }]
  for (const p of nextRows) {
    const opponentRow = byFixtureAndTeam.get(`${p.fixture_id}-${p.opponent_id}`);

    if (!byTeam.has(p.team_id)) byTeam.set(p.team_id, []);
    byTeam.get(p.team_id).push({ opponentId: p.opponent_id, xg: p.xg, xga: opponentRow?.xg ?? null });
  }
  return byTeam;
}

/** Adds up a field across fixtures (a double gameweek adds both). null if no fixtures. */
function sumFixtures(fixtures, field) {
  if (fixtures.length === 0 || fixtures.some((f) => f[field] === null)) return null;
  return fixtures.reduce((sum, f) => sum + f[field], 0);
}

const sum = (matches, getValue) => matches.reduce((total, m) => total + getValue(m), 0);

/** A match's xG difference: positive = it created more than it conceded. */
const xgDifference = (match) => match.xg - match.opponent.xg;

/**
 * The window without the team's best and worst match (highest and lowest xG
 * difference). `windowMatches` is most recent first. If there are too few matches it
 * is returned as it is. On a tie, the most recent match counts as the best and
 * the oldest as the worst. Returns { kept, removed }.
 */
function withoutBestAndWorst(windowMatches) {
  if (windowMatches.length < MIN_MATCHES_TO_TRIM) return { kept: windowMatches, removed: [] };

  let best = 0;
  for (let i = 1; i < windowMatches.length; i++) {
    if (xgDifference(windowMatches[i]) > xgDifference(windowMatches[best])) best = i;
  }
  let worst = windowMatches.length - 1;
  for (let i = windowMatches.length - 2; i >= 0; i--) {
    if (xgDifference(windowMatches[i]) < xgDifference(windowMatches[worst])) worst = i;
  }

  const removed = [windowMatches[best], windowMatches[worst]];
  return { kept: windowMatches.filter((match) => !removed.includes(match)), removed };
}

async function loadRows() {
  const [history, ratings, teamsById, projections] = await Promise.all([
    getTeamHistory(),
    getRatings(),
    getTeamsById(),
    getProjections(),
  ]);
  lastGw = await getLastCompletedGw();
  teamsLookup = teamsById;

  const nextFixtures = getNextFixtures(projections);

  return ratings.map((rating) => {
    const team = teamsById.get(rating.team_id);
    const name = team?.team ?? `Team ${rating.team_id}`;

    const matches = history.get(rating.team_id) ?? []; // most recent first
    const windowMatches = getWindowSample(matches);

    // The matches every window number is built from: the window, or with the
    // team's best and worst match taken out of it.
    const { kept: sample, removed } = trimOutliers ? withoutBestAndWorst(windowMatches) : { kept: windowMatches, removed: [] };

    // The same matches are left out of the lines (scatter trail and trend), too.
    const series = removed.length ? matches.filter((m) => !removed.includes(m)) : matches;

    // The team's most recent match in the last completed gameweek.
    const lastMatch = matches.find((m) => m.season === state.latest_season && m.gw === lastGw);

    const next = nextFixtures.get(rating.team_id) ?? [];

    // For the scatter's trail (see SCATTER_TRAIL): xG and xGA across the window.
    const trailAverages = SCATTER_TRAIL === 'expanding' ? expandingAverages : rollingAverages;
    const trailFor = trailAverages(series, (m) => m.xg, sample.length);
    const trailAgainst = trailAverages(series, (m) => m.opponent.xg, sample.length);
    const fullTrail = trailFor.map((xg, i) => ({ xg, xga: trailAgainst[i] }));

    // Skip the noisiest first points, unless that would leave no line at all.
    const skip = SCATTER_TRAIL === 'expanding' ? Math.min(TRAIL_SKIP_FIRST, Math.floor(fullTrail.length / 2)) : 0;
    const scatterTrail = fullTrail.length - skip >= 2 ? fullTrail.slice(skip) : fullTrail;

    return {
      team_id: rating.team_id,
      team: name,
      team_short: team?.team_short ?? name,

      lastOpponentId: lastMatch?.opponent_id ?? null,
      lastScore: lastMatch ? `${lastMatch.goals}–${lastMatch.opponent.goals}` : null,
      lastXg: lastMatch?.xg ?? null,
      lastXga: lastMatch?.opponent.xg ?? null,

      // Totals over the window. The Per game | Total toggle turns these into the columns.
      sampleSize: sample.length,
      windowSize: windowMatches.length, // before any matches are taken out
      trimmed: removed.length > 0, // best and worst match left out
      xgTotal: sum(sample, (m) => m.xg),
      xgaTotal: sum(sample, (m) => m.opponent.xg),
      goalsTotal: sum(sample, (m) => m.goals),
      concededTotal: sum(sample, (m) => m.opponent.goals),

      trendFor: rollingAverages(series, (m) => m.xg, MAX_LAST_N),
      trendAgainst: rollingAverages(series, (m) => m.opponent.xg, MAX_LAST_N),
      trendDividers: seasonDividers(series, MAX_LAST_N),

      scatterTrail,
      span: getWindowSpan(windowMatches), // the window as asked for, whatever was taken out of it

      nextOpponentIds: next.map((f) => f.opponentId),
      nextXg: sumFixtures(next, 'xg'),
      nextXga: sumFixtures(next, 'xga'),
    };
  });
}

/** Adds the window columns as the toggle wants them: per game or total. */
function withWindowColumns(row) {
  if (row.sampleSize === 0) {
    return { ...row, xg: null, xga: null, xgd: null, attackDiff: null, defenceDiff: null, xgPerMatch: null, xgaPerMatch: null };
  }

  const divisor = statsMode === 'perGame' ? row.sampleSize : 1;
  const xg = row.xgTotal / divisor;
  const xga = row.xgaTotal / divisor;

  return {
    ...row,
    xg,
    xga,
    xgPerMatch: row.xgTotal / row.sampleSize, // for the shading, whichever mode is showing
    xgaPerMatch: row.xgaTotal / row.sampleSize,
    xgd: xg - xga,
    attackDiff: (row.goalsTotal - row.xgTotal) / divisor,      // goals scored - xG: positive = scoring more than xG (good)
    defenceDiff: (row.concededTotal - row.xgaTotal) / divisor, // goals conceded - xGA: positive = conceding more than xGA (bad)
  };
}

/* ---------- formatting ---------- */

function decimals() {
  return statsMode === 'perGame' ? 2 : 1;
}

function formatXg(value, places = 2) {
  return value === null ? '–' : value.toFixed(places);
}

/** +0.12 / −0.34 / 0.00 */
function formatSigned(value) {
  if (value === null) return '–';

  const places = decimals();
  const rounded = Number(value.toFixed(places));
  if (rounded === 0) return (0).toFixed(places);
  return rounded > 0 ? `+${rounded.toFixed(places)}` : `−${Math.abs(rounded).toFixed(places)}`;
}

/* ---------- drawing ---------- */

/** One numeric <td>: shaded if getCellShading says so, with an asterisk
 *  when the team has fewer matches than the window asks for (windowed columns). */
function numberCell(key, row, text) {
  const [shadingKey, shadeField] = SHADED_BY_PER_MATCH[key] ?? [key, key];
  const shading = getCellShading(shadingKey, row[shadeField], columnRanges[shadeField]);
  const style = shading ? ` style="${shading}"` : '';

  const isPartial = SAMPLE_COLUMNS.includes(key) && row[key] !== null && isPartialSample(row.windowSize);
  const based = row.trimmed
    ? `Based on ${row.sampleSize} matches (${row.windowSize} in the window, without the best and worst; the window is ${state.lastN})`
    : `Based on ${row.sampleSize} matches (the window is ${state.lastN})`;
  const flag = isPartial ? `<span class="sample-flag" title="${based}">*</span>` : '';

  return `<td${style}>${text}${flag}</td>`;
}

function renderRow(row, i) {
  const opponents = (ids) => ids.map((id) => crestHtml(id, teamsLookup)).join('');

  return `
    <tr>
      <td class="sticky-col" style="--stick-left:0px;">${i + 1}</td>
      <td class="col-left sticky-col sticky-col--edge" style="--stick-left:40px;">
        <div class="team-cell">${crestHtml(row.team_id, teamsLookup)}<span class="team-name-full">${row.team}</span><span class="team-name-short">${row.team_short}</span></div>
      </td>
      <td>${row.lastOpponentId ? crestHtml(row.lastOpponentId, teamsLookup, { mono: true }) : BLANK_CELL}</td>
      <td class="col-left">${row.lastScore ?? '–'}</td>
      ${numberCell('lastXg', row, formatXg(row.lastXg))}
      ${numberCell('lastXga', row, formatXg(row.lastXga))}
      ${numberCell('xg', row, formatXg(row.xg, decimals()))}
      ${numberCell('xga', row, formatXg(row.xga, decimals()))}
      ${numberCell('xgd', row, formatSigned(row.xgd))}
      ${numberCell('attackDiff', row, formatSigned(row.attackDiff))}
      ${numberCell('defenceDiff', row, formatSigned(row.defenceDiff))}
      <td>${sparklineSvg([
        { values: row.trendFor, color: FOR_COLOR },
        { values: row.trendAgainst, color: AGAINST_COLOR },
      ], { dividers: row.trendDividers })}</td>
      <td>${row.nextOpponentIds.length ? opponents(row.nextOpponentIds) : BLANK_CELL}</td>
      ${numberCell('nextXg', row, formatXg(row.nextXg))}
      ${numberCell('nextXga', row, formatXg(row.nextXga))}
    </tr>
  `;
}

function renderTable() {
  document.getElementById('xgLastGwLabel').textContent = lastGw ? `Last GW (GW${lastGw})` : 'Last GW';
  document.getElementById('xgWindowLabel').textContent =
    `${windowTitle()} (${statsMode === 'perGame' ? 'per match' : 'total'})`;

  // Say which gameweek "Next" is. If no team has a fixture in it (e.g. the season is over), just "Next (proj.)".
  const hasNextFixtures = rows.some((row) => row.nextOpponentIds.length > 0);
  document.getElementById('xgNextLabel').textContent =
    hasNextFixtures ? `Next (GW${state.gameweek + 1}, proj.)` : 'Next (proj.)';

  const displayRows = rows.map(withWindowColumns);
  columnRanges = getColumnRanges(displayRows, NUMERIC_COLUMNS);

  const sorted = displayRows.sort((a, b) => compareWithBlanksLast(a, b, sortKey, sortDir));
  document.getElementById('xgBody').innerHTML = sorted.map(renderRow).join('');

  document.querySelectorAll('#xgTable thead th[data-key]').forEach((th) => {
    const isSorted = th.dataset.key === sortKey;
    th.classList.toggle('sorted', isSorted);
    th.querySelector('.arrow').textContent = isSorted ? (sortDir === 1 ? '▲' : '▼') : '';
  });
}

/** The window, in words, with where it starts and ends. */
function windowDescription() {
  const coverage = describeCoverage(rows.map((r) => r.span));
  return coverage ? `${windowText()} (${coverage})` : windowText();
}

function renderNote() {
  const partial = rows.filter((r) => isPartialSample(r.windowSize)).length;
  const flagNote = partial ? ` · * fewer than ${matchesText(state.lastN)}` : '';

  // Say so when each team's best and worst match have been taken out (and for whom that couldn't be done).
  const untrimmed = trimOutliers ? rows.filter((r) => r.windowSize > 0 && !r.trimmed).length : 0;
  const trimNote = trimOutliers
    ? ` · best & worst match removed${untrimmed ? ` (teams with under ${MIN_MATCHES_TO_TRIM} matches keep them all)` : ''}`
    : '';

  // The trend explainer lives under the table (index.html), so it only shows with the table.
  document.getElementById('xgNote').textContent = `${windowDescription()} per team${flagNote}${trimNote}`;
  const over = state.seasonOnly ? '' : 'over the ';
  document.getElementById('xgScatterCoverage').textContent = `Per match ${over}${windowDescription()}${trimNote}`;
}

/** The scatter always shows per-match averages, whatever the table toggle says. */
function renderScatter() {
  renderXgScatter(rows.map((row) => ({
    team_id: row.team_id,
    team: row.team,
    team_short: row.team_short,
    color: getTeamColor(row.team_short),
    sampleSize: row.sampleSize,
    xg: row.sampleSize ? row.xgTotal / row.sampleSize : null,
    xga: row.sampleSize ? row.xgaTotal / row.sampleSize : null,
    trail: row.scatterTrail,
  })));
}

/* ---------- public ---------- */

/** Loads the data for the selected competition and window, and draws the chart and table. */
export async function renderExpectedGoals() {
  rows = await loadRows();
  renderNote();
  renderTable();
  renderScatter();
}

/** Wires up the Team / Player and Per game / Total toggles and the sortable headers. */
export function initExpectedGoals() {
  bindSegmented('xgView', (val) => {
    document.getElementById('xgTeamView').style.display = val === 'team' ? '' : 'none';
    document.getElementById('xgPlayerView').style.display = val === 'player' ? '' : 'none';
  });

  // Scatter | Table. The Per game | Total toggle only applies to the table.
  bindSegmented('xgLayout', (val) => {
    const scatter = val === 'scatter';
    document.getElementById('xgScatterView').style.display = scatter ? '' : 'none';
    document.getElementById('xgTableView').style.display = scatter ? 'none' : '';
    document.getElementById('xgStatsMode').style.display = scatter ? 'none' : '';
  });

  bindSegmented('xgStatsMode', (val) => {
    statsMode = val;
    renderTable();
  });

  // Remove each team's best & worst match. It changes the numbers behind the chart and the
  // table, so everything is rebuilt.
  const trimBox = document.getElementById('xgTrim');
  trimBox.addEventListener('change', () => {
    trimOutliers = trimBox.checked;
    renderExpectedGoals();
  });

  document.querySelectorAll('#xgTable thead th[data-key]').forEach((th) => {
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

  initXgScatter();
}
