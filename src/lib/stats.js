import { isSuperAdminPlayer } from './admins.js';
import { round } from './utils.js';

export const STAT_KEYS = ['pace', 'dribbling', 'shooting', 'defense', 'passing', 'physical'];
export const POSITION_OPTIONS = ['N/A', 'GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST'];
export const RATING_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_YELLOW_CARDS = 2;
export const MAX_RED_CARDS = 1;
export const QUICK_RATING_POINTS = 3;
export const QUICK_ACHIEVEMENT_DEFINITIONS = [
  { key: 'goleador', title: 'Голеадор', category: 'Базовые', ratingWeight: 2, automatic: false },
  { key: 'hat_trick', title: 'Хет-трикер', category: 'Голы и атака', ratingWeight: 3, automatic: false },
  { key: 'pokerface', title: 'Покерфейс', category: 'Голы и атака', ratingWeight: 4, automatic: false },
  { key: 'comeback_maker', title: 'Камбэк-мейкер', category: 'Голы и атака', ratingWeight: 2, automatic: false },
  { key: 'long_shot', title: 'Дальний выстрел', category: 'Голы и атака', ratingWeight: 1.5, automatic: false },
  { key: 'assistant', title: 'Ассистент', category: 'Пасы и командная игра', ratingWeight: 2, automatic: false },
  { key: 'playmaker', title: 'Плеймейкер', category: 'Пасы и командная игра', ratingWeight: 3, automatic: false },
  { key: 'unselfish', title: 'Не жадный', category: 'Пасы и командная игра', ratingWeight: 1.5, automatic: false },
  { key: 'conductor', title: 'Дирижёр', category: 'Пасы и командная игра', ratingWeight: 2.5, automatic: false },
  { key: 'wall', title: 'Стена', category: 'Защита', ratingWeight: 2.5, automatic: false },
  { key: 'pickpocket', title: 'Карманник', category: 'Защита', ratingWeight: 2, automatic: false },
  { key: 'cat', title: 'Кошка', category: 'Вратарь', ratingWeight: 2.5, automatic: false },
  { key: 'no_toxic', title: 'Без токсика', category: 'Другие', ratingWeight: 1, automatic: false },
  { key: 'maguire_day', title: 'Магуайр дня', category: 'Другие', ratingWeight: -1.5, automatic: false },
  { key: 'planned_it', title: 'Я так и задумал', category: 'Другие', ratingWeight: 1, automatic: false },
  { key: 'woodworker', title: 'Штангист', category: 'Другие', ratingWeight: -0.5, automatic: false }
];

const QUICK_ACHIEVEMENT_META = Object.fromEntries(
  QUICK_ACHIEVEMENT_DEFINITIONS.map((item) => [item.key, item])
);

const FALLBACK_STATS = {
  pace: 50,
  dribbling: 50,
  shooting: 50,
  defense: 50,
  passing: 50,
  physical: 50
};
const DATE_LABEL_MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря'
];
const DATE_LABEL_REGEX = new RegExp(`(\\d{1,2})\\s+(${DATE_LABEL_MONTHS.join('|')})`, 'i');

function compareByDate(left, right) {
  return new Date(left.scheduledAt) - new Date(right.scheduledAt);
}

function getRatingWindowEnd(game) {
  return new Date(new Date(game.scheduledAt).getTime() + RATING_WINDOW_MS);
}

export function isRatingWindowOpen(game, now = new Date()) {
  if (game?.closedAt) {
    return false;
  }

  const scheduledAt = new Date(game.scheduledAt);
  return now >= scheduledAt && now < getRatingWindowEnd(game);
}

function isFinalizedForCareer(game, now = new Date()) {
  if (game?.excludeFromCareer || ['history-import', 'text-import', 'bootstrap-import'].includes(game?.source)) {
    return false;
  }

  const scheduledAt = new Date(game.scheduledAt);
  const closedAt = game.closedAt ? new Date(game.closedAt) : null;

  if (closedAt && closedAt >= scheduledAt) {
    return true;
  }

  return now >= getRatingWindowEnd(game);
}

function pickDominantPosition(positionCounts) {
  const entries = Object.entries(positionCounts ?? {});

  if (!entries.length) {
    return 'N/A';
  }

  entries.sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }

    return left[0].localeCompare(right[0]);
  });

  return entries[0][0];
}

function createEmptySummary() {
  return {
    count: 0,
    goalsTotal: 0,
    assistsTotal: 0,
    yellowCardsMax: 0,
    redCardsMax: 0,
    positionCounts: {},
    sums: {
      pace: 0,
      dribbling: 0,
      shooting: 0,
      defense: 0,
      passing: 0,
      physical: 0
    }
  };
}

function createEmptyBoostSummary() {
  return {
    totalPoints: 0,
    mvpVotes: 0,
    achievementScore: 0,
    achievementCounts: {},
    statPoints: Object.fromEntries(STAT_KEYS.map((key) => [key, 0])),
    raterIds: new Set()
  };
}

function createEmptyCareerEntry() {
  return {
    games: 0,
    ratedGames: 0,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    overall: 50,
    positionCounts: {},
    statSums: {
      pace: 0,
      dribbling: 0,
      shooting: 0,
      defense: 0,
      passing: 0,
      physical: 0
    }
  };
}

function normalizeSeedStat(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 50;
  }

  return Math.max(1, Math.min(99, number));
}

function applyCareerSeedToEntry(entry, seed) {
  const ratedGames = Math.max(0, Math.round(Number(seed?.ratedGames ?? 0)));

  if (!ratedGames) {
    return;
  }

  entry.ratedGames += ratedGames;
  entry.goals += Math.max(0, Math.round(Number(seed.goals ?? 0)));
  entry.assists += Math.max(0, Math.round(Number(seed.assists ?? 0)));
  entry.yellowCards += Math.max(0, Math.round(Number(seed.yellowCards ?? 0)));
  entry.redCards += Math.max(0, Math.round(Number(seed.redCards ?? 0)));

  const position = POSITION_OPTIONS.includes(seed.position) ? seed.position : 'N/A';
  if (position !== 'N/A') {
    entry.positionCounts[position] = (entry.positionCounts[position] ?? 0) + ratedGames;
  }

  for (const key of STAT_KEYS) {
    entry.statSums[key] += normalizeSeedStat(seed.stats?.[key]) * ratedGames;
  }
}

function finalizeSummary(summary) {
  if (!summary.count) {
    return {
      hasRatings: false,
      stats: { ...FALLBACK_STATS },
      overall: 50,
      goals: 0,
      assists: 0,
      yellowCards: 0,
      redCards: 0,
      cards: {
        yellow: 0,
        red: 0
      },
      hasCards: false,
      position: 'N/A',
      ratingsCount: 0
    };
  }

  const stats = Object.fromEntries(
    STAT_KEYS.map((key) => [key, round(summary.sums[key] / summary.count)])
  );
  const overall = round(
    STAT_KEYS.reduce((sum, key) => sum + stats[key], 0) / STAT_KEYS.length
  );

  return {
    hasRatings: true,
    stats,
    overall,
    goals: round(summary.goalsTotal / summary.count),
    assists: round(summary.assistsTotal / summary.count),
    yellowCards: summary.yellowCardsMax,
    redCards: summary.redCardsMax,
    cards: {
      yellow: summary.yellowCardsMax,
      red: summary.redCardsMax
    },
    hasCards: summary.yellowCardsMax > 0 || summary.redCardsMax > 0,
    position: pickDominantPosition(summary.positionCounts),
    ratingsCount: summary.count
  };
}

