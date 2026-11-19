/*
  heroCharts.js
  The six trend charts on the Overview tab. They show the full history
  for the selected competition and don't react to any other filter.

  Steps:
  1. Collapse the match rows into one row per gameweek.
  2. Add a rolling 38-gameweek average to each gameweek.
  3. Drop the first season (its early averages cover a partial window).
  4. Draw the charts and fill in each card's headline value.

  Each chart is a Chart.js line chart plus a small plugin (trendDecor,
  below) that adds the extras: alternating season bands with season labels,
  a dashed long-run average line, a peak marker, and the latest value at
  the end of each line.
*/

import { state } from './state.js';
import { getResults } from './leagueData.js';
import { trendDirection } from './utils.js';

const ROLLING_WINDOW = 38; // gameweeks

// Values of the `result` column in results.json (from the team's point of view).
const RESULT = { draw: 0, win: 1, loss: 2 };

// Same palette as the CSS variables in styles.css (canvas can't read CSS variables).
const COLORS = {
  line: '#1B3A2B',     // --pitch
  homeWin: '#0072B2',  // --pos
  draw: '#D6A24C',     // --gold
  awayWin: '#C1440E',  // --neg
  grid: '#E8E1CC',     // --paper-dim
  ink: '#201D18',      // --ink
  muted: '#5A5548',    // --ink-soft
  band: 'rgba(241, 236, 221, 0.7)', // --paper, for every other season
  ring: '#ffffff',     // card background
};
const FONT = "'IBM Plex Mono', monospace";

// The five single-line charts. `key` is the column in results.json and
// matches the card ids: trendChart-<key>, trendNum-<key>, trendDelta-<key>.
//   decimals      decimals on the end label and headline number
//   axisDecimals  decimals on the y-axis labels (defaults to `decimals`)
//   stepSize      fixed gap between y-axis gridlines (omit to let Chart.js choose)
const SINGLE_LINE_CHARTS = [
  { key: 'goals', label: 'Goals per match', decimals: 2, stepSize: 0.25 },
  { key: 'xg', label: 'Expected goals per match', decimals: 2 },
  { key: 'cs', label: 'Clean sheets per match', decimals: 2 },
  { key: 'dc_hits', label: 'DefCon hits per match', decimals: 2 },
  { key: 'defcons', label: 'DefCons per match', decimals: 1, axisDecimals: 0, stepSize: 10 },
];

const chartInstances = {};

/* ---------- 1. one row per gameweek ---------- */

function buildGameweekTable(rows) {
  const gameweeks = {};

  for (const row of rows) {
    const key = `${row.season}-${row.gw}`;
    if (!gameweeks[key]) {
      gameweeks[key] = {
        season: row.season, gw: row.gw,
        matchIds: new Set(),
        goals: 0, xg: 0, cs: 0, dc_hits: 0, defcons: 0,
        homeWins: 0, draws: 0, awayWins: 0,
      };
    }
    const g = gameweeks[key];

    g.matchIds.add(row.match_id);
    g.goals += row.goals;
    g.xg += row.xg;
    g.cs += row.cs ? 1 : 0;
    g.dc_hits += row.dc_hits;
    g.defcons += row.defcons;

    // Count each match's outcome once, using the home team's row.
    if (row.is_home) {
      if (row.result === RESULT.win) g.homeWins++;
      else if (row.result === RESULT.loss) g.awayWins++;
      else g.draws++;
    }
  }

  return Object.values(gameweeks)
    .map((g) => ({ ...g, matches: g.matchIds.size }))
    .sort((a, b) => a.season - b.season || a.gw - b.gw);
}

/* ---------- 2. rolling averages ---------- */

/** The (up to) 38 gameweeks ending at index i. */
function rollingWindow(gameweeks, i) {
  return gameweeks.slice(Math.max(0, i - ROLLING_WINDOW + 1), i + 1);
}

function sum(rows, getValue) {
  return rows.reduce((total, row) => total + getValue(row), 0);
}

function addRollingAverages(gameweeks) {
  gameweeks.forEach((gw, i) => {
    const window = rollingWindow(gameweeks, i);

    // Every metric is weighted by matches, not by gameweeks: add up the totals
    // first, then divide by the number of matches. That way a gameweek with
    // 4 matches doesn't count the same as one with 10 or 17, and a gameweek
    // still in progress only counts for the matches played so far.
    // (A gameweek in the table always has at least one match, so this never divides by 0.)
    const totalMatches = sum(window, (r) => r.matches);

    // Per-game metrics.
    SINGLE_LINE_CHARTS.forEach(({ key }) => {
      gw[`${key}_rolling`] = sum(window, (r) => r[key]) / totalMatches;
    });

    // Outcome split: match counts first, then convert to %.
    const share = (field) => (totalMatches ? (sum(window, (r) => r[field]) / totalMatches) * 100 : null);
    gw.homeWinPct_rolling = share('homeWins');
    gw.drawPct_rolling = share('draws');
    gw.awayWinPct_rolling = share('awayWins');
  });
}

