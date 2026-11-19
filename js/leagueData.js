/*
  leagueData.js
  Loads the shared league data files and hands them back in a tidy,
  ready-to-use shape. The Overview (hero.js, heroCharts.js) and the
  Team Ratings table (teamRatings.js) all read from here, so files are
  only fetched/cleaned once and every competition filter lives in one place.

  Files used:
  - data/results.json  one row per team per match (2 rows per match)
  - data/teams.json    team_id -> team name / short name
  - data/ratings.json  team ratings, standings and title/top 4/relegation odds
  - data/projections.json  projected stats for each team's remaining fixtures
  - data/score_matrix.json  score probabilities for the matches in Match Forecasts
  - data/gameweeks.json    one row per match date, with a finished flag
*/

import { loadJSON } from './dataStore.js';
import { state } from './state.js';
import { matchesText } from './utils.js';

/* ---------- results ---------- */

/** The newest season that has any rows (never later than latest_season).
 *  Before a new season's first match, this is the season before. */
export function getNewestSeason(rows) {
  return rows.reduce(
    (newest, r) => (r.season <= state.latest_season && r.season > newest ? r.season : newest),
    0
  );
}

/**
 * Keeps only the unbroken run of seasons that ends at `newestSeason`.
 * Starting there, it goes back one season at a time and stops at the first
 * season with no rows. Anything older is dropped, so history never jumps
 * across a missing season (e.g. a team that was relegated and came back).
 *
 * Use it on any "last N matches" or rolling-average history. Pass the
 * rows for one team to get that team's run, or the whole competition's
 * rows to get the competition's run. Row order is kept.
 */
export function keepConsecutiveSeasons(rows, newestSeason) {
  const seasons = new Set(rows.map((r) => r.season));

  let oldest = newestSeason;
  if (!seasons.has(oldest)) return [];
  while (seasons.has(oldest - 1)) oldest--;

  return rows.filter((r) => r.season >= oldest && r.season <= newestSeason);
}

let allResultsPromise = null;
const resultsByCompetition = new Map();

/** Loads results.json once. The ids come through as floats (43.0), so
 *  we turn them into whole numbers here and nowhere else. */
function loadAllResults() {
  if (!allResultsPromise) {
    allResultsPromise = loadJSON('data/results.json').then((rows) =>
      rows.map((r) => ({
        ...r,
        team_id: Math.trunc(r.team_id),
        opponent_id: Math.trunc(r.opponent_id),
      }))
    );
  }
  return allResultsPromise;
}

/** All result rows for one competition (defaults to the selected one).
 *  Filtered once per competition, then remembered. Only the unbroken run
 *  of seasons ending at the newest season is kept — see keepConsecutiveSeasons. */
export async function getResults(competition = state.competition) {
  if (!resultsByCompetition.has(competition)) {
    const rows = await loadAllResults();
    const competitionRows = rows.filter((r) => r.competition === competition);
    resultsByCompetition.set(
      competition,
      keepConsecutiveSeasons(competitionRows, getNewestSeason(competitionRows))
    );
  }
  return resultsByCompetition.get(competition);
}

const teamHistoryByCompetition = new Map();

/**
 * Every team's match history for one competition, as a Map of
 * team_id -> matches, most recent first. Each match is a results row plus
 * `.opponent`: the opponent's row from the same match (so match.opponent.xg
 * is the xG the team conceded).
 *
 * Only each team's unbroken run of seasons is kept (see
 * keepConsecutiveSeasons), so a team that was away for a season doesn't
 * borrow matches from before the gap.
 */