function finalizeCareerEntry(entry) {
  const stats = entry.ratedGames
    ? Object.fromEntries(
        STAT_KEYS.map((key) => [key, round(entry.statSums[key] / entry.ratedGames)])
      )
    : { ...FALLBACK_STATS };
  const overall = round(
    STAT_KEYS.reduce((sum, key) => sum + stats[key], 0) / STAT_KEYS.length
  );

  return {
    games: entry.games,
    ratedGames: entry.ratedGames,
    goals: entry.goals,
    assists: entry.assists,
    yellowCards: entry.yellowCards,
    redCards: entry.redCards,
    cards: {
      yellow: entry.yellowCards,
      red: entry.redCards
    },
    overall,
    stats,
    position: entry.ratedGames ? pickDominantPosition(entry.positionCounts) : 'N/A'
  };
}

function applyBoostsToStats(baseStats, boostSummary) {
  const signalScore = Number(boostSummary?.achievementScore ?? 0);

  return Object.fromEntries(
    STAT_KEYS.map((key) => [
      key,
      Math.max(1, Math.min(99, Math.round(
        Number(baseStats?.[key] ?? FALLBACK_STATS[key]) +
        Number(boostSummary?.statPoints?.[key] ?? 0) +
        signalScore
      )))
    ])
  );
}

function getStatsOverall(stats) {
  return round(STAT_KEYS.reduce((sum, key) => sum + Number(stats[key] ?? 0), 0) / STAT_KEYS.length);
}

function getQuickFormLearningRate(ratedGames) {
  const games = Math.max(0, Math.round(Number(ratedGames ?? 0)));
  return Math.max(0.15, 0.25 - Math.min(games, 10) * 0.01);
}

function getQuickFormBaseStats(entry, player) {
  if (entry.ratedGames > 0) {
    return finalizeCareerEntry(entry).stats;
  }

  return player?.selfProfile?.stats || FALLBACK_STATS;
}

function getQuickFormPosition(entry, player) {
  const career = finalizeCareerEntry(entry);

  if (career.position !== 'N/A') {
    return career.position;
  }

  return player?.selfProfile?.position || player?.defaultPosition || 'N/A';
}

function buildQuickFormStats(entry, boostSummary, quickContext, player) {
  const raterCount = Math.max(1, Number(quickContext?.raterCount ?? 0));
  const visibility = (
    Number(boostSummary?.totalPoints ?? 0) +
    Number(boostSummary?.mvpVotes ?? 0) * 2 +
    Number(boostSummary?.achievementScore ?? 0)
  ) / raterCount;
  const delta = Math.max(-8, Math.min(12, -8 + visibility * 4));
  const baseStats = getQuickFormBaseStats(entry, player);

  return Object.fromEntries(
    STAT_KEYS.map((key) => {
      const statFocus = Math.min(3, Number(boostSummary?.statPoints?.[key] ?? 0));
      return [
        key,
        Math.max(1, Math.min(99, round(Number(baseStats[key] ?? FALLBACK_STATS[key]) + delta + statFocus)))
      ];
    })
  );
}

function applyQuickFormToCareerEntry(entry, boostSummary, quickContext, player) {
  if (!quickContext?.hasActivity) {
    return;
  }

  const baseStats = getQuickFormBaseStats(entry, player);
  const matchStats = buildQuickFormStats(entry, boostSummary, quickContext, player);
  const learningRate = getQuickFormLearningRate(entry.ratedGames);
  const ratedGames = entry.ratedGames + 1;
  const position = getQuickFormPosition(entry, player);

  entry.ratedGames = ratedGames;

  if (position !== 'N/A') {
    entry.positionCounts[position] = (entry.positionCounts[position] ?? 0) + 1;
  }

  for (const key of STAT_KEYS) {
    const current = Number(baseStats[key] ?? FALLBACK_STATS[key]);
    const next = current + (Number(matchStats[key]) - current) * learningRate;
    entry.statSums[key] = next * ratedGames;
  }
}

function previewQuickFormOverallAfterGame(entry, boostSummary, quickContext, player) {
  if (!quickContext?.hasActivity) {
    return finalizeCareerEntry(entry).overall;
  }

  const copy = {
    ...entry,
    positionCounts: { ...(entry.positionCounts ?? {}) },
    statSums: { ...(entry.statSums ?? {}) }
  };

  applyQuickFormToCareerEntry(copy, boostSummary, quickContext, player);
  return finalizeCareerEntry(copy).overall;
}

function ensureCareerEntry(career, playerId) {
  if (!career.has(playerId)) {
    career.set(playerId, createEmptyCareerEntry());
  }

  return career.get(playerId);
}

function applyGameToCareerEntry(entry, gameStats) {
  entry.games += 1;

  if (!gameStats?.hasRatings) {
    return;
  }

  entry.ratedGames += 1;
  entry.goals += gameStats.goals;
  entry.assists += gameStats.assists;
  entry.yellowCards += gameStats.yellowCards ?? 0;
  entry.redCards += gameStats.redCards ?? 0;
  entry.positionCounts[gameStats.position] = (entry.positionCounts[gameStats.position] ?? 0) + 1;

  for (const key of STAT_KEYS) {
    entry.statSums[key] += gameStats.stats[key];
  }
}

function applyBoostsToCareerEntry(entry, boostSummary, player, fullGameStatsApplied = false) {
  if (!boostSummary?.hasQuickRating) {
    return;
  }

  if (fullGameStatsApplied && entry.ratedGames > 0) {
    for (const key of STAT_KEYS) {
      entry.statSums[key] += Number(boostSummary.statPoints[key] ?? 0) + Number(boostSummary.achievementScore ?? 0);
    }
    return;
  }

  const career = finalizeCareerEntry(entry);
  const baseStats = entry.ratedGames > 0
    ? career.stats
    : player?.selfProfile?.stats || FALLBACK_STATS;
  const boostedStats = applyBoostsToStats(baseStats, boostSummary);
  const position = career.position !== 'N/A'
    ? career.position
    : player?.selfProfile?.position || player?.defaultPosition || 'N/A';

  entry.ratedGames += 1;

  if (position !== 'N/A') {
    entry.positionCounts[position] = (entry.positionCounts[position] ?? 0) + 1;
  }

  for (const key of STAT_KEYS) {
    entry.statSums[key] += boostedStats[key];
  }
}

function previewCareerOverallAfterGame(entry, gameStats) {
  if (!gameStats?.hasRatings) {
    return finalizeCareerEntry(entry).overall;
  }

  const ratedGames = entry.ratedGames + 1;
  const stats = Object.fromEntries(
    STAT_KEYS.map((key) => [key, round((entry.statSums[key] + gameStats.stats[key]) / ratedGames)])
  );

  return round(STAT_KEYS.reduce((sum, key) => sum + stats[key], 0) / STAT_KEYS.length);
}

