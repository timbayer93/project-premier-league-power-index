/*
  xgScatter.js
  Scatter chart on the Expected Goals tab: every team's attack against its
  defence over the window ("Last N matches", or "This season only").

    y axis   xG created per match   (higher is better, up)
    x axis   xG conceded per match  (lower is better, so the axis runs
                                     backwards: better is to the right)
    centre   the dashed cross is the league average, and the axes are
             centred on it, so the top-right is "better than average at both"
    scale    both axes cover the same range of values (the larger of the two
             needs), so a gap of 0.5 xG looks the same either way

  Each team is its logo on a circle ringed in the club's colour. Click a
  team to grey out the others and draw that team's trend in its club colour:
  a connected line of its average xG created and conceded as the window
  builds up (point by point, from the start of the window), so the line ends
  exactly on the team's dot. The line fades in towards the latest; hollow
  dot = the start. The axes zoom out smoothly to fit the line and back again
  when you deselect. Click the chart background, or the team again, to
  deselect.

  Needs, for each team: { team_id, team, team_short, color, xg, xga,
  sampleSize, trail: [{ xg, xga }] } (see expectedGoals.js).
*/

import { getTeamLogoURL } from './utils.js';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

const COLORS = {
  ink: '#201D18',
  muted: '#5A5548',
  grid: '#E8E1CC',
  circleFill: '#ffffff',
  dimmedRing: '#9A9382', // the ring of teams greyed out by a selection
  quadrant: '#D6336C', // the quadrant names (a pink for now; change it here)
};
const POINT_RADIUS = 15;
const LOGO_SIZE = 22;
const ZOOM_MS = 350;
const DOMAIN_PADDING = 1.2; // axes reach 20% past the furthest point
const GRID_OPACITY = 0.7;   // the gridlines (the tick labels keep full strength)
const TRAIL_WIDTH = 2.2;    // the selected team's line

// Names in the four corners, as two short lines so they fit on a phone.
// (Up is more xG created = stronger offense; right is less xG conceded = stronger defense.)
const QUADRANT_LABELS = {
  topRight: ['Strong offense', '& defense'],
  topLeft: ['Strong offense', '& weak defense'],
  bottomRight: ['Weak offense', '& strong defense'],
  bottomLeft: ['Weak offense', '& defense'],
};

let teams = [];             // the points currently shown
let selectedId = null;      // team_id of the selected team, or null
let hoverId = null;
let drawing = null;         // drawing handles (scales, selections) for the current render

/* ---------- numbers ---------- */

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

/** How far the furthest point is from `centre` (never zero). */
const maxDeviation = (values, centre) => Math.max(0.05, ...values.map((v) => Math.abs(v - centre)));

/**
 * The axes' ranges. Both axes cover exactly the same values: they are
 * centred on the league average and reach a little past the furthest point
 * on either axis. When a team is selected its trail is included too.
 */
function getDomains() {
  const league = { xg: mean(teams.map((t) => t.xg)), xga: mean(teams.map((t) => t.xga)) };
  const centre = (league.xg + league.xga) / 2; // the two league averages are almost identical

  const selected = teams.find((t) => t.team_id === selectedId);
  const values = teams.flatMap((t) => [t.xg, t.xga]);
  if (selected) values.push(...selected.trail.flatMap((p) => [p.xg, p.xga]));

  const half = maxDeviation(values, centre) * DOMAIN_PADDING;

  return {
    league,
    y: [centre - half, centre + half],
    x: [centre + half, centre - half], // reversed: low xG conceded is on the right
  };
}

/* ---------- layout ---------- */

function getLayout(width) {
  const narrow = width < 560;
  const margin = narrow
    ? { top: 14, right: 14, bottom: 46, left: 42 }
    : { top: 16, right: 24, bottom: 52, left: 56 };

  return {
    width,
    height: Math.round(Math.min(560, Math.max(380, width * 0.55))),
    margin,
    narrow,
  };
}

/* ---------- drawing ---------- */

