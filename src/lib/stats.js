import { round } from './utils.js';

export const STAT_KEYS = ['pace', 'dribbling', 'shooting', 'defense', 'passing', 'physical'];
export const POSITION_OPTIONS = ['N/A', 'GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST'];
export const RATING_WINDOW_MS = 24 * 60 * 60 * 1000;

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
const DATE_LABEL_REGEX = new RegExp(`\\b(\\d{1,2})\\s+(${DATE_LABEL_MONTHS.join('|')})\\b`, 'i');

function compareByDate(left, right) {
  return new Date(left.scheduledAt) - new Date(right.scheduledAt);
}

function getRatingWindowEnd(game) {
  return new Date(new Date(game.scheduledAt).getTime() + RATING_WINDOW_MS);
}

export function isRatingWindowOpen(game, now = new Date()) {
  const scheduledAt = new Date(game.scheduledAt);
  return now >= scheduledAt && now < getRatingWindowEnd(game);
}

function isFinalizedForCareer(game, now = new Date()) {
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

function buildCareerIndexForPlayersAndGames(state, players, games, now = new Date()) {
  const career = new Map();

  for (const player of players) {
    career.set(player.id, createEmptyCareerEntry());
  }

  for (const game of games.filter((item) => isFinalizedForCareer(item, now))) {
    const aggregation = buildGameAggregation(state, game.id);

    for (const playerId of game.playerIds) {
      applyGameToCareerEntry(ensureCareerEntry(career, playerId), aggregation?.players[playerId]);
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

  for (const game of games.sort(compareByDate)) {
    if (!isFinalizedForCareer(game, now)) {
      continue;
    }

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
      applyGameToCareerEntry(ensureCareerEntry(career, playerId), aggregation?.players[playerId]);
    }
  }

  return mvpIndex;
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

function buildGamesView(state, games, playerCards, now) {
  const mvpIndex = buildGameMvpIndexForGames(state, games, now);
  const playersById = new Map(playerCards.map((player) => [player.id, player]));

  return games
    .map((game) => {
      const aggregation = buildGameAggregation(state, game.id);
      const mvp = mvpIndex.get(game.id);
      const mvpPlayer = mvp ? playersById.get(mvp.playerId) : null;
      const totalGoals = round(
        game.playerIds.reduce((sum, playerId) => {
          const gameStats = aggregation?.players[playerId];
          return sum + (gameStats?.hasRatings ? gameStats.goals : 0);
        }, 0)
      );
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
      const topScorerPlayer = topScorer ? playersById.get(topScorer.playerId) : null;

      return {
        id: game.id,
        dateLabel: normalizeDateLabel(game.dateLabel),
        location: game.location,
        time: game.time,
        scheduledAt: game.scheduledAt,
        status: getGameStatus(game, now),
        playersCount: game.playerIds.length,
        totalGoals,
        mvp: mvp
          ? {
              playerId: mvp.playerId,
              displayName: mvpPlayer?.displayName || 'Игрок',
              username: mvpPlayer?.username || '',
              ratingIncrease: mvp.ratingIncrease,
              overall: mvp.overall
            }
          : null,
        topScorer: topScorer
          ? {
              playerId: topScorer.playerId,
              displayName: topScorerPlayer?.displayName || 'Игрок',
              username: topScorerPlayer?.username || '',
              goals: topScorer.goals,
              overall: topScorer.overall
            }
          : null
      };
    })
    .sort((left, right) => new Date(right.scheduledAt) - new Date(left.scheduledAt));
}

function getSnapshotChatIds(state, chatId) {
  const footballChatIds = Object.values(state.chats)
    .filter((chat) => chat.type !== 'private')
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

export function buildChatSnapshot(state, chatId, viewerPlayerId = null, now = new Date()) {
  const chat = state.chats[String(chatId)];

  const scopedChatIds = getSnapshotChatIds(state, chatId);
  const fallbackChat = scopedChatIds.map((id) => state.chats[id]).find(Boolean) ?? null;

  if (!chat && !scopedChatIds.length) {
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

  const scopedGames = getGamesForChatIds(state, scopedChatIds);
  const players = Object.values(state.players);
  const globalCareer = buildGlobalCareerIndex(state, now);
  const latestMvp = getLatestMvpForGames(state, scopedGames, now);
  const buildPlayerCard = (player, playerCareer, isMvp = false) => {
    const careerEntry = playerCareer ?? {
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
      overall: careerEntry.overall,
      position: careerEntry.ratedGames ? careerEntry.position : (player.selfProfile?.position || player.defaultPosition || 'N/A'),
      stats: careerEntry.ratedGames ? careerEntry.stats : (player.selfProfile?.stats || careerEntry.stats),
      games: careerEntry.games,
      ratedGames: careerEntry.ratedGames,
      goals: careerEntry.goals,
      assists: careerEntry.assists,
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

  const currentGame = pickCurrentGame(scopedGames, now);
  const buildGameDayView = (game) => {
    const aggregation = buildGameAggregation(state, game.id);
    const status = getGameStatus(game, now);
    const hasStarted = now >= new Date(game.scheduledAt);
    const viewerIsParticipant = viewerPlayerId ? game.playerIds.includes(viewerPlayerId) : false;
    const ratingWindowOpen = isRatingWindowOpen(game, now);
    const viewerRatings = new Map(
      Object.values(state.ratings)
        .filter((rating) => rating.gameId === game.id && rating.raterPlayerId === viewerPlayerId)
        .map((rating) => [rating.targetPlayerId, rating])
    );

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
      ratingsPromptSent: Boolean(game.ratingsOpenedAt),
      organizerPlayerId: game.organizerPlayerId ?? null,
      canViewerManage: Boolean(viewerPlayerId && game.organizerPlayerId === viewerPlayerId),
      participants: game.playerIds
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
  };

  const currentGameView = currentGame ? buildGameDayView(currentGame) : null;
  const gameDays = scopedGames
    .slice(-2)
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
    viewerCanCreateGames: Boolean(viewerPlayer?.privateChatId),
    currentGame: currentGameView,
    gameDays,
    games: buildGamesView(state, scopedGames, playerCards, now),
    players: playerCards,
    availablePlayers
  };
}