function getChatPlayers(state, chatId) {
  return Object.values(state.players).filter((player) => player.chatIds.includes(String(chatId)));
}

function getPlayersForChatIds(state, chatIds) {
  const allowedChatIds = new Set(chatIds.map(String));
  return Object.values(state.players).filter((player) =>
    (player.chatIds ?? []).some((playerChatId) => allowedChatIds.has(String(playerChatId)))
  );
}

function getSelectablePlayers(state) {
  return Object.values(state.players);
}

export function getGamesForChat(state, chatId) {
  return Object.values(state.games)
    .filter((game) => game.chatId === String(chatId))
    .sort(compareByDate);
}

function getGamesForChatIds(state, chatIds) {
  const allowedChatIds = new Set(chatIds.map(String));
  return Object.values(state.games)
    .filter((game) => allowedChatIds.has(String(game.chatId)))
    .sort(compareByDate);
}

export function buildGameAggregation(state, gameId) {
  const game = state.games[gameId];

  if (!game) {
    return null;
  }

  const ratings = Object.values(state.ratings).filter((rating) => rating.gameId === gameId);
  const byPlayer = new Map();

  for (const playerId of game.playerIds) {
    byPlayer.set(playerId, createEmptySummary());
  }

  for (const rating of ratings) {
    if (!byPlayer.has(rating.targetPlayerId)) {
      byPlayer.set(rating.targetPlayerId, createEmptySummary());
    }

    const summary = byPlayer.get(rating.targetPlayerId);
    summary.count += 1;
    summary.positionCounts[rating.position] = (summary.positionCounts[rating.position] ?? 0) + 1;

    if (rating.position !== 'GK') {
      summary.goalsTotal += rating.goals;
      summary.assistsTotal += rating.assists;
    }

    summary.yellowCardsMax = Math.max(summary.yellowCardsMax, Math.min(MAX_YELLOW_CARDS, Math.max(0, Math.round(Number(rating.yellowCards ?? 0)))));
    summary.redCardsMax = Math.max(summary.redCardsMax, Math.min(MAX_RED_CARDS, Math.max(0, Math.round(Number(rating.redCards ?? 0)))));

    for (const key of STAT_KEYS) {
      summary.sums[key] += rating[key];
    }
  }

  const players = Object.fromEntries(
    [...byPlayer.entries()].map(([playerId, summary]) => [playerId, finalizeSummary(summary)])
  );

  return {
    gameId,
    players
  };
}

export function buildGameBoostAggregation(state, gameId) {
  const game = state.games[gameId];

  if (!game) {
    return null;
  }

  const byPlayer = new Map();
  const gameRaterIds = new Set();

  for (const playerId of game.playerIds) {
    byPlayer.set(playerId, createEmptyBoostSummary());
  }

  for (const boost of Object.values(state.statBoosts ?? {})) {
    if (boost.gameId !== gameId || !STAT_KEYS.includes(boost.statKey)) {
      continue;
    }

    if (!byPlayer.has(boost.targetPlayerId)) {
      byPlayer.set(boost.targetPlayerId, createEmptyBoostSummary());
    }

    const summary = byPlayer.get(boost.targetPlayerId);
    const points = Math.max(0, Math.round(Number(boost.points ?? 0)));
    summary.statPoints[boost.statKey] += points;
    summary.totalPoints += points;

    if (boost.raterPlayerId) {
      summary.raterIds.add(boost.raterPlayerId);
      gameRaterIds.add(boost.raterPlayerId);
    }
  }

  for (const vote of Object.values(state.mvpVotes ?? {})) {
    if (vote.gameId !== gameId || !game.playerIds.includes(vote.targetPlayerId)) {
      continue;
    }

    if (!byPlayer.has(vote.targetPlayerId)) {
      byPlayer.set(vote.targetPlayerId, createEmptyBoostSummary());
    }

    const summary = byPlayer.get(vote.targetPlayerId);
    summary.mvpVotes += 1;

    if (vote.raterPlayerId) {
      summary.raterIds.add(vote.raterPlayerId);
      gameRaterIds.add(vote.raterPlayerId);
    }
  }

  for (const vote of Object.values(state.achievementVotes ?? {})) {
    const achievementKey = String(vote.achievementKey ?? '');
    const achievement = QUICK_ACHIEVEMENT_META[achievementKey];

    if (!achievement || vote.gameId !== gameId || !game.playerIds.includes(vote.targetPlayerId)) {
      continue;
    }

    if (!byPlayer.has(vote.targetPlayerId)) {
      byPlayer.set(vote.targetPlayerId, createEmptyBoostSummary());
    }

    const summary = byPlayer.get(vote.targetPlayerId);
    summary.achievementScore += Number(achievement.ratingWeight ?? 0);
    summary.achievementCounts[achievementKey] = (summary.achievementCounts[achievementKey] ?? 0) + 1;

    if (vote.raterPlayerId) {
      summary.raterIds.add(vote.raterPlayerId);
      gameRaterIds.add(vote.raterPlayerId);
    }
  }

  return {
    gameId,
    hasActivity: gameRaterIds.size > 0,
    raterCount: gameRaterIds.size,
    players: Object.fromEntries(
      [...byPlayer.entries()].map(([playerId, summary]) => [
        playerId,
        {
          hasBoosts: summary.totalPoints > 0,
          hasAchievements: Object.keys(summary.achievementCounts).length > 0,
          hasQuickRating: summary.totalPoints > 0 || summary.mvpVotes > 0 || Object.keys(summary.achievementCounts).length > 0,
          totalPoints: summary.totalPoints,
          mvpVotes: summary.mvpVotes,
          achievementScore: summary.achievementScore,
          achievementCounts: { ...summary.achievementCounts },
          statPoints: { ...summary.statPoints },
          ratingsCount: summary.raterIds.size
        }
      ])
    )
  };
}

function combineGameStatsWithBoosts(gameStats, boostSummary, playerCard = null) {
  if (!boostSummary?.hasQuickRating) {
    return gameStats ?? null;
  }

  const baseStats = gameStats?.hasRatings
    ? gameStats.stats
    : playerCard?.ratedGames > 0 || playerCard?.hasSelfProfile
      ? playerCard.stats
      : FALLBACK_STATS;
  const stats = applyBoostsToStats(baseStats, boostSummary);
  const position = gameStats?.hasRatings
    ? gameStats.position
    : playerCard?.position || 'N/A';

  return {
    hasRatings: true,
    stats,
    overall: getStatsOverall(stats),
    goals: gameStats?.hasRatings ? gameStats.goals : 0,
    assists: gameStats?.hasRatings ? gameStats.assists : 0,
    yellowCards: gameStats?.hasRatings ? gameStats.yellowCards ?? 0 : 0,
    redCards: gameStats?.hasRatings ? gameStats.redCards ?? 0 : 0,
    cards: gameStats?.hasRatings
      ? gameStats.cards
      : {
          yellow: 0,
          red: 0
        },
    hasCards: Boolean(gameStats?.hasCards),
    position,
    ratingsCount: Math.max(
      1,
      Number(gameStats?.ratingsCount ?? 0) + Number(boostSummary.ratingsCount ?? 0)
    ),
    boostPoints: boostSummary.totalPoints,
    statPoints: boostSummary.statPoints,
    achievementCounts: boostSummary.achievementCounts ?? {},
    achievementScore: boostSummary.achievementScore ?? 0
  };
}