/* ---------- 3. build the series ---------- */

function buildSeries(rows) {
  const gameweeks = buildGameweekTable(rows);
  if (gameweeks.length === 0) return [];

  addRollingAverages(gameweeks);

  const firstSeason = gameweeks[0].season;
  return gameweeks.filter((gw) => gw.season !== firstSeason);
}

/* ---------- 4a. extras drawn on top of the chart (the plugin) ---------- */

const seasonLabel = (season) => `${season}/${season + 1}`;

/** [{ season, index }] — where each season starts along the x axis. */
function getSeasonStarts(seasons) {
  const starts = [];
  seasons.forEach((season, index) => {
    if (index === 0 || season !== seasons[index - 1]) starts.push({ season, index });
  });
  return starts;
}

const pixelX = (chart, index) => chart.scales.x.getPixelForValue(index);

/** Left and right pixel edge of season number k. */
function getBandEdges(chart, starts, k) {
  const { left, right } = chart.chartArea;
  return {
    x0: k === 0 ? left : pixelX(chart, starts[k].index),
    x1: k === starts.length - 1 ? right : pixelX(chart, starts[k + 1].index),
  };
}

/** Light shading behind every other season. */
function drawSeasonBands(chart, options) {
  const { ctx, chartArea } = chart;
  const starts = getSeasonStarts(options.seasons);

  ctx.save();
  ctx.fillStyle = COLORS.band;
  starts.forEach((start, k) => {
    if (k % 2 !== 0) return;
    const { x0, x1 } = getBandEdges(chart, starts, k);
    ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
  });
  ctx.restore();
}

/** Season names under the chart. Only as many as fit, always including the latest. */
function drawSeasonLabels(chart, options) {
  const { ctx, chartArea } = chart;
  const starts = getSeasonStarts(options.seasons);

  ctx.save();
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const bandWidth = (chartArea.right - chartArea.left) / starts.length;
  const step = Math.max(1, Math.ceil((ctx.measureText('25/26').width + 6) / bandWidth));

  for (let k = starts.length - 1; k >= 0; k -= step) {
    const { x0, x1 } = getBandEdges(chart, starts, k);
    ctx.fillText(seasonLabel(starts[k].season), (x0 + x1) / 2, chartArea.bottom + 5);
  }
  ctx.restore();
}

/** Dashed line at the average of everything plotted (drawn under the data line). */
function drawAverageLine(chart, options) {
  if (options.average == null) return;

  const { ctx, chartArea } = chart;
  const y = chart.scales.y.getPixelForValue(options.average);
  if (y < chartArea.top || y > chartArea.bottom) return;

  ctx.save();
  ctx.strokeStyle = COLORS.muted;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(chartArea.left, y);
  ctx.lineTo(chartArea.right, y);
  ctx.stroke();
  ctx.restore();
}

/** The "avg 2.86" label at the left of the line. It sits on whichever side of the
 *  line the data isn't, so it covers as little of the data as possible. */
function drawAverageLabel(chart, options) {
  if (options.average == null) return;

  const { ctx, chartArea } = chart;
  const lineY = chart.scales.y.getPixelForValue(options.average);
  if (lineY < chartArea.top || lineY > chartArea.bottom) return;

  const text = `avg ${options.format(options.average)}`;

  ctx.save();
  ctx.font = `11px ${FONT}`;
  const labelWidth = ctx.measureText(text).width + 8;

  // Average height of the data line underneath the label.
  const underLabel = chart.getDatasetMeta(0).data.filter((p) => p.x <= chartArea.left + labelWidth);
  const dataY = underLabel.length ? underLabel.reduce((sum, p) => sum + p.y, 0) / underLabel.length : lineY;
  const dataIsAbove = dataY < lineY;

  const labelY = dataIsAbove ? lineY + 13 : lineY - 4;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fillRect(chartArea.left + 2, labelY - 11, labelWidth - 2, 14);
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'left';
  ctx.fillText(text, chartArea.left + 4, labelY);
  ctx.restore();
}

