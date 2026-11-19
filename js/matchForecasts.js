/*
  matchForecasts.js
  Match Forecast tab, with two layouts switched by the Table | Score Matrix
  toggle (table first):
    Table         the next gameweek's fixtures, one row per team (forecastTable.js)
    Score Matrix  pick a match from the dropdown and see its score
  probabilities as a heat map, two bar charts (each team's chance of
  scoring N goals) and a home win / draw / away win summary box.

  Data: data/score_matrix.json (via getScoreMatrices) plus team names
  from teams.json. Everything is drawn with D3 into one SVG.

  How the chart is laid out (it reads like a football score grid):
    - heat map columns (left to right)  = HOME goals, bars along the top
    - heat map rows    (top to bottom)  = AWAY goals, bars down the left
    - summary box (top left): home win in the top-right triangle,
      away win in the bottom-left triangle, draws on the diagonal
*/

import { state } from './state.js';
import { getTeamLogoURL } from './utils.js';
import { getScoreMatrices, getTeamsById } from './leagueData.js';
import { bindSegmented } from './ui.js';
import { initForecastTable, renderForecastTable, showForecastTableError } from './forecastTable.js';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

const HOME_COLOR = '#D6A24C'; // gold (--gold)
const AWAY_COLOR = '#0072B2'; // blue (--pos, colorblind-safe)
const HEAT_COLOR = '#1B3A2B'; // darkest heat map cell (--pitch)

const GOALS_SHOWN = 5;                          // 0, 1, 2, 3 and "4 or more"
const AXIS_LABELS = ['0', 1, 2, 3, '4+'];
const BAND_LABELS = ['0 goals', '1', '2', '3', '4+'];

let fixtures = [];           // the matches in the dropdown
let currentFixtureId = null; // the match currently drawn
let view = 'table';           // 'table' | 'matrix'

/* ---------- helpers ---------- */

/** Black or white text, whichever is readable on this background colour. */
function getTextColor(bgColor) {
  const c = d3.color(bgColor);
  if (!c) return '#201D18';
  const rgb = c.rgb();
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.6 ? '#201D18' : '#ffffff';
}

/** 0.234 -> "23%", anything under 1% -> "<1%". */
function formatPercent(probability) {
  return probability < 0.01 ? '<1%' : `${Math.round(probability * 100)}%`;
}

/** Goals beyond 4 are all counted in the "4+" bucket. */
function goalBucket(goals) {
  return Math.min(goals, GOALS_SHOWN - 1);
}

/* ---------- 1. prepare the numbers ---------- */

/** matrix[home][away] -> everything the chart needs. */
function prepareData(matrix) {
  const size = matrix.length;

  // heatMap[awayBucket][homeBucket]: the 7x7 grid squeezed into 5x5.
  const heatMap = Array.from({ length: GOALS_SHOWN }, () => Array(GOALS_SHOWN).fill(0));
  const homeGoalsProb = Array(GOALS_SHOWN).fill(0); // chance the home team scores 0, 1, 2, 3, 4+
  const awayGoalsProb = Array(GOALS_SHOWN).fill(0); // chance the away team scores 0, 1, 2, 3, 4+
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  for (let home = 0; home < size; home++) {
    for (let away = 0; away < size; away++) {
      const probability = matrix[home][away];

      heatMap[goalBucket(away)][goalBucket(home)] += probability;
      homeGoalsProb[goalBucket(home)] += probability;
      awayGoalsProb[goalBucket(away)] += probability;

      if (home > away) homeWin += probability;
      else if (home === away) draw += probability;
      else awayWin += probability;
    }
  }

  return { heatMap, homeGoalsProb, awayGoalsProb, homeWin, draw, awayWin };
}

/* ---------- 2. layout ---------- */