function getGameStatsWithBoosts(state, gameId, playerId, playerCard = null, aggregation = null, boostAggregation = null) {
  const baseAggregation = aggregation ?? buildGameAggregation(state, gameId);
  const boosts = boostAggregation ?? buildGameBoostAggregation(state, gameId);
  return combineGameStatsWithBoosts(
    baseAggregation?.players[playerId] ?? null,
    boosts?.players[playerId] ?? null,
    playerCard
  );
}

function buildCareerIndexForPlayersAndGames(state, players, games, now = new Date()) {
  const career = new Map();
  const playersById = new Map(players.map((player) => [player.id, player]));

  for (const player of players) {
    const entry = createEmptyCareerEntry();
    applyCareerSeedToEntry(entry, player.careerSeed);
    career.set(player.id, entry);
  }

  for (const game of games.filter((item) => isFinalizedForCareer(item, now))) {
    const aggregation = buildGameAggregation(state, game.id);
    const boostAggregation = buildGameBoostAggregation(state, game.id);

    for (const playerId of game.playerIds) {
      const gameStats = aggregation?.players[playerId];
      const entry = ensureCareerEntry(career, playerId);
      applyGameToCareerEntry(entry, gameStats);

      if (gameStats?.hasRatings) {
        applyBoostsToCareerEntry(entry, boostAggregation?.players[playerId], playersById.get(playerId), true);
        continue;
      }

      applyQuickFormToCareerEntry(
        entry,
        boostAggregation?.players[playerId],
        boostAggregation,
        playersById.get(playerId)
      );
    }
  }

  return new Map(
    [...career.entries()].map(([playerId, entry]) => [playerId, finalizeCareerEntry(entry)])
  );
}

export function buildCareerIndex(state, chatId, now = new Date()) {
  return buildCareerIndexForPlayersAndGames(
    state,
    getChatPlayers(state, chatId),
    getGamesForChat(state, chatId),
    now
  );
}

export function buildGlobalCareerIndex(state, now = new Date()) {
  return buildCareerIndexForPlayersAndGames(
    state,
    Object.values(state.players),
    Object.values(state.games).sort(compareByDate),
    now
  );
}

function buildGameMvpIndexForGames(state, games, now = new Date()) {
  const career = new Map();
  const mvpIndex = new Map();

  for (const player of Object.values(state.players)) {
    const entry = createEmptyCareerEntry();
    applyCareerSeedToEntry(entry, player.careerSeed);

    if (entry.ratedGames > 0) {
      career.set(player.id, entry);
    }
  }

  for (const game of games.sort(compareByDate)) {
    if (!isFinalizedForCareer(game, now)) {
      continue;
    }

    const aggregation = buildGameAggregation(state, game.id);
    const boostAggregation = buildGameBoostAggregation(state, game.id);
    const voteWinner = getGameMvpVoteWinner(state, game);

    if (voteWinner) {
      const entry = ensureCareerEntry(career, voteWinner.playerId);
      const summary = aggregation?.players[voteWinner.playerId];
      const boostSummary = boostAggregation?.players[voteWinner.playerId];
      const previousOverall = finalizeCareerEntry(entry).overall;
      const nextOverall = summary?.hasRatings
        ? previewCareerOverallAfterGame(entry, summary)
        : previewQuickFormOverallAfterGame(entry, boostSummary, boostAggregation, state.players[voteWinner.playerId]);

      mvpIndex.set(game.id, {
        gameId: game.id,
        playerId: voteWinner.playerId,
        overall: nextOverall,
        ratingIncrease: round(nextOverall - previousOverall, 2),
        previousOverall,
        gameOverall: summary?.overall ?? nextOverall,
        votes: voteWinner.votes
      });
    }

    const candidates = game.playerIds
      .map((playerId) => {
        const entry = ensureCareerEntry(career, playerId);
        const summary = aggregation?.players[playerId];
        const boostSummary = boostAggregation?.players[playerId];

        if (!summary?.hasRatings && !boostAggregation?.hasActivity) {
          return null;
        }

        const previousOverall = finalizeCareerEntry(entry).overall;
        const nextOverall = summary?.hasRatings
          ? previewCareerOverallAfterGame(entry, summary)
          : previewQuickFormOverallAfterGame(entry, boostSummary, boostAggregation, state.players[playerId]);
        const increase = round(nextOverall - previousOverall, 2);

        return {
          playerId,
          summary: summary?.hasRatings ? summary : {
            overall: nextOverall,
            ratingsCount: boostSummary?.ratingsCount ?? 0,
            goals: 0,
            assists: 0
          },
          previousOverall,
          nextOverall,
          increase
        };
      })
      .filter((candidate) => candidate?.increase > 0);

    if (!voteWinner && candidates.length) {
      candidates.sort((left, right) => {
        if (right.increase !== left.increase) {
          return right.increase - left.increase;
        }

        if (right.nextOverall !== left.nextOverall) {
          return right.nextOverall - left.nextOverall;
        }

        if (right.summary.overall !== left.summary.overall) {
          return right.summary.overall - left.summary.overall;
        }

        if (right.summary.ratingsCount !== left.summary.ratingsCount) {
          return right.summary.ratingsCount - left.summary.ratingsCount;
        }

        if (right.summary.goals !== left.summary.goals) {
          return right.summary.goals - left.summary.goals;
        }

        return right.summary.assists - left.summary.assists;
      });

      mvpIndex.set(game.id, {
        gameId: game.id,
        playerId: candidates[0].playerId,
        overall: candidates[0].nextOverall,
        ratingIncrease: candidates[0].increase,
        previousOverall: candidates[0].previousOverall,
        gameOverall: candidates[0].summary.overall
      });
    }

    for (const playerId of game.playerIds) {
      const gameStats = aggregation?.players[playerId];
      const entry = ensureCareerEntry(career, playerId);
      applyGameToCareerEntry(entry, gameStats);

      if (gameStats?.hasRatings) {
        applyBoostsToCareerEntry(entry, boostAggregation?.players[playerId], state.players[playerId], true);
        continue;
      }

      applyQuickFormToCareerEntry(entry, boostAggregation?.players[playerId], boostAggregation, state.players[playerId]);
    }
  }

  return mvpIndex;
}

function getGameMvpVoteWinner(state, game) {
  const voteCounts = new Map();

  for (const vote of Object.values(state.mvpVotes ?? {})) {
    if (vote.gameId !== game.id || !game.playerIds.includes(vote.targetPlayerId)) {
      continue;
    }

    voteCounts.set(vote.targetPlayerId, (voteCounts.get(vote.targetPlayerId) ?? 0) + 1);
  }

  const candidates = [...voteCounts.entries()].map(([playerId, votes]) => ({ playerId, votes }));

  if (!candidates.length) {
    return null;
  }

  candidates.sort((left, right) => {
    if (right.votes !== left.votes) {
      return right.votes - left.votes;
    }

    return left.playerId.localeCompare(right.playerId);
  });

  return candidates[0];
}

