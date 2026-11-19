/*
  shading.js
  How the numeric columns are coloured, in one place.

  Every table that shades cells calls getCellShading() for each numeric cell
  and puts whatever comes back in the cell's style="..." attribute. It returns
  CSS declarations (a background, a text colour, bold, a data bar...) or ''
  for "leave this cell alone".

  Done so far: Team Ratings, the Fixture Tickers, and the window columns of the
  DefCons and Expected Goals team tables. Every other column returns '' for now.

  Design rules
  - Sequential ramps run from white (the table background) to a deep shade,
    so "no colour" means "nothing to see here" and colour means "look at this".
  - Ratings are only coloured on their better-than-average side, so roughly
    half the cells stay clear and the colour keeps its impact.
  - Each ramp is its own hue and is built on lightness, so the columns also read
    in greyscale / colour blindness. Offence views are blue, defence views orange
    (Team Ratings and the Fixture Tickers follow the same rule), Overall is green.
  - Text switches to white automatically once the background gets dark enough
    (see WHITE_TEXT_MIN_CONTRAST).
*/

/* ================= settings you are likely to tweak ================= */

// How the three finishing-chance columns (Title, Top 4, Relegation) look.
//   'bars'   a thin off-black bar along the bottom of the cell, scaled 0-100%
//   'colour' sequential colour, but only above a high threshold (FINISHING_COLOURS)
export const FINISHING_STYLE = 'bars';

const BAR_COLOUR = '#3B372E'; // off-black
const BAR_HEIGHT_PX = 5;

// Used when FINISHING_STYLE is 'colour': nothing is coloured below `threshold` (%).
const FINISHING_COLOURS = {
  champion_pct:   { palette: 'green',      threshold: 10 },
  top4_pct:       { palette: 'green',      threshold: 30 },
  relegation_pct: { palette: 'vermillion', threshold: 30 },
};

// Sequential ratings. `startAt: 'mean'` = only colour the better-than-average side.
// Use 'min' (or 'max' when lower is better) to colour the whole column instead.
const RATING_COLUMNS = {
  overall: { palette: 'green', better: 'high', startAt: 'mean' },
  off:     { palette: 'blue',   better: 'high', startAt: 'mean' },
  def:     { palette: 'orange', better: 'low',  startAt: 'mean' }, // lower def rating = better defence
};

// Fixture Tickers. Offence views are blue, defence views orange. Each colours only
// the cells above `from`, scaled up to the highest cell. Values are per match (a
// double gameweek is averaged), so one threshold fits every cell.
const FIXTURE_VIEWS = {
  // `from`: colour starts above this.  `to`: the deepest colour is reached here (anything
  // higher looks the same). Leave `to` as null to use the highest cell instead.
  // The caps sit at about the same place in each distribution (the top 3% of fixtures reach
  // full colour), so the two orange views are equally deep. Without a cap on DefCon hits the
  // single highest cell set the scale and almost everything looked pale.
  fixtureXg:     { palette: 'blue',   from: 1.5,  to: 2.2  }, // projected xG
  fixtureCs:     { palette: 'orange', from: 0.30, to: 0.50 }, // clean sheet chance (0.30 = 30%)
  fixtureDcHits: { palette: 'orange', from: 2,    to: 2.8  }, // projected defensive contribution hits
};

// DefCons and Expected Goals team tables: only the best teams' window numbers get colour,
// all in green. The value is always per match (whichever of Per game | Total is showing),
// so the colouring doesn't change with the toggle.
const TOP_TEAMS_SHARE = 0.30; // colour the best 30% of teams (6 of 20)
const TEAM_TABLE_COLUMNS = {
  defconsHits:    { palette: 'green', better: 'high' },
  defconsDefcons: { palette: 'green', better: 'high' },
  teamXg:         { palette: 'green', better: 'high' },
  teamXga:        { palette: 'green', better: 'low'  }, // lower xGA = better defence, so lowest is "top"
};

