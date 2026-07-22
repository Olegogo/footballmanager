import assert from 'node:assert/strict';
import test from 'node:test';

import { renderLineupSvg } from '../src/lib/lineup-image.js';

function buildPlayer(position) {
  return {
    id: `player_${position}`,
    displayName: position,
    username: position.toLowerCase(),
    position,
    overall: 55,
    ratedGames: 1,
    photoUrl: ''
  };
}

async function getCardX(position) {
  const svg = await renderLineupSvg({ participants: [buildPlayer(position)] });
  const match = svg.match(/<g transform="translate\((-?\d+) (-?\d+)\)">/);

  assert.ok(match, 'player card transform should be rendered');
  return Number(match[1]);
}

test('lineup snapshot keeps extreme flank players inside the image', async () => {
  assert.equal(await getCardX('RW'), 45);
  assert.equal(await getCardX('LW'), 1005);
});