function getGameAchievementWinner(state, game, achievementKey) {
  const voteCounts = new Map();

  for (const vote of Object.values(state.achievementVotes ?? {})) {
    if (
      vote.gameId !== game.id ||
      vote.achievementKey !== achievementKey ||
      !game.playerIds.includes(vote.targetPlayerId)
    ) {
      continue;
    }

    voteCounts.set(vote.targetPlayerId, (voteCounts.get(vote.targetPlayerId) ?? 0) + 1);
  }

  const candidates = [...voteCounts.entries()].map(([playerId, votes]) => ({ playerId, votes }));

  if (!candidates.length) {
    return null;
  }

  candidates.sort((left, right) => {
    if (right.votes !== left.votes) {
      return right.votes - left.votes;
    }

    return left.playerId.localeCompare(right.playerId);
  });

  return candidates[0];
}

function incrementAchievement(achievementIndex, playerId, achievementKey, count = 1) {
  if (!playerId || !achievementKey || count <= 0) {
    return;
  }

  if (!achievementIndex[playerId]) {
    achievementIndex[playerId] = {};
  }

  achievementIndex[playerId][achievementKey] = (achievementIndex[playerId][achievementKey] ?? 0) + count;
}

function hasPlayerRatingActivity(state, game, playerId) {
  const targetIds = game.playerIds.filter((targetPlayerId) => targetPlayerId !== playerId);
  const ratedTargets = new Set(
    Object.values(state.ratings ?? {})
      .filter((rating) => rating.gameId === game.id && rating.raterPlayerId === playerId)
      .map((rating) => rating.targetPlayerId)
  );

  if (targetIds.length && targetIds.every((targetPlayerId) => ratedTargets.has(targetPlayerId))) {
    return true;
  }

  return Boolean(
    Object.values(state.statBoosts ?? {}).some((boost) => boost.gameId === game.id && boost.raterPlayerId === playerId) ||
    Object.values(state.mvpVotes ?? {}).some((vote) => vote.gameId === game.id && vote.raterPlayerId === playerId) ||
    Object.values(state.achievementVotes ?? {}).some((vote) => vote.gameId === game.id && vote.raterPlayerId === playerId)
  );
}

function buildPlayerAchievementIndex(state, games, career, now = new Date()) {
  const achievementIndex = {};
  const finalizedGames = games
    .filter((game) => isFinalizedForCareer(game, now))
    .sort(compareByDate);
  const mvpIndex = buildGameMvpIndexForGames(state, finalizedGames, now);
  const gamesByPlayerId = {};
  const locationsByPlayerId = {};
  const consecutiveByPlayerId = {};
  const bestConsecutiveByPlayerId = {};

  for (const game of finalizedGames) {
    const mvp = mvpIndex.get(game.id);
    const goleadorWinner = getGameAchievementWinner(state, game, 'goleador');
    const seenAchievements = new Set();

    if (mvp) {
      incrementAchievement(achievementIndex, mvp.playerId, 'mvp');

      const mvpPlayer = state.players[mvp.playerId];
      const mvpCareer = career.get(mvp.playerId);

      if ((mvpCareer?.position || mvpPlayer?.defaultPosition) === 'GK') {
        incrementAchievement(achievementIndex, mvp.playerId, 'last_line');
      }

      if (Number(mvp.previousOverall ?? mvpCareer?.overall ?? 50) < 55) {
        incrementAchievement(achievementIndex, mvp.playerId, 'dark_horse');
      }
    }

    if (goleadorWinner) {
      incrementAchievement(achievementIndex, goleadorWinner.playerId, 'goleador');
    }

    for (const vote of Object.values(state.achievementVotes ?? {})) {
      if (vote.gameId !== game.id || vote.achievementKey === 'goleador') {
        continue;
      }

      const key = `${vote.targetPlayerId}:${vote.achievementKey}`;

      if (seenAchievements.has(key)) {
        continue;
      }

      seenAchievements.add(key);
      incrementAchievement(achievementIndex, vote.targetPlayerId, vote.achievementKey);
    }

    for (const playerId of game.playerIds) {
      gamesByPlayerId[playerId] = (gamesByPlayerId[playerId] ?? 0) + 1;
      consecutiveByPlayerId[playerId] = (consecutiveByPlayerId[playerId] ?? 0) + 1;
      bestConsecutiveByPlayerId[playerId] = Math.max(
        bestConsecutiveByPlayerId[playerId] ?? 0,
        consecutiveByPlayerId[playerId]
      );

      const locationKey = String(game.location || '').trim().toLowerCase();

      if (locationKey) {
        if (!locationsByPlayerId[playerId]) {
          locationsByPlayerId[playerId] = {};
        }

        locationsByPlayerId[playerId][locationKey] = (locationsByPlayerId[playerId][locationKey] ?? 0) + 1;
      }

      if (hasPlayerRatingActivity(state, game, playerId)) {
        incrementAchievement(achievementIndex, playerId, 'support');
      }
    }

    for (const playerId of Object.keys(state.players ?? {})) {
      if (!game.playerIds.includes(playerId)) {
        consecutiveByPlayerId[playerId] = 0;
      }
    }

    if (game.organizerPlayerId) {
      incrementAchievement(achievementIndex, game.organizerPlayerId, 'organizer');
    }
  }

  const topThreePlayerIds = [...career.entries()]
    .filter(([, entry]) => entry.ratedGames > 0)
    .sort((left, right) => Number(right[1].overall ?? 0) - Number(left[1].overall ?? 0))
    .slice(0, 3)
    .map(([playerId]) => playerId);

  for (const [playerId, entry] of career.entries()) {
    if ((gamesByPlayerId[playerId] ?? entry.games ?? 0) > 0) {
      incrementAchievement(achievementIndex, playerId, 'debutant');
    }

    if ((gamesByPlayerId[playerId] ?? entry.games ?? 0) >= 50) {
      incrementAchievement(achievementIndex, playerId, 'yard_veteran');
    }

    if ((bestConsecutiveByPlayerId[playerId] ?? 0) >= 5) {
      incrementAchievement(achievementIndex, playerId, 'stable_guy');
    }

    if (Object.values(locationsByPlayerId[playerId] ?? {}).some((count) => count >= 10)) {
      incrementAchievement(achievementIndex, playerId, 'local_guy');
    }

    if (topThreePlayerIds.includes(playerId)) {
      incrementAchievement(achievementIndex, playerId, 'yard_elite');
    }
  }

  return achievementIndex;
}