/** All the sizes, derived from the container width so the chart scales. */
function getLayout(containerWidth) {
  const cellSize = containerWidth / (GOALS_SHOWN + 4);

  const paddingTop = cellSize * 0.75;
  const paddingBottom = cellSize * 0.6;
  const paddingLeft = cellSize * 1.25;
  const paddingRight = cellSize * 0.5;

  const barChartSize = cellSize * 1.75;
  const gap = cellSize * 0.75;
  const barThickness = cellSize * 0.4;

  return {
    cellSize,
    paddingLeft,
    barChartSize,
    gap,
    barThickness,
    barOffset: (cellSize - barThickness) / 2,
    matrixOffset: paddingLeft + barChartSize + gap, // where the heat map starts (x and y)
    svgWidth: GOALS_SHOWN * cellSize + paddingLeft + paddingRight + barChartSize + gap,
    svgHeight: GOALS_SHOWN * cellSize + paddingTop + paddingBottom + barChartSize + gap,
    fontSize: {
      tick: cellSize * 0.16,
      matrixLabel: cellSize * 0.2,
      barLabel: cellSize * 0.16,
      summaryLabel: cellSize * 0.16,
      summaryAxisTitle: cellSize * 0.12,
      barHeader: cellSize * 0.17,
      title: cellSize * 0.32,
      subtitle: cellSize * 0.2,
    },
  };
}

/* ---------- 3. title above the chart ---------- */

function drawTitle(fixture, layout) {
  const { cellSize, fontSize } = layout;
  const logoSize = cellSize * 0.4;
  const date = d3.timeFormat('%d %B %Y')(new Date(fixture.match_date));

  const logo = (team) =>
    `<img src="${getTeamLogoURL(team.id)}" alt="${team.name} logo" class="match-forecasts__team-logo-title" style="width:${logoSize}px; height:${logoSize}px;" />`;

  d3.select('.match-forecasts-matrix-header').html(`
    <div class="match-forecasts__title" style="font-size:${fontSize.title}px;">
      ${logo(fixture.home)}
      ${fixture.home.name.toUpperCase()}
      <span class="match-forecasts__title">VS.</span>
      ${logo(fixture.away)}
      ${fixture.away.name.toUpperCase()}
    </div>
    <div class="match-forecasts__sub-title" style="font-size:${fontSize.subtitle}px;">
      Pre-Match Forecast | Gameweek ${fixture.gw} | ${date}
    </div>
  `);
}

/* ---------- 4. heat map ---------- */

function drawHeatMap(svg, data, layout) {
  const { cellSize, matrixOffset, fontSize } = layout;
  const size = GOALS_SHOWN * cellSize;

  const colorScale = d3
    .scaleLinear()
    .domain([0.025, d3.max(data.heatMap.flat())])
    .range(['#fff', HEAT_COLOR]);

  const group = svg.append('g').attr('transform', `translate(${matrixOffset}, ${matrixOffset})`);

  // coloured cells
  data.heatMap.forEach((rowValues, row) => {
    const rowGroup = group.append('g').attr('transform', `translate(0, ${row * cellSize})`);
    rowValues.forEach((value, col) => {
      rowGroup.append('rect')
        .attr('x', col * cellSize)
        .attr('width', cellSize)
        .attr('height', cellSize)
        .attr('stroke', '#cccccc')
        .attr('stroke-width', 0.25)
        .attr('fill', colorScale(value));
    });
  });

  // thick outline on the diagonal (the draws)
  data.heatMap.forEach((rowValues, i) => {
    group.append('rect')
      .attr('class', 'diagonal-border')
      .attr('x', i * cellSize)
      .attr('y', i * cellSize)
      .attr('width', cellSize)
      .attr('height', cellSize)
      .attr('fill', 'none')
      .attr('stroke', 'black')
      .attr('stroke-width', 1.25);
  });

  // outline around the whole grid
  group.append('rect')
    .attr('width', size)
    .attr('height', size)
    .attr('fill', 'none')
    .attr('stroke', 'black')
    .attr('stroke-width', 1.5);

  // percentage in each cell
  data.heatMap.forEach((rowValues, row) => {
    const rowGroup = group.append('g').attr('transform', `translate(0, ${row * cellSize})`);
    rowValues.forEach((value, col) => {
      rowGroup.append('text')
        .attr('x', col * cellSize + cellSize / 2)
        .attr('y', cellSize / 2)
        .attr('dy', '.35em')
        .attr('text-anchor', 'middle')
        .attr('class', 'match-forecasts__matrix-label')
        .attr('font-size', fontSize.matrixLabel)
        .style('fill', getTextColor(colorScale(value)))
        .text(formatPercent(value));
    });
  });
}