/** Draws the whole chart from scratch (first draw, resize, or new data). */
function draw() {
  const container = document.getElementById('xgScatter');
  if (!container) return;
  container.innerHTML = '';
  if (teams.length === 0) return;

  const layout = getLayout(container.clientWidth || 600);
  const { width, height, margin } = layout;
  const domains = getDomains();

  const x = d3.scaleLinear().domain(domains.x).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain(domains.y).range([height - margin.bottom, margin.top]);

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('role', 'img')
    .attr('aria-label', 'Scatter chart of every team\'s xG created against xG conceded');

  // Clicking the background clears the selection.
  svg.append('rect').attr('width', width).attr('height', height).attr('fill', 'transparent')
    .on('click', () => select(null));

  const axes = svg.append('g');
  const xAxisG = axes.append('g').attr('transform', `translate(0, ${height - margin.bottom})`);
  const yAxisG = axes.append('g').attr('transform', `translate(${margin.left}, 0)`);

  const cross = svg.append('g').attr('pointer-events', 'none');
  const crossV = cross.append('line').attr('stroke', COLORS.muted).attr('stroke-dasharray', '4 4');
  const crossH = cross.append('line').attr('stroke', COLORS.muted).attr('stroke-dasharray', '4 4');
  const crossLabel = cross.append('text').attr('font-size', 11).attr('fill', COLORS.muted).text('league avg');

  // The quadrant names in the corners.
  const quads = svg.append('g').attr('pointer-events', 'none').attr('font-size', layout.narrow ? 11 : 13)
    .attr('fill', COLORS.quadrant).attr('font-weight', 600);
  // `firstY` is where the first line sits; the second line goes one line height below it.
  const lineHeight = layout.narrow ? 13 : 15;
  const q = (lines, px, firstY, anchor) => {
    const label = quads.append('text').attr('text-anchor', anchor);
    lines.forEach((line, i) => label.append('tspan').attr('x', px).attr('y', firstY + i * lineHeight).text(line));
  };
  q(QUADRANT_LABELS.topLeft, margin.left + 8, margin.top + 16, 'start');
  q(QUADRANT_LABELS.topRight, width - margin.right - 8, margin.top + 16, 'end');
  q(QUADRANT_LABELS.bottomLeft, margin.left + 8, height - margin.bottom - 8 - lineHeight, 'start');
  q(QUADRANT_LABELS.bottomRight, width - margin.right - 8, height - margin.bottom - 8 - lineHeight, 'end');

  // Axis titles
  svg.append('text').attr('x', (margin.left + width - margin.right) / 2).attr('y', height - 8).attr('text-anchor', 'middle')
    .attr('font-size', 12).attr('fill', COLORS.muted).text('xG conceded per match  (better →)');
  svg.append('text').attr('transform', `translate(14, ${(margin.top + height - margin.bottom) / 2}) rotate(-90)`).attr('text-anchor', 'middle')
    .attr('font-size', 12).attr('fill', COLORS.muted).text('xG created per match  (better →)');

  const trailG = svg.append('g').attr('pointer-events', 'none');

  const pointsG = svg.append('g');
  const points = pointsG.selectAll('g.xg-point').data(teams, (d) => d.team_id).join('g')
    .attr('class', 'xg-point')
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', (d) => `${d.team}: xG ${d.xg.toFixed(2)}, xG conceded ${d.xga.toFixed(2)}`)
    .style('cursor', 'pointer')
    .on('click', (event, d) => { event.stopPropagation(); select(d.team_id === selectedId ? null : d.team_id); })
    .on('keydown', (event, d) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(d.team_id === selectedId ? null : d.team_id); } })
    .on('mouseenter', (event, d) => { hoverId = d.team_id; d3.select(event.currentTarget).raise(); updateInfo(); })
    .on('mouseleave', () => { hoverId = null; updateInfo(); });

  points.append('circle').attr('r', POINT_RADIUS).attr('fill', COLORS.circleFill).attr('stroke', (d) => d.color).attr('stroke-width', 2);
  points.append('image').attr('href', (d) => getTeamLogoURL(d.team_id)).attr('width', LOGO_SIZE).attr('height', LOGO_SIZE)
    .attr('x', -LOGO_SIZE / 2).attr('y', -LOGO_SIZE / 2);
  points.append('title').text((d) => d.team);

  drawing = { x, y, layout, xAxisG, yAxisG, crossV, crossH, crossLabel, points, trailG };
  position(false);
  styleSelection();
  updateInfo();
}

