/*
  ownership.js
  Placeholder for the Ownership tab. The Team / Player toggle is wired
  up — this will eventually hold two tables (team-level and
  player-level ownership data).
*/

import { bindSegmented } from './ui.js';

const LABELS = {
  team: 'Team ownership — coming soon<br>work in progress',
  player: 'Player ownership — coming soon<br>work in progress',
};

export function initOwnership() {
  const note = document.getElementById('ownershipNote');
  note.innerHTML = LABELS.team;
  bindSegmented('ownershipView', (val) => {
    note.innerHTML = LABELS[val];
  });
}