/* ---------- 5. axes ---------- */

/** The 0, 1, 2, 3, 4+ labels just outside the heat map. */
function drawGoalLabels(svg, layout, orientation, transform) {
  const { cellSize, fontSize } = layout;

  svg.append('g')
    .attr('transform', transform)
    .selectAll('text')
    .data(AXIS_LABELS)
    .enter()
    .append('text')
    .attr('class', 'match-forecasts__tick-label')
    .attr('font-size', fontSize.tick)
    .attr(orientation === 'x' ? 'x' : 'y', (d, i) => i * cellSize + cellSize / 2)
    .attr(orientation === 'x' ? 'y' : 'x', -5)
    .attr('text-anchor', orientation === 'x' ? 'middle' : 'end')
    .attr('alignment-baseline', 'middle')
    .text((d) => d);
}

/** One D3 axis, restyled to show only light grid lines and small labels. */
function drawAxis(svg, layout, { scale, orientation, ticks, tickFormat, size, transform }) {
  let axis;
  if (orientation === 'left') axis = d3.axisLeft(scale);
  else if (orientation === 'bottom') axis = d3.axisBottom(scale);
  else if (orientation === 'top') axis = d3.axisTop(scale);

  if (ticks !== undefined) axis.ticks(ticks);
  if (size !== undefined) axis.tickSize(size);
  if (tickFormat !== undefined) axis.tickFormat(tickFormat);

  svg.append('g')
    .attr('transform', transform)
    .call(axis)
    .call((g) => g.selectAll('.tick line').attr('stroke', '#ccc'))
    .call((g) => g.selectAll('path').remove())
    .call((g) => g.selectAll('text').classed('match-forecasts__tick-label', true))
    .call((g) => g.selectAll('text').attr('font-size', layout.fontSize.tick));
}

function drawAxes(svg, layout) {
  const { cellSize, paddingLeft, barChartSize, matrixOffset } = layout;

  const percentScale = d3.scaleLinear().domain([0, 1]).range([barChartSize, 0]);
  const goalScale = d3.scaleBand().domain(BAND_LABELS).range([0, cellSize * GOALS_SHOWN]);
  const percent = d3.format('.0%');

  drawGoalLabels(svg, layout, 'x', `translate(${matrixOffset}, ${matrixOffset - 5})`);
  drawGoalLabels(svg, layout, 'y', `translate(${matrixOffset - 5}, ${matrixOffset})`);

  // percentage grid lines behind the two bar charts
  drawAxis(svg, layout, { scale: percentScale, orientation: 'left', ticks: 2, tickFormat: percent, size: -GOALS_SHOWN * cellSize, transform: `translate(${matrixOffset - 4}, ${paddingLeft})` });
  drawAxis(svg, layout, { scale: percentScale, orientation: 'top', ticks: 2, tickFormat: percent, size: GOALS_SHOWN * cellSize, transform: `translate(${paddingLeft}, ${matrixOffset + GOALS_SHOWN * cellSize + 4})` });

  // goal-count lines through the bar charts
  drawAxis(svg, layout, { scale: goalScale, orientation: 'top', tickFormat: (d) => d, size: -barChartSize * 1.1, transform: `translate(${matrixOffset}, ${paddingLeft - 6})` });
  drawAxis(svg, layout, { scale: goalScale, orientation: 'left', tickFormat: (d) => d, size: -barChartSize * 1.1, transform: `translate(${paddingLeft - 6}, ${matrixOffset})` });
}

/* ---------- 6. bar charts ---------- */

/** A percentage label with a white outline so it stays readable over grid lines. */
function drawBarLabel(group, { x, y, anchor, text, fontSize, outline }) {
  const label = group.append('text')
    .attr('x', x)
    .attr('y', y)
    .attr('text-anchor', anchor)
    .attr('class', 'match-forecasts__bar-label')
    .attr('font-size', fontSize);

  if (outline) {
    label.style('stroke', 'white').style('stroke-width', 3.5).style('paint-order', 'stroke').style('fill', 'none');
  } else {
    label.style('fill', '#201D18');
  }
  label.text(text);
}

/**
 * Bars for a set of 5 probabilities.
 *   'vertical'   bars rise from the baseline (the chart above the heat map)
 *   'horizontal' bars run right to left (the chart beside the heat map)
 */