// Fixture difficulty is diverging: tough fixtures run white -> off-black, easy ones
// white -> blue, and everything in between stays white. Each side has two cut-offs,
// both positions among all upcoming fixtures (0.80 = harder than 80% of them), so they
// adjust themselves as the ratings change:
//   FROM  where the colour starts (further from 0.5 = fewer cells coloured)
//   FULL  where it reaches its deepest shade. Everything beyond is the same colour, so
//         the very toughest (or easiest) fixtures look alike, not a different shade each.
// The two ramps. Blue (easy) and off-black (tough) is the current choice. A green (easy) and
// orange (tough) pair is also defined below; it was tried and tested for colour blindness, and
// it is one line to switch to:
//   const DIFFICULTY_PALETTES = { tough: 'tangerine', easy: 'seagreen' };
const DIFFICULTY_PALETTES = { tough: 'charcoal', easy: 'blue' };

const DIFFICULTY_TOUGH_FROM = 0.80;
const DIFFICULTY_TOUGH_FULL = 0.90;
const DIFFICULTY_EASY_FROM = 0.30;
const DIFFICULTY_EASY_FULL = 0.10;

// Sequential ramps: [position 0-1, colour]. Position 0 is always white.
const PALETTES = {
  green:      [[0, '#FFFFFF'], [0.35, '#C9DCD0'], [0.7, '#5E8A6E'], [1, '#1B3A2B']], // the site's pitch green
  orange:     [[0, '#FFFFFF'], [0.35, '#F3DFB4'], [0.7, '#D6A24C'], [1, '#AC7A2C']], // amber, built on the site's gold
  blue:       [[0, '#FFFFFF'], [0.35, '#BBD9EC'], [0.7, '#3C93C8'], [1, '#1B74A8']], // a deeper --pos
  vermillion: [[0, '#FFFFFF'], [0.35, '#F3C9B3'], [0.7, '#D9744A'], [1, '#B04E26']], // a deeper --neg
  charcoal:   [[0, '#FFFFFF'], [0.35, '#D9D6CE'], [0.7, '#8A867B'], [1, '#535048']], // soft off-black, for tough fixtures
  // An alternative fixture difficulty pair (see DIFFICULTY_PALETTES). The green leans slightly blue and the orange is bright: that
  // pairing stays easy to tell apart for the common kinds of colour blindness, which a purer
  // green and a yellower orange do not.
  seagreen:   [[0, '#FFFFFF'], [0.35, '#B6E0D4'], [0.7, '#3FAE8E'], [1, '#2D7D66']], // easy fixtures (alternative)
  tangerine:  [[0, '#FFFFFF'], [0.35, '#F9D3AC'], [0.7, '#F08A24'], [1, '#C2600E']], // tough fixtures (alternative)
};

// The weakest shaded cell starts this far along its ramp (0-1), so the first
// step above the threshold is still visible against white.
const MIN_TINT = 0.12;

const INK = '#201D18';  // the site's text colour (--ink)
const WHITE = '#FFFFFF';

// White text is used on any background it reaches at least this contrast on; otherwise the
// normal ink stays. Lower = white takes over on lighter shades (3.6 switches at about the
// middle of the blue ramp; 4.5, the usual accessibility guideline, would switch later).
const WHITE_TEXT_MIN_CONTRAST = 3.6;

/* ================= colour helpers ================= */

const clamp01 = (x) => Math.min(1, Math.max(0, x));

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** The colour at position t (0-1) along a ramp. */
function rampColour(stops, t) {
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i];
    if (t <= p1) {
      const [p0, c0] = stops[i - 1];
      const f = (t - p0) / (p1 - p0);
      const a = hexToRgb(c0);
      const b = hexToRgb(c1);
      return a.map((v, k) => v + (b[k] - v) * f);
    }
  }
  return hexToRgb(stops[stops.length - 1][1]);
}

