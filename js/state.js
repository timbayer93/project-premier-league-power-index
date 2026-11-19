/*
  state.js
  The one shared, mutable object every other module reads from and
  writes to, plus a small label helper.
*/

export const state = {
  competition: null,
  season: null,        // the season being viewed (filter bar)
  latest_season: null, // the most recent season in the data ("as of today")
  gameweek: null,      // set manually via activeGW in config.json

  lastN: 38,             // the "Last N matches" window (filter bar), 1 to MAX_LAST_N
  seasonOnly: false,     // "This season only" ticked: each team's window is its matches this season (lastN is ignored)
  statsMode: 'total',    // 'total' or 'perGame'
  windowMode: 'season',  // 'season' or 'last380'
};

export const MAX_LAST_N = 38;

/** Display label for a season id, e.g. 26 -> "2026-27". Defaults to the
 *  currently selected season. */
export function getSeasonLabel(seasonId = state.season) {
  return `20${seasonId}-${seasonId + 1}`;
}