/** A ring and label on the highest point (single-line charts only). */
function drawPeak(chart, options) {
  const lastIndex = options.seasons.length - 1;
  if (options.peakIndex == null || options.peakIndex === lastIndex) return; // end label already covers it

  const { ctx, chartArea } = chart;
  const point = chart.getDatasetMeta(0).data[options.peakIndex];
  const value = chart.data.datasets[0].data[options.peakIndex];

  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.ring;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = COLORS.line;
  ctx.stroke();

  // Label goes on whichever side has more room.
  const onRightHalf = point.x > (chartArea.left + chartArea.right) / 2;
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = onRightHalf ? 'right' : 'left';
  const text = `Peak ${options.format(value)} · ${seasonLabel(options.seasons[options.peakIndex])}`;
  ctx.fillText(text, point.x + (onRightHalf ? -7 : 7), Math.max(chartArea.top + 11, point.y - 8));
  ctx.restore();
}

/** A dot on the last point of every line, with its value beside it. */
function drawEndLabels(chart, options) {
  const { ctx } = chart;
  const last = options.seasons.length - 1;
  const isMulti = chart.data.datasets.length > 1;

  const ends = chart.data.datasets.map((dataset, i) => {
    const point = chart.getDatasetMeta(i).data[last];
    return { x: point.x, y: point.y, labelY: point.y, color: dataset.borderColor, text: options.format(dataset.data[last]) };
  });

  // Nudge labels apart so they don't overlap (when lines finish close together).
  const MIN_GAP = 14;
  const byHeight = [...ends].sort((a, b) => a.y - b.y);
  for (let i = 1; i < byHeight.length; i++) {
    byHeight[i].labelY = Math.max(byHeight[i].labelY, byHeight[i - 1].labelY + MIN_GAP);
  }

  ctx.save();
  ends.forEach((end) => {
    ctx.beginPath();
    ctx.arc(end.x, end.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.ring;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(end.x, end.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = end.color;
    ctx.fill();

    // With several lines, a small colour dot links each label to its line.
    if (isMulti) {
      ctx.beginPath();
      ctx.arc(end.x + 12, end.labelY, 3, 0, Math.PI * 2);
      ctx.fillStyle = end.color;
      ctx.fill();
    }

    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(end.text, end.x + (isMulti ? 19 : 11), end.labelY);
  });
  ctx.restore();
}

const trendDecor = {
  id: 'trendDecor',
  beforeDraw(chart, args, options) { drawSeasonBands(chart, options); },
  beforeDatasetsDraw(chart, args, options) { drawAverageLine(chart, options); },
  afterDatasetsDraw(chart, args, options) { drawAverageLabel(chart, options); drawPeak(chart, options); drawEndLabels(chart, options); },
  afterDraw(chart, args, options) { drawSeasonLabels(chart, options); },
};

/* ---------- 4b. drawing the charts ---------- */

/**
 * Draws (or redraws) one chart.
 *   datasets  [{ label, data, color, dash? }]
 *   format    how a value reads on the chart, e.g. v => v.toFixed(2)
 *   extras    { average, peakIndex }  both optional
 *   tickFormat  how a y-axis label reads (defaults to `format`)
 *   stepSize  fixed gap between y-axis gridlines (omit to let Chart.js choose)
 *   maxTicks  most y-axis labels to show
 */
function drawChart(key, series, datasets, { format, tickFormat = format, extras = {}, showLegend = false, maxTicks = 4, stepSize }) {
  const canvas = document.getElementById('trendChart-' + key);
  if (!canvas) return;

  if (chartInstances[key]) chartInstances[key].destroy();

  const seasons = series.map((p) => p.season);

  chartInstances[key] = new Chart(canvas, {
    type: 'line',
    plugins: [trendDecor],
    data: {
      labels: series.map((p) => `${seasonLabel(p.season)} GW${p.gw}`),
      datasets: datasets.map(({ label, data, color, dash }) => ({
        label, data,
        borderColor: color,
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: dash ?? [],
        borderJoinStyle: 'round',
        tension: 0.25,
        pointRadius: 0,
        pointHoverRadius: 4,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      // Room on the right for the end labels, and underneath for the season names.
      layout: { padding: { right: datasets.length > 1 ? 62 : 54, bottom: 22, top: 6 } },
      plugins: {
        legend: showLegend
          ? { display: true, position: 'top', align: 'start', labels: { boxWidth: 16, padding: 8, font: { size: 11, family: FONT }, color: COLORS.muted } }
          : { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const point = series[items[0].dataIndex];
              return `${seasonLabel(point.season)} · GW${point.gw}`;
            },
            label: (item) => `${item.dataset.label}: ${format(item.parsed.y)}`,
          },
        },
        trendDecor: { seasons, format, ...extras },
      },
      scales: {
        x: { display: false },
        y: {
          grace: '8%',
          grid: { color: COLORS.grid },
          border: { display: false },
          ticks: {
            maxTicksLimit: maxTicks,
            ...(stepSize ? { stepSize } : {}),
            color: COLORS.muted,
            font: { size: 11, family: FONT },
            callback: (v) => tickFormat(v),
          },
        },
      },
    },
  });
}

/* ---------- 4c. card headlines ---------- */

/**
 * Fills a card's big number and its change since a season ago
 * (38 gameweeks earlier, the same window the chart averages over).
 * `inPoints` shows the change as percentage points instead of a percentage.
 */
function renderHeadline(key, values, format, { inPoints = false } = {}) {
  const numEl = document.getElementById('trendNum-' + key);
  const deltaEl = document.getElementById('trendDelta-' + key);
  if (!numEl || !deltaEl) return;

  if (values.length === 0) {
    numEl.textContent = '–';
    deltaEl.innerHTML = '';
    return;
  }

  const latest = values[values.length - 1];
  const seasonAgo = values[values.length - 1 - ROLLING_WINDOW]; // undefined if there isn't a season of history
  numEl.textContent = format(latest);

  let change = null; // { dir, text }
  if (seasonAgo !== undefined && inPoints) {
    const diff = latest - seasonAgo;
    change = { dir: diff > 0.05 ? 'up' : diff < -0.05 ? 'down' : 'flat', text: `${Math.abs(diff).toFixed(1)} pts` };
  } else if (seasonAgo !== undefined && trendDirection(latest, seasonAgo)) {
    const trend = trendDirection(latest, seasonAgo);
    change = { dir: trend.dir, text: `${Math.abs(trend.pct).toFixed(1)}%` };
  }

  if (!change) {
    deltaEl.innerHTML = `<span class="trend flat">no prior season</span>`;
    return;
  }

  const arrow = change.dir === 'up' ? '▲' : change.dir === 'down' ? '▼' : '▬';
  deltaEl.innerHTML = `<span class="trend ${change.dir}">${arrow} ${change.text}</span><span class="trend-sub">vs a season ago</span>`;
}

/* ---------- public ---------- */

export async function renderTrendChart() {
  const rows = await getResults(state.competition);
  const series = buildSeries(rows);

  // Single-line charts
  SINGLE_LINE_CHARTS.forEach(({ key, label, decimals, axisDecimals = decimals, stepSize }) => {
    const values = series.map((p) => p[`${key}_rolling`]);
    const format = (v) => v.toFixed(decimals);
    const tickFormat = (v) => v.toFixed(axisDecimals);

    // Average of everything plotted, and where the highest point is.
    const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const peakIndex = values.length ? values.indexOf(Math.max(...values)) : null;

    drawChart(key, series, [{ label, data: values, color: COLORS.line }], {
      format,
      tickFormat,
      stepSize,
      maxTicks: stepSize ? 6 : 4, // fixed steps can give 5 or 6 lines; don't let Chart.js thin them out
      extras: { average, peakIndex },
    });
    renderHeadline(key, values, format);
  });

  // Home advantage: three lines. Dashes as well as colour, so they can be told apart without colour.
  const homeWin = series.map((p) => p.homeWinPct_rolling);
  const percent = (v) => `${v.toFixed(1)}%`;

  drawChart(
    'home_advantage',
    series,
    [
      { label: 'Home win', data: homeWin, color: COLORS.homeWin },
      { label: 'Away win', data: series.map((p) => p.awayWinPct_rolling), color: COLORS.awayWin, dash: [5, 3] },
      { label: 'Draw', data: series.map((p) => p.drawPct_rolling), color: COLORS.draw, dash: [2, 3] },
    ],
    { format: percent, tickFormat: (v) => `${v.toFixed(0)}%`, showLegend: true, maxTicks: 6 }
  );
  renderHeadline('home_advantage', homeWin, percent, { inPoints: true });
}

/** Keeps the charts the right size on window resize / phone rotation. */
export function initTrendChart() {
  let resizeTimeout;
  function scheduleResize(delay = 150) {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      Object.values(chartInstances).forEach((chart) => chart.resize());
    }, delay);
  }
  window.addEventListener('resize', () => scheduleResize(150));
  window.addEventListener('orientationchange', () => scheduleResize(200));
}
