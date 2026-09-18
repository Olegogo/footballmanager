import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFullFieldAssignments, getMaximumTeamCount, splitBalancedTeams } from '../src/lib/lineup.js';

function player(id, overall, position = 'CM') {
  return { id, displayName: id, overall, position };
}

test('match formations match the fixed five, six, seven and eight-player schemes', () => {
  const expected = {
    5: [[34,24],[34,76],[68,24],[68,76]],
    6: [[31,24],[31,76],[59,24],[59,76],[80,50]],
    7: [[27,24],[27,76],[51,15],[51,50],[51,85],[78,50]],
    8: [[27,24],[27,76],[51,15],[51,50],[51,85],[76,24],[76,76]]
  };
  for (const size of [5,6,7,8]) {
    const roster = [player('keeper',80,'GK'), ...Array.from({length:size-1},(_,i)=>player(`p${i}`,70))];
    const assigned = buildFullFieldAssignments(roster);
    assert.deepEqual(assigned[0].slot,{x:12,y:50});
    assert.deepEqual(assigned.slice(1).map(({slot})=>[slot.x,slot.y]).sort(), expected[size].sort());
    assert.deepEqual(buildFullFieldAssignments([...roster].reverse()),assigned);
  }
});

test('known positions take suitable sides and unknown players take vacant places', () => {
  const assigned = buildFullFieldAssignments([
    player('unknown',99,'N/A'), player('left',70,'LB'), player('right',70,'RB'),
    player('wing',70,'RW'), player('keeper',80,'GK')
  ]);
  const byId = Object.fromEntries(assigned.map((entry)=>[entry.player.id,entry.slot]));
  assert.deepEqual(byId.left,{x:34,y:24});
  assert.deepEqual(byId.right,{x:34,y:76});
  assert.deepEqual(byId.wing,{x:68,y:76});
  assert.deepEqual(byId.unknown,{x:68,y:24});
});

test('keepers never overflow into outfield and nobody is lost without a keeper or in large squads', () => {
  for (const size of [0,1,4,5,8,11,25]) {
    const roster = Array.from({length:size},(_,i)=>player(`p${i}`,70,i%2?'N/A':'CM'));
    const assigned = buildFullFieldAssignments(roster);
    assert.equal(assigned.length,size);
    assert.ok(assigned.every(({slot})=>slot.x>12));
    assert.equal(new Set(assigned.map(({slot})=>`${slot.x},${slot.y}`)).size,size);
  }
  const assigned = buildFullFieldAssignments([player('a',80,'GK'),player('b',70,'GK'),player('c',70)]);
  assert.ok(assigned.filter(({position})=>position==='GK').every(({slot})=>slot.x===12 && slot.y>=38 && slot.y<=62));
  const effective = buildFullFieldAssignments([{...player('override',80),currentGameStats:{hasRatings:true,position:'GK'}}]);
  assert.deepEqual(effective[0].slot,{x:12,y:50});
});

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