export async function getTeamHistory(competition = state.competition) {
  if (!teamHistoryByCompetition.has(competition)) {
    const results = await getResults(competition);
    const rowByMatchAndTeam = new Map(results.map((r) => [`${r.match_id}-${r.team_id}`, r]));

    // match_num_dsc counts back from the latest row, so sorting by it puts
    // each team's matches most recent first, across seasons.
    const matchesByTeam = new Map();
    for (const row of [...results].sort((a, b) => a.match_num_dsc - b.match_num_dsc)) {
      const opponent = rowByMatchAndTeam.get(`${row.match_id}-${row.opponent_id}`);
      if (!opponent) continue;

      if (!matchesByTeam.has(row.team_id)) matchesByTeam.set(row.team_id, []);
      matchesByTeam.get(row.team_id).push({ ...row, opponent });
    }

    const newestSeason = getNewestSeason(results);
    for (const [teamId, matches] of matchesByTeam) {
      matchesByTeam.set(teamId, keepConsecutiveSeasons(matches, newestSeason));
    }
    teamHistoryByCompetition.set(competition, matchesByTeam);
  }
  return teamHistoryByCompetition.get(competition);
}

/** Result rows for the latest season only — used for the "as of today"
 *  highlights, which ignore the season filter. */
export async function getLatestSeasonResults(competition = state.competition) {
  const rows = await getResults(competition);
  return rows.filter((r) => r.season === state.latest_season);
}

/* ---------- teams ---------- */

let teamsByIdPromise = null;

/** Map of team_id -> { team_id, team, team_short }. */
export function getTeamsById() {
  if (!teamsByIdPromise) {
    teamsByIdPromise = loadJSON('data/teams.json').then(
      (teams) => new Map(teams.map((t) => [t.team_id, t]))
    );
  }
  return teamsByIdPromise;
}

/* ---------- ratings ---------- */

// ratings.json stores ratings as small decimals (e.g. 0.61).
// Every page that shows them multiplies by this, so they all look the same.
export const RATING_SCALE = 1;

/** Ratings (one row per team) for one competition and season. Defaults to
 *  the latest season. When the season dropdown should drive a page,
 *  pass state.season instead. */
export async function getRatings(competition = state.competition, season = state.latest_season) {
  const ratings = await loadJSON('data/ratings.json');
  return ratings.filter((r) => r.competition === competition && r.season === season);
}

/* ---------- projections ---------- */

/** Projected stats for each team's remaining fixtures (one row per team
 *  per fixture) for one competition and season. */
export async function getProjections(competition = state.competition, season = state.latest_season) {
  const projections = await loadJSON('data/projections.json');

  // TODO(competition): projections.json has no `competition` column yet, so
  // for now we keep only the teams that are in this competition's ratings.
  // Once you add a `competition` column to projections.json:
  //   1. delete the three lines below, and
  //   2. uncomment the filter underneath them.
  const ratings = await getRatings(competition, season);
  const teamIds = new Set(ratings.map((r) => r.team_id));
  return projections.filter((p) => p.season === season && teamIds.has(p.team_id));

  // return projections.filter((p) => p.competition === competition && p.season === season);
}

/* ---------- score matrices ---------- */

// score_matrix.json has a column for every scoreline from 0-0 to 6-6.
const MATRIX_SIZE = 7; // goals 0 to 6

/** Turns the flat score_H_A columns into matrix[homeGoals][awayGoals]. */
function toMatrix(row) {
  return Array.from({ length: MATRIX_SIZE }, (_, home) =>
    Array.from({ length: MATRIX_SIZE }, (_, away) => row[`score_${home}_${away}`])
  );
}

/** The matches to forecast, in file order (the file is already sorted by
 *  match date). Each one has its score probabilities as matrix[home][away].
 *
 *  The file should only hold the matches to show, so there's no gameweek
 *  filter. Competition and season are still filtered because fixture ids
 *  repeat every season and the file may still contain older seasons. */
export async function getScoreMatrices(competition = state.competition, season = state.latest_season) {
  const rows = await loadJSON('data/score_matrix.json');

  return rows
    .filter((r) => r.competition === competition && r.season === season)
    .map((r) => ({
      fixture_id: r.fixture_id,
      gw: r.gw,
      match_date: r.match_date,
      home_team_id: r.home_team_id,
      away_team_id: r.away_team_id,
      matrix: toMatrix(r),
    }));
}