function buildLatestRatingDeltaIndex(state, games, now = new Date()) {
  const career = new Map();
  const playersById = new Map(Object.values(state.players ?? {}).map((player) => [player.id, player]));
  const latestDeltaByPlayerId = {};

  for (const player of playersById.values()) {
    const entry = createEmptyCareerEntry();
    applyCareerSeedToEntry(entry, player.careerSeed);
    career.set(player.id, entry);
  }

  for (const game of games.filter((item) => isFinalizedForCareer(item, now)).sort(compareByDate)) {
    const aggregation = buildGameAggregation(state, game.id);
    const boostAggregation = buildGameBoostAggregation(state, game.id);

    for (const playerId of game.playerIds) {
      const entry = ensureCareerEntry(career, playerId);
      const previousOverall = entry.ratedGames > 0 ? Number(finalizeCareerEntry(entry).overall) : null;
      const gameStats = aggregation?.players[playerId];
      const boostSummary = boostAggregation?.players[playerId];
      const hasRatingActivity = Boolean(gameStats?.hasRatings || boostAggregation?.hasActivity);

      applyGameToCareerEntry(entry, gameStats);

      if (gameStats?.hasRatings) {
        applyBoostsToCareerEntry(entry, boostSummary, playersById.get(playerId), true);
      } else {
        applyQuickFormToCareerEntry(entry, boostSummary, boostAggregation, playersById.get(playerId));
      }

      if (hasRatingActivity && previousOverall !== null) {
        latestDeltaByPlayerId[playerId] = round(finalizeCareerEntry(entry).overall - previousOverall, 2);
      }
    }
  }

  return latestDeltaByPlayerId;
}

function getLatestMvpForGames(state, games, now = new Date()) {
  const mvpIndex = buildGameMvpIndexForGames(state, games, now);

  for (const game of [...games].sort(compareByDate).reverse()) {
    const mvp = mvpIndex.get(game.id);

    if (mvp) {
      return mvp;
    }
  }

  return null;
}

export function getLatestMvp(state, chatId, now = new Date()) {
  return getLatestMvpForGames(state, getGamesForChat(state, chatId), now);
}

export function buildGameMvpIndex(state, chatId, now = new Date()) {
  const games = getGamesForChat(state, chatId);
  return buildGameMvpIndexForGames(state, games, now);
}

function comparePlayers(left, right) {
  if (left.isMvp !== right.isMvp) {
    return left.isMvp ? -1 : 1;
  }

  if (right.overall !== left.overall) {
    return right.overall - left.overall;
  }

  if (right.games !== left.games) {
    return right.games - left.games;
  }

  if (right.goals !== left.goals) {
    return right.goals - left.goals;
  }

  return right.assists - left.assists;
}

function getGameStatus(game, now) {
  const scheduledAt = new Date(game.scheduledAt);
  const finishedAt = new Date(scheduledAt.getTime() + 3 * 60 * 60 * 1000);

  if (now < scheduledAt) {
    return 'upcoming';
  }

  if (game.closedAt) {
    return 'finished';
  }

  if (now >= finishedAt) {
    return 'finished';
  }

  return 'live';
}

function normalizeDateLabel(dateLabel = '') {
  const normalized = String(dateLabel || '').replaceAll(',', ' ');
  const match = normalized.match(DATE_LABEL_REGEX);

  if (!match) {
    return String(dateLabel || '');
  }

  return `${Number(match[1])} ${match[2].toLowerCase()}`;
}

function buildGameCardsSummary(game, aggregation) {
  const cards = game.playerIds.reduce(
    (acc, playerId) => {
      const gameStats = aggregation?.players[playerId];

      if (!gameStats?.hasRatings) {
        return acc;
      }

      acc.yellow += gameStats.yellowCards ?? 0;
      acc.red += gameStats.redCards ?? 0;
      return acc;
    },
    { yellow: 0, red: 0 }
  );

  return {
    ...cards,
    total: cards.yellow + cards.red,
    hasCards: cards.yellow > 0 || cards.red > 0
  };
}

function buildGameAverageOverall(game, aggregation, boostAggregation, playersById) {
  const ratedPlayers = game.playerIds
    .map((playerId) => combineGameStatsWithBoosts(
      aggregation?.players[playerId] ?? null,
      boostAggregation?.players[playerId] ?? null,
      playersById.get(playerId)
    ))
    .filter((gameStats) => gameStats?.hasRatings);

  if (!ratedPlayers.length) {
    return null;
  }

  return round(
    ratedPlayers.reduce((sum, gameStats) => sum + gameStats.overall, 0) / ratedPlayers.length
  );
}

function buildGameRosterAverageOverall(game, playersById) {
  const ratedPlayers = game.playerIds
    .map((playerId) => playersById.get(playerId))
    .filter((player) => player?.ratedGames > 0 && Number(player.overall) > 0);

  if (!ratedPlayers.length) {
    return null;
  }

  return round(
    ratedPlayers.reduce((sum, player) => sum + Number(player.overall), 0) / ratedPlayers.length
  );
}

function buildGamesView(state, games, playerCards, now) {
  const mvpIndex = buildGameMvpIndexForGames(state, games, now);
  const playersById = new Map(playerCards.map((player) => [player.id, player]));

  return games
    .map((game) => {
      const aggregation = buildGameAggregation(state, game.id);
      const boostAggregation = buildGameBoostAggregation(state, game.id);
      const mvp = mvpIndex.get(game.id);
      const mvpPlayer = mvp ? playersById.get(mvp.playerId) : null;
      const mvpAchievementCounts = mvp
        ? boostAggregation?.players?.[mvp.playerId]?.achievementCounts ?? {}
        : {};
      const mvpAchievements = Object.entries(mvpAchievementCounts)
        .filter(([, count]) => Number(count) > 0)
        .map(([key, count]) => ({
          key,
          title: QUICK_ACHIEVEMENT_META[key]?.title || key,
          count: Math.max(1, Math.round(Number(count)))
        }));
      const importedMvp = game.importedSummary?.mvp ?? null;
      const importedTopScorer = game.importedSummary?.topScorer ?? null;
      const cards = buildGameCardsSummary(game, aggregation);
      const averageOverall = buildGameAverageOverall(game, aggregation, boostAggregation, playersById) ?? buildGameRosterAverageOverall(game, playersById);
      const totalGoals = round(
        game.playerIds.reduce((sum, playerId) => {
          const gameStats = aggregation?.players[playerId];
          return sum + (gameStats?.hasRatings ? gameStats.goals : 0);
        }, 0)
      ) || Number(game.importedSummary?.totalGoals ?? 0);
      const topScorer = isFinalizedForCareer(game, now) ? game.playerIds
        .map((playerId) => {
          const gameStats = aggregation?.players[playerId];

          if (!gameStats?.hasRatings || gameStats.goals <= 0) {
            return null;
          }

          return {
            playerId,
            goals: gameStats.goals,
            overall: gameStats.overall,
            ratingsCount: gameStats.ratingsCount
          };
        })
        .filter(Boolean)
        .sort((left, right) => {
          if (right.goals !== left.goals) {
            return right.goals - left.goals;
          }

          if (right.overall !== left.overall) {
            return right.overall - left.overall;
          }

          return right.ratingsCount - left.ratingsCount;
        })[0] ?? null : null;
      const goleadorWinner = isFinalizedForCareer(game, now) ? getGameAchievementWinner(state, game, 'goleador') : null;
      const topScorerPlayer = topScorer ? playersById.get(topScorer.playerId) : null;
      const goleadorPlayer = goleadorWinner ? playersById.get(goleadorWinner.playerId) : null;

      return {
        id: game.id,
        dateLabel: normalizeDateLabel(game.dateLabel),
        location: game.location,
        time: game.time,
        scheduledAt: game.scheduledAt,
        status: getGameStatus(game, now),
        playersCount: game.playerIds.length,
        totalGoals,
        averageOverall,
        cards,
        mvp: mvp
          ? {
              playerId: mvp.playerId,
              displayName: mvpPlayer?.displayName || 'Игрок',
              username: mvpPlayer?.username || '',
              ratingIncrease: mvp.ratingIncrease,
              overall: mvp.overall,
              votes: mvp.votes ?? 0,
              achievements: mvpAchievements
            }
          : importedMvp,
        topScorer: topScorer
          ? {
              playerId: topScorer.playerId,
              displayName: topScorerPlayer?.displayName || 'Игрок',
              username: topScorerPlayer?.username || '',
              goals: topScorer.goals,
              overall: topScorer.overall
            }
          : goleadorWinner
            ? {
                playerId: goleadorWinner.playerId,
                displayName: goleadorPlayer?.displayName || 'Игрок',
                username: goleadorPlayer?.username || '',
                goals: 0,
                votes: goleadorWinner.votes,
                overall: goleadorPlayer?.overall ?? 0
              }
            : importedTopScorer
      };
    })
    .sort((left, right) => new Date(right.scheduledAt) - new Date(left.scheduledAt));
}

