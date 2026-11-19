/*
  utils.js
  Small, dependency-free helpers shared across tabs.
*/


/*
  Generic comparator for sorting an array of row objects by any column,
  string or numeric. Shared by every sortable table (Team Ratings now,
  Fixtures later) so click-to-sort behavior stays consistent everywhere
  without copy-pasting this per table.
*/
export function compareRows(a, b, key, dir) {
  const av = a[key];
  const bv = b[key];
  if (typeof av === 'string') return av.localeCompare(bv) * dir;
  return (av - bv) * dir;
}

/** Like compareRows, but rows with no value (null/undefined) always sort
 *  last, whichever direction the table is sorted in. */
export function compareWithBlanksLast(a, b, key, dir) {
  const aValue = a[key];
  const bValue = b[key];

  if (aValue == null && bValue == null) return 0;
  if (aValue == null) return 1;
  if (bValue == null) return -1;
  return compareRows(a, b, key, dir);
}

/** Percentage change from `prior` to `current`, and which way it went
 *  (up / down / flat). null if there is no prior value to compare with. */
export function trendDirection(current, prior) {
  if (!prior) return null;
  const pct = ((current - prior) / prior) * 100;
  const dir = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat';
  return { dir, pct };
}

/** What an empty table cell shows. */
export const BLANK_CELL = '<span class="fixture-blank">–</span>';

/** Average of getValue(row) over rows, or null if there are no rows. */
export function average(rows, getValue) {
  if (rows.length === 0) return null;
  return rows.reduce((sum, row) => sum + getValue(row), 0) / rows.length;
}

/** "1 match", "10 matches" */
export function matchesText(count) {
  return `${count} ${count === 1 ? 'match' : 'matches'}`;
}

export const TREND_WINDOW = 10; // matches in each moving average

/**
 * Trend line values for a team: for each of its last `count` matches
 * (oldest first), the average of getValue over that match and the 9 before
 * it. When fewer earlier matches exist, it averages what is available.
 * `matches` must be most recent first.
 */
export function rollingAverages(matches, getValue, count) {
  const recent = matches.slice(0, count + TREND_WINDOW - 1).reverse(); // oldest first
  const firstShown = Math.max(0, recent.length - count);

  const values = [];
  for (let i = firstShown; i < recent.length; i++) {
    const window = recent.slice(Math.max(0, i - TREND_WINDOW + 1), i + 1);
    values.push(average(window, getValue));
  }
  return values;
}

/**
 * An expanding average: for each of the `count` matches (oldest first), the
 * average of getValue from the start of that window up to that match. The
 * last value is the average over the whole window. `matches` must be most
 * recent first.
 */
export function expandingAverages(matches, getValue, count) {
  const window = matches.slice(0, count).reverse(); // oldest first

  const values = [];
  let total = 0;
  window.forEach((match, i) => {
    total += getValue(match);
    values.push(total / (i + 1));
  });
  return values;
}

/** A team crest <img>. `mono` makes it greyscale. The team name shows on hover. */
export function crestHtml(teamId, teamsById, { mono = false } = {}) {
  const name = teamsById.get(teamId)?.team ?? '';
  return `<img class="crest${mono ? ' crest-mono' : ''}" src="${getTeamLogoURL(teamId)}" alt="" title="${name}">`;
}

/**
 * Where a season ends and the next begins along a trend line: the positions
 * (0-based, along the points) of the first match of each new season, for the
 * last `count` of a team's matches. `matches` must be most recent first, the
 * same list and count given to rollingAverages. Pass the result to sparklineSvg.
 */
export function seasonDividers(matches, count) {
  const shown = matches.slice(0, count).reverse(); // oldest first, like the trend points

  const dividers = [];
  shown.forEach((match, i) => {
    if (i > 0 && match.season !== shown[i - 1].season) dividers.push(i);
  });
  return dividers;
}

/**
 * Small inline trend chart. `lines` is a list of { values, color }; all
 * lines are drawn on one shared scale (the min and max across every line),
 * so two lines can be compared with each other.
 *
 * `dividers` (optional, see seasonDividers) are the positions where a new
 * season starts; each gets a faint dashed vertical line between its two points.
 */
export function sparklineSvg(lines, { dividers = [] } = {}) {
  const pointCount = lines[0]?.values.length ?? 0;
  if (pointCount < 2) return BLANK_CELL; // a single point can't make a line

  const width = 60;
  const height = 20;
  const padX = 1.5; // room so the line's thickness isn't clipped at the edges
  const padY = 2.5;
  const allValues = lines.flatMap((line) => line.values);
  const min = Math.min(...allValues);
  const range = Math.max(...allValues) - min || 1;
  const step = (width - 2 * padX) / (pointCount - 1);

  const dividerLines = dividers
    .map((i) => {
      const x = (padX + (i - 0.5) * step).toFixed(1);
      return `<line x1="${x}" x2="${x}" y1="0" y2="${height}" stroke="#9A9382" stroke-width="1" stroke-dasharray="3 2" opacity="0.7"/>`;
    })
    .join('');

  const polylines = lines
    .map(({ values, color }) => {
      const points = values
        .map((v, i) => `${(padX + i * step).toFixed(1)},${(padY + (height - 2 * padY) * (1 - (v - min) / range)).toFixed(1)}`)
        .join(' ');
      return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5"/>`;
    })
    .join('');

  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${dividerLines}${polylines}</svg>`;
}

/** Premier League badge URL for a team id (team_id / team_code are the same number). */
export function getTeamLogoURL(teamId) {
  return `https://resources.premierleague.com/premierleague/badges/100/t${teamId}@x2.png`;
}