/* ---------- gameweeks ---------- */

/** The latest gameweek where every match date is finished (0 if none yet).
 *  A gameweek that is only partly played doesn't count.
 *
 *  Note: gameweeks.json has no `competition` column, so this is the same
 *  for every competition. */
export async function getLastCompletedGw(season = state.latest_season) {
  const rows = await loadJSON('data/gameweeks.json');

  const allFinished = new Map(); // gw -> true if every date in that gw is finished
  for (const row of rows.filter((r) => r.season === season)) {
    allFinished.set(row.gw, (allFinished.get(row.gw) ?? true) && row.finished);
  }

  const completed = [...allFinished].filter(([, done]) => done).map(([gw]) => gw);
  return completed.length ? Math.max(...completed) : 0;
}

/* ---------- the "Last N matches" window ---------- */

/**
 * The matches a team's windowed numbers (averages, totals, scatter) are
 * built from. `matches` must be most recent first (see getTeamHistory).
 *   - normally: the last N matches (the "Last N matches" box)
 *   - with "This season only" ticked: every match the team has played this
 *     season, however many that is
 */
export function getWindowSample(matches) {
  if (state.seasonOnly) return matches.filter((m) => m.season === state.latest_season);
  return matches.slice(0, state.lastN);
}

/** The window in words, for headers and notes: "last 38 matches" / "this season". */
export function windowText() {
  return state.seasonOnly ? 'this season' : `last ${matchesText(state.lastN)}`;
}

/** The same, as a title: "Last 38 matches" / "This season". */
export function windowTitle() {
  const text = windowText();
  return text[0].toUpperCase() + text.slice(1);
}

/** True if a team has fewer matches than the window asks for (shown with an
 *  asterisk). "This season only" never counts as partial: it is whatever
 *  the team has played. */
export function isPartialSample(sampleSize) {
  return !state.seasonOnly && sampleSize < state.lastN;
}

/* ---------- where the window starts and ends ---------- */

const seasonShort = (season) => `${season}/${season + 1}`;

/** The first and last match of a team's window, as { start, end } (each { season, gw }),
 *  or null if the window is empty. `sample` is most recent first (see getWindowSample). */
export function getWindowSpan(sample) {
  if (sample.length === 0) return null;

  const oldest = sample[sample.length - 1];
  const newest = sample[0];
  return {
    start: { season: oldest.season, gw: oldest.gw },
    end: { season: newest.season, gw: newest.gw },
  };
}

/**
 * Where the window runs from and to, in words, e.g. "GW7 25/26 – GW6 26/27"
 * (or "GW1–GW6 26/27" within one season). Teams can differ slightly (blank
 * gameweeks, newly promoted sides), so this reports the most common start
 * and the most common end across teams. `spans` are getWindowSpan results.
 */
export function describeCoverage(spans) {
  const present = spans.filter(Boolean);
  if (present.length === 0) return '';

  // Most common { season, gw }; on a tie, the earlier one for a start and the later one for an end.
  const mostCommon = (points, preferLater) => {
    const counts = new Map();
    for (const p of points) {
      const key = `${p.season}-${p.gw}`;
      counts.set(key, { ...p, count: (counts.get(key)?.count ?? 0) + 1 });
    }
    return [...counts.values()].sort((a, b) =>
      b.count - a.count || (preferLater ? 1 : -1) * ((b.season - a.season) || (b.gw - a.gw))
    )[0];
  };

  const start = mostCommon(present.map((s) => s.start), false);
  const end = mostCommon(present.map((s) => s.end), true);

  if (start.season === end.season && start.gw === end.gw) return `GW${start.gw} ${seasonShort(start.season)}`;
  if (start.season === end.season) return `GW${start.gw}–GW${end.gw} ${seasonShort(start.season)}`;
  return `GW${start.gw} ${seasonShort(start.season)} – GW${end.gw} ${seasonShort(end.season)}`;
}