function getSnapshotChatIds(state, chatId) {
  const footballChatIds = Object.values(state.chats)
    .filter((chat) => chat.type !== 'private' && chat.type !== 'global')
    .map((chat) => String(chat.id));

  if (footballChatIds.length) {
    return footballChatIds;
  }

  const requestedChat = state.chats[String(chatId)];
  return requestedChat && requestedChat.type !== 'private' ? [String(chatId)] : [];
}

function pickCurrentGame(games, now = new Date()) {
  if (!games.length) {
    return null;
  }

  const liveOrUpcoming = games
    .filter((game) => ['live', 'upcoming'].includes(getGameStatus(game, now)))
    .sort((left, right) => new Date(left.scheduledAt) - new Date(right.scheduledAt))[0];

  if (liveOrUpcoming) {
    return liveOrUpcoming;
  }

  return [...games].sort((left, right) => new Date(right.scheduledAt) - new Date(left.scheduledAt))[0];
}

function pickGameDayGames(games, currentGame, now = new Date(), selectedGame = null) {
  const selected = [];
  const addGame = (game) => {
    if (game && !selected.some((item) => item.id === game.id)) {
      selected.push(game);
    }
  };
  const byNewest = [...games].sort((left, right) => new Date(right.scheduledAt) - new Date(left.scheduledAt));
  const latestFinished = byNewest.find((game) => getGameStatus(game, now) === 'finished');
  const targetSize = selectedGame ? 3 : 2;

  addGame(currentGame);
  addGame(selectedGame);
  addGame(latestFinished);

  for (const game of byNewest) {
    if (selected.length >= targetSize) {
      break;
    }

    addGame(game);
  }

  return selected.sort((left, right) => new Date(right.scheduledAt) - new Date(left.scheduledAt));
}