/** WCAG relative luminance of an [r, g, b] colour. */
function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(rgbA, rgbB) {
  const [hi, lo] = [luminance(rgbA), luminance(rgbB)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/** The text colour to set on this background, or '' to keep the normal ink. */
function textColourFor(backgroundRgb) {
  return contrastRatio(backgroundRgb, hexToRgb(WHITE)) >= WHITE_TEXT_MIN_CONTRAST ? WHITE : '';
}

/** Style for a cell shaded at strength t (0-1) of a palette. */
function shade(paletteName, t) {
  const rgb = rampColour(PALETTES[paletteName], MIN_TINT + (1 - MIN_TINT) * clamp01(t));
  const text = textColourFor(rgb);
  return `background:${rgbToHex(rgb)}` + (text ? `;color:${text}` : '');
}

/* ================= the column rules ================= */

/** Overall / Off / Def: sequential, only on the better-than-average side. */
function shadeRating(rule, value, range) {
  if (!range || [range.min, range.max, range.mean].some((x) => typeof x !== 'number')) return '';

  const high = rule.better === 'high';
  const start = rule.startAt === 'mean' ? range.mean : (high ? range.min : range.max);
  const end = high ? range.max : range.min;
  const span = end - start;
  if (span === 0) return '';

  const t = (value - start) / span;       // 0 at the start, 1 at the best team
  return t > 0 ? shade(rule.palette, t) : '';
}

/** A thin bar along the bottom of the cell, as wide as the percentage. */
function dataBar(value) {
  const width = Math.min(100, value);
  if (width < 0.5) return '';
  const w = width.toFixed(1);
  return `background-image:linear-gradient(90deg,${BAR_COLOUR} ${w}%,transparent ${w}%);`
       + `background-repeat:no-repeat;background-size:100% ${BAR_HEIGHT_PX}px;background-position:left bottom`;
}

/** Colour only above a high threshold, scaled from the threshold up to 100%. */
function thresholdColour(columnKey, value) {
  const { palette, threshold } = FINISHING_COLOURS[columnKey];
  if (value <= threshold) return '';
  return shade(palette, (value - threshold) / (100 - threshold));
}

/** Team tables: colour the best TOP_TEAMS_SHARE of teams, scaled from the edge of that group to the best team. */
function shadeTopTeams(rule, value, range) {
  if (!range || typeof range.at !== 'function' || typeof range.min !== 'number') return '';

  if (rule.better === 'high') {
    const start = range.at(1 - TOP_TEAMS_SHARE);
    return value > start && range.max > start ? shade(rule.palette, (value - start) / (range.max - start)) : '';
  }
  const start = range.at(TOP_TEAMS_SHARE);
  return value < start && start > range.min ? shade(rule.palette, (start - value) / (start - range.min)) : '';
}

/** Fixture views: colour only above a threshold, scaled from there up to `to` (or the highest cell). */
function shadeAbove(rule, value, range) {
  const top = rule.to ?? range?.max;
  if (typeof top !== 'number' || value <= rule.from || top <= rule.from) return '';
  return shade(rule.palette, (value - rule.from) / (top - rule.from)); // shade() caps this at the deepest colour
}

/** Fixture difficulty: diverging. Tough = off-black, easy = blue, the middle stays white. */
function shadeDifficulty(value, range) {
  if (!range || typeof range.at !== 'function') return '';
  const [toughFrom, toughFull, easyFrom, easyFull] = [
    DIFFICULTY_TOUGH_FROM, DIFFICULTY_TOUGH_FULL, DIFFICULTY_EASY_FROM, DIFFICULTY_EASY_FULL,
  ].map((p) => range.at(p));
  if ([toughFrom, toughFull, easyFrom, easyFull].some((x) => x === null)) return '';

  if (value > toughFrom && toughFull > toughFrom) {
    return shade(DIFFICULTY_PALETTES.tough, (value - toughFrom) / (toughFull - toughFrom));
  }
  if (value < easyFrom && easyFrom > easyFull) {
    return shade(DIFFICULTY_PALETTES.easy, (easyFrom - value) / (easyFrom - easyFull));
  }
  return '';
}

/* ================= public ================= */

/** The value at position p (0-1) among already-sorted numbers, e.g. 0.5 = the median. */
function quantile(sorted, p) {
  const i = clamp01(p) * (sorted.length - 1);
  const lo = Math.floor(i);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** min, max, mean and at(p) (the value p of the way up, 0-1) for a list of numbers.
 *  Missing values (null, undefined, NaN) are ignored. With no usable values at all
 *  everything is null, rather than Infinity / -Infinity, so getCellShading can skip it. */
export function getValueRange(values) {
  const sorted = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return { min: null, max: null, mean: null, at: () => null };

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    at: (p) => quantile(sorted, p),
  };
}

/** getValueRange() for each of the given columns of a list of row objects, worked out once per render. */
export function getColumnRanges(rows, columnKeys) {
  const ranges = {};
  for (const key of columnKeys) ranges[key] = getValueRange(rows.map((row) => row[key]));
  return ranges;
}

/**
 * CSS declarations to style a cell (for its style="..." attribute), or '' to
 * leave it alone.
 *
 *   columnKey  the column, e.g. 'overall', 'def', 'xga'
 *   value      the cell's raw value
 *   range      { min, max, mean, at(p) } for that column (see getValueRange)
 *
 * Team Ratings columns handled so far:
 *   'overall', 'off', 'def'                      sequential, above average only (RATING_COLUMNS)
 *   'points'                                     bold
 *   'champion_pct', 'top4_pct', 'relegation_pct' bars or thresholded colour (FINISHING_STYLE)
 *
 * Team tables (the value is per match; the range covers all teams in the table):
 *   'defconsHits', 'defconsDefcons'              green, the top 30% of teams (DefCons tab)
 *   'teamXg', 'teamXga'                          green, the top 30% of teams; for xGA the lowest (Expected Goals tab)
 *
 * Fixture Tickers (the value is per match; the range covers every upcoming fixture):
 *   'fixtureDifficulty'                          diverging, tough = off-black, easy = blue
 *   'fixtureXg'                                  blue, 1.5 up to 2.2
 *   'fixtureCs', 'fixtureDcHits'                 orange, 30% up to 50% / 2 up to 2.8
 *   'fixtureOverall'                             bold
 *
 * Still to do. Lower is better for these, so their colours need to be reversed:
 *   'xga', 'lastXga', 'nextXga'                  (Expected Goals)
 *   'runAvg'                                     (Fixtures, Runs: lower = easier)
 * Other numeric columns that can be shaded: 'projHits', 'projDefcons', 'projCs'
 * (DefCons projections), and the Match Forecasts table's 'xg', 'xga', 'cs', 'dcHits'.
 * The Goals − xG columns are signed, with 0 as neutral. 'attackDiff' (goals
 * scored − xG): positive is good. 'defenceDiff' (goals conceded − xGA):
 * positive is BAD (conceding more than expected), so its colours reverse.
 */
export function getCellShading(columnKey, value, range) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''; // missing: never styled

  if (columnKey === 'points' || columnKey === 'fixtureOverall') return 'font-weight:700';

  if (columnKey in TEAM_TABLE_COLUMNS) return shadeTopTeams(TEAM_TABLE_COLUMNS[columnKey], value, range);

  if (columnKey === 'fixtureDifficulty') return shadeDifficulty(value, range);
  if (columnKey in FIXTURE_VIEWS) return shadeAbove(FIXTURE_VIEWS[columnKey], value, range);

  if (columnKey in RATING_COLUMNS) return shadeRating(RATING_COLUMNS[columnKey], value, range);

  if (columnKey in FINISHING_COLOURS) {
    return FINISHING_STYLE === 'bars' ? dataBar(value) : thresholdColour(columnKey, value);
  }

  return '';
}
