import { buildGameMvpIndexForGames } from './stats.js';

// Oldest to newest. A repeat never refreshes a player's place in the queue.
export function advanceStarFive(entries, entry) {
  if (entries.some((item) => item.playerId === entry.playerId)) return entries;
  return [...entries, entry].slice(-5);
}

export function getStarFiveCandidates(state, now = new Date()) {
  const games = Object.values(state.games).filter((game) =>
    new Date(game.scheduledAt) <= now
  ).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt) || a.id.localeCompare(b.id));
  const mvps = buildGameMvpIndexForGames(state, [...games], now);
  return games.flatMap((game) => {
    const mvp = mvps.get(game.id);
    return mvp && state.players[mvp.playerId]
      ? [{ gameId: game.id, chatId: String(game.chatId), playerId: mvp.playerId, scheduledAt: game.scheduledAt }]
      : [];
  });
}

export function buildStarFiveView(entries, playerCards) {
  const cards = new Map(playerCards.map((player) => [player.id, player]));
  const players = [...entries].reverse().flatMap((entry) => {
    const player = cards.get(entry.playerId);
    return player ? [{ ...player, mvpGameId: entry.gameId, enteredAt: entry.scheduledAt }] : [];
  });
  const rated = players.filter((player) => player.ratedGames > 0);
  return {
    players,
    rating: rated.length ? Math.round(rated.reduce((sum, player) => sum + player.overall, 0) / rated.length) : null,
    revision: entries.map((entry) => entry.gameId).join('_')
  };
}
