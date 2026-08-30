import assert from 'node:assert/strict';
import test from 'node:test';

import { getMaximumTeamCount, splitBalancedTeams } from '../src/lib/lineup.js';

function player(id, overall, position = 'CM') {
  return { id, displayName: id, overall, position };
}

test('splitBalancedTeams supports two to four balanced teams', () => {
  const players = Array.from({ length: 20 }, (_, index) => player(`p${index}`, 90 - index));

  for (const teamCount of [2, 3, 4]) {
    const teams = splitBalancedTeams(players, teamCount);
    const sizes = teams.map((team) => team.players.length);

    assert.equal(teams.length, teamCount);
    assert.equal(teams.flatMap((team) => team.players).length, players.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
  }
});

test('splitBalancedTeams spreads goalkeepers between teams first', () => {
  const players = [
    player('gk1', 80, 'GK'),
    player('gk2', 79, 'GK'),
    player('gk3', 78, 'GK'),
    player('gk4', 77, 'GK'),
    ...Array.from({ length: 16 }, (_, index) => player(`p${index}`, 70 - index))
  ];
  const teams = splitBalancedTeams(players, 4);

  assert.deepEqual(teams.map((team) => team.players.filter((item) => item.position === 'GK').length), [1, 1, 1, 1]);
});

test('team count requires at least five players per team', () => {
  assert.equal(getMaximumTeamCount(10), 2);
  assert.equal(getMaximumTeamCount(14), 2);
  assert.equal(getMaximumTeamCount(15), 3);
  assert.equal(getMaximumTeamCount(19), 3);
  assert.equal(getMaximumTeamCount(20), 4);

  const tenPlayers = Array.from({ length: 10 }, (_, index) => player(`p${index}`, 80 - index));
  assert.equal(splitBalancedTeams(tenPlayers, 4).length, 2);
});