export function buildChatSnapshot(state, chatId, viewerPlayerId = null, now = new Date(), options = {}) {
  const chat = state.chats[String(chatId)];
  const scopedChatIds = getSnapshotChatIds(state, chatId);
  const fallbackChat = scopedChatIds.map((id) => state.chats[id]).find(Boolean) ?? null;
  const allGames = Object.values(state.games).sort(compareByDate);
  const players = Object.values(state.players);

  if (!chat && !fallbackChat && !allGames.length && !players.length) {
    return {
      chat: null,
      currentGame: null,
      gameDays: [],
      games: [],
      players: [],
      availablePlayers: [],
      latestMvpPlayerId: null,
      viewerPlayerId,
      viewerCanCreateGames: false
    };
  }

  const globalCareer = buildGlobalCareerIndex(state, now);
  const latestMvp = getLatestMvpForGames(state, allGames, now);
  const achievementIndex = buildPlayerAchievementIndex(state, allGames, globalCareer, now);
  const ratingDeltaIndex = buildLatestRatingDeltaIndex(state, allGames, now);
  const buildPlayerCard = (player, playerCareer, isMvp = false) => {
    const careerEntry = playerCareer ?? {
      games: 0,
      ratedGames: 0,
      goals: 0,
      assists: 0,
      yellowCards: 0,
      redCards: 0,
      cards: {
        yellow: 0,
        red: 0
      },
      overall: 50,
      stats: { ...FALLBACK_STATS },
      position: 'N/A'
    };

    return {
      id: player.id,
      username: player.username,
      displayName: player.displayName || (player.username ? `@${player.username}` : 'Игрок'),
      firstName: player.firstName,
      lastName: player.lastName,
      photoUrl: player.photoUrl,
      overall: careerEntry.overall,
      ratingDelta: ratingDeltaIndex[player.id] ?? null,
      position: player.selfProfile?.position ||
        (careerEntry.ratedGames ? careerEntry.position : (player.defaultPosition || 'N/A')),
      stats: careerEntry.ratedGames ? careerEntry.stats : (player.selfProfile?.stats || careerEntry.stats),
      games: careerEntry.games,
      ratedGames: careerEntry.ratedGames,
      goals: careerEntry.goals,
      assists: careerEntry.assists,
      yellowCards: careerEntry.yellowCards,
      redCards: careerEntry.redCards,
      cards: careerEntry.cards,
      achievementCounts: achievementIndex[player.id] ?? {},
      hasSelfProfile: Boolean(player.selfProfile),
      isMvp
    };
  };
  const playerCards = players
    .map((player) => {
      const playerCareer = globalCareer.get(player.id) ?? {
        games: 0,
        ratedGames: 0,
        goals: 0,
        assists: 0,
        yellowCards: 0,
        redCards: 0,
        cards: {
          yellow: 0,
          red: 0
        },
        overall: 50,
        stats: { ...FALLBACK_STATS },
        position: 'N/A'
      };

      return buildPlayerCard(player, playerCareer, latestMvp?.playerId === player.id);
    })
    .sort(comparePlayers);
  const availablePlayers = getSelectablePlayers(state)
    .map((player) => buildPlayerCard(player, globalCareer.get(player.id), latestMvp?.playerId === player.id))
    .sort(comparePlayers);
  const viewerPlayer = viewerPlayerId ? state.players[viewerPlayerId] : null;

  const currentGame = pickCurrentGame(allGames, now);
  const buildGameDayView = (game) => {
    const aggregation = buildGameAggregation(state, game.id);
    const boostAggregation = buildGameBoostAggregation(state, game.id);
    const status = getGameStatus(game, now);
    const hasStarted = now >= new Date(game.scheduledAt);
    const priorCareer = buildCareerIndexForPlayersAndGames(
      state,
      players,
      allGames.filter((candidate) =>
        candidate.id !== game.id &&
        new Date(candidate.scheduledAt) < new Date(game.scheduledAt)
      ),
      now
    );
    const viewerIsParticipant = viewerPlayerId ? game.playerIds.includes(viewerPlayerId) : false;
    const ratingWindowOpen = isRatingWindowOpen(game, now);
    const invitedPlayerIds = (game.invitedPlayerIds ?? []).filter(
      (playerId) =>
        !game.playerIds.includes(playerId) &&
        !(game.declinedPlayerIds ?? []).includes(playerId)
    );
    const pendingJoinPlayerIds = (game.pendingJoinPlayerIds ?? []).filter(
      (playerId) => !game.playerIds.includes(playerId) && !invitedPlayerIds.includes(playerId)
    );
    const viewerJoinStatus = !viewerPlayerId
      ? 'anonymous'
      : viewerIsParticipant
        ? 'participant'
        : invitedPlayerIds.includes(viewerPlayerId)
          ? 'invited'
          : pendingJoinPlayerIds.includes(viewerPlayerId)
            ? 'pending'
            : 'none';
    const canViewerManage = Boolean(
      viewerPlayerId &&
      (
        game.organizerPlayerId === viewerPlayerId ||
        isSuperAdminPlayer(viewerPlayer) ||
        state.chats[String(game.chatId)]?.adminPlayerIds?.includes(viewerPlayerId)
      )
    );
    const viewerRatings = new Map(
      Object.values(state.ratings)
        .filter((rating) => rating.gameId === game.id && rating.raterPlayerId === viewerPlayerId)
        .map((rating) => [rating.targetPlayerId, rating])
    );
    const viewerBoosts = Object.values(state.statBoosts ?? {})
      .filter((boost) => boost.gameId === game.id && boost.raterPlayerId === viewerPlayerId)
      .map((boost) => ({
        targetPlayerId: boost.targetPlayerId,
        statKey: boost.statKey,
        points: boost.points
      }));
    const boostedTargetIdsByViewer = new Set(viewerBoosts.map((boost) => boost.targetPlayerId));
    const viewerMvpVote = Object.values(state.mvpVotes ?? {})
      .find((vote) => vote.gameId === game.id && vote.raterPlayerId === viewerPlayerId) ?? null;
    const viewerAchievementVotes = Object.values(state.achievementVotes ?? {})
      .filter((vote) => vote.gameId === game.id && vote.raterPlayerId === viewerPlayerId)
      .map((vote) => ({
        targetPlayerId: vote.targetPlayerId,
        achievementKey: vote.achievementKey
      }));

    return {
      id: game.id,
      dateLabel: normalizeDateLabel(game.dateLabel),
      location: game.location,
      time: game.time,
      scheduledAt: game.scheduledAt,
      priceLine: game.priceLine,
      paymentLines: game.paymentLines,
      status,
      hasStarted,
      isFinished: status === 'finished',
      ratingWindowOpen,
      ratingWindowEndsAt: getRatingWindowEnd(game).toISOString(),
      viewerIsParticipant,
      canViewerRate: ratingWindowOpen && viewerIsParticipant,
      viewerJoinStatus,
      canViewerRequestJoin: Boolean(
        viewerPlayerId &&
        viewerJoinStatus === 'none' &&
        game.organizerPlayerId &&
        status === 'upcoming' &&
        !ratingWindowOpen
      ),
      ratingsPromptSent: Boolean(game.ratingsOpenedAt),
      quickRatersCount: boostAggregation?.raterCount ?? 0,
      quickRatingPoints: QUICK_RATING_POINTS,
      viewerQuickRating: {
        mvpPlayerId: viewerMvpVote?.targetPlayerId ?? '',
        boosts: viewerBoosts,
        achievements: viewerAchievementVotes
      },
      organizerPlayerId: game.organizerPlayerId ?? null,
      canViewerManage,
      pendingJoinPlayers: pendingJoinPlayerIds
        .map((playerId) => {
          const profile = playerCards.find((player) => player.id === playerId);

          if (!profile) {
            return null;
          }

          return {
            ...profile,
            inviteStatus: 'pending',
            canViewerApproveJoin: canViewerManage,
            canViewerCancelJoin: viewerPlayerId === playerId
          };
        })
        .filter(Boolean),
      invitedPlayers: invitedPlayerIds
        .map((playerId) => {
          const profile = playerCards.find((player) => player.id === playerId);

          if (!profile) {
            return null;
          }

          return {
            ...profile,
            inviteStatus: 'invited',
            canViewerAcceptInvite: viewerPlayerId === playerId,
            canViewerDeclineInvite: viewerPlayerId === playerId
          };
        })
        .filter(Boolean),
      participants: game.playerIds
        .map((playerId) => {
          const profile = playerCards.find((player) => player.id === playerId);
          const gameStats = getGameStatsWithBoosts(
            state,
            game.id,
            playerId,
            profile,
            aggregation,
            boostAggregation
          );
          const previousCareer = priorCareer.get(playerId);
          const previousOverall = previousCareer?.ratedGames > 0 ? Number(previousCareer.overall) : null;
          const ratingDelta = gameStats?.hasRatings && previousOverall !== null
            ? round(Number(gameStats.overall) - previousOverall, 2)
            : null;
          const viewerRating = viewerRatings.get(playerId);

          return {
            ...profile,
            currentGameStats: gameStats
              ? {
                  ...gameStats,
                  previousOverall,
                  ratingDelta
                }
              : null,
            viewerHasRatedTarget: Boolean(viewerRating || boostedTargetIdsByViewer.has(playerId)),
            viewerRating: viewerRating
              ? {
                  position: viewerRating.position,
                  goals: viewerRating.goals,
                  assists: viewerRating.assists,
                  yellowCards: viewerRating.yellowCards ?? 0,
                  redCards: viewerRating.redCards ?? 0,
                  cards: {
                    yellow: viewerRating.yellowCards ?? 0,
                    red: viewerRating.redCards ?? 0
                  },
                  stats: Object.fromEntries(STAT_KEYS.map((key) => [key, viewerRating[key]]))
                }
              : null,
            canRateTarget:
              Boolean(viewerPlayerId) &&
              viewerPlayerId !== playerId &&
              viewerIsParticipant &&
              ratingWindowOpen
          };
        })
        .filter(Boolean)
    };
  };

  const currentGameView = currentGame ? buildGameDayView(currentGame) : null;
  const selectedGame = options.selectedGameId
    ? allGames.find((game) => game.id === String(options.selectedGameId))
    : null;
  const gameDays = pickGameDayGames(allGames, currentGame, now, selectedGame)
    .map((game) => buildGameDayView(game))
    .sort((left, right) => new Date(right.scheduledAt) - new Date(left.scheduledAt));

  return {
    chat: {
      id: chat?.id ?? fallbackChat?.id ?? String(chatId),
      title: chat?.title ?? fallbackChat?.title ?? '',
      currentGameId: currentGame?.id ?? null
    },
    viewerPlayerId,
    latestMvpPlayerId: latestMvp?.playerId ?? null,
    viewerCanCreateGames: Boolean(viewerPlayer),
    currentGame: currentGameView,
    gameDays,
    games: buildGamesView(state, allGames, playerCards, now),
    players: playerCards,
    availablePlayers
  };
}
