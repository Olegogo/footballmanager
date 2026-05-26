import { round } from './utils.js';

export const STAT_KEYS = ['pace', 'dribbling', 'shooting', 'defense', 'passing', 'physical'];
export const POSITION_OPTIONS = ['N/A', 'GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST'];

const FALLBACK_STATS = {
  pace: 50,
  dribbling: 50,
  shooting: 50,
  defense: 50,
  passing: 50,
  physical: 50
};

function compareByDate(left, right) {
  return new Date(left.scheduledAt) - new Date(right.scheduledAt);
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

function createEmptyCareerEntry() {
  return {
    games: 0,
    ratedGames: 0,
    goals: 0,
    assists: 0,
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

function finalizeSummary(summary) {
  if (!summary.count) {
    return {
      hasRatings: false,
      stats: { ...FALLBACK_STATS },
      overall: 50,
      goals: 0,
      assists: 0,
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
    overall,
    stats,
    position: entry.ratedGames ? pickDominantPosition(entry.positionCounts) : 'N/A'
  };
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
  entry.positionCounts[gameStats.position] = (entry.positionCounts[gameStats.position] ?? 0) + 1;

  for (const key of STAT_KEYS) {
    entry.statSums[key] += gameStats.stats[key];
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

export function getGamesForChat(state, chatId) {
  return Object.values(state.games)
    .filter((game) => game.chatId === String(chatId))
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

export function buildCareerIndex(state, chatId) {
  const players = getChatPlayers(state, chatId);
  const games = getGamesForChat(state, chatId);
  const career = new Map();

  for (const player of players) {
    career.set(player.id, createEmptyCareerEntry());
  }

  for (const game of games) {
    const aggregation = buildGameAggregation(state, game.id);

    for (const playerId of game.playerIds) {
      applyGameToCareerEntry(ensureCareerEntry(career, playerId), aggregation?.players[playerId]);
    }
  }

  return new Map(
    [...career.entries()].map(([playerId, entry]) => [playerId, finalizeCareerEntry(entry)])
  );
}

export function getLatestMvp(state, chatId) {
  const games = getGamesForChat(state, chatId);
  const career = new Map();
  let latestMvp = null;

  for (const game of games) {
    const aggregation = buildGameAggregation(state, game.id);
    const candidates = game.playerIds
      .map((playerId) => {
        const entry = ensureCareerEntry(career, playerId);
        const summary = aggregation?.players[playerId];

        if (!summary?.hasRatings) {
          return null;
        }

        const previousOverall = finalizeCareerEntry(entry).overall;
        const nextOverall = previewCareerOverallAfterGame(entry, summary);
        const increase = round(nextOverall - previousOverall, 2);

        return {
          playerId,
          summary,
          previousOverall,
          nextOverall,
          increase
        };
      })
      .filter((candidate) => candidate?.increase > 0);

    if (candidates.length) {
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

      latestMvp = {
        gameId: game.id,
        playerId: candidates[0].playerId,
        overall: candidates[0].nextOverall,
        ratingIncrease: candidates[0].increase,
        previousOverall: candidates[0].previousOverall,
        gameOverall: candidates[0].summary.overall
      };
    }

    for (const playerId of game.playerIds) {
      applyGameToCareerEntry(ensureCareerEntry(career, playerId), aggregation?.players[playerId]);
    }
  }

  return latestMvp;
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

  if (now >= finishedAt) {
    return 'finished';
  }

  return 'live';
}

export function buildChatSnapshot(state, chatId, viewerPlayerId = null, now = new Date()) {
  const chat = state.chats[String(chatId)];

  if (!chat) {
    return {
      chat: null,
      currentGame: null,
      players: [],
      latestMvpPlayerId: null,
      viewerPlayerId
    };
  }

  const players = getChatPlayers(state, chatId);
  const career = buildCareerIndex(state, chatId);
  const latestMvp = getLatestMvp(state, chatId);
  const playerCards = players
    .map((player) => {
      const playerCareer = career.get(player.id) ?? {
        games: 0,
        ratedGames: 0,
        goals: 0,
        assists: 0,
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
        overall: playerCareer.overall,
        position: playerCareer.ratedGames ? playerCareer.position : (player.defaultPosition || 'N/A'),
        stats: playerCareer.stats,
        games: playerCareer.games,
        ratedGames: playerCareer.ratedGames,
        goals: playerCareer.goals,
        assists: playerCareer.assists,
        isMvp: latestMvp?.playerId === player.id
      };
    })
    .sort(comparePlayers);

  const currentGame = chat.currentGameId ? state.games[chat.currentGameId] : null;
  let currentGameView = null;

  if (currentGame) {
    const aggregation = buildGameAggregation(state, currentGame.id);
    const status = getGameStatus(currentGame, now);
    const hasStarted = now >= new Date(currentGame.scheduledAt);
    const viewerIsParticipant = viewerPlayerId ? currentGame.playerIds.includes(viewerPlayerId) : false;
    const ratingWindowOpen = chat.currentGameId === currentGame.id && hasStarted;
    const viewerRatings = new Map(
      Object.values(state.ratings)
        .filter((rating) => rating.gameId === currentGame.id && rating.raterPlayerId === viewerPlayerId)
        .map((rating) => [rating.targetPlayerId, rating])
    );

    currentGameView = {
      id: currentGame.id,
      dateLabel: currentGame.dateLabel,
      location: currentGame.location,
      time: currentGame.time,
      scheduledAt: currentGame.scheduledAt,
      priceLine: currentGame.priceLine,
      paymentLines: currentGame.paymentLines,
      status,
      hasStarted,
      isFinished: status === 'finished',
      ratingWindowOpen,
      viewerIsParticipant,
      canViewerRate: ratingWindowOpen && viewerIsParticipant,
      ratingsPromptSent: Boolean(currentGame.ratingsOpenedAt),
      participants: currentGame.playerIds
        .map((playerId) => {
          const profile = playerCards.find((player) => player.id === playerId);
          const gameStats = aggregation?.players[playerId];
          const viewerRating = viewerRatings.get(playerId);

          return {
            ...profile,
            currentGameStats: gameStats ?? null,
            viewerHasRatedTarget: Boolean(viewerRating),
            viewerRating: viewerRating
              ? {
                  position: viewerRating.position,
                  goals: viewerRating.goals,
                  assists: viewerRating.assists,
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
  }

  return {
    chat: {
      id: chat.id,
      title: chat.title,
      currentGameId: chat.currentGameId
    },
    viewerPlayerId,
    latestMvpPlayerId: latestMvp?.playerId ?? null,
    currentGame: currentGameView,
    players: playerCards
  };
}