function drawBars(svg, layout, { data, orientation, transform, color }) {
  const { cellSize, barChartSize, barOffset, barThickness, fontSize } = layout;
  const scale = d3.scaleLinear().domain([0, 1]).range([barChartSize, 0]);
  const group = svg.append('g').attr('transform', transform);

  const isVertical = orientation === 'vertical';

  // bars
  data.forEach((value, i) => {
    const bar = group.append('rect');
    if (isVertical) {
      bar.attr('x', i * cellSize + barOffset).attr('width', barThickness)
        .attr('y', scale(value)).attr('height', barChartSize - scale(value));
    } else {
      bar.attr('y', i * cellSize + barOffset).attr('height', barThickness)
        .attr('x', scale(value)).attr('width', barChartSize - scale(value));
    }
    bar.attr('fill', color);
  });

  // labels: the white outline versions first, then the dark text on top
  [true, false].forEach((outline) => {
    data.forEach((value, i) => {
      drawBarLabel(group, {
        x: isVertical ? i * cellSize + cellSize / 2 : scale(value) - 6,
        y: isVertical ? scale(value) - 4 : i * cellSize + cellSize / 2 + 4,
        anchor: isVertical ? 'middle' : 'end',
        text: formatPercent(value),
        fontSize: fontSize.barLabel,
        outline,
      });
    });
  });
}

function drawBarCharts(svg, data, layout) {
  const { paddingLeft, matrixOffset } = layout;

  // above the heat map: how likely the HOME team is to score 0, 1, 2, 3, 4+
  drawBars(svg, layout, {
    data: data.homeGoalsProb,
    orientation: 'vertical',
    transform: `translate(${matrixOffset}, ${paddingLeft})`,
    color: HOME_COLOR,
  });

  // beside the heat map: how likely the AWAY team is to score 0, 1, 2, 3, 4+
  drawBars(svg, layout, {
    data: data.awayGoalsProb,
    orientation: 'horizontal',
    transform: `translate(${paddingLeft}, ${matrixOffset})`,
    color: AWAY_COLOR,
  });
}

/* ---------- 7. win / draw / loss summary box ---------- */

function drawSummary(svg, data, layout) {
  const { paddingLeft, barChartSize, fontSize } = layout;
  const cell = barChartSize / GOALS_SHOWN;

  const group = svg.append('g').attr('transform', `translate(${paddingLeft}, ${paddingLeft})`);

  function drawCell(row, col, fill, stroke, opacity) {
    const rect = group.append('rect')
      .attr('x', col * cell)
      .attr('y', row * cell)
      .attr('width', cell)
      .attr('height', cell)
      .attr('fill', fill);
    if (stroke) rect.attr('stroke', stroke.color).attr('stroke-width', stroke.width);
    if (opacity) rect.attr('fill-opacity', opacity);
  }

  // white background grid
  for (let row = 0; row < GOALS_SHOWN; row++) {
    for (let col = 0; col < GOALS_SHOWN; col++) {
      drawCell(row, col, 'white', { color: 'white', width: 0.5 });
    }
  }
  // draws: the diagonal
  for (let i = 0; i < GOALS_SHOWN; i++) {
    drawCell(i, i, 'white', { color: 'black', width: 0.5 });
  }
  // home wins: the top-right triangle (home goals > away goals)
  for (let row = 0; row < GOALS_SHOWN; row++) {
    for (let col = row + 1; col < GOALS_SHOWN; col++) {
      drawCell(row, col, HOME_COLOR, null, 0.75);
    }
  }
  // away wins: the bottom-left triangle
  for (let row = 1; row < GOALS_SHOWN; row++) {
    for (let col = 0; col < row; col++) {
      drawCell(row, col, AWAY_COLOR, null, 0.75);
    }
  }

  // percentages, roughly in the middle of each region
  const labelCell = {
    home: { x: Math.floor((GOALS_SHOWN + 1) / 2), y: Math.floor((GOALS_SHOWN - 2) / 2) },
    draw: { x: Math.floor(GOALS_SHOWN / 2), y: Math.floor(GOALS_SHOWN / 2) },
    away: { x: Math.floor((GOALS_SHOWN - 2) / 2), y: Math.floor((GOALS_SHOWN + 1) / 2) },
  };

  function addLabel(position, probability, whiteText) {
    group.append('text')
      .attr('x', position.x * cell + cell / 2)
      .attr('y', position.y * cell + cell / 2)
      .attr('text-anchor', 'middle')
      .attr('alignment-baseline', 'middle')
      .attr('class', 'match-forecasts__summary-label')
      .attr('font-size', fontSize.summaryLabel)
      .attr('fill', whiteText ? 'white' : '#201D18')
      .attr('font-weight', 'bold')
      .text(`${Math.round(probability * 100)}%`);
  }

  addLabel(labelCell.home, data.homeWin, true);
  addLabel(labelCell.draw, data.draw, false);
  addLabel(labelCell.away, data.awayWin, true);

  // axis titles
  group.append('text')
    .attr('x', -2.5)
    .attr('y', cell * GOALS_SHOWN)
    .attr('text-anchor', 'start')
    .attr('class', 'match-forecasts__summary-axis-title')
    .attr('fill', AWAY_COLOR)
    .attr('font-size', fontSize.summaryAxisTitle)
    .attr('transform', `rotate(-90, ${-2.5}, ${cell * GOALS_SHOWN})`)
    .text('Away Win Probability '.toUpperCase());

  group.append('text')
    .attr('x', cell * GOALS_SHOWN)
    .attr('y', -2.5)
    .attr('text-anchor', 'end')
    .attr('class', 'match-forecasts__summary-axis-title')
    .attr('fill', HOME_COLOR)
    .attr('font-size', fontSize.summaryAxisTitle)
    .text('Home Win Probability '.toUpperCase());

  // outline
  group.append('rect')
    .attr('width', GOALS_SHOWN * cell)
    .attr('height', GOALS_SHOWN * cell)
    .attr('fill', 'none')
    .attr('stroke', 'black')
    .attr('stroke-width', 0.5);
}

