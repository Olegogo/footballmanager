import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STAT_KEYS,
  buildChatSnapshot,
  buildGameAggregation,
  buildGameBoostAggregation,
  buildGlobalCareerIndex
} from '../src/lib/stats.js';

const PLAYER_IDS = ['strong', 'weak', 'neutral', 'target', 'other'];
const AFTER_GAMES = new Date('2026-06-30T00:00:00.000Z');

function stats(value) {
  return Object.fromEntries(STAT_KEYS.map((key) => [key, value]));
}

function fixture({ seeded = true } = {}) {
  const players = Object.fromEntries(PLAYER_IDS.map((id, index) => [id, {
    id,
    telegramUserId: index + 1,
    displayName: id,
    chatIds: ['-1001', '-1002'],
    defaultPosition: 'CM'
  }]));
  if (seeded) {
    players.strong.careerSeed = { ratedGames: 3, stats: stats(90), position: 'CM' };
    players.weak.careerSeed = { ratedGames: 3, stats: stats(10), position: 'CM' };
  }
  return {
    version: 1,
    meta: {},
    chats: Object.fromEntries(['-1001', '-1002'].map((id) => [id, {
      id, title: id, type: 'supergroup', playerIds: [...PLAYER_IDS], currentGameId: 'match'
    }])),
    players,
    games: {},
    ratings: {},
    statBoosts: {},
    mvpVotes: {},
    achievementVotes: {}
  };
}

function addGame(state, id = 'match', scheduledAt = '2026-06-10T18:00:00.000Z', chatId = '-1001') {
  state.games[id] = {
    id,
    chatId,
    scheduledAt,
    closedAt: new Date(new Date(scheduledAt).getTime() + 90 * 60 * 1000).toISOString(),
    playerIds: [...PLAYER_IDS],
    time: '18:00–19:30',
    dateLabel: '10 июня',
    paymentLines: [],
    priceLine: ''
  };
}

function addRating(state, gameId, raterPlayerId, targetPlayerId, value, extra = {}) {
  const id = `${gameId}:${raterPlayerId}:${targetPlayerId}`;
  state.ratings[id] = {
    id, gameId, chatId: state.games[gameId].chatId, raterPlayerId, targetPlayerId,
    ...stats(value), position: 'CM', goals: 0, assists: 0, ...extra
  };
}

function addQuickVote(state, raterPlayerId, targetPlayerId, { gameId = 'match', points = 3 } = {}) {
  const id = `${gameId}:${raterPlayerId}:${targetPlayerId}`;
  const vote = { id, gameId, raterPlayerId, targetPlayerId };
  state.statBoosts[id] = { ...vote, statKey: 'passing', points };
  state.mvpVotes[id] = { ...vote };
  state.achievementVotes[id] = { ...vote, achievementKey: 'goleador' };
}

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `expected ${actual} to equal ${expected}`);
}

test('full ratings give stronger authors more influence without weighting match facts', () => {
  const state = fixture();
  addGame(state);
  addRating(state, 'match', 'strong', 'target', 90, { goals: 4, assists: 2, yellowCards: 1 });
  addRating(state, 'match', 'weak', 'target', 10, { goals: 2, assists: 0, yellowCards: 2, redCards: 1 });

  const target = buildGameAggregation(state, 'match').players.target;
  assert.deepEqual(target.stats, stats(56));
  assert.equal(target.overall, 56);
  assert.equal(target.ratingsCount, 2);
  assert.equal(target.goals, 3);
  assert.equal(target.assists, 1);
  assert.deepEqual(target.cards, { yellow: 2, red: 1 });
  assert.equal(buildGlobalCareerIndex(state, AFTER_GAMES).get('target').overall, 56);

  state.players.strong.careerSeed.stats = stats(99);
  state.players.weak.careerSeed.stats = stats(1);
  assert.equal(buildGameAggregation(state, 'match').players.target.overall, 56);
  state.players.strong.careerSeed.stats = stats(70);
  state.players.weak.careerSeed.stats = stats(30);
  assert.equal(buildGameAggregation(state, 'match').players.target.overall, 53);

  state.players.strong.careerSeed.stats = stats(10);
  state.players.weak.careerSeed.stats = stats(90);
  assert.equal(buildGameAggregation(state, 'match').players.target.overall, 44);
});

test('unrated authors remain neutral regardless of their self-entered profile', () => {
  const state = fixture({ seeded: false });
  addGame(state);
  state.players.strong.selfProfile = { stats: stats(99), position: 'CM' };
  state.players.weak.selfProfile = { stats: stats(1), position: 'CM' };
  addRating(state, 'match', 'strong', 'target', 90);
  addRating(state, 'match', 'weak', 'target', 10);
  addQuickVote(state, 'strong', 'target');
  addQuickVote(state, 'weak', 'other');

  assert.equal(buildGameAggregation(state, 'match').players.target.overall, 50);
  const quick = buildGameBoostAggregation(state, 'match');
  closeTo(quick.players.target.ratingPoints, 3);
  closeTo(quick.players.other.ratingPoints, 3);
  closeTo(quick.players.target.ratingMvpVotes, 1);
});

