/*
  hero.js
  The top of the Overview tab:
  - the intro banner label (competition · season · gameweek)
  - the four highlight cards (title odds, relegation odds, biggest
    xG over/underperformer) — always "as of today", so they ignore the
    season and Total/Per game toggles
  - the KPI grid, which does react to those toggles

  Each KPI is computed for the current period and the period before it,
  purely to drive the up/down trend arrow and percentage.
*/

import { state, getSeasonLabel } from './state.js';
import { bindSegmented } from './ui.js';
import { getTeamLogoURL, trendDirection } from './utils.js';
import {
  getResults,
  getLatestSeasonResults,
  getTeamsById,
  getRatings,
} from './leagueData.js';

// "Last 380 matches" window. results.json has two rows per match.
const WINDOW_MATCHES = 380;
const WINDOW_ROWS = WINDOW_MATCHES * 2;

export function initHero() {
  // The toggles only change the KPI cards, so only those get redrawn.
  bindSegmented('statsMode', (val) => { state.statsMode = val; renderKpis(); });
  bindSegmented('windowMode', (val) => { state.windowMode = val; renderKpis(); });
}

export async function renderHero() {
  renderHeroLabel();
  await Promise.all([renderHighlights(), renderKpis()]);
}

/* ---------- banner label ---------- */

function renderHeroLabel() {
  const parts = [state.competition.toUpperCase(), getSeasonLabel()];

  if (state.gameweek === 0) {
    parts.push('Pre-Season');
  } else if (state.gameweek) {
    parts.push(`Gameweek ${state.gameweek}`);
  }

  document.getElementById('heroCompetition').textContent = parts.join(' · ');
}

/* ---------- highlight cards ---------- */

/** Fills one highlight card. Pass teamId = null to show an empty card. */
function setHighlight(id, teamsById, teamId, value) {
  const team = teamsById.get(teamId);
  const crest = document.getElementById(id + 'Crest');

  document.getElementById(id + 'Num').textContent = team ? value : '–';
  document.getElementById(id + 'Team').textContent = team ? team.team : '–';

  if (team) {
    crest.innerHTML = `<img src="${getTeamLogoURL(team.team_id)}" alt="${team.team}" class="hero-team-crest">`;
  } else {
    crest.textContent = '–';
  }
}

/** The row with the highest value for `key`, or undefined if no rows. */
function maxBy(rows, key) {
  return rows.reduce((best, row) => (!best || row[key] > best[key] ? row : best), undefined);
}

function formatSigned(value) {
  return value >= 0 ? `+${value.toFixed(1)}` : `−${Math.abs(value).toFixed(1)}`;
}

/** For every team: actual goal difference minus expected goal difference,
 *  added up over the rows given. Sorted from biggest overperformer down. */
function getXgPerformance(rows) {
  // Each match has one row per team, so look up the opponent's row
  // to get the goals/xG they scored against this team.
  const rowLookup = new Map(rows.map((r) => [`${r.match_id}-${r.team_id}`, r]));
  const totals = new Map(); // team_id -> overperformance

  for (const row of rows) {
    const opponent = rowLookup.get(`${row.match_id}-${row.opponent_id}`);
    if (!opponent) continue;

    const actualGD = row.goals - opponent.goals;
    const expectedGD = row.xg - opponent.xg;
    totals.set(row.team_id, (totals.get(row.team_id) ?? 0) + (actualGD - expectedGD));
  }

  return [...totals]
    .map(([team_id, overperformance]) => ({ team_id, overperformance }))
    .sort((a, b) => b.overperformance - a.overperformance);
}

async function renderHighlights() {
  const [ratings, results, teamsById] = await Promise.all([
    getRatings(),
    getLatestSeasonResults(),
    getTeamsById(),
  ]);

  const titleFavourite = maxBy(ratings, 'champion_pct');
  const relegationFavourite = maxBy(ratings, 'relegation_pct');

  setHighlight('titleOdds', teamsById, titleFavourite?.team_id, `${(titleFavourite?.champion_pct * 100).toFixed(1)}%`);
  setHighlight('relegationOdds', teamsById, relegationFavourite?.team_id, `${(relegationFavourite?.relegation_pct * 100).toFixed(1)}%`);

  const performance = getXgPerformance(results);
  const over = performance[0];
  const under = performance[performance.length - 1];

  setHighlight('overperformer', teamsById, over?.team_id, formatSigned(over?.overperformance ?? 0));
  setHighlight('underperformer', teamsById, under?.team_id, formatSigned(under?.overperformance ?? 0));
}

/* ---------- KPI cards ---------- */