/* ---------- 8. chart headings ---------- */

function drawChartHeadings(svg, fixture, layout) {
  const { cellSize, paddingLeft, barChartSize, gap, matrixOffset, svgHeight, fontSize } = layout;

  // left of the heat map: the away team's goals
  const awayHeading = svg.append('text')
    .attr('class', 'match-forecasts__bar-header')
    .attr('font-size', fontSize.barHeader)
    .attr('x', paddingLeft * 0.5)
    .attr('y', (svgHeight - GOALS_SHOWN * cellSize) * 0.85);
  awayHeading.append('tspan').attr('x', paddingLeft * 0.5).attr('dy', 0).text('Likelihood of ');
  awayHeading.append('tspan').attr('fill', AWAY_COLOR).attr('font-weight', 'bold').text(`${fixture.away.short} `);
  awayHeading.append('tspan').text('scoring');
  awayHeading.append('tspan').attr('x', paddingLeft * 0.5).attr('dy', '1.2em').text('a given number of goals');

  // above the heat map: the home team's goals
  const homeHeading = svg.append('text')
    .attr('class', 'match-forecasts__bar-header')
    .attr('font-size', fontSize.barHeader)
    .attr('x', matrixOffset * 0.88)
    .attr('y', svgHeight - barChartSize - gap - GOALS_SHOWN * cellSize * 1.12);
  homeHeading.append('tspan').text('Likelihood of ');
  homeHeading.append('tspan').attr('fill', HOME_COLOR).attr('font-weight', 'bold').text(fixture.home.short + ' ');
  homeHeading.append('tspan').text('scoring a given number of goals');

  // above the heat map itself
  svg.append('text')
    .attr('class', 'match-forecasts__bar-header')
    .attr('x', matrixOffset)
    .attr('y', (svgHeight - GOALS_SHOWN * cellSize) * 0.87)
    .attr('font-size', fontSize.barHeader)
    .attr('font-weight', 'bold')
    .text('Final Score Probabilities');
}

/* ---------- drawing one match ---------- */

