import fs from 'node:fs/promises';
import path from 'node:path';

import { createSessionToken } from './auth.js';
import { parseAnnouncementTextLog, parseTelegramExportGames } from './parser.js';
import { POSITION_OPTIONS, STAT_KEYS, buildCareerIndex, buildChatSnapshot } from './stats.js';
import { clamp, formatDisplayName, normalizeUsername, toIsoString, unique } from './utils.js';

const DEFAULT_POSITION_BY_USERNAME = {
  dbabanin: 'GK',
  satwerz: 'GK'
};

function defaultState() {
  return {
    version: 1,
    meta: {
      nextPlayerId: 1,
      nextGameId: 1,
      nextRatingId: 1
    },
    chats: {},
    players: {},
    games: {},
    ratings: {}
  };
}

function findPlayerByTelegramUserId(state, telegramUserId) {
  return Object.values(state.players).find((player) => player.telegramUserId === telegramUserId) ?? null;
}

function findPlayerById(state, playerId) {
  return state.players[playerId] ?? null;
}

function findPlayerByUsername(state, username) {
  const normalized = normalizeUsername(username);
  return Object.values(state.players).find((player) => player.username === normalized) ?? null;
}

function ensureChatState(state, chat) {
  const id = String(chat.id);
  const existing = state.chats[id] ?? {
    id,
    title: chat.title ?? '',
    type: chat.type ?? 'unknown',
    username: chat.username ?? '',
    currentGameId: null,
    playerIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  existing.title = chat.title ?? existing.title;
  existing.type = chat.type ?? existing.type;
  existing.username = chat.username ?? existing.username;
  existing.updatedAt = new Date().toISOString();
  state.chats[id] = existing;
  return existing;
}

function createPlayerRecord(state, username = '') {
  const id = `player_${state.meta.nextPlayerId++}`;
  const now = new Date().toISOString();
  const player = {
    id,
    telegramUserId: null,
    username: normalizeUsername(username),
    displayName: username ? `@${normalizeUsername(username)}` : 'Игрок',
    firstName: '',
    lastName: '',
    photoUrl: '',
    chatIds: [],
    createdAt: now,
    updatedAt: now
  };

  state.players[id] = player;
  return player;
}

function getDefaultPosition(username) {
  return DEFAULT_POSITION_BY_USERNAME[normalizeUsername(username)] || 'N/A';
}

function applyPlayerDefaults(player, username = '') {
  const defaultPosition = getDefaultPosition(username || player.username);

  if (defaultPosition !== 'N/A') {
    player.defaultPosition = defaultPosition;
  } else if (!player.defaultPosition) {
    player.defaultPosition = 'N/A';
  }

  return player;
}

function attachPlayerToChat(state, chatId, playerId) {
  const chat = state.chats[String(chatId)];

  if (!chat) {
    return;
  }

  chat.playerIds = unique([...(chat.playerIds ?? []), playerId]);
  const player = state.players[playerId];
  player.chatIds = unique([...(player.chatIds ?? []), String(chatId)]);
  player.updatedAt = new Date().toISOString();
}

function sanitizePosition(position) {
  return POSITION_OPTIONS.includes(position) ? position : 'CM';
}

function sanitizeProfilePosition(position) {
  return POSITION_OPTIONS.includes(position) ? position : 'N/A';
}

function isGameEditableBeforeStart(game, now) {
  if (!game) {
    return false;
  }

  if (game.ratingsOpenedAt) {
    return false;
  }

  return new Date(game.scheduledAt) > now;
}

function isSameAnnouncementSchedule(game, announcement) {
  return game.date === announcement.date && game.time === announcement.time;
}

function createDateWithOffset(year, monthIndex, day, hours, minutes, offset) {
  const match = String(offset).trim().match(/^([+-])(\d{2}):(\d{2})$/);

  if (!match) {
    return new Date(year, monthIndex, day, hours, minutes, 0, 0);
  }

  const sign = match[1] === '-' ? -1 : 1;
  const offsetHours = Number(match[2]);
  const offsetMinutes = Number(match[3]);
  const totalOffsetMinutes = sign * (offsetHours * 60 + offsetMinutes);
  const utcTimestamp = Date.UTC(year, monthIndex, day, hours, minutes, 0, 0) - totalOffsetMinutes * 60 * 1000;
  return new Date(utcTimestamp);
}

function buildManualSchedule(date, time, timezoneOffset = process.env.CHAT_TIMEZONE_OFFSET || '+03:00') {
  const dateMatch = String(date ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(time ?? '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);

  if (!dateMatch || !timeMatch) {
    throw new Error('Укажите дату и время игры');
  }

  const year = Number(dateMatch[1]);
  const monthIndex = Number(dateMatch[2]) - 1;
  const day = Number(dateMatch[3]);
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const scheduledAt = createDateWithOffset(year, monthIndex, day, hours, minutes, timezoneOffset);
  const monthNames = [
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

  return {
    scheduledAt: scheduledAt.toISOString(),
    date: scheduledAt.toISOString().slice(0, 10),
    dateLabel: `${day} ${monthNames[monthIndex]}`,
    time: `${timeMatch[1]}:${timeMatch[2]}`
  };
}

function setCurrentGame(chat, game, nowIso, previousGame = null) {
  if (previousGame && previousGame.id !== game.id && !previousGame.closedAt) {
    previousGame.closedAt = nowIso;
    previousGame.ratingsClosedByGameId = game.id;
    previousGame.updatedAt = nowIso;
  }

  chat.currentGameId = game.id;
  chat.updatedAt = nowIso;
}

function resolveAnnouncementPlayerIds(state, chatId, usernames) {
  return usernames.map((username) => {
    let player = findPlayerByUsername(state, username);

    if (!player) {
      player = createPlayerRecord(state, username);
    }

    applyPlayerDefaults(player, username);

    attachPlayerToChat(state, chatId, player.id);
    return player.id;
  });
}

function applyAnnouncementToGame(state, game, {
  chatId,
  messageId,
  rawText,
  announcement,
  source,
  sourceDate,
  nowIso
}) {
  const playerIds = resolveAnnouncementPlayerIds(state, chatId, announcement.playerUsernames);

  game.messageId = messageId;
  game.rawText = rawText;
  game.key = announcement.key;
  game.source = source;
  game.sourceDate = sourceDate ? toIsoString(sourceDate) : nowIso;
  game.dateLabel = announcement.dateLabel;
  game.location = announcement.location;
  game.time = announcement.time;
  game.scheduledAt = announcement.scheduledAt;
  game.date = announcement.date;
  game.priceLine = announcement.priceLine;
  game.paymentLines = announcement.paymentLines;
  game.playerUsernames = announcement.playerUsernames;
  game.playerIds = playerIds;
  game.updatedAt = nowIso;

  return game;
}

function mergeImportedAnnouncements(state, {
  chatId,
  chatTitle,
  chatType,
  items,
  source
}) {
  ensureChatState(state, {
    id: chatId,
    title: chatTitle,
    type: chatType
  });

  let importedGames = 0;

  for (const item of items) {
    const existingByMessageId = Object.values(state.games).find(
      (game) =>
        game.chatId === String(chatId) &&
        game.messageId === item.messageId &&
        item.messageId !== null
    );

    if (existingByMessageId) {
      continue;
    }

    const existingByKey = Object.values(state.games).find(
      (game) =>
        game.chatId === String(chatId) && game.key === item.announcement.key
    );

    if (existingByKey) {
      continue;
    }

    const playerIds = item.announcement.playerUsernames.map((username) => {
      let player = findPlayerByUsername(state, username);

      if (!player) {
        player = createPlayerRecord(state, username);
      }

      attachPlayerToChat(state, chatId, player.id);
      return player.id;
    });

    const gameId = `game_${state.meta.nextGameId++}`;
    const now = new Date().toISOString();
    state.games[gameId] = {
      id: gameId,
      chatId: String(chatId),
      messageId: item.messageId,
      rawText: item.rawText,
      key: item.announcement.key,
      source,
      sourceDate: item.sourceDate,
      dateLabel: item.announcement.dateLabel,
      location: item.announcement.location,
      time: item.announcement.time,
      scheduledAt: item.announcement.scheduledAt,
      date: item.announcement.date,
      priceLine: item.announcement.priceLine,
      paymentLines: item.announcement.paymentLines,
      playerUsernames: item.announcement.playerUsernames,
      playerIds,
      ratingsOpenedAt: null,
      ratingsPromptMessageId: null,
      ratingsClosedByGameId: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now
    };
    importedGames += 1;
  }

  return importedGames;
}

export class AppStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = defaultState();
    this.writeQueue = Promise.resolve();
    this.sessions = new Map();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      this.state = {
        ...defaultState(),
        ...parsed,
        meta: {
          ...defaultState().meta,
          ...(parsed?.meta ?? {})
        }
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }

      await this.persist();
    }
  }

  async persist() {
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(this.state, null, 2), 'utf-8');
    await fs.rename(tempPath, this.filePath);
  }

  async mutate(mutator) {
    const run = async () => {
      const result = await mutator(this.state);
      await this.persist();
      return result;
    };
    const next = this.writeQueue.then(run, run);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  async ensureChat(chat) {
    return this.mutate((state) => ensureChatState(state, chat));
  }

  async rememberTelegramUser(chatId, user, extra = {}) {
    return this.mutate((state) => {
      const chat = ensureChatState(state, {
        id: chatId,
        title: extra.chatTitle ?? '',
        type: extra.chatType ?? 'unknown'
      });
      const normalizedUsername = normalizeUsername(user?.username || extra.username);
      let player =
        findPlayerByTelegramUserId(state, user?.id ?? null) ??
        findPlayerByUsername(state, normalizedUsername);

      if (!player) {
        player = createPlayerRecord(state, normalizedUsername);
      }

      player.telegramUserId = user?.id ?? player.telegramUserId;
      player.username = normalizedUsername || player.username;
      player.firstName = user?.first_name ?? player.firstName;
      player.lastName = user?.last_name ?? player.lastName;
      player.displayName = extra.displayName || formatDisplayName(user) || player.displayName;
      player.photoUrl = extra.photoUrl || user?.photo_url || player.photoUrl;
      if (chat.type === 'private') {
        player.privateChatId = String(chat.id);
        player.privateStartedAt = player.privateStartedAt || new Date().toISOString();
      }
      player.updatedAt = new Date().toISOString();
      applyPlayerDefaults(player, normalizedUsername);

      attachPlayerToChat(state, chat.id, player.id);
      return player;
    });
  }

  async upsertPlayerByUsername(chatId, username) {
    return this.mutate((state) => {
      ensureChatState(state, { id: chatId, title: '', type: 'supergroup' });
      let player = findPlayerByUsername(state, username);

      if (!player) {
        player = createPlayerRecord(state, username);
      }

      if (!player.displayName || player.displayName === 'Игрок') {
        player.displayName = `@${normalizeUsername(username)}`;
      }

      applyPlayerDefaults(player, username);

      attachPlayerToChat(state, chatId, player.id);
      return player;
    });
  }

  async recordGameFromAnnouncement({
    chatId,
    chatTitle = '',
    chatType = 'supergroup',
    messageId = null,
    rawText,
    announcement,
    source = 'telegram-message',
    sourceDate = null
  }) {
    return this.mutate((state) => {
      const effectiveNow = sourceDate ? new Date(sourceDate) : new Date();
      const now = effectiveNow.toISOString();
      const chat = ensureChatState(state, {
        id: chatId,
        title: chatTitle,
        type: chatType
      });
      const currentGame = chat.currentGameId ? state.games[chat.currentGameId] : null;
      const existingByMessageId = Object.values(state.games).find(
        (game) => game.chatId === String(chatId) && game.messageId === messageId && messageId !== null
      );

      if (existingByMessageId) {
        if (isGameEditableBeforeStart(existingByMessageId, effectiveNow)) {
          const game = applyAnnouncementToGame(state, existingByMessageId, {
            chatId,
            messageId,
            rawText,
            announcement,
            source,
            sourceDate,
            nowIso: now
          });
          setCurrentGame(chat, game, now, currentGame);
          return { created: false, updated: true, game };
        }

        return { created: false, updated: false, game: existingByMessageId };
      }

      const existingBySchedule = Object.values(state.games).find(
        (game) => game.chatId === String(chatId) && isSameAnnouncementSchedule(game, announcement)
      );

      if (existingBySchedule) {
        if (isGameEditableBeforeStart(existingBySchedule, effectiveNow)) {
          const game = applyAnnouncementToGame(state, existingBySchedule, {
            chatId,
            messageId,
            rawText,
            announcement,
            source,
            sourceDate,
            nowIso: now
          });
          setCurrentGame(chat, game, now, currentGame);
          return { created: false, updated: true, game };
        }

        return { created: false, updated: false, game: existingBySchedule };
      }

      if (currentGame && isGameEditableBeforeStart(currentGame, effectiveNow)) {
        const game = applyAnnouncementToGame(state, currentGame, {
          chatId,
          messageId,
          rawText,
          announcement,
          source,
            sourceDate,
            nowIso: now
        });
        setCurrentGame(chat, game, now, currentGame);
        return { created: false, updated: true, game };
      }

      const existingByKey = Object.values(state.games).find(
        (game) => game.chatId === String(chatId) && game.key === announcement.key
      );

      if (existingByKey) {
        return { created: false, updated: false, game: existingByKey };
      }

      const playerIds = resolveAnnouncementPlayerIds(state, chatId, announcement.playerUsernames);
      const gameId = `game_${state.meta.nextGameId++}`;
      const game = {
        id: gameId,
        chatId: String(chatId),
        messageId,
        rawText,
        key: announcement.key,
        source,
        sourceDate: sourceDate ? toIsoString(sourceDate) : now,
        dateLabel: announcement.dateLabel,
        location: announcement.location,
        time: announcement.time,
        scheduledAt: announcement.scheduledAt,
        date: announcement.date,
        priceLine: announcement.priceLine,
        paymentLines: announcement.paymentLines,
        playerUsernames: announcement.playerUsernames,
        playerIds,
        ratingsOpenedAt: null,
        ratingsPromptMessageId: null,
        ratingsClosedByGameId: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now
      };

      state.games[gameId] = game;
      setCurrentGame(chat, game, now, currentGame);
      return { created: true, game };
    });
  }

  async createManualGame({
    chatId,
    organizerPlayerId,
    date,
    time,
    location,
    playerIds,
    timezoneOffset
  }) {
    return this.mutate((state) => {
      const chat = state.chats[String(chatId)];
      const organizer = findPlayerById(state, organizerPlayerId);

      if (!chat) {
        throw new Error('Чат не найден');
      }

      if (!organizer) {
        throw new Error('Организатор не найден');
      }

      const selectedPlayerIds = unique(
        (Array.isArray(playerIds) ? playerIds : [])
          .map((playerId) => String(playerId))
          .filter((playerId) => Boolean(state.players[playerId]))
      );

      if (selectedPlayerIds.length < 2) {
        throw new Error('Добавьте минимум двух игроков');
      }

      const schedule = buildManualSchedule(date, time, timezoneOffset);
      const now = new Date().toISOString();
      const gameId = `game_${state.meta.nextGameId++}`;
      const usernames = selectedPlayerIds.map((playerId) => state.players[playerId]?.username).filter(Boolean);
      const game = {
        id: gameId,
        chatId: String(chatId),
        messageId: null,
        rawText: '',
        key: [
          schedule.scheduledAt.slice(0, 16),
          String(location ?? '').trim().toLowerCase(),
          selectedPlayerIds.join(',')
        ].join('|'),
        source: 'manual',
        sourceDate: now,
        organizerPlayerId,
        dateLabel: schedule.dateLabel,
        location: String(location ?? '').trim(),
        time: schedule.time,
        scheduledAt: schedule.scheduledAt,
        date: schedule.date,
        priceLine: '',
        paymentLines: [],
        playerUsernames: usernames,
        playerIds: selectedPlayerIds,
        declinedPlayerIds: [],
        ratingsOpenedAt: null,
        ratingsPromptMessageId: null,
        ratingsClosedByGameId: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now
      };

      for (const playerId of selectedPlayerIds) {
        attachPlayerToChat(state, chat.id, playerId);
      }

      state.games[gameId] = game;
      const currentGame = chat.currentGameId ? state.games[chat.currentGameId] : null;
      setCurrentGame(chat, game, now, currentGame);
      return { created: true, game };
    });
  }

  async removePlayerFromGame({ gameId, playerId }) {
    return this.mutate((state) => {
      const game = state.games[gameId];
      const player = findPlayerById(state, playerId);

      if (!game || !player) {
        throw new Error('Игра или игрок не найдены');
      }

      const wasInGame = game.playerIds.includes(playerId);

      if (wasInGame) {
        game.playerIds = game.playerIds.filter((id) => id !== playerId);
        game.playerUsernames = game.playerIds.map((id) => state.players[id]?.username).filter(Boolean);
        game.declinedPlayerIds = unique([...(game.declinedPlayerIds ?? []), playerId]);
        game.updatedAt = new Date().toISOString();
      }

      return {
        removed: wasInGame,
        game,
        player,
        organizer: game.organizerPlayerId ? findPlayerById(state, game.organizerPlayerId) : null
      };
    });
  }

  async importTelegramExport({
    chatId,
    chatTitle = 'Football Chat',
    chatType = 'supergroup',
    payload
  }) {
    const games = parseTelegramExportGames(payload);

    if (!games.length) {
      return {
        importedGames: 0,
        totalFound: 0
      };
    }

    return this.mutate((state) => {
      const importedGames = mergeImportedAnnouncements(state, {
        chatId,
        chatTitle,
        chatType,
        items: games,
        source: 'history-import'
      });
      return {
        importedGames,
        totalFound: games.length
      };
    });
  }

  async importAnnouncementTextLog({
    chatId,
    chatTitle = 'Football Chat',
    chatType = 'supergroup',
    text,
    referenceDate = new Date()
  }) {
    const items = parseAnnouncementTextLog(text, referenceDate);

    if (!items.length) {
      return {
        importedGames: 0,
        totalFound: 0
      };
    }

    return this.mutate((state) => {
      const importedGames = mergeImportedAnnouncements(state, {
        chatId,
        chatTitle,
        chatType,
        items,
        source: 'text-import'
      });
      return {
        importedGames,
        totalFound: items.length
      };
    });
  }

  listGamesRequiringPrompt(now = new Date()) {
    return Object.values(this.state.games).filter((game) => {
      const chat = this.state.chats[game.chatId];

      if (!chat || chat.currentGameId !== game.id || game.ratingsOpenedAt) {
        return false;
      }

      return new Date(game.scheduledAt) <= now;
    });
  }

  async markRatingsPromptSent(gameId, messageId) {
    return this.mutate((state) => {
      const game = state.games[gameId];

      if (!game) {
        return null;
      }

      game.ratingsOpenedAt = new Date().toISOString();
      game.ratingsPromptMessageId = messageId ?? null;
      game.updatedAt = new Date().toISOString();
      return game;
    });
  }

  async submitRating({ chatId, gameId, raterPlayerId, targetPlayerId, payload }) {
    return this.mutate((state) => {
      const chat = state.chats[String(chatId)];
      const game = state.games[gameId];

      if (!chat || !game || game.chatId !== String(chatId)) {
        throw new Error('Игра не найдена');
      }

      if (chat.currentGameId !== gameId) {
        throw new Error('Окно оценки уже закрыто новой игрой');
      }

      if (new Date(game.scheduledAt) > new Date()) {
        throw new Error('Игра еще не началась');
      }

      if (raterPlayerId === targetPlayerId) {
        throw new Error('Нельзя оценивать себя');
      }

      if (!game.playerIds.includes(raterPlayerId) || !game.playerIds.includes(targetPlayerId)) {
        throw new Error('Оценивать можно только участников текущей игры');
      }

      let rating = Object.values(state.ratings).find(
        (item) =>
          item.gameId === gameId &&
          item.raterPlayerId === raterPlayerId &&
          item.targetPlayerId === targetPlayerId
      );

      if (!rating) {
        rating = {
          id: `rating_${state.meta.nextRatingId++}`,
          chatId: String(chatId),
          gameId,
          raterPlayerId,
          targetPlayerId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }

      rating.position = sanitizePosition(payload.position);

      for (const key of STAT_KEYS) {
        rating[key] = clamp(Number(payload[key] ?? 50), 1, 99);
      }

      rating.goals = rating.position === 'GK' ? 0 : clamp(Number(payload.goals ?? 0), 0, 20);
      rating.assists = rating.position === 'GK' ? 0 : clamp(Number(payload.assists ?? 0), 0, 20);
      rating.updatedAt = new Date().toISOString();
      state.ratings[rating.id] = rating;
      return rating;
    });
  }

  async updateSelfProfile({ chatId, playerId, payload }) {
    return this.mutate((state) => {
      const chat = state.chats[String(chatId)];
      const player = state.players[playerId];

      if (!chat || !player || !chat.playerIds.includes(playerId)) {
        throw new Error('Игрок не найден');
      }

      const career = buildCareerIndex(state, chatId).get(playerId);

      if (career?.ratedGames > 0) {
        throw new Error('Карточку уже формируют оценки других игроков');
      }

      player.selfProfile = {
        position: sanitizeProfilePosition(payload.position),
        stats: Object.fromEntries(
          STAT_KEYS.map((key) => [key, clamp(Number(payload[key] ?? 50), 1, 99)])
        ),
        updatedAt: new Date().toISOString()
      };
      player.updatedAt = new Date().toISOString();
      return player.selfProfile;
    });
  }

  createSession(playerId, chatId) {
    const token = createSessionToken();
    this.sessions.set(token, {
      token,
      playerId,
      chatId: String(chatId),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
    });
    return token;
  }

  getSession(token) {
    if (!token) {
      return null;
    }

    const session = this.sessions.get(token);

    if (!session) {
      return null;
    }

    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return null;
    }

    return session;
  }

  cleanupSessions() {
    for (const [token, session] of this.sessions.entries()) {
      if (session.expiresAt < Date.now()) {
        this.sessions.delete(token);
      }
    }
  }

  loginDevUser(chatId, username, displayName = '') {
    return this.mutate((state) => {
      ensureChatState(state, { id: chatId, title: '', type: 'supergroup' });
      let player = findPlayerByUsername(state, username);

      if (!player) {
        player = createPlayerRecord(state, username);
      }

      player.username = normalizeUsername(username);
      player.displayName = displayName || player.displayName || `@${player.username}`;
      attachPlayerToChat(state, chatId, player.id);
      const token = createSessionToken();

      this.sessions.set(token, {
        token,
        playerId: player.id,
        chatId: String(chatId),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
      });

      return { player, token };
    });
  }

  getSnapshot(chatId, viewerPlayerId = null) {
    return buildChatSnapshot(this.state, String(chatId), viewerPlayerId, new Date());
  }

  getPlayerById(playerId) {
    return findPlayerById(this.state, playerId);
  }

  getPlayerByTelegramUserId(telegramUserId) {
    return findPlayerByTelegramUserId(this.state, telegramUserId);
  }

  getGameById(gameId) {
    return this.state.games[gameId] ?? null;
  }
}
