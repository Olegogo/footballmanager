import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getComparableStatValues,
  getPositionBenchmarkGroup,
  getProfileStatBenchmark
} from '../src/lib/profile-benchmark.js';

function peer(id, position, shooting, overrides = {}) {
  return {
    id,
    position,
    ratedGames: 1,
    stats: { shooting },
    ...overrides
  };
}

test('position benchmark groups neighboring roles together', () => {
  assert.equal(getPositionBenchmarkGroup('CB'), 'defense');
  assert.equal(getPositionBenchmarkGroup('CM'), 'midfield');
  assert.equal(getPositionBenchmarkGroup('ST'), 'attack');
  assert.equal(getPositionBenchmarkGroup('N/A'), '');
});

test('comparison excludes the viewer, other roles, and fallback-only player cards', () => {
  const players = [
    peer('viewer', 'CM', 90),
    peer('midfielder', 'CAM', 70),
    peer('forward', 'ST', 80),
    peer('fallback', 'CDM', 50, { ratedGames: 0, hasSelfProfile: false })
  ];

  assert.deepEqual(getComparableStatValues(players, {
    viewerPlayerId: 'viewer',
    position: 'CM',
    statKey: 'shooting'
  }), [70]);
});

test('benchmark reports below average and top-percent labels from peers', () => {
  const belowAveragePeers = [40, 50, 60].map((value, index) => peer(`m${index}`, 'CM', value));
  assert.equal(getProfileStatBenchmark(belowAveragePeers, {
    position: 'CAM',
    statKey: 'shooting',
    value: 47
  }).kind, 'below_average');

  const topPeers = [
    ...Array.from({ length: 6 }, (_, index) => peer(`high${index}`, 'ST', 80)),
    ...Array.from({ length: 13 }, (_, index) => peer(`low${index}`, 'LW', 50))
  ];
  assert.deepEqual(getProfileStatBenchmark(topPeers, {
    position: 'RW',
    statKey: 'shooting',
    value: 71
  }), { kind: 'top', peerCount: 19, topPercent: 35 });
});

test('benchmark avoids a comparison when there are too few peers', () => {
  const result = getProfileStatBenchmark([
    peer('one', 'CB', 50),
    peer('two', 'LB', 60)
  ], {
    position: 'RB',
    statKey: 'shooting',
    value: 70
  });

  assert.deepEqual(result, { kind: 'insufficient_data', peerCount: 2 });
});