test('quick ratings weight relative influence while preserving raw votes and quorum', () => {
  const state = fixture();
  addGame(state);
  addQuickVote(state, 'strong', 'target');
  addQuickVote(state, 'weak', 'other');

  const quick = buildGameBoostAggregation(state, 'match');
  assert.equal(quick.raterCount, 2);
  assert.equal(quick.participantCount, 5);
  assert.equal(quick.quorum, 3);
  assert.equal(quick.confidence, 2 / 3);
  for (const id of ['target', 'other']) {
    assert.equal(quick.players[id].totalPoints, 3);
    assert.equal(quick.players[id].statPoints.passing, 3);
    assert.equal(quick.players[id].mvpVotes, 1);
    assert.equal(quick.players[id].ratingsCount, 1);
    assert.deepEqual(quick.players[id].achievementCounts, { goleador: 1 });
    assert.equal(quick.players[id].achievementScore, 2);
  }
  closeTo(quick.players.target.ratingPoints, 3.45);
  closeTo(quick.players.target.ratingStatPoints.passing, 3.45);
  closeTo(quick.players.target.ratingMvpVotes, 1.15);
  closeTo(quick.players.target.ratingAchievementScore, 2.3);
  closeTo(quick.players.other.ratingPoints, 2.55);
  closeTo(quick.players.other.ratingMvpVotes, 0.85);
  closeTo(quick.players.other.ratingAchievementScore, 1.7);

  const career = buildGlobalCareerIndex(state, AFTER_GAMES);
  assert.ok(career.get('target').overall > career.get('other').overall);
});

test('equal author weights preserve quick-rating signals and career changes', () => {
  const strongState = fixture();
  strongState.players.weak.careerSeed.stats = stats(90);
  addGame(strongState);
  addQuickVote(strongState, 'strong', 'target');
  addQuickVote(strongState, 'weak', 'other', { points: 1 });
  const neutralState = structuredClone(strongState);
  neutralState.players.strong.careerSeed.stats = stats(50);
  neutralState.players.weak.careerSeed.stats = stats(50);

  const strongQuick = buildGameBoostAggregation(strongState, 'match');
  const neutralQuick = buildGameBoostAggregation(neutralState, 'match');
  for (const id of ['target', 'other']) {
    closeTo(strongQuick.players[id].ratingPoints, neutralQuick.players[id].ratingPoints);
    closeTo(strongQuick.players[id].ratingMvpVotes, neutralQuick.players[id].ratingMvpVotes);
    closeTo(strongQuick.players[id].ratingAchievementScore, neutralQuick.players[id].ratingAchievementScore);
  }
  const strongCareer = buildGlobalCareerIndex(strongState, AFTER_GAMES);
  const neutralCareer = buildGlobalCareerIndex(neutralState, AFTER_GAMES);
  assert.deepEqual(strongCareer.get('target'), neutralCareer.get('target'));
  assert.deepEqual(strongCareer.get('other'), neutralCareer.get('other'));
});

test('weights use earlier global history across chats and ignore game insertion order', () => {
  const state = fixture({ seeded: false });
  addGame(state, 'match');
  addGame(state, 'history', '2026-06-01T18:00:00.000Z', '-1002');
  addRating(state, 'history', 'neutral', 'strong', 90);
  addRating(state, 'history', 'neutral', 'weak', 10);
  addRating(state, 'match', 'strong', 'target', 90);
  addRating(state, 'match', 'weak', 'target', 10);

  assert.equal(buildGameAggregation(state, 'match').players.target.overall, 56);
  const career = buildGlobalCareerIndex(state, AFTER_GAMES);
  assert.equal(career.get('target').overall, 56);
  const reordered = structuredClone(state);
  reordered.games = Object.fromEntries(Object.entries(reordered.games).reverse());
  reordered.ratings = Object.fromEntries(Object.entries(reordered.ratings).reverse());
  assert.deepEqual(buildGameAggregation(reordered, 'match'), buildGameAggregation(state, 'match'));
  assert.deepEqual(buildGlobalCareerIndex(reordered, AFTER_GAMES), career);
  const snapshot = buildChatSnapshot(state, '-1001', 'neutral', AFTER_GAMES);
  assert.equal(snapshot.players.find((player) => player.id === 'target').overall, 56);
  assert.equal(snapshot.currentGame.participants.find((player) => player.id === 'target').currentGameStats.overall, 56);
});

test('current-game ratings cannot increase the weight of their own authors', () => {
  const state = fixture({ seeded: false });
  addGame(state);
  addRating(state, 'match', 'neutral', 'strong', 99);
  addRating(state, 'match', 'neutral', 'weak', 1);
  addRating(state, 'match', 'strong', 'target', 90);
  addRating(state, 'match', 'weak', 'target', 10);
  addQuickVote(state, 'strong', 'target');
  addQuickVote(state, 'weak', 'other');

  assert.equal(buildGameAggregation(state, 'match').players.target.overall, 50);
  const quick = buildGameBoostAggregation(state, 'match');
  closeTo(quick.players.target.ratingPoints, 3);
  closeTo(quick.players.other.ratingPoints, 3);
});

