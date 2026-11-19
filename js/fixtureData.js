/*
  fixtureData.js
  Loads the upcoming fixtures once and works out how hard each one is.
  Used by both Fixtures layouts: the gameweek grid (fixtures.js) and the
  easiest / hardest runs (fixtureRuns.js).

  Data: data/projections.json (one row per team per unplayed fixture),
  with team names and ratings from teams.json / ratings.json.
*/

import { getRatings, getTeamsById, getProjections, RATING_SCALE } from './leagueData.js';

/* =====================================================================
   DIFFICULTY  —  edit this section to change how difficulty is worked out

   Difficulty of a fixture = the opponent's Overall rating (the same
   number shown on Team Ratings, i.e. rating x 100), nudged for venue:
     - playing AT HOME makes the opponent a little easier (x 0.95)
     - playing AWAY makes the opponent a little harder   (x 1.05)
   Higher number = harder fixture.

   To change the formula, edit getFixtureDifficulty() below. It gets the
   opponent's rating and whether your team is at home.

   BLANK GAMEWEEKS: a team with no fixture in a gameweek counts as having
   the hardest fixture in the league (the largest difficulty in the data,
   returned as `hardestDifficulty` below). This is used for the Overall
   column in the Difficulty view and for the runs, so teams with blanks
   rank as harder. The blank cell itself still shows "–".
   ===================================================================== */
const HOME_DIFFICULTY_FACTOR = 0.95; // 5% easier at home
const AWAY_DIFFICULTY_FACTOR = 1.05; // 5% harder away

function getFixtureDifficulty(opponentRating, isHome) {
  return opponentRating * (isHome ? HOME_DIFFICULTY_FACTOR : AWAY_DIFFICULTY_FACTOR);
}

/** Turns one projections row into the fixture details the tables need. */
function toFixture(projection, ratingByTeam) {
  const opponentRating = ratingByTeam.get(projection.opponent_id);

  return {
    opponentId: projection.opponent_id,
    isHome: projection.home,
    difficulty: getFixtureDifficulty(opponentRating, projection.home),
    xg: projection.xg,
    cs: projection.xcs,
    dc_hits: projection.dc_hits,
  };
}

/**
 * Everything the Fixtures tab needs:
 *   teams              [{ team_id, team, team_short }]  one per row
 *   teamsById          Map of team_id -> the same
 *   fixturesByTeam     Map of team_id -> Map of gw -> [fixture, ...]
 *                      (a list per gameweek, so blank = 0 and double = 2 both work)
 *   lastGw             the last gameweek that has projections
 *   hardestDifficulty  the hardest fixture in the league (null if there are none)
 */
export async function loadFixtureData() {
  const [ratings, teamsById, projections] = await Promise.all([
    getRatings(),
    getTeamsById(),
    getProjections(),
  ]);

  const teams = ratings.map((r) => {
    const team = teamsById.get(r.team_id);
    const name = team?.team ?? `Team ${r.team_id}`;
    return { team_id: r.team_id, team: name, team_short: team?.team_short ?? name };
  });

  const ratingByTeam = new Map(ratings.map((r) => [r.team_id, r.spi * RATING_SCALE]));

  const fixturesByTeam = new Map();
  let hardestDifficulty = null;

  for (const projection of projections) {
    if (!fixturesByTeam.has(projection.team_id)) fixturesByTeam.set(projection.team_id, new Map());
    const byGw = fixturesByTeam.get(projection.team_id);

    if (!byGw.has(projection.gw)) byGw.set(projection.gw, []);
    const fixture = toFixture(projection, ratingByTeam);
    byGw.get(projection.gw).push(fixture);

    if (hardestDifficulty === null || fixture.difficulty > hardestDifficulty) {
      hardestDifficulty = fixture.difficulty;
    }
  }

  const lastGw = projections.length ? Math.max(...projections.map((p) => p.gw)) : 0;

  return { teams, teamsById, fixturesByTeam, lastGw, hardestDifficulty };
}