/** Puts everything where the current scales say, optionally animating there. */
function position(animate) {
  const { x, y, layout, xAxisG, yAxisG, crossV, crossH, crossLabel, points, trailG } = drawing;
  const { width, height, margin } = layout;
  const domains = getDomains();
  x.domain(domains.x);
  y.domain(domains.y);

  const t = (selection) => (animate ? selection.transition().duration(ZOOM_MS) : selection);
  // Same number of ticks on both axes, so they land on the same values. Gridlines run both ways.
  const tickCount = layout.narrow ? 5 : 7;
  const xAxis = d3.axisBottom(x).ticks(tickCount).tickSize(-(height - margin.top - margin.bottom)).tickPadding(10).tickSizeOuter(0);
  const yAxis = d3.axisLeft(y).ticks(tickCount).tickSize(-(width - margin.left - margin.right)).tickPadding(8).tickSizeOuter(0);

  t(xAxisG).call(xAxis);
  t(yAxisG).call(yAxis);
  [xAxisG, yAxisG].forEach((g) => {
    g.selectAll('text').attr('font-size', 11).attr('fill', COLORS.muted);
    g.selectAll('.domain').remove();
  });
  [xAxisG, yAxisG].forEach((g) => g.selectAll('line').attr('stroke', COLORS.grid).attr('stroke-opacity', GRID_OPACITY));

  const cx = x(domains.league.xga);
  const cy = y(domains.league.xg);
  t(crossV).attr('x1', cx).attr('x2', cx).attr('y1', margin.top).attr('y2', height - margin.bottom);
  t(crossH).attr('x1', margin.left).attr('x2', width - margin.right).attr('y1', cy).attr('y2', cy);
  // On a phone the corner names reach almost to the middle, so the label drops below them.
  t(crossLabel).attr('x', cx + 5).attr('y', margin.top + (layout.narrow ? 50 : 11));

  t(points).attr('transform', (d) => `translate(${x(d.xga)}, ${y(d.xg)})`);

  // The selected team's trail (redrawn each time: its shape depends on the scales).
  // Straight segments that get thicker and darker towards the latest point,
  // so the direction of time reads at a glance.
  trailG.selectAll('*').remove();
  const selected = teams.find((tm) => tm.team_id === selectedId);
  if (selected && selected.trail.length > 1) {
    const trail = selected.trail;
    const lastSegment = Math.max(1, trail.length - 2);
    const colour = selected.color;

    trailG.selectAll('line').data(trail.slice(1)).join('line')
      .attr('x1', (d, i) => x(trail[i].xga)).attr('y1', (d, i) => y(trail[i].xg))
      .attr('x2', (d) => x(d.xga)).attr('y2', (d) => y(d.xg))
      .attr('stroke', colour).attr('stroke-linecap', 'round')
      .attr('stroke-width', TRAIL_WIDTH)
      .attr('opacity', (d, i) => 0.2 + 0.7 * (i / lastSegment));

    const start = trail[0];
    const end = trail[trail.length - 1];
    trailG.append('circle').attr('cx', x(start.xga)).attr('cy', y(start.xg)).attr('r', 4.5)
      .attr('fill', '#fff').attr('stroke', colour).attr('stroke-width', 2);
    trailG.append('circle').attr('cx', x(end.xga)).attr('cy', y(end.xg)).attr('r', 4.5).attr('fill', colour);

    if (animate) trailG.attr('opacity', 0).transition().duration(ZOOM_MS).attr('opacity', 1);
    else trailG.attr('opacity', 1);
  }
}

/** Greys out everyone except the selected team. */
function styleSelection() {
  drawing.points
    .classed('is-dim', (d) => selectedId !== null && d.team_id !== selectedId)
    .classed('is-selected', (d) => d.team_id === selectedId);
  drawing.points.filter((d) => d.team_id === selectedId).raise();
  // Every ring is the club's colour; a selection greys the others and thickens its own.
  drawing.points.select('circle')
    .attr('stroke', (d) => (selectedId !== null && d.team_id !== selectedId ? COLORS.dimmedRing : d.color))
    .attr('stroke-width', (d) => (d.team_id === selectedId ? 3.5 : 2));
}

/* ---------- the line of text above the chart ---------- */

function updateInfo() {
  const info = document.getElementById('xgScatterInfo');
  if (!info) return;

  const shown = teams.find((t) => t.team_id === (hoverId ?? selectedId));
  if (!shown) { info.textContent = 'Click a team to see how its xG created and conceded have moved'; return; }

  const diff = shown.xg - shown.xga;
  const signed = `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(2)}`;
  const suffix = shown.team_id === selectedId ? ' · line = running average, ending on the dot' : '';
  info.textContent = `${shown.team}: xG ${shown.xg.toFixed(2)} · xGA ${shown.xga.toFixed(2)} · xGD ${signed}${suffix}`;
}

/* ---------- public ---------- */

function select(teamId) {
  selectedId = teamId;
  if (!drawing) return;
  position(true);
  styleSelection();
  updateInfo();
}

/** Draws the chart for these teams (called by expectedGoals.js whenever its data changes). */
export function renderXgScatter(points) {
  teams = points.filter((p) => p.sampleSize > 0);
  if (!teams.some((t) => t.team_id === selectedId)) selectedId = null;
  draw();
}

/** Redraws when the chart's width changes. Call once. */
export function initXgScatter() {
  const container = document.getElementById('xgScatter');
  if (!container) return;

  let timeout;
  let lastWidth = 0;
  new ResizeObserver(() => {
    const width = container.clientWidth;
    if (width === lastWidth) return; // our own height changes don't need a redraw
    lastWidth = width;
    clearTimeout(timeout);
    timeout = setTimeout(draw, 100);
  }).observe(container);
}
