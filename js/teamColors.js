/*
  teamColors.js
  Club colours, keyed by the lower-case team code (team_short in teams.json,
  e.g. "ars"). Only `primary` is used so far (the scatter's trend line);
  `secondary` and `alt` are here for later.
*/

const TEAM_COLORS = {
  ars: { primary: '#DB0007', secondary: '#063672', alt: '' },
  avl: { primary: '#670E36', secondary: '#95BFE5', alt: '' },
  bha: { primary: '#0057B8', secondary: '', alt: '' },
  bou: { primary: '#C8080E', secondary: '#000000', alt: '' },
  bre: { primary: '#e30613', secondary: '', alt: '' },
  bur: { primary: '#6C1D45', secondary: '#99D6EA', alt: '' },
  che: { primary: '#034694', secondary: '', alt: '#6A7AB5' },
  cry: { primary: '#1B458F', secondary: '#C4122E', alt: '' },
  cov: { primary: '#1F77B4', secondary: '', alt: '' },
  eve: { primary: '#003399', secondary: '', alt: '' },
  ful: { primary: '#000000', secondary: '#FFFFFF', alt: '' },
  hul: { primary: '#FF7F0E', secondary: '', alt: '' },
  ips: { primary: '#0D3D90', secondary: '', alt: '' },
  lee: { primary: '#1D428A', secondary: '#FFCD00', alt: '' },
  lei: { primary: '#003090', secondary: '', alt: '' },
  liv: { primary: '#C8102E', secondary: '#00B2A9', alt: '' },
  lut: { primary: '#F38D00', secondary: '', alt: '' },
  mci: { primary: '#6CABDD', secondary: '', alt: '' },
  mun: { primary: '#DA291C', secondary: '', alt: '' },
  new: { primary: '#241F20', secondary: '', alt: '' },
  nor: { primary: '#00A650', secondary: '#FFF200', alt: '' },
  nfo: { primary: '#EB0024', secondary: '', alt: '' },
  sou: { primary: '#D71920', secondary: '', alt: '' },
  sun: { primary: '#EA222B', secondary: '', alt: '' },
  tot: { primary: '#132257', secondary: '', alt: '' },
  wat: { primary: '#FBEE23', secondary: '#ED2127', alt: '' },
  whu: { primary: '#7A263A', secondary: '#1BB1E7', alt: '' },
  wol: { primary: '#FDB913', secondary: '', alt: '#231F20' },
};

const FALLBACK_PRIMARY = '#1B3A2B'; // the site's pitch green, for any club not listed

/** A team's primary colour from its code ("ARS" or "ars"). */
export function getTeamColor(teamShort) {
  return TEAM_COLORS[String(teamShort).toLowerCase()]?.primary ?? FALLBACK_PRIMARY;
}