function drawMatchForecast(fixtureId) {
  const svg = d3.select('#match-forecasts-matrix');
  svg.selectAll('*').remove();

  const fixture = fixtures.find((f) => f.fixture_id === fixtureId);
  if (!fixture) return;

  const containerWidth = document.querySelector('.match-forecasts-container').getBoundingClientRect().width;
  const layout = getLayout(containerWidth);
  const data = prepareData(fixture.matrix);

  svg.attr('viewBox', `0 0 ${layout.svgWidth} ${layout.svgHeight}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  drawTitle(fixture, layout);
  drawHeatMap(svg, data, layout);
  drawAxes(svg, layout);
  drawBarCharts(svg, data, layout);
  drawSummary(svg, data, layout);
  drawChartHeadings(svg, fixture, layout);
}

/* ---------- loading and page wiring ---------- */

function showMessage(text) {
  d3.select('#match-forecasts-matrix').selectAll('*').remove();
  d3.select('.match-forecasts-matrix-header').html(`<div class="match-forecasts__sub-title">${text}</div>`);
}

/**
 * Draws the table and the score matrix. They load their data separately, so
 * they run side by side and fail separately: if one throws (bad or missing
 * data, say) the other still draws, and the failure is logged to the console
 * and shown in place of the part that failed.
 */
export async function renderMatchForecasts() {
  const [table, matrix] = await Promise.allSettled([renderForecastTable(), renderScoreMatrix()]);

  if (table.status === 'rejected') {
    console.error('Match Forecast table failed to draw:', table.reason);
    showForecastTableError();
  }
  if (matrix.status === 'rejected') {
    console.error('Score matrix failed to draw:', matrix.reason);
    currentFixtureId = null;
    showMessage('The score matrix could not be drawn (see the browser console).');
  }
}

/** Loads the matches for the selected competition, fills the dropdown and draws the first one. */
async function renderScoreMatrix() {
  const [matches, teamsById] = await Promise.all([getScoreMatrices(), getTeamsById()]);

  const toTeam = (id) => {
    const team = teamsById.get(id);
    const name = team?.team ?? `Team ${id}`;
    return { id, name, short: team?.team_short ?? '?' };
  };

  fixtures = matches.map((m) => ({
    fixture_id: m.fixture_id,
    gw: m.gw,
    match_date: m.match_date,
    matrix: m.matrix,
    home: toTeam(m.home_team_id),
    away: toTeam(m.away_team_id),
  }));

  const selector = document.getElementById('match-selector');
  selector.innerHTML = fixtures
    .map((f) => `<option value="${f.fixture_id}">${f.home.name} vs. ${f.away.name}</option>`)
    .join('');

  renderNote();

  if (fixtures.length === 0) {
    currentFixtureId = null;
    showMessage('No fixtures to forecast.');
    return;
  }

  currentFixtureId = fixtures[0].fixture_id;
  drawMatchForecast(currentFixtureId);
}

function renderNote() {
  const note = document.getElementById('forecastsNote');

  if (view === 'table') {
    note.textContent = `GW${state.gameweek + 1} · kickoff times are UK time · click a match to highlight it`;
    return;
  }

  const gameweeks = new Set(fixtures.map((f) => f.gw));
  const description = 'score matrix + outcome probabilities';
  let text = description;

  if (gameweeks.size === 1) text = `GW ${fixtures[0].gw} fixtures · ${description}`;
  else if (gameweeks.size > 1) text = `Upcoming fixtures · ${description}`;

  note.textContent = text;
}

/** Wires up the Table | Score Matrix toggle, the table, the dropdown and the resize redraw. Call once. */
export function initMatchForecasts() {
  initForecastTable();

  // The chart is sized from its container's width, so it redraws by itself
  // (see the resize observer below) when it becomes visible.
  bindSegmented('forecastView', (val) => {
    view = val;
    document.getElementById('forecastTableView').style.display = view === 'table' ? '' : 'none';
    document.getElementById('forecastMatrixView').style.display = view === 'matrix' ? '' : 'none';
    renderNote();
  });

  document.getElementById('match-selector').addEventListener('change', (e) => {
    currentFixtureId = Number(e.target.value);
    drawMatchForecast(currentFixtureId);
  });

  // The chart is sized from the container's width, so redraw when it changes.
  let resizeTimeout;
  new ResizeObserver(() => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (currentFixtureId != null) drawMatchForecast(currentFixtureId);
    }, 100);
  }).observe(document.querySelector('.match-forecasts-container'));
}