// One entry per KPI card. `field` is the column in results.json.
// Decimals are for the Total / Per game display; thousands adds "1,234".
const KPIS = [
  { id: 'kpiGoals',         field: 'goals',   totalDecimals: 0, perGameDecimals: 2, thousands: true,
    labels: { total: 'Total goals', perGame: 'Goals per game' } },
  { id: 'kpiExpectedGoals', field: 'xg',      totalDecimals: 0, perGameDecimals: 2, thousands: true,
    labels: { total: 'Total xG', perGame: 'xG per game' } },
  { id: 'kpiCleanSheets',   field: 'cs',      totalDecimals: 0, perGameDecimals: 2, thousands: false,
    labels: { total: 'Total clean sheets', perGame: 'Clean sheets per game' } },
  { id: 'kpiDcHits',        field: 'dc_hits', totalDecimals: 0, perGameDecimals: 2, thousands: true,
    labels: { total: 'Total defensive contribution hits', perGame: 'Defensive contribution hits per game' } },
  { id: 'kpiDefcons',       field: 'defcons', totalDecimals: 0, perGameDecimals: 2, thousands: true,
    labels: { total: 'Total defensive contributions', perGame: 'Defensive contributions per game' } },
];

/** Splits the results into the period being shown and the period before
 *  it, depending on the Season / Last 38 GWs toggle. */
function getPeriodRows(rows) {
  if (state.windowMode === 'season') {
    const current = rows.filter((r) => r.season === state.season);

    // Compare with the same stage of last season (e.g. first 60 matches vs first 60 matches).
    const latestMatchNum = Math.max(...current.map((r) => r.match_num_asc));
    const prior = rows.filter(
      (r) => r.season === state.season - 1 && r.match_num_asc <= latestMatchNum
    );
    return { current, prior };
  }

  // Last 380 matches vs the 380 matches before that.
  // match_num_dsc counts back from the most recent row (1 = latest).
  const current = rows.filter((r) => r.match_num_dsc <= WINDOW_ROWS);
  const prior = rows.filter(
    (r) => r.match_num_dsc > WINDOW_ROWS && r.match_num_dsc <= WINDOW_ROWS * 2
  );
  return { current, prior };
}

/** Adds up each metric across rows. `matches` counts unique matches,
 *  not rows (each match has 2 rows, one per team). */
function aggregate(rows) {
  const totals = { matches: 0, goals: 0, xg: 0, cs: 0, dc_hits: 0, defcons: 0 };
  const matchIds = new Set();

  for (const row of rows) {
    matchIds.add(row.match_id);
    totals.goals += row.goals;
    totals.xg += row.xg;
    totals.cs += row.cs ? 1 : 0;
    totals.dc_hits += row.dc_hits;
    totals.defcons += row.defcons;
  }

  totals.matches = matchIds.size;
  return totals;
}

/** The KPI value as shown: either the total, or the per-game average. */
function getMetric(totals, field) {
  if (state.statsMode === 'total') return totals[field];
  return totals.matches ? totals[field] / totals.matches : 0;
}

function formatKpi(kpi, value) {
  const decimals = state.statsMode === 'total' ? kpi.totalDecimals : kpi.perGameDecimals;
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: kpi.thousands,
  });
}

/** Writes one KPI card: label, number and trend line. */
function renderKpi(kpi, current, prior) {
  const currentValue = getMetric(current, kpi.field);
  const priorValue = getMetric(prior, kpi.field);

  document.getElementById(kpi.id + 'Lbl').textContent = kpi.labels[state.statsMode];
  document.getElementById(kpi.id + 'Num').textContent = formatKpi(kpi, currentValue);

  const trendEl = document.getElementById(kpi.id + 'Trend');
  const trend = trendDirection(currentValue, priorValue);

  if (!trend) {
    trendEl.innerHTML = `<span class="trend flat">prior period n/a</span>`;
    return;
  }

  const arrow = trend.dir === 'up' ? '▲' : trend.dir === 'down' ? '▼' : '▬';
  const priorText = state.windowMode === 'season' ? 'last season' : 'prior period';
  trendEl.innerHTML = `
    <span class="trend ${trend.dir}">${arrow} ${Math.abs(trend.pct).toFixed(1)}%</span>
    <span class="trend-sub">vs ${formatKpi(kpi, priorValue)} ${priorText}</span>
  `;
}

async function renderKpis() {
  const rows = await getResults();
  const periods = getPeriodRows(rows);
  const current = aggregate(periods.current);
  const prior = aggregate(periods.prior);

  // "Matches played" has no trend — comparing match counts isn't meaningful.
  document.getElementById('kpiMatchesNum').textContent = current.matches;

  KPIS.forEach((kpi) => renderKpi(kpi, current, prior));
}