test('later matches cannot change the weighting of earlier full or quick ratings', () => {
  const state = fixture();
  addGame(state);
  addRating(state, 'match', 'strong', 'target', 90);
  addRating(state, 'match', 'weak', 'target', 10);
  addQuickVote(state, 'strong', 'target');
  addQuickVote(state, 'weak', 'other');
  const fullBefore = buildGameAggregation(state, 'match');
  const quickBefore = buildGameBoostAggregation(state, 'match');

  addGame(state, 'future', '2026-06-20T18:00:00.000Z');
  addRating(state, 'future', 'neutral', 'strong', 1);
  addRating(state, 'future', 'neutral', 'weak', 99);
  assert.deepEqual(buildGameAggregation(state, 'match'), fullBefore);
  assert.deepEqual(buildGameBoostAggregation(state, 'match'), quickBefore);
});

test('simultaneous games freeze author weights before either game is applied', () => {
  const state = fixture({ seeded: false });
  addGame(state, 'history', '2026-06-10T18:00:00.000Z', '-1002');
  addGame(state, 'match');
  addRating(state, 'history', 'neutral', 'strong', 99);
  addRating(state, 'history', 'neutral', 'weak', 1);
  addRating(state, 'match', 'strong', 'target', 90);
  addRating(state, 'match', 'weak', 'target', 10);
  addQuickVote(state, 'strong', 'target');
  addQuickVote(state, 'weak', 'other');

  const full = buildGameAggregation(state, 'match');
  const quick = buildGameBoostAggregation(state, 'match');
  assert.equal(full.players.target.overall, 50);
  closeTo(quick.players.target.ratingPoints, 3);
  closeTo(quick.players.other.ratingPoints, 3);
  const reordered = structuredClone(state);
  reordered.games = Object.fromEntries(Object.entries(reordered.games).reverse());
  assert.deepEqual(buildGameAggregation(reordered, 'match'), full);
  assert.deepEqual(buildGameBoostAggregation(reordered, 'match'), quick);
  assert.deepEqual(buildGlobalCareerIndex(reordered, AFTER_GAMES), buildGlobalCareerIndex(state, AFTER_GAMES));
});

for (const firstAssessment of ['none', 'negative achievement']) {
  test(`quick participation with ${firstAssessment} does not validate a self-entered author rating`, () => {
    const state = fixture({ seeded: false });
    state.players.strong.selfProfile = { stats: stats(99), position: 'CM' };
    addGame(state, 'first', '2026-06-01T18:00:00.000Z');
    addQuickVote(state, 'neutral', 'target', { gameId: 'first' });
    if (firstAssessment === 'negative achievement') {
      state.achievementVotes.negative = {
        id: 'negative', gameId: 'first', raterPlayerId: 'weak',
        targetPlayerId: 'strong', achievementKey: 'maguire_day'
      };
    }
    addGame(state);
    addQuickVote(state, 'strong', 'target');
    addQuickVote(state, 'neutral', 'other');

    const quick = buildGameBoostAggregation(state, 'match');
    closeTo(quick.players.target.ratingPoints, 3);
    closeTo(quick.players.other.ratingPoints, 3);
    closeTo(quick.players.target.ratingMvpVotes, 1);
    closeTo(quick.players.other.ratingMvpVotes, 1);
    closeTo(quick.players.target.ratingAchievementScore, 2);
    closeTo(quick.players.other.ratingAchievementScore, 2);
  });
}

for (const assessment of ['positive quick vote', 'full rating']) {
  test(`a previously unassessed participant gets author weight only after a personal ${assessment}`, () => {
    const state = fixture({ seeded: false });
    state.players.strong.selfProfile = { stats: stats(99), position: 'CM' };
    addGame(state, 'first', '2026-06-01T18:00:00.000Z');
    addQuickVote(state, 'neutral', 'target', { gameId: 'first' });
    addGame(state, 'assessment', '2026-06-05T18:00:00.000Z');
    addQuickVote(state, 'strong', 'target', { gameId: 'assessment' });
    addQuickVote(state, 'neutral', 'other', { gameId: 'assessment' });
    if (assessment === 'full rating') {
      addRating(state, 'assessment', 'weak', 'strong', 90);
    } else {
      state.statBoosts.personal = {
        id: 'personal', gameId: 'assessment', raterPlayerId: 'weak',
        targetPlayerId: 'strong', statKey: 'passing', points: 3
      };
    }
    addGame(state);
    addQuickVote(state, 'strong', 'target');
    addQuickVote(state, 'neutral', 'other');

    const duringAssessment = buildGameBoostAggregation(state, 'assessment');
    closeTo(duringAssessment.players.target.ratingPoints, 3);
    closeTo(duringAssessment.players.other.ratingPoints, 3);
    const afterAssessment = buildGameBoostAggregation(state, 'match');
    assert.ok(afterAssessment.players.target.ratingPoints > afterAssessment.players.other.ratingPoints);
    assert.ok(afterAssessment.players.target.ratingMvpVotes > afterAssessment.players.other.ratingMvpVotes);
  });
}
