import { advanceStarFive, buildStarFiveView, getStarFiveCandidates } from './star-five.js';
import { scheduleInTimeZone } from './timezone.js';
import { AppError } from './errors.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { isSuperAdminPlayer } from './admins.js';
import { createSessionToken } from './auth.js';
import { parseAnnouncementTextLog, parseTelegramExportGames } from './parser.js';
import { MAX_RED_CARDS, MAX_YELLOW_CARDS, POSITION_OPTIONS, QUICK_ACHIEVEMENT_DEFINITIONS, QUICK_RATING_POINTS, STAT_KEYS, buildChatSnapshot, buildGlobalCareerIndex, getRatingWindowEnd, haveAllParticipantsRated, isRatingWindowOpen } from './stats.js';
import { clamp, formatDisplayName, normalizeUsername, toIsoString, unique } from './utils.js';
import { DEFAULT_LOCALE, normalizeLocale, resolveLocale } from '../../packages/i18n/index.js';

const DEFAULT_POSITION_BY_USERNAME = {
  dbabanin: 'GK',
  satwerz: 'GK'
};

const DEFAULT_MANUAL_GAME_DURATION_MINUTES = 90;

function defaultState() {
  return {
    version: 1,
    meta: {
      nextPlayerId: 1,
      nextGameId: 1,
      nextRatingId: 1,
      nextStatBoostId: 1,
      nextMvpVoteId: 1,
      nextAchievementVoteId: 1,
      nextTeamId: 1,
      nextChallengeId: 1,
      nextAnnouncementDraftId: 1
    },
    chats: {},
    players: {},
    games: {},
    ratings: {},
    statBoosts: {},
    mvpVotes: {},
    achievementVotes: {},
    teams: {},
    teamChallenges: {},
    announcementDrafts: {},
    sessions: {}
  };
}

const TEAM_FORMATS = new Set(['5x5', '6x6', '7x7', '8x8', '11x11']);
const TEAM_LEVELS = new Set(['beginner', 'amateur', 'strong_amateur', 'semi_pro']);
const TEAM_STATUSES = new Set(['open', 'invite_only', 'inactive']);
const CHALLENGE_MODES = new Set(['friendly', 'ranked', 'open']);

function normalizeChoice(value, choices, fallback) {
  const normalized = String(value ?? '').trim();
  return choices.has(normalized) ? normalized : fallback;
}

function normalizeTeamImageUrl(value) {
  const normalized = String(value ?? '').trim();

  if (!normalized) return '';
  if (normalized.length > 700_000) {
    throw new AppError('team_image_large');
  }
  if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(normalized) && !/^https:\/\//i.test(normalized)) {
    throw new AppError('team_image_invalid');
  }
  return normalized;
}

function assertCanManageTeam(state, team, requesterPlayerId) {
  const requester = findPlayerById(state, requesterPlayerId);

  if (isSuperAdminPlayer(requester) || team.captainPlayerId === requesterPlayerId) {
    return;
  }

  throw new AppError('captain_only');
}

function buildTeamViews(state, playerCards, viewerPlayerId) {
  const cardsById = new Map((playerCards ?? []).map((player) => [player.id, player]));
  const rawTeams = Object.values(state.teams ?? {});
  const games = Object.values(state.games ?? {});

  const teams = rawTeams.map((team) => {
    const players = (team.playerIds ?? [])
      .map((playerId) => cardsById.get(playerId))
      .filter(Boolean);
    const ratedPlayers = players.filter((player) => Number(player.overall) > 0 && Number(player.ratedGames) > 0);
    const rating = ratedPlayers.length
      ? Math.round(ratedPlayers.reduce((sum, player) => sum + Number(player.overall), 0) / ratedPlayers.length)
      : 0;
    const captain = cardsById.get(team.captainPlayerId) ?? null;

    return {
      ...team,
      players,
      captain,
      rating,
      averagePlayerRating: rating,
      gamesCount: games.filter((game) => (game.teamIds ?? []).includes(team.id)).length,
      isMember: (team.playerIds ?? []).includes(viewerPlayerId),
      canManage: team.captainPlayerId === viewerPlayerId || isSuperAdminPlayer(state.players[viewerPlayerId]),
      canChallenge: Boolean(viewerPlayerId) && team.status === 'open' && team.captainPlayerId !== viewerPlayerId
    };
  });
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const viewerTeamIds = new Set(teams.filter((team) => team.canManage).map((team) => team.id));
  const challenges = Object.values(state.teamChallenges ?? {})
    .filter((challenge) =>
      challenge.status === 'open' ||
      viewerTeamIds.has(challenge.challengerTeamId) ||
      viewerTeamIds.has(challenge.opponentTeamId)
    )
    .map((challenge) => {
      const challenger = teamsById.get(challenge.challengerTeamId) ?? null;
      const opponent = teamsById.get(challenge.opponentTeamId) ?? null;
      const ratingDifference = challenger && opponent
        ? Math.abs(challenger.rating - opponent.rating)
        : 0;
      const ratingBase = Math.max(challenger?.rating ?? 0, opponent?.rating ?? 0, 1);
      const ratingDifferencePercent = Math.round((ratingDifference / ratingBase) * 100);
      const compatibility = ratingDifferencePercent <= 8 ? 'good' : ratingDifferencePercent <= 18 ? 'fair' : 'hard';

      return {
        ...challenge,
        challenger,
        opponent,
        ratingDifferencePercent,
        compatibility,
        canRespond: viewerTeamIds.has(challenge.awaitingTeamId) && ['sent', 'counter'].includes(challenge.status),
        canAcceptOpen: challenge.status === 'open' &&
          !viewerTeamIds.has(challenge.challengerTeamId) &&
          viewerTeamIds.size > 0,
        canManage: viewerTeamIds.has(challenge.challengerTeamId) || viewerTeamIds.has(challenge.opponentTeamId),
        canEdit: viewerTeamIds.has(challenge.challengerTeamId) &&
          ['open', 'sent', 'counter'].includes(challenge.status)
      };
    })
    .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));

  return { teams, teamChallenges: challenges };
}

function ensureLocaleFields(state) {
  let changed = false;

  for (const chat of Object.values(state.chats ?? {})) {
    const nextLocale = normalizeLocale(chat.locale || 'ru');
    const nextSource = chat.localeSource || 'fallback';

    if (chat.locale !== nextLocale) {
      chat.locale = nextLocale;
      changed = true;
    }

    if (chat.localeSource !== nextSource) {
      chat.localeSource = nextSource;
      changed = true;
    }
  }

  for (const player of Object.values(state.players ?? {})) {
    if (!player.analyticsId) {
      player.analyticsId = randomUUID();
      changed = true;
    }
    const nextLocale = normalizeLocale(player.locale || 'ru');
    const nextSource = player.localeSource || 'fallback';

    if (player.locale !== nextLocale) {
      player.locale = nextLocale;
      changed = true;
    }

    if (player.localeSource !== nextSource) {
      player.localeSource = nextSource;
      changed = true;
    }
  }

  return changed;
}

const QUICK_ACHIEVEMENT_KEYS = new Set(
  QUICK_ACHIEVEMENT_DEFINITIONS
    .filter((achievement) => !achievement.automatic)
    .map((achievement) => achievement.key)
);

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

function createSessionRecord(token, playerId, chatId, authMethod = 'telegram') {
  return {
    token,
    playerId,
    chatId: String(chatId),
    authMethod,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
  };
}

function isSessionValid(session) {
  return Boolean(session?.token && session?.playerId && session.expiresAt >= Date.now());
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
    adminPlayerIds: [],
    locale: normalizeLocale(chat.locale),
    localeSource: chat.locale ? (chat.localeSource ?? 'manual') : 'fallback',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  existing.title = chat.title ?? existing.title;
  existing.type = chat.type ?? existing.type;
  existing.username = chat.username ?? existing.username;
  existing.adminPlayerIds = Array.isArray(existing.adminPlayerIds) ? existing.adminPlayerIds : [];
  existing.locale = normalizeLocale(existing.locale || chat.locale || DEFAULT_LOCALE);
  existing.localeSource = existing.localeSource || (chat.locale ? (chat.localeSource ?? 'manual') : 'fallback');
  existing.updatedAt = new Date().toISOString();
  state.chats[id] = existing;
  return existing;
}

function createPlayerRecord(state, username = '') {
  const id = `player_${state.meta.nextPlayerId++}`;
  const now = new Date().toISOString();
  const player = {
    id,
    analyticsId: randomUUID(),
    telegramUserId: null,
    username: normalizeUsername(username),
    displayName: username ? `@${normalizeUsername(username)}` : 'Игрок',
    firstName: '',
    lastName: '',
    photoUrl: '',
    chatIds: [],
    locale: DEFAULT_LOCALE,
    localeSource: 'fallback',
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

function sanitizeCardCount(value, max) {
  return Math.round(clamp(Number(value ?? 0), 0, max));
}

function sanitizeBoostPoints(value) {
  return Math.round(clamp(Number(value ?? 0), 0, QUICK_RATING_POINTS));
}

function sanitizeProfilePosition(position) {
  return POSITION_OPTIONS.includes(position) ? position : 'N/A';
}

function sanitizeCareerSeed(player) {
  const ratedGames = Math.round(clamp(Number(player.ratedGames ?? 0), 0, 10000));

  if (!ratedGames) {
    return null;
  }

  const fallbackStat = clamp(Number(player.overall ?? 50), 1, 99);

  return {
    ratedGames,
    goals: Math.round(clamp(Number(player.goals ?? 0), 0, 10000)),
    assists: Math.round(clamp(Number(player.assists ?? 0), 0, 10000)),
    yellowCards: Math.round(clamp(Number(player.yellowCards ?? player.cards?.yellow ?? 0), 0, 10000)),
    redCards: Math.round(clamp(Number(player.redCards ?? player.cards?.red ?? 0), 0, 10000)),
    position: sanitizeProfilePosition(player.position),
    stats: Object.fromEntries(
      STAT_KEYS.map((key) => [key, clamp(Number(player.stats?.[key] ?? fallbackStat), 1, 99)])
    ),
    source: player.source || 'career-seed-import',
    updatedAt: new Date().toISOString()
  };
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

function isSameTelegramMessageId(left, right) {
  return left !== null && left !== undefined && right !== null && right !== undefined && String(left) === String(right);
}

function isGameJoinable(game, now = new Date()) {
  return Boolean(
    game?.organizerPlayerId &&
    !game.rosterLocked &&
    !game.ratingsOpenedAt &&
    !game.closedAt &&
    new Date(game.scheduledAt) > now
  );
}

function isSameAnnouncementSchedule(game, announcement) {
  return game.date === announcement.date && game.time === announcement.time;
}

function isSameAnnouncementDate(game, announcement) {
  return game.date === announcement.date;
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

function padTimePart(value) {
  return String(value).padStart(2, '0');
}

function formatTimeFromMinutes(totalMinutes) {
  const dayMinutes = 24 * 60;
  const normalized = ((totalMinutes % dayMinutes) + dayMinutes) % dayMinutes;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${padTimePart(hours)}:${padTimePart(minutes)}`;
}

function parseManualTimeInput(time) {
  const match = String(time ?? '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?:\s*[–—-]\s*([01]\d|2[0-3]):([0-5]\d))?$/);

  if (!match) {
    return null;
  }

  const startHours = Number(match[1]);
  const startMinutes = Number(match[2]);
  const start = `${match[1]}:${match[2]}`;
  const explicitEnd = match[3] && match[4] ? `${match[3]}:${match[4]}` : '';
  const end = explicitEnd || formatTimeFromMinutes(startHours * 60 + startMinutes + DEFAULT_MANUAL_GAME_DURATION_MINUTES);

  return {
    start,
    end,
    display: explicitEnd ? `${start}–${end}` : start,
    hours: startHours,
    minutes: startMinutes
  };
}

function buildTimeRangeWithDuration(time, durationMinutes) {
  const parsed = parseManualTimeInput(time);

  if (!parsed) {
    return time;
  }

  const duration = Number(durationMinutes) === 60 ? 60 : 90;
  return `${parsed.start}–${formatTimeFromMinutes(parsed.hours * 60 + parsed.minutes + duration)}`;
}

function buildManualSchedule(date, time, timezoneOffset = process.env.CHAT_TIMEZONE_OFFSET || '+03:00', timeZone = '') {
  const dateMatch = String(date ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeInfo = parseManualTimeInput(time);

  if (!dateMatch || !timeInfo) {
    throw new AppError('schedule_required');
  }

  const year = Number(dateMatch[1]);
  const monthIndex = Number(dateMatch[2]) - 1;
  const day = Number(dateMatch[3]);
  const scheduledAt = scheduleInTimeZone(String(date), timeInfo.start, timeZone || timezoneOffset);
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
    date: String(date),
    timeZone: timeZone || timezoneOffset,
    dateLabel: `${day} ${monthNames[monthIndex]}`,
    time: timeInfo.display
  };
}

function assertScheduleNotInPast(scheduledAt, now = new Date()) {
  const scheduledMs = new Date(scheduledAt).getTime();
  const currentMinuteMs = Math.floor(now.getTime() / 60_000) * 60_000;

  if (Number.isFinite(scheduledMs) && scheduledMs < currentMinuteMs) {
    const error = new AppError('game_in_past');
    error.code = 'GAME_IN_PAST';
    error.statusCode = 400;
    throw error;
  }
}

function resolveManualPlayerIds(state, playerIds) {
  return unique(
    (Array.isArray(playerIds) ? playerIds : [])
      .map((playerId) => String(playerId))
      .filter((playerId) => Boolean(state.players[playerId]))
  );
}

function applyManualFieldsToGame(state, game, {
  date,
  time,
  location,
  additionalInfo,
  playerIds,
  timezoneOffset,
  timeZone,
  nowIso
}) {
  const selectedPlayerIds = resolveManualPlayerIds(state, playerIds);

  if (selectedPlayerIds.length < 2) {
    throw new AppError('players_required');
  }

  const schedule = buildManualSchedule(date, time, timezoneOffset, timeZone || game.timeZone);
  const normalizedLocation = String(location ?? '').trim();

  game.key = [
    schedule.scheduledAt.slice(0, 16),
    normalizedLocation.toLowerCase(),
    selectedPlayerIds.join(',')
  ].join('|');
  game.dateLabel = schedule.dateLabel;
  game.location = normalizedLocation;
  game.time = schedule.time;
  game.scheduledAt = schedule.scheduledAt;
  game.date = schedule.date;
  game.timeZone = schedule.timeZone;
  game.priceLine = '';
  game.paymentLines = String(additionalInfo ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  game.playerIds = selectedPlayerIds;
  game.playerUsernames = selectedPlayerIds.map((playerId) => state.players[playerId]?.username).filter(Boolean);
  game.pendingJoinPlayerIds = (game.pendingJoinPlayerIds ?? []).filter(
    (playerId) => !selectedPlayerIds.includes(playerId)
  );
  game.declinedPlayerIds = (game.declinedPlayerIds ?? []).filter(
    (playerId) => !selectedPlayerIds.includes(playerId)
  );
  game.updatedAt = nowIso;

  for (const playerId of selectedPlayerIds) {
    attachPlayerToChat(state, game.chatId, playerId);
  }

  return game;
}

function applyManualInviteState(state, game, {
  selectedPlayerIds,
  organizerPlayerId,
  previousAcceptedPlayerIds = [],
  previousInvitedPlayerIds = [],
  nowIso
}) {
  const selectedIds = unique([organizerPlayerId, ...selectedPlayerIds])
    .filter((playerId) => Boolean(state.players[playerId]));
  const previousAccepted = new Set(previousAcceptedPlayerIds);
  const previousInvited = new Set(previousInvitedPlayerIds);
  const acceptedPlayerIds = selectedIds.filter(
    (playerId) =>
      playerId === organizerPlayerId ||
      (previousAccepted.has(playerId) && !previousInvited.has(playerId))
  );
  const invitedPlayerIds = selectedIds.filter(
    (playerId) => !acceptedPlayerIds.includes(playerId)
  );

  game.playerIds = unique(acceptedPlayerIds);
  game.invitedPlayerIds = unique(invitedPlayerIds);
  game.playerUsernames = selectedIds
    .map((playerId) => state.players[playerId]?.username)
    .filter(Boolean);
  game.pendingJoinPlayerIds = (game.pendingJoinPlayerIds ?? []).filter(
    (playerId) => !selectedIds.includes(playerId)
  );
  game.declinedPlayerIds = (game.declinedPlayerIds ?? []).filter(
    (playerId) => !selectedIds.includes(playerId)
  );
  game.updatedAt = nowIso;

  for (const playerId of selectedIds) {
    attachPlayerToChat(state, game.chatId, playerId);
  }

  return game;
}

function assertCanManageGame(state, game, requesterPlayerId) {
  const requester = findPlayerById(state, requesterPlayerId);
  const chat = state.chats[String(game.chatId)];

  if (isSuperAdminPlayer(requester)) {
    return;
  }

  if (chat?.adminPlayerIds?.includes(requesterPlayerId)) {
    return;
  }

  if (game.organizerPlayerId && game.organizerPlayerId === requesterPlayerId) {
    return;
  }

  throw new AppError('organizer_only');
}

function assertCanToggleRosterLock(state, game, requesterPlayerId) {
  const requester = findPlayerById(state, requesterPlayerId);

  if (isSuperAdminPlayer(requester)) {
    return;
  }

  if (game.organizerPlayerId && game.organizerPlayerId === requesterPlayerId) {
    return;
  }

  throw new AppError('roster_organizer_only');
}

function findLatestGameForChat(state, chatId) {
  return Object.values(state.games)
    .filter((game) => game.chatId === String(chatId))
    .sort((left, right) => new Date(right.scheduledAt) - new Date(left.scheduledAt))[0] ?? null;
}

function findGameBySchedule(state, game) {
  const scheduledAt = String(game?.scheduledAt || '');
  const location = String(game?.location || '').trim().toLowerCase();

  if (!scheduledAt) {
    return null;
  }

  return Object.values(state.games).find((item) => {
    const sameSchedule = String(item.scheduledAt || '') === scheduledAt;
    const sameTime = String(item.time || '') === String(game.time || '');
    const sameLocation = String(item.location || '').trim().toLowerCase() === location;
    return sameSchedule && sameTime && sameLocation;
  }) ?? null;
}

function mergeExternalPlayer(state, externalPlayer) {
  const username = normalizeUsername(externalPlayer?.username);
  let player =
    (externalPlayer?.telegramUserId ? findPlayerByTelegramUserId(state, externalPlayer.telegramUserId) : null) ??
    (username ? findPlayerByUsername(state, username) : null);

  if (!player) {
    player = createPlayerRecord(state, username);
  }

  player.telegramUserId = externalPlayer?.telegramUserId ?? player.telegramUserId;
  player.username = username || player.username;
  player.displayName = externalPlayer?.displayName || player.displayName;
  player.firstName = externalPlayer?.firstName || player.firstName;
  player.lastName = externalPlayer?.lastName || player.lastName;
  player.photoUrl = externalPlayer?.photoUrl || player.photoUrl;
  player.defaultPosition = externalPlayer?.defaultPosition || player.defaultPosition;
  player.privateChatId = externalPlayer?.privateChatId || player.privateChatId;
  player.privateStartedAt = externalPlayer?.privateStartedAt || player.privateStartedAt;
  player.selfProfile = player.selfProfile || externalPlayer?.selfProfile;
  player.chatIds = unique([...(player.chatIds ?? []), ...(externalPlayer?.chatIds ?? []).map(String)]);
  player.updatedAt = new Date().toISOString();
  applyPlayerDefaults(player, player.username);
  return player;
}

function copyExternalGameFields(targetGame, externalGame, playerIdMap, nowIso) {
  const playerIds = (externalGame.playerIds ?? [])
    .map((playerId) => playerIdMap.get(String(playerId)))
    .filter(Boolean);

  targetGame.chatId = String(externalGame.chatId || targetGame.chatId || 'global');
  targetGame.messageId = externalGame.messageId ?? targetGame.messageId ?? null;
  targetGame.rawText = externalGame.rawText ?? targetGame.rawText ?? '';
  targetGame.key = externalGame.key || targetGame.key || '';
  targetGame.source = externalGame.source || targetGame.source || 'state-merge';
  targetGame.sourceDate = externalGame.sourceDate || targetGame.sourceDate || nowIso;
  targetGame.dateLabel = externalGame.dateLabel || targetGame.dateLabel || '';
  targetGame.location = externalGame.location || targetGame.location || '';
  targetGame.time = externalGame.time || targetGame.time || '';
  targetGame.scheduledAt = externalGame.scheduledAt || targetGame.scheduledAt || '';
  targetGame.date = externalGame.date || targetGame.date || String(targetGame.scheduledAt || '').slice(0, 10);
  targetGame.priceLine = externalGame.priceLine || targetGame.priceLine || '';
  targetGame.paymentLines = Array.isArray(externalGame.paymentLines) ? externalGame.paymentLines : targetGame.paymentLines || [];
  targetGame.rosterLocked = Boolean(externalGame.rosterLocked ?? targetGame.rosterLocked ?? false);
  targetGame.playerUsernames = Array.isArray(externalGame.playerUsernames) ? externalGame.playerUsernames : targetGame.playerUsernames || [];
  targetGame.playerRefs = Array.isArray(externalGame.playerRefs) ? externalGame.playerRefs : targetGame.playerRefs || [];
  targetGame.playerIds = playerIds.length ? playerIds : targetGame.playerIds || [];
  targetGame.invitedPlayerIds = (externalGame.invitedPlayerIds ?? [])
    .map((playerId) => playerIdMap.get(String(playerId)))
    .filter((playerId) => playerId && !(targetGame.playerIds ?? []).includes(playerId));
  targetGame.declinedPlayerIds = (externalGame.declinedPlayerIds ?? [])
    .map((playerId) => playerIdMap.get(String(playerId)))
    .filter(Boolean);
  targetGame.pendingJoinPlayerIds = (externalGame.pendingJoinPlayerIds ?? [])
    .map((playerId) => playerIdMap.get(String(playerId)))
    .filter((playerId) => playerId && !(targetGame.playerIds ?? []).includes(playerId));
  targetGame.ratingsOpenedAt = externalGame.ratingsOpenedAt || targetGame.ratingsOpenedAt || null;
  targetGame.ratingsPromptMessageId = externalGame.ratingsPromptMessageId ?? targetGame.ratingsPromptMessageId ?? null;
  targetGame.ratingSummarySentAt = externalGame.ratingSummarySentAt || targetGame.ratingSummarySentAt || null;
  targetGame.ratingSummaryChatMessageId = externalGame.ratingSummaryChatMessageId ?? targetGame.ratingSummaryChatMessageId ?? null;
  targetGame.ratingSummaryPrivatePlayerIds = unique([
    ...(targetGame.ratingSummaryPrivatePlayerIds ?? []),
    ...(externalGame.ratingSummaryPrivatePlayerIds ?? [])
      .map((playerId) => playerIdMap.get(String(playerId)))
      .filter(Boolean)
  ]);
  targetGame.ratingsClosedByGameId = externalGame.ratingsClosedByGameId || targetGame.ratingsClosedByGameId || null;
  targetGame.excludeFromCareer = Boolean(externalGame.excludeFromCareer ?? targetGame.excludeFromCareer ?? false);
  targetGame.closedAt = externalGame.closedAt || targetGame.closedAt || null;
  targetGame.createdAt = externalGame.createdAt || targetGame.createdAt || nowIso;
  targetGame.updatedAt = nowIso;

  return targetGame;
}

function mergeExternalState(state, externalState) {
  const now = new Date().toISOString();
  const playerIdMap = new Map();
  const gameIdMap = new Map();
  let playersMerged = 0;
  let gamesMerged = 0;
  let ratingsMerged = 0;
  let statBoostsMerged = 0;
  let mvpVotesMerged = 0;
  let achievementVotesMerged = 0;

  for (const chat of Object.values(externalState?.chats ?? {})) {
    ensureChatState(state, chat);
  }

  for (const externalPlayer of Object.values(externalState?.players ?? {})) {
    const player = mergeExternalPlayer(state, externalPlayer);
    playerIdMap.set(String(externalPlayer.id), player.id);
    playersMerged += 1;
  }

  const playersWithExternalRatings = new Set(
    [
      ...Object.values(externalState?.ratings ?? {}).map((rating) => String(rating.targetPlayerId)),
      ...Object.values(externalState?.statBoosts ?? {}).map((boost) => String(boost.targetPlayerId))
    ]
  );

  for (const externalGame of Object.values(externalState?.games ?? {})) {
    const existingGame = findGameBySchedule(state, externalGame);
    const game = existingGame ?? {
      id: `game_${state.meta.nextGameId++}`,
      chatId: String(externalGame.chatId || 'global')
    };

    ensureChatState(state, {
      id: externalGame.chatId || game.chatId || 'global',
      title: '',
      type: externalGame.chatId === 'global' ? 'global' : 'supergroup'
    });
    copyExternalGameFields(game, externalGame, playerIdMap, now);
    state.games[game.id] = game;
    gameIdMap.set(String(externalGame.id), game.id);
    gamesMerged += 1;
  }

  for (const externalRating of Object.values(externalState?.ratings ?? {})) {
    const gameId = gameIdMap.get(String(externalRating.gameId));
    const targetPlayerId = playerIdMap.get(String(externalRating.targetPlayerId));
    const raterPlayerId = playerIdMap.get(String(externalRating.raterPlayerId));

    if (!gameId || !targetPlayerId || !raterPlayerId) {
      continue;
    }

    const existingRating = Object.values(state.ratings).find(
      (rating) =>
        rating.gameId === gameId &&
        rating.raterPlayerId === raterPlayerId &&
        rating.targetPlayerId === targetPlayerId
    );
    const rating = existingRating ?? {
      id: `rating_${state.meta.nextRatingId++}`,
      createdAt: externalRating.createdAt || now
    };

    rating.chatId = String(state.games[gameId]?.chatId || externalRating.chatId || 'global');
    rating.gameId = gameId;
    rating.raterPlayerId = raterPlayerId;
    rating.targetPlayerId = targetPlayerId;
    rating.position = sanitizePosition(externalRating.position);

    for (const key of STAT_KEYS) {
      rating[key] = clamp(Number(externalRating[key] ?? 50), 1, 99);
    }

    rating.goals = rating.position === 'GK' ? 0 : clamp(Number(externalRating.goals ?? 0), 0, 20);
    rating.assists = rating.position === 'GK' ? 0 : clamp(Number(externalRating.assists ?? 0), 0, 20);
    rating.yellowCards = sanitizeCardCount(externalRating.yellowCards, MAX_YELLOW_CARDS);
    rating.redCards = sanitizeCardCount(externalRating.redCards, MAX_RED_CARDS);
    rating.updatedAt = externalRating.updatedAt || now;
    state.ratings[rating.id] = rating;
    ratingsMerged += 1;
  }

  for (const externalBoost of Object.values(externalState?.statBoosts ?? {})) {
    const gameId = gameIdMap.get(String(externalBoost.gameId));
    const targetPlayerId = playerIdMap.get(String(externalBoost.targetPlayerId));
    const raterPlayerId = playerIdMap.get(String(externalBoost.raterPlayerId));
    const statKey = String(externalBoost.statKey ?? '');

    if (!gameId || !targetPlayerId || !raterPlayerId || !STAT_KEYS.includes(statKey)) {
      continue;
    }

    const existingBoost = Object.values(state.statBoosts ?? {}).find(
      (boost) =>
        boost.gameId === gameId &&
        boost.raterPlayerId === raterPlayerId &&
        boost.targetPlayerId === targetPlayerId &&
        boost.statKey === statKey
    );
    const boost = existingBoost ?? {
      id: `stat_boost_${state.meta.nextStatBoostId++}`,
      createdAt: externalBoost.createdAt || now
    };

    boost.chatId = String(state.games[gameId]?.chatId || externalBoost.chatId || 'global');
    boost.gameId = gameId;
    boost.raterPlayerId = raterPlayerId;
    boost.targetPlayerId = targetPlayerId;
    boost.statKey = statKey;
    boost.points = sanitizeBoostPoints(externalBoost.points);
    boost.updatedAt = externalBoost.updatedAt || now;
    state.statBoosts[boost.id] = boost;
    statBoostsMerged += 1;
  }

  for (const externalVote of Object.values(externalState?.mvpVotes ?? {})) {
    const gameId = gameIdMap.get(String(externalVote.gameId));
    const targetPlayerId = playerIdMap.get(String(externalVote.targetPlayerId));
    const raterPlayerId = playerIdMap.get(String(externalVote.raterPlayerId));

    if (!gameId || !targetPlayerId || !raterPlayerId) {
      continue;
    }

    const existingVote = Object.values(state.mvpVotes ?? {}).find(
      (vote) => vote.gameId === gameId && vote.raterPlayerId === raterPlayerId
    );
    const vote = existingVote ?? {
      id: `mvp_vote_${state.meta.nextMvpVoteId++}`,
      createdAt: externalVote.createdAt || now
    };

    vote.chatId = String(state.games[gameId]?.chatId || externalVote.chatId || 'global');
    vote.gameId = gameId;
    vote.raterPlayerId = raterPlayerId;
    vote.targetPlayerId = targetPlayerId;
    vote.updatedAt = externalVote.updatedAt || now;
    state.mvpVotes[vote.id] = vote;
    mvpVotesMerged += 1;
  }

  for (const externalVote of Object.values(externalState?.achievementVotes ?? {})) {
    const gameId = gameIdMap.get(String(externalVote.gameId));
    const targetPlayerId = playerIdMap.get(String(externalVote.targetPlayerId));
    const raterPlayerId = playerIdMap.get(String(externalVote.raterPlayerId));
    const achievementKey = String(externalVote.achievementKey ?? '');

    if (!gameId || !targetPlayerId || !raterPlayerId || !QUICK_ACHIEVEMENT_KEYS.has(achievementKey)) {
      continue;
    }

    const existingVote = Object.values(state.achievementVotes ?? {}).find(
      (vote) =>
        vote.gameId === gameId &&
        vote.raterPlayerId === raterPlayerId &&
        vote.targetPlayerId === targetPlayerId &&
        vote.achievementKey === achievementKey
    );
    const vote = existingVote ?? {
      id: `achievement_vote_${state.meta.nextAchievementVoteId++}`,
      createdAt: externalVote.createdAt || now
    };

    vote.chatId = String(state.games[gameId]?.chatId || externalVote.chatId || 'global');
    vote.gameId = gameId;
    vote.raterPlayerId = raterPlayerId;
    vote.targetPlayerId = targetPlayerId;
    vote.achievementKey = achievementKey;
    vote.updatedAt = externalVote.updatedAt || now;
    state.achievementVotes[vote.id] = vote;
    achievementVotesMerged += 1;
  }

  for (const externalPlayerId of playersWithExternalRatings) {
    const playerId = playerIdMap.get(externalPlayerId);

    if (playerId && state.players[playerId]?.careerSeed) {
      delete state.players[playerId].careerSeed;
    }
  }

  return { playersMerged, gamesMerged, ratingsMerged, statBoostsMerged, mvpVotesMerged, achievementVotesMerged };
}

function getBootstrapDetailedGames(snapshot) {
  const seen = new Set();
  const games = [];

  for (const game of [snapshot?.currentGame, ...(snapshot?.gameDays ?? [])]) {
    if (!game?.id || seen.has(game.id) || !Array.isArray(game.participants)) {
      continue;
    }

    seen.add(game.id);
    games.push(game);
  }

  return games;
}

function getBootstrapGameSummary(snapshot, gameId) {
  return (snapshot?.games ?? []).find((game) => game.id === gameId) ?? null;
}

function importBootstrapSnapshot(state, snapshot) {
  const now = new Date().toISOString();
  const chat = ensureChatState(state, {
    id: 'global',
    title: 'Все игры',
    type: 'global'
  });
  const playerIdByBootstrapId = new Map();
  let playersImported = 0;
  let gamesImported = 0;
  let ratingsImported = 0;

  const upsertCardPlayer = (card) => {
    const player = mergeExternalPlayer(state, {
      id: card.id,
      username: card.username,
      displayName: card.displayName,
      firstName: card.firstName,
      lastName: card.lastName,
      photoUrl: card.photoUrl,
      defaultPosition: card.position
    });

    attachPlayerToChat(state, chat.id, player.id);
    playerIdByBootstrapId.set(String(card.id), player.id);
    playersImported += 1;
    return player.id;
  };

  for (const player of snapshot?.players ?? []) {
    upsertCardPlayer(player);
  }

  for (const game of getBootstrapDetailedGames(snapshot)) {
    const participantIds = game.participants.map((player) => {
      if (playerIdByBootstrapId.has(String(player.id))) {
        return playerIdByBootstrapId.get(String(player.id));
      }

      return upsertCardPlayer(player);
    });
    const scheduleGame = {
      scheduledAt: game.scheduledAt,
      time: game.time,
      location: game.location
    };
    const existingGame = findGameBySchedule(state, scheduleGame);
    const targetGame = existingGame ?? {
      id: `game_${state.meta.nextGameId++}`,
      chatId: chat.id,
      createdAt: now
    };
    const summary = getBootstrapGameSummary(snapshot, game.id);
    const summaryMvpId = summary?.mvp?.playerId ? playerIdByBootstrapId.get(String(summary.mvp.playerId)) : '';
    const summaryTopScorerId = summary?.topScorer?.playerId ? playerIdByBootstrapId.get(String(summary.topScorer.playerId)) : '';

    targetGame.chatId = chat.id;
    targetGame.messageId = targetGame.messageId ?? null;
    targetGame.rawText = targetGame.rawText ?? '';
    targetGame.key = targetGame.key || `bootstrap:${game.scheduledAt}:${String(game.location || '').toLowerCase()}`;
    targetGame.source = targetGame.source || 'bootstrap-import';
    targetGame.sourceDate = targetGame.sourceDate || now;
    targetGame.dateLabel = game.dateLabel;
    targetGame.location = game.location;
    targetGame.time = game.time;
    targetGame.scheduledAt = game.scheduledAt;
    targetGame.date = String(game.scheduledAt || '').slice(0, 10);
    targetGame.priceLine = game.priceLine || targetGame.priceLine || '';
    targetGame.paymentLines = Array.isArray(game.paymentLines) ? game.paymentLines : targetGame.paymentLines || [];
    targetGame.playerUsernames = game.participants.map((player) => normalizeUsername(player.username)).filter(Boolean);
    targetGame.playerIds = participantIds;
    targetGame.invitedPlayerIds = [];
    targetGame.pendingJoinPlayerIds = [];
    targetGame.declinedPlayerIds = targetGame.declinedPlayerIds || [];
    targetGame.ratingsOpenedAt = game.ratingsOpenedAt || targetGame.ratingsOpenedAt || null;
    targetGame.ratingsPromptMessageId = game.ratingsPromptMessageId ?? targetGame.ratingsPromptMessageId ?? null;
    targetGame.ratingSummarySentAt = game.ratingSummarySentAt || targetGame.ratingSummarySentAt || null;
    targetGame.ratingSummaryChatMessageId = game.ratingSummaryChatMessageId ?? targetGame.ratingSummaryChatMessageId ?? null;
    targetGame.ratingSummaryPrivatePlayerIds = Array.isArray(game.ratingSummaryPrivatePlayerIds)
      ? game.ratingSummaryPrivatePlayerIds
      : targetGame.ratingSummaryPrivatePlayerIds || [];
    targetGame.ratingsClosedByGameId = targetGame.ratingsClosedByGameId || null;
    targetGame.closedAt = game.status === 'finished' ? targetGame.closedAt || now : targetGame.closedAt || null;
    targetGame.excludeFromCareer = true;
    targetGame.importedSummary = {
      totalGoals: Number(summary?.totalGoals ?? 0),
      mvp: summary?.mvp && summaryMvpId
        ? {
            ...summary.mvp,
            playerId: summaryMvpId
          }
        : null,
      topScorer: summary?.topScorer && summaryTopScorerId
        ? {
            ...summary.topScorer,
            playerId: summaryTopScorerId
          }
        : null
    };
    targetGame.updatedAt = now;
    state.games[targetGame.id] = targetGame;
    gamesImported += 1;

    for (const ratingId of Object.keys(state.ratings)) {
      if (state.ratings[ratingId].gameId === targetGame.id && state.ratings[ratingId].source === 'bootstrap-import') {
        delete state.ratings[ratingId];
      }
    }

    for (const participant of game.participants) {
      const targetPlayerId = playerIdByBootstrapId.get(String(participant.id));
      const stats = participant.currentGameStats;

      if (!targetPlayerId || !stats?.hasRatings) {
        continue;
      }

      const ratingsCount = Math.max(1, Math.round(Number(stats.ratingsCount ?? 1)));

      for (let index = 0; index < ratingsCount; index += 1) {
        const rating = {
          id: `rating_${state.meta.nextRatingId++}`,
          chatId: chat.id,
          gameId: targetGame.id,
          raterPlayerId: `bootstrap_${game.id}_${targetPlayerId}_${index}`,
          targetPlayerId,
          position: sanitizePosition(stats.position),
          goals: stats.position === 'GK' ? 0 : clamp(Number(stats.goals ?? 0), 0, 20),
          assists: stats.position === 'GK' ? 0 : clamp(Number(stats.assists ?? 0), 0, 20),
          source: 'bootstrap-import',
          createdAt: now,
          updatedAt: now
        };

        for (const key of STAT_KEYS) {
          rating[key] = clamp(Number(stats.stats?.[key] ?? 50), 1, 99);
        }

        state.ratings[rating.id] = rating;
        ratingsImported += 1;
      }
    }
  }

  return { playersImported, gamesImported, ratingsImported };
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

function normalizePlayerRef(ref) {
  if (typeof ref === 'string') {
    return {
      username: normalizeUsername(ref),
      displayName: ''
    };
  }

  return {
    username: normalizeUsername(ref?.username),
    displayName: String(ref?.displayName ?? '').trim(),
    telegramUserId: ref?.telegramUserId ?? null,
    firstName: ref?.firstName ?? '',
    lastName: ref?.lastName ?? '',
    photoUrl: ref?.photoUrl ?? ''
  };
}

function getAnnouncementPlayerRefs(announcement) {
  return Array.isArray(announcement.playerRefs) && announcement.playerRefs.length
    ? announcement.playerRefs
    : announcement.playerUsernames;
}

function resolveAnnouncementPlayerIds(state, chatId, playerRefs) {
  return playerRefs.map((item) => {
    const ref = normalizePlayerRef(item);
    let player =
      (ref.telegramUserId ? findPlayerByTelegramUserId(state, ref.telegramUserId) : null) ??
      findPlayerByUsername(state, ref.username);

    if (!player) {
      player = createPlayerRecord(state, ref.username);
    }

    if (ref.telegramUserId) {
      player.telegramUserId = ref.telegramUserId;
    }

    player.username = ref.username || player.username;
    player.firstName = ref.firstName || player.firstName;
    player.lastName = ref.lastName || player.lastName;
    player.photoUrl = ref.photoUrl || player.photoUrl;

    if (ref.displayName && (!player.displayName || player.displayName === `@${player.username}` || player.displayName === 'Игрок')) {
      player.displayName = ref.displayName;
    }

    applyPlayerDefaults(player, ref.username);

    attachPlayerToChat(state, chatId, player.id);
    return player.id;
  });
}

function applyAnnouncementToGame(state, game, {
  chatId,
  messageId,
  rawText,
  announcement,
  organizerPlayerId = null,
  source,
  sourceDate,
  nowIso
}) {
  const playerIds = resolveAnnouncementPlayerIds(state, chatId, getAnnouncementPlayerRefs(announcement));

  game.messageId = messageId;
  game.rawText = rawText;
  game.key = announcement.key;
  game.source = source;
  game.sourceDate = sourceDate ? toIsoString(sourceDate) : nowIso;
  game.organizerPlayerId = game.organizerPlayerId || organizerPlayerId || null;
  game.dateLabel = announcement.dateLabel;
  game.location = announcement.location;
  game.time = announcement.time;
  game.scheduledAt = announcement.scheduledAt;
  game.date = announcement.date;
  game.timeZone = announcement.timeZone || game.timeZone;
  if (announcement.hasPaymentBlock) {
    game.priceLine = announcement.priceLine;
    game.paymentLines = announcement.paymentLines;
  }
  game.playerUsernames = announcement.playerUsernames;
  game.playerRefs = getAnnouncementPlayerRefs(announcement).map((item) => normalizePlayerRef(item));
  game.playerIds = playerIds;
  game.invitedPlayerIds = [];
  game.pendingJoinPlayerIds = (game.pendingJoinPlayerIds ?? []).filter(
    (playerId) => !playerIds.includes(playerId)
  );
  game.declinedPlayerIds = (game.declinedPlayerIds ?? []).filter(
    (playerId) => !playerIds.includes(playerId)
  );
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

    const playerIds = resolveAnnouncementPlayerIds(state, chatId, getAnnouncementPlayerRefs(item.announcement));

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
      playerRefs: getAnnouncementPlayerRefs(item.announcement).map((item) => normalizePlayerRef(item)),
      playerIds,
      invitedPlayerIds: [],
      pendingJoinPlayerIds: [],
      declinedPlayerIds: [],
      ratingsOpenedAt: null,
      ratingsPromptMessageId: null,
      ratingSummarySentAt: null,
      ratingSummaryChatMessageId: null,
      ratingSummaryPrivatePlayerIds: [],
      ratingsClosedByGameId: null,
      excludeFromCareer: true,
      closedAt: null,
      createdAt: now,
      updatedAt: now
    };
    importedGames += 1;
  }

  return importedGames;
}

export class AppStore {
  constructor(filePath, { allowDevSessions = false } = {}) {
    this.filePath = filePath;
    this.allowDevSessions = allowDevSessions;
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
        },
        sessions: parsed?.sessions ?? {}
      };
      this.sessions = new Map(
        Object.entries(this.state.sessions)
          .filter(([, session]) => isSessionValid(session) && this.isSessionAllowed(session))
          .map(([token, session]) => [token, session])
      );
      const sessionsRemoved = this.sessions.size !== Object.keys(this.state.sessions).length;
      this.state.sessions = Object.fromEntries(this.sessions);
      if (ensureLocaleFields(this.state) || sessionsRemoved) {
        await this.persist();
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }

      await this.persist();
    }
    await this.syncStarFives({ notify: Boolean(this.state.starFive) });
  }

  async syncStarFives({ notify = true, now = new Date() } = {}) {
    const candidates = getStarFiveCandidates(this.state, now);
    const unseen = candidates.filter((entry) => !this.state.starFive?.processed?.[entry.gameId]);
    if (this.state.starFive && !unseen.length) return;
    await this.mutate((state) => {
      const data = state.starFive ??= { processed: {}, entries: [], events: {} };
      for (const entry of unseen) {
        if (data.processed[entry.gameId]) continue;
        data.processed[entry.gameId] = entry;
        const current = data.entries;
        const next = advanceStarFive(current, entry);
        if (next === current) continue;
        data.entries = next;
        if (notify) {
          data.events[entry.gameId] = {
            ...entry, entries: next, chatSent: false,
            privateChatId: state.players[entry.playerId]?.privateChatId || '',
            privateSent: !state.players[entry.playerId]?.privateChatId
          };
        }
      }
    });
  }

  listPendingStarFiveEvents() {
    return Object.values(this.state.starFive?.events ?? {}).filter((event) => !event.chatSent || !event.privateSent);
  }

  async markStarFiveDelivery(gameId, destination) {
    if (!['chatSent', 'privateSent'].includes(destination)) throw new Error('Invalid star five destination');
    await this.mutate((state) => {
      const event = state.starFive?.events?.[gameId];
      if (event) event[destination] = true;
    });
  }

  getStarFive(entries = null) {
    const snapshot = buildChatSnapshot(this.state, 'global');
    return buildStarFiveView(entries ?? this.state.starFive?.entries ?? [], snapshot.players);
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

  async setChatAdminStatus(chatId, playerId, isAdmin) {
    return this.mutate((state) => {
      const chat = ensureChatState(state, { id: chatId, title: '', type: 'supergroup' });
      const adminPlayerIds = new Set(chat.adminPlayerIds ?? []);

      if (isAdmin) {
        adminPlayerIds.add(playerId);
      } else {
        adminPlayerIds.delete(playerId);
      }

      chat.adminPlayerIds = [...adminPlayerIds];
      return chat;
    });
  }

  async setChatLocale(chatId, locale, localeSource = 'manual') {
    return this.mutate((state) => {
      const chat = ensureChatState(state, { id: chatId, title: '', type: 'supergroup' });
      chat.locale = normalizeLocale(locale);
      chat.localeSource = localeSource;
      chat.updatedAt = new Date().toISOString();
      return chat;
    });
  }

  async setPlayerLocale(playerId, locale, localeSource = 'manual') {
    return this.mutate((state) => {
      const player = findPlayerById(state, playerId);

      if (!player) {
        throw new AppError('player_not_found');
      }

      player.locale = normalizeLocale(locale);
      player.localeSource = localeSource;
      player.updatedAt = new Date().toISOString();
      return player;
    });
  }

  async setPlayerLocaleByTelegramUserId(telegramUserId, locale, localeSource = 'manual') {
    return this.mutate((state) => {
      const player = findPlayerByTelegramUserId(state, telegramUserId);

      if (!player) {
        throw new AppError('player_not_found');
      }

      player.locale = normalizeLocale(locale);
      player.localeSource = localeSource;
      player.updatedAt = new Date().toISOString();
      return player;
    });
  }

  async setChatTimeZone(chatId, timeZone) {
    return this.mutate(state => {
      const chat = state.chats[String(chatId)];
      if (!chat) throw new AppError('chat_not_found');
      scheduleInTimeZone('2030-01-15', '12:00', timeZone);
      chat.timeZone = timeZone;
    });
  }

  getChatLocale(chatId) {
    const chat = this.state.chats[String(chatId)];
    return normalizeLocale(chat?.locale || DEFAULT_LOCALE);
  }

  getPlayerLocale(playerId) {
    const player = findPlayerById(this.state, playerId);
    return normalizeLocale(player?.locale || DEFAULT_LOCALE);
  }

  getChatById(chatId) {
    return this.state.chats[String(chatId)] ?? null;
  }

  findGameByMessage(chatId, messageId) {
    return Object.values(this.state.games).find(
      (game) => game.chatId === String(chatId) && isSameTelegramMessageId(game.messageId, messageId)
    ) ?? null;
  }

  findAnnouncementDraftByMessage(chatId, messageId) {
    return Object.values(this.state.announcementDrafts ?? {}).find(
      (draft) => draft.chatId === String(chatId) && isSameTelegramMessageId(draft.sourceMessageId, messageId)
    ) ?? null;
  }

  getAnnouncementDraftById(draftId) {
    return this.state.announcementDrafts?.[draftId] ?? null;
  }

  async saveAnnouncementDraft({
    chatId,
    chatTitle,
    chatType,
    sourceMessageId,
    rawText,
    announcement,
    organizerPlayerId,
    authorTelegramUserId,
    sourceDate
  }) {
    return this.mutate((state) => {
      ensureChatState(state, {
        id: chatId,
        title: chatTitle ?? '',
        type: chatType ?? 'supergroup'
      });
      state.announcementDrafts ??= {};

      const existing = Object.values(state.announcementDrafts).find(
        (draft) => draft.chatId === String(chatId) && isSameTelegramMessageId(draft.sourceMessageId, sourceMessageId)
      );
      const now = new Date().toISOString();
      const draft = existing ?? {
        id: `announcement_draft_${state.meta.nextAnnouncementDraftId++}`,
        chatId: String(chatId),
        sourceMessageId,
        confirmationChatId: null,
        confirmationMessageId: null,
        createdAt: now
      };

      Object.assign(draft, {
        chatTitle: chatTitle ?? '',
        chatType: chatType ?? 'supergroup',
        rawText,
        announcement,
        organizerPlayerId: organizerPlayerId || null,
        authorTelegramUserId: authorTelegramUserId ?? null,
        sourceDate: sourceDate ? toIsoString(sourceDate) : now,
        updatedAt: now
      });
      state.announcementDrafts[draft.id] = draft;
      return { created: !existing, draft };
    });
  }

  async setAnnouncementDraftConfirmation(draftId, { chatId, messageId }) {
    return this.mutate((state) => {
      const draft = state.announcementDrafts?.[draftId];

      if (!draft) {
        return null;
      }

      draft.confirmationChatId = String(chatId);
      draft.confirmationMessageId = messageId;
      draft.updatedAt = new Date().toISOString();
      return draft;
    });
  }

  async deleteAnnouncementDraft(draftId) {
    return this.mutate((state) => {
      const draft = state.announcementDrafts?.[draftId] ?? null;

      if (draft) {
        delete state.announcementDrafts[draftId];
      }

      return draft;
    });
  }

  async setGameBotAnnouncement(gameId, { chatId, messageId }) {
    return this.mutate((state) => {
      const game = state.games[gameId];

      if (!game) {
        return null;
      }

      game.botAnnouncementChatId = String(chatId);
      game.botAnnouncementMessageId = messageId;
      game.updatedAt = new Date().toISOString();
      return game;
    });
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
      if (player.localeSource !== 'manual') {
        const localeResolution = resolveLocale({
          telegramLocale: user?.language_code,
          fallback: player.locale || DEFAULT_LOCALE
        });
        player.locale = localeResolution.locale;
        player.localeSource = localeResolution.localeSource;
      }
      if (chat.type === 'private') {
        player.privateChatId = String(chat.id);
        player.privateStartedAt = player.privateStartedAt || new Date().toISOString();
        if (chat.localeSource !== 'manual') {
          chat.locale = player.locale;
          chat.localeSource = player.localeSource;
        }
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
    organizerPlayerId = null,
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
        (game) => game.chatId === String(chatId) && isSameTelegramMessageId(game.messageId, messageId)
      );

      if (existingByMessageId) {
        if (isGameEditableBeforeStart(existingByMessageId, effectiveNow)) {
          const game = applyAnnouncementToGame(state, existingByMessageId, {
            chatId,
            messageId,
            rawText,
            announcement,
            organizerPlayerId,
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
            organizerPlayerId,
            source,
            sourceDate,
            nowIso: now
          });
          setCurrentGame(chat, game, now, currentGame);
          return { created: false, updated: true, game };
        }

        return { created: false, updated: false, game: existingBySchedule };
      }

      const existingByDate = Object.values(state.games)
        .filter((game) => game.chatId === String(chatId) && isSameAnnouncementDate(game, announcement))
        .sort((left, right) => new Date(right.updatedAt || right.createdAt || right.scheduledAt) - new Date(left.updatedAt || left.createdAt || left.scheduledAt))[0];

      if (existingByDate) {
        if (isGameEditableBeforeStart(existingByDate, effectiveNow)) {
          const game = applyAnnouncementToGame(state, existingByDate, {
            chatId,
            messageId,
            rawText,
            announcement,
            organizerPlayerId,
            source,
            sourceDate,
            nowIso: now
          });
          setCurrentGame(chat, game, now, currentGame);
          return { created: false, updated: true, game };
        }

        return { created: false, updated: false, game: existingByDate };
      }

      if (currentGame && isSameAnnouncementDate(currentGame, announcement) && isGameEditableBeforeStart(currentGame, effectiveNow)) {
        const game = applyAnnouncementToGame(state, currentGame, {
          chatId,
          messageId,
          rawText,
          announcement,
          organizerPlayerId,
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

      const playerIds = resolveAnnouncementPlayerIds(state, chatId, getAnnouncementPlayerRefs(announcement));
      const gameId = `game_${state.meta.nextGameId++}`;
      const game = {
        id: gameId,
        chatId: String(chatId),
        messageId,
        rawText,
        key: announcement.key,
        source,
        sourceDate: sourceDate ? toIsoString(sourceDate) : now,
        organizerPlayerId: organizerPlayerId || null,
        dateLabel: announcement.dateLabel,
        location: announcement.location,
        time: announcement.time,
        scheduledAt: announcement.scheduledAt,
        date: announcement.date,
        timeZone: announcement.timeZone,
        priceLine: announcement.priceLine,
        paymentLines: announcement.paymentLines,
        playerUsernames: announcement.playerUsernames,
        playerRefs: getAnnouncementPlayerRefs(announcement).map((item) => normalizePlayerRef(item)),
        playerIds,
        rosterLocked: false,
        invitedPlayerIds: [],
        pendingJoinPlayerIds: [],
        declinedPlayerIds: [],
        ratingsOpenedAt: null,
        ratingsPromptMessageId: null,
        ratingSummarySentAt: null,
        ratingSummaryChatMessageId: null,
        ratingSummaryPrivatePlayerIds: [],
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
    additionalInfo,
    timezoneOffset,
    timeZone
  }) {
    return this.mutate((state) => {
      const chat = state.chats[String(chatId)];
      const organizer = findPlayerById(state, organizerPlayerId);

      if (!chat) {
        throw new AppError('chat_not_found');
      }

      if (!organizer) {
        throw new AppError('organizer_not_found');
      }

      const now = new Date().toISOString();
      const requestedSchedule = buildManualSchedule(date, time, timezoneOffset, timeZone);
      assertScheduleNotInPast(requestedSchedule.scheduledAt);
      const gameId = `game_${state.meta.nextGameId++}`;
      const game = {
        id: gameId,
        chatId: String(chatId),
        messageId: null,
        rawText: '',
        key: '',
        source: 'manual',
        sourceDate: now,
        organizerPlayerId,
        dateLabel: '',
        location: '',
        time: '',
        scheduledAt: '',
        date: '',
        priceLine: '',
        paymentLines: [],
        rosterLocked: false,
        playerUsernames: [],
        playerIds: [],
        invitedPlayerIds: [],
        declinedPlayerIds: [],
        pendingJoinPlayerIds: [],
        ratingsOpenedAt: null,
        ratingsPromptMessageId: null,
        ratingSummarySentAt: null,
        ratingSummaryChatMessageId: null,
        ratingSummaryPrivatePlayerIds: [],
        ratingsClosedByGameId: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now
      };

      applyManualFieldsToGame(state, game, {
        date,
        time,
        location,
        additionalInfo,
        playerIds: unique([organizerPlayerId, ...(Array.isArray(playerIds) ? playerIds : [])]),
        timezoneOffset,
        timeZone,
        nowIso: now
      });
      applyManualInviteState(state, game, {
        selectedPlayerIds: game.playerIds,
        organizerPlayerId,
        previousAcceptedPlayerIds: [organizerPlayerId],
        previousInvitedPlayerIds: [],
        nowIso: now
      });

      state.games[gameId] = game;
      const currentGame = chat.currentGameId ? state.games[chat.currentGameId] : null;
      setCurrentGame(chat, game, now, currentGame);
      return { created: true, game };
    });
  }

  async createTeam({
    requesterPlayerId,
    name,
    city,
    imageUrl,
    format,
    level,
    captainPlayerId,
    playerIds,
    status
  }) {
    return this.mutate((state) => {
      const requester = findPlayerById(state, requesterPlayerId);

      if (!requester) {
        throw new AppError('player_not_found');
      }

      const normalizedName = String(name ?? '').trim();
      const normalizedCity = String(city ?? '').trim();

      if (!normalizedName || !normalizedCity) {
        throw new AppError('team_details_required');
      }

      const selectedPlayerIds = resolveManualPlayerIds(state, [
        requesterPlayerId,
        ...(Array.isArray(playerIds) ? playerIds : [])
      ]);
      const selectedCaptainId = selectedPlayerIds.includes(captainPlayerId)
        ? captainPlayerId
        : requesterPlayerId;
      const now = new Date().toISOString();
      const teamId = `team_${state.meta.nextTeamId++}`;
      const team = {
        id: teamId,
        name: normalizedName,
        city: normalizedCity,
        imageUrl: normalizeTeamImageUrl(imageUrl),
        format: normalizeChoice(format, TEAM_FORMATS, '5x5'),
        level: normalizeChoice(level, TEAM_LEVELS, 'amateur'),
        captainPlayerId: selectedCaptainId,
        playerIds: unique(selectedPlayerIds),
        status: normalizeChoice(status, TEAM_STATUSES, 'open'),
        reputation: 100,
        createdByPlayerId: requesterPlayerId,
        createdAt: now,
        updatedAt: now
      };

      state.teams[teamId] = team;
      return { created: true, team };
    });
  }

  async updateTeam({ teamId, requesterPlayerId, payload }) {
    return this.mutate((state) => {
      const team = state.teams?.[teamId];

      if (!team) {
        throw new AppError('team_not_found');
      }

      assertCanManageTeam(state, team, requesterPlayerId);
      const requestedCaptainId = String(payload?.captainPlayerId ?? team.captainPlayerId);
      const selectedPlayerIds = resolveManualPlayerIds(state, [
        ...(Array.isArray(payload?.playerIds) ? payload.playerIds : team.playerIds),
        requestedCaptainId
      ]);
      const selectedCaptainId = selectedPlayerIds.includes(requestedCaptainId)
        ? requestedCaptainId
        : team.captainPlayerId;

      team.name = String(payload?.name ?? team.name).trim() || team.name;
      team.city = String(payload?.city ?? team.city).trim() || team.city;
      team.imageUrl = normalizeTeamImageUrl(payload?.imageUrl ?? team.imageUrl);
      team.format = normalizeChoice(payload?.format, TEAM_FORMATS, team.format);
      team.level = normalizeChoice(payload?.level, TEAM_LEVELS, team.level);
      team.status = normalizeChoice(payload?.status, TEAM_STATUSES, team.status);
      team.playerIds = unique(selectedPlayerIds);
      team.captainPlayerId = team.playerIds.includes(selectedCaptainId)
        ? selectedCaptainId
        : requesterPlayerId;
      team.updatedAt = new Date().toISOString();
      return { updated: true, team };
    });
  }

  async deleteTeam({ teamId, requesterPlayerId }) {
    return this.mutate((state) => {
      const team = state.teams?.[teamId];

      if (!team) {
        throw new AppError('team_not_found');
      }

      assertCanManageTeam(state, team, requesterPlayerId);
      delete state.teams[teamId];

      for (const [challengeId, challenge] of Object.entries(state.teamChallenges ?? {})) {
        if ([challenge.challengerTeamId, challenge.opponentTeamId].includes(teamId)) {
          delete state.teamChallenges[challengeId];
        }
      }

      return { deleted: true, teamId };
    });
  }

  async createTeamChallenge({ requesterPlayerId, challengerTeamId, opponentTeamId, payload }) {
    return this.mutate((state) => {
      const challengerTeam = state.teams?.[challengerTeamId];

      if (!challengerTeam) {
        throw new AppError('team_not_found');
      }

      assertCanManageTeam(state, challengerTeam, requesterPlayerId);
      const opponentTeam = opponentTeamId ? state.teams?.[opponentTeamId] : null;

      if (opponentTeamId && !opponentTeam) {
        throw new AppError('opponent_not_found');
      }

      if (opponentTeam?.id === challengerTeam.id) {
        throw new AppError('challenge_self');
      }

      const date = String(payload?.date ?? '').trim();
      const time = String(payload?.time ?? '').trim();
      const location = String(payload?.location ?? '').trim();

      if (!date || !time || !location) {
        throw new AppError('venue_schedule_required');
      }

      const now = new Date().toISOString();
      const challengeId = `challenge_${state.meta.nextChallengeId++}`;
      const mode = normalizeChoice(payload?.mode, CHALLENGE_MODES, opponentTeam ? 'friendly' : 'open');
      const challenge = {
        id: challengeId,
        challengerTeamId: challengerTeam.id,
        opponentTeamId: opponentTeam?.id ?? null,
        format: normalizeChoice(payload?.format, TEAM_FORMATS, challengerTeam.format),
        date,
        time,
        timeZone: payload?.timeZone || process.env.CHAT_TIMEZONE_OFFSET || '+03:00',
        location,
        duration: Number(payload?.duration) === 60 ? 60 : 90,
        mode,
        costSplit: String(payload?.costSplit ?? '').trim(),
        needsReferee: Boolean(payload?.needsReferee),
        comment: String(payload?.comment ?? '').trim(),
        status: opponentTeam ? 'sent' : 'open',
        awaitingTeamId: opponentTeam?.id ?? null,
        createdByPlayerId: requesterPlayerId,
        gameId: null,
        createdAt: now,
        updatedAt: now
      };

      state.teamChallenges[challengeId] = challenge;
      return { created: true, challenge };
    });
  }

  async updateTeamChallenge({ challengeId, requesterPlayerId, payload }) {
    return this.mutate((state) => {
      const challenge = state.teamChallenges?.[challengeId];

      if (!challenge) {
        throw new AppError('challenge_not_found');
      }

      if (!['open', 'sent', 'counter'].includes(challenge.status)) {
        throw new AppError('challenge_active');
      }

      const challengerTeam = state.teams?.[challenge.challengerTeamId];

      if (!challengerTeam) {
        throw new AppError('team_not_found');
      }

      assertCanManageTeam(state, challengerTeam, requesterPlayerId);
      const date = String(payload?.date ?? challenge.date).trim();
      const time = String(payload?.time ?? challenge.time).trim();
      const location = String(payload?.location ?? challenge.location).trim();

      if (!date || !time || !location) {
        throw new AppError('venue_schedule_required');
      }

      challenge.date = date;
      challenge.time = time;
      challenge.timeZone = payload?.timeZone || challenge.timeZone;
      challenge.location = location;
      challenge.format = normalizeChoice(payload?.format, TEAM_FORMATS, challenge.format);
      challenge.duration = Number(payload?.duration) === 60 ? 60 : 90;
      challenge.mode = normalizeChoice(payload?.mode, CHALLENGE_MODES, challenge.mode);
      challenge.costSplit = String(payload?.costSplit ?? challenge.costSplit).trim();
      challenge.needsReferee = payload?.needsReferee == null
        ? challenge.needsReferee
        : Boolean(payload.needsReferee);
      challenge.comment = String(payload?.comment ?? challenge.comment).trim();
      challenge.updatedAt = new Date().toISOString();
      return { challenge, game: null };
    });
  }

  async cancelTeamChallenge({ challengeId, requesterPlayerId }) {
    return this.mutate((state) => {
      const challenge = state.teamChallenges?.[challengeId];

      if (!challenge) {
        throw new AppError('challenge_not_found');
      }

      if (!['open', 'sent', 'counter'].includes(challenge.status)) {
        throw new AppError('challenge_closed');
      }

      const challengerTeam = state.teams?.[challenge.challengerTeamId];

      if (!challengerTeam) {
        throw new AppError('team_not_found');
      }

      assertCanManageTeam(state, challengerTeam, requesterPlayerId);
      challenge.status = 'cancelled';
      challenge.awaitingTeamId = null;
      challenge.cancelledAt = new Date().toISOString();
      challenge.updatedAt = challenge.cancelledAt;
      return { challenge, game: null };
    });
  }

  async deleteTeamChallenge({ challengeId, requesterPlayerId }) {
    return this.mutate((state) => {
      const challenge = state.teamChallenges?.[challengeId];

      if (!challenge) {
        throw new AppError('challenge_not_found');
      }

      const challengerTeam = state.teams?.[challenge.challengerTeamId];

      if (!challengerTeam) {
        throw new AppError('team_not_found');
      }

      assertCanManageTeam(state, challengerTeam, requesterPlayerId);
      delete state.teamChallenges[challengeId];
      return { deleted: true, challengeId };
    });
  }

  async respondToTeamChallenge({ challengeId, requesterPlayerId, action, payload, timezoneOffset }) {
    return this.mutate((state) => {
      const challenge = state.teamChallenges?.[challengeId];

      if (!challenge) {
        throw new AppError('challenge_not_found');
      }

      if (!['open', 'sent', 'counter'].includes(challenge.status)) {
        throw new AppError('challenge_processed');
      }

      let opponentTeam = challenge.opponentTeamId ? state.teams?.[challenge.opponentTeamId] : null;
      const challengerTeam = state.teams?.[challenge.challengerTeamId];
      const managedTeams = Object.values(state.teams ?? {}).filter((team) => {
        if (!team) return false;
        try {
          assertCanManageTeam(state, team, requesterPlayerId);
          return true;
        } catch {
          return false;
        }
      });
      let managedTeam = managedTeams.find((team) => team.id === challenge.awaitingTeamId) ??
        managedTeams.find((team) => [challengerTeam?.id, opponentTeam?.id].includes(team.id));

      if (challenge.status === 'open' && action === 'accept') {
        const responderTeamId = String(payload?.responderTeamId ?? '').trim();
        const responderTeam = managedTeams.find((team) => team.id === responderTeamId);

        if (!responderTeam || responderTeam.id === challengerTeam?.id) {
          throw new AppError('challenge_team_required');
        }

        if (responderTeam.status === 'inactive') {
          throw new AppError('challenge_team_inactive');
        }

        challenge.opponentTeamId = responderTeam.id;
        opponentTeam = responderTeam;
        managedTeam = responderTeam;
      }

      if (!managedTeam) {
        throw new AppError('challenge_captain_only');
      }

      if (challenge.status !== 'open' && challenge.awaitingTeamId && managedTeam.id !== challenge.awaitingTeamId) {
        throw new AppError('challenge_other_turn');
      }

      if (action === 'decline') {
        challenge.status = 'declined';
        challenge.awaitingTeamId = null;
        challenge.updatedAt = new Date().toISOString();
        return { challenge, game: null };
      }

      if (action === 'counter') {
        challenge.date = String(payload?.date ?? challenge.date).trim();
        challenge.time = String(payload?.time ?? challenge.time).trim();
        challenge.timeZone = payload?.timeZone || challenge.timeZone;
        challenge.location = String(payload?.location ?? challenge.location).trim();
        challenge.duration = Number(payload?.duration) === 60 ? 60 : 90;
        challenge.costSplit = String(payload?.costSplit ?? challenge.costSplit).trim();
        challenge.needsReferee = payload?.needsReferee == null
          ? challenge.needsReferee
          : Boolean(payload.needsReferee);
        challenge.comment = String(payload?.comment ?? challenge.comment).trim();
        challenge.status = 'counter';
        challenge.awaitingTeamId = managedTeam.id === challengerTeam.id
          ? opponentTeam?.id ?? null
          : challengerTeam.id;
        challenge.updatedAt = new Date().toISOString();
        return { challenge, game: null };
      }

      if (action !== 'accept' || !challengerTeam || !opponentTeam) {
        throw new AppError('challenge_action_invalid');
      }

      const chat = state.chats.global;

      if (!chat) {
        throw new AppError('global_not_found');
      }

      const now = new Date().toISOString();
      const gameId = `game_${state.meta.nextGameId++}`;
      const organizerPlayerId = challengerTeam.captainPlayerId;
      const selectedPlayerIds = unique([
        ...(challengerTeam.playerIds ?? []),
        ...(opponentTeam.playerIds ?? [])
      ]);
      const game = {
        id: gameId,
        chatId: 'global',
        messageId: null,
        rawText: '',
        key: '',
        source: 'team_challenge',
        challengeMode: challenge.mode,
        needsReferee: challenge.needsReferee,
        sourceDate: now,
        organizerPlayerId,
        dateLabel: '',
        location: '',
        time: '',
        scheduledAt: '',
        date: '',
        priceLine: '',
        paymentLines: [],
        rosterLocked: false,
        playerUsernames: [],
        playerIds: [],
        invitedPlayerIds: [],
        declinedPlayerIds: [],
        pendingJoinPlayerIds: [],
        ratingsOpenedAt: null,
        ratingsPromptMessageId: null,
        ratingSummarySentAt: null,
        ratingSummaryChatMessageId: null,
        ratingSummaryPrivatePlayerIds: [],
        ratingsClosedByGameId: null,
        closedAt: null,
        teamIds: [challengerTeam.id, opponentTeam.id],
        challengeId: challenge.id,
        createdAt: now,
        updatedAt: now
      };
      const details = [
        challenge.costSplit,
        challenge.comment
      ].filter(Boolean).join('\n');

      applyManualFieldsToGame(state, game, {
        date: challenge.date,
        time: buildTimeRangeWithDuration(challenge.time, challenge.duration),
        timeZone: challenge.timeZone,
        location: challenge.location,
        additionalInfo: details,
        playerIds: selectedPlayerIds,
        timezoneOffset,
        nowIso: now
      });
      applyManualInviteState(state, game, {
        selectedPlayerIds: game.playerIds,
        organizerPlayerId,
        previousAcceptedPlayerIds: [organizerPlayerId],
        previousInvitedPlayerIds: [],
        nowIso: now
      });
      state.games[gameId] = game;
      const currentGame = chat.currentGameId ? state.games[chat.currentGameId] : null;
      setCurrentGame(chat, game, now, currentGame);
      challenge.status = 'accepted';
      challenge.awaitingTeamId = null;
      challenge.gameId = game.id;
      challenge.updatedAt = now;
      return { challenge, game };
    });
  }

  async updateManualGame({
    chatId,
    gameId,
    requesterPlayerId,
    date,
    time,
    location,
    playerIds,
    additionalInfo,
    timezoneOffset,
    timeZone
  }) {
    return this.mutate((state) => {
      const chat = state.chats[String(chatId)];
      const game = state.games[gameId];

      if (!chat || !game || game.chatId !== String(chatId)) {
        throw new AppError('game_not_found');
      }

      assertCanManageGame(state, game, requesterPlayerId);

      if (!isGameEditableBeforeStart(game, new Date())) {
        throw new AppError('game_not_editable');
      }

      const now = new Date().toISOString();
      const previousAcceptedPlayerIds = [...(game.playerIds ?? [])];
      const previousInvitedPlayerIds = [...(game.invitedPlayerIds ?? [])];
      applyManualFieldsToGame(state, game, {
        date,
        time,
        location,
        additionalInfo,
        playerIds: unique([game.organizerPlayerId || requesterPlayerId, ...(Array.isArray(playerIds) ? playerIds : [])]),
        timezoneOffset,
        timeZone,
        nowIso: now
      });
      applyManualInviteState(state, game, {
        selectedPlayerIds: game.playerIds,
        organizerPlayerId: game.organizerPlayerId || requesterPlayerId,
        previousAcceptedPlayerIds,
        previousInvitedPlayerIds,
        nowIso: now
      });
      setCurrentGame(chat, game, now, chat.currentGameId ? state.games[chat.currentGameId] : null);
      return { updated: true, game };
    });
  }

  async setGameRosterLocked({ gameId, requesterPlayerId, rosterLocked }) {
    return this.mutate((state) => {
      const game = state.games[gameId];

      if (!game) {
        throw new AppError('game_not_found');
      }

      assertCanToggleRosterLock(state, game, requesterPlayerId);

      if (!isGameEditableBeforeStart(game, new Date())) {
        throw new AppError('game_not_editable');
      }

      game.rosterLocked = Boolean(rosterLocked);
      game.updatedAt = new Date().toISOString();
      return { updated: true, game };
    });
  }

  async deleteGame({ chatId, gameId, requesterPlayerId }) {
    return this.mutate((state) => {
      const chat = state.chats[String(chatId)];
      const game = state.games[gameId];

      if (!chat || !game || game.chatId !== String(chatId)) {
        throw new AppError('game_not_found');
      }

      assertCanManageGame(state, game, requesterPlayerId);

      for (const ratingId of Object.keys(state.ratings)) {
        if (state.ratings[ratingId].gameId === gameId) {
          delete state.ratings[ratingId];
        }
      }

      for (const boostId of Object.keys(state.statBoosts ?? {})) {
        if (state.statBoosts[boostId].gameId === gameId) {
          delete state.statBoosts[boostId];
        }
      }

      for (const voteId of Object.keys(state.mvpVotes ?? {})) {
        if (state.mvpVotes[voteId].gameId === gameId) {
          delete state.mvpVotes[voteId];
        }
      }

      delete state.games[gameId];

      if (chat.currentGameId === gameId) {
        const latestGame = findLatestGameForChat(state, chatId);
        chat.currentGameId = latestGame?.id ?? null;
      }

      chat.updatedAt = new Date().toISOString();
      return { deleted: true };
    });
  }

  async removePlayerFromGame({ gameId, playerId }) {
    return this.mutate((state) => {
      const game = state.games[gameId];
      const player = findPlayerById(state, playerId);

      if (!game || !player) {
        throw new AppError('game_player_not_found');
      }

      const wasInGame = game.playerIds.includes(playerId);
      const wasInvited = (game.invitedPlayerIds ?? []).includes(playerId);
      const wasPending = (game.pendingJoinPlayerIds ?? []).includes(playerId);

      if (wasInGame || wasInvited || wasPending) {
        game.playerIds = game.playerIds.filter((id) => id !== playerId);
        game.invitedPlayerIds = (game.invitedPlayerIds ?? []).filter((id) => id !== playerId);
        game.pendingJoinPlayerIds = (game.pendingJoinPlayerIds ?? []).filter((id) => id !== playerId);
        game.playerUsernames = game.playerIds.map((id) => state.players[id]?.username).filter(Boolean);
        game.declinedPlayerIds = unique([...(game.declinedPlayerIds ?? []), playerId]);
        game.updatedAt = new Date().toISOString();
      }

      return {
        removed: wasInGame || wasInvited || wasPending,
        game,
        player,
        organizer: game.organizerPlayerId ? findPlayerById(state, game.organizerPlayerId) : null
      };
    });
  }

  async acceptGameInvite({ gameId, playerId }) {
    return this.mutate((state) => {
      const game = state.games[gameId];
      const player = findPlayerById(state, playerId);

      if (!game || !player) {
        throw new AppError('game_player_not_found');
      }

      if (!isGameEditableBeforeStart(game, new Date())) {
        throw new AppError('invite_expired');
      }

      if (game.playerIds.includes(playerId)) {
        return {
          accepted: false,
          game,
          player,
          organizer: game.organizerPlayerId ? findPlayerById(state, game.organizerPlayerId) : null
        };
      }

      if (!(game.invitedPlayerIds ?? []).includes(playerId)) {
        throw new AppError('invite_not_found');
      }

      game.invitedPlayerIds = (game.invitedPlayerIds ?? []).filter((id) => id !== playerId);
      game.declinedPlayerIds = (game.declinedPlayerIds ?? []).filter((id) => id !== playerId);
      game.playerIds = unique([...(game.playerIds ?? []), playerId]);
      game.playerUsernames = game.playerIds.map((id) => state.players[id]?.username).filter(Boolean);
      attachPlayerToChat(state, game.chatId, playerId);
      game.updatedAt = new Date().toISOString();

      return {
        accepted: true,
        game,
        player,
        organizer: game.organizerPlayerId ? findPlayerById(state, game.organizerPlayerId) : null
      };
    });
  }

  async joinGameFromBot({ gameId, playerId }) {
    return this.mutate((state) => {
      const game = state.games[gameId];
      const player = findPlayerById(state, playerId);

      if (!game || !player) {
        throw new AppError('game_player_not_found');
      }

      if (!isGameJoinable(game, new Date())) {
        throw new AppError('registration_closed');
      }

      const wasInGame = game.playerIds.includes(playerId);
      game.playerIds = unique([...(game.playerIds ?? []), playerId]);
      game.invitedPlayerIds = (game.invitedPlayerIds ?? []).filter((id) => id !== playerId);
      game.pendingJoinPlayerIds = (game.pendingJoinPlayerIds ?? []).filter((id) => id !== playerId);
      game.declinedPlayerIds = (game.declinedPlayerIds ?? []).filter((id) => id !== playerId);
      game.playerUsernames = game.playerIds.map((id) => state.players[id]?.username).filter(Boolean);
      attachPlayerToChat(state, game.chatId, playerId);
      game.updatedAt = new Date().toISOString();

      return {
        joined: !wasInGame,
        game,
        player,
        organizer: game.organizerPlayerId ? findPlayerById(state, game.organizerPlayerId) : null
      };
    });
  }

  async requestJoinGame({ gameId, playerId }) {
    return this.mutate((state) => {
      const game = state.games[gameId];
      const player = findPlayerById(state, playerId);

      if (!game || !player) {
        throw new AppError('game_player_not_found');
      }

      if (game.playerIds.includes(playerId)) {
        throw new AppError('already_joined');
      }

      if ((game.invitedPlayerIds ?? []).includes(playerId)) {
        throw new AppError('already_invited');
      }

      if (!isGameJoinable(game, new Date())) {
        throw new AppError('requests_closed');
      }

      const pendingJoinPlayerIds = game.pendingJoinPlayerIds ?? [];
      const wasPending = pendingJoinPlayerIds.includes(playerId);
      game.pendingJoinPlayerIds = unique([...pendingJoinPlayerIds, playerId]);
      game.declinedPlayerIds = (game.declinedPlayerIds ?? []).filter((id) => id !== playerId);
      game.updatedAt = new Date().toISOString();

      return {
        requested: !wasPending,
        game,
        player,
        organizer: game.organizerPlayerId ? findPlayerById(state, game.organizerPlayerId) : null
      };
    });
  }

  async cancelJoinRequest({ gameId, playerId, requesterPlayerId = playerId }) {
    return this.mutate((state) => {
      const game = state.games[gameId];
      const player = findPlayerById(state, playerId);

      if (!game || !player) {
        throw new AppError('game_player_not_found');
      }

      const isSelfCancel = requesterPlayerId === playerId;

      if (!isSelfCancel) {
        assertCanManageGame(state, game, requesterPlayerId);

        if (!isGameEditableBeforeStart(game, new Date())) {
          throw new AppError('game_not_editable');
        }
      }

      const previousPending = game.pendingJoinPlayerIds ?? [];
      const previousInvited = game.invitedPlayerIds ?? [];
      game.pendingJoinPlayerIds = previousPending.filter((id) => id !== playerId);
      game.invitedPlayerIds = previousInvited.filter((id) => id !== playerId);

      if (
        previousPending.length !== game.pendingJoinPlayerIds.length ||
        previousInvited.length !== game.invitedPlayerIds.length
      ) {
        game.updatedAt = new Date().toISOString();
      }

      return {
        cancelled:
          previousPending.length !== game.pendingJoinPlayerIds.length ||
          previousInvited.length !== game.invitedPlayerIds.length,
        game,
        player,
        organizer: game.organizerPlayerId ? findPlayerById(state, game.organizerPlayerId) : null
      };
    });
  }

  async approveJoinRequest({ gameId, requesterPlayerId, playerId }) {
    return this.mutate((state) => {
      const game = state.games[gameId];
      const player = findPlayerById(state, playerId);

      if (!game || !player) {
        throw new AppError('game_player_not_found');
      }

      assertCanManageGame(state, game, requesterPlayerId);

      if (!isGameEditableBeforeStart(game, new Date())) {
        throw new AppError('game_not_editable');
      }

      if (!(game.pendingJoinPlayerIds ?? []).includes(playerId)) {
        throw new AppError('request_not_found');
      }

      game.pendingJoinPlayerIds = (game.pendingJoinPlayerIds ?? []).filter((id) => id !== playerId);
      game.declinedPlayerIds = (game.declinedPlayerIds ?? []).filter((id) => id !== playerId);
      game.playerIds = unique([...(game.playerIds ?? []), playerId]);
      game.invitedPlayerIds = (game.invitedPlayerIds ?? []).filter((id) => id !== playerId);
      game.playerUsernames = game.playerIds.map((id) => state.players[id]?.username).filter(Boolean);
      attachPlayerToChat(state, game.chatId, playerId);
      game.updatedAt = new Date().toISOString();

      return {
        approved: true,
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

  async importCareerSeed({ players }) {
    if (!Array.isArray(players)) {
      throw new Error('players must be an array');
    }

    return this.mutate((state) => {
      let importedPlayers = 0;

      for (const item of players) {
        const username = normalizeUsername(item.username);
        const seed = sanitizeCareerSeed(item);

        if (!username || !seed) {
          continue;
        }

        let player = findPlayerByUsername(state, username);

        if (!player) {
          player = createPlayerRecord(state, username);
        }

        player.username = username;
        player.displayName = item.displayName || player.displayName || `@${username}`;
        player.firstName = item.firstName || player.firstName;
        player.lastName = item.lastName || player.lastName;
        player.photoUrl = item.photoUrl || player.photoUrl;
        player.careerSeed = seed;
        player.updatedAt = new Date().toISOString();
        applyPlayerDefaults(player, username);
        importedPlayers += 1;
      }

      return { importedPlayers };
    });
  }

  async mergeState(externalState) {
    if (!externalState || typeof externalState !== 'object') {
      throw new Error('state must be an object');
    }

    return this.mutate((state) => mergeExternalState(state, externalState));
  }

  async importBootstrapSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('snapshot must be an object');
    }

    return this.mutate((state) => importBootstrapSnapshot(state, snapshot));
  }

  listGamesRequiringPrompt(now = new Date()) {
    return Object.values(this.state.games).filter((game) => {
      const chat = this.state.chats[game.chatId];

      if (!chat || chat.type === 'private' || game.ratingsOpenedAt) {
        return false;
      }

      if (chat.type !== 'global' && chat.currentGameId !== game.id) {
        return false;
      }

      return new Date(game.scheduledAt) <= now;
    });
  }

  listGamesRequiringSummary(now = new Date()) {
    const nowMs = new Date(now).getTime();
    const gamesWithRatings = new Set(Object.values(this.state.ratings).map((rating) => rating.gameId));
    const gamesWithBoosts = new Set(Object.values(this.state.statBoosts ?? {}).map((boost) => boost.gameId));
    const gamesWithMvpVotes = new Set(Object.values(this.state.mvpVotes ?? {}).map((vote) => vote.gameId));
    const gamesWithAchievementVotes = new Set(Object.values(this.state.achievementVotes ?? {}).map((vote) => vote.gameId));

    return Object.values(this.state.games).filter((game) => {
      if (game.ratingSummarySentAt || game.excludeFromCareer) {
        return false;
      }

      const ratingWindowEndAt = getRatingWindowEnd(this.state, game).getTime();

      const ratingComplete = haveAllParticipantsRated(this.state, game);

      if (!ratingComplete && (!Number.isFinite(ratingWindowEndAt) || nowMs < ratingWindowEndAt)) {
        return false;
      }

      return Boolean(
        game.ratingsOpenedAt ||
        gamesWithRatings.has(game.id) ||
        gamesWithBoosts.has(game.id) ||
        gamesWithMvpVotes.has(game.id) ||
        gamesWithAchievementVotes.has(game.id)
      );
    });
  }

  getQuickRatingMvpProgress(gameId) {
    const game = this.state.games[gameId];

    if (!game || game.excludeFromCareer) {
      return null;
    }

    const participantIds = new Set(game.playerIds ?? []);
    const total = participantIds.size;

    if (total < 2) {
      return null;
    }

    const votesByPlayerId = new Map();
    const voterIds = new Set();

    for (const vote of Object.values(this.state.mvpVotes ?? {})) {
      if (vote.gameId !== gameId || !participantIds.has(vote.targetPlayerId)) {
        continue;
      }

      votesByPlayerId.set(vote.targetPlayerId, (votesByPlayerId.get(vote.targetPlayerId) ?? 0) + 1);

      if (vote.raterPlayerId) {
        voterIds.add(vote.raterPlayerId);
      }
    }

    const leaders = [...votesByPlayerId.entries()]
      .map(([playerId, votes]) => ({ playerId, votes }))
      .sort((left, right) => {
        if (right.votes !== left.votes) {
          return right.votes - left.votes;
        }

        return left.playerId.localeCompare(right.playerId);
      });

    const leader = leaders[0];

    if (!leader || leader.votes <= 1 || leader.votes === leaders[1]?.votes) {
      return null;
    }

    const player = this.state.players[leader.playerId] ?? null;
    const achievementCount = Object.values(this.state.achievementVotes ?? {}).filter(
      (vote) => vote.gameId === gameId && participantIds.has(vote.targetPlayerId)
    ).length;
    const base = {
      game,
      player,
      playerId: leader.playerId,
      playerName: player?.displayName || player?.username || 'Игрок',
      votes: leader.votes,
      total,
      votersCount: voterIds.size,
      achievementCount
    };

    if (!game.ratingMvpProgressLeaderSentAt) {
      return {
        ...base,
        stage: 'leader'
      };
    }

    if (leader.votes > total / 2 && !game.ratingMvpProgressMajoritySentAt) {
      return {
        ...base,
        stage: 'majority'
      };
    }

    return null;
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

  async markQuickRatingMvpProgressSent(gameId, stage, messageId) {
    return this.mutate((state) => {
      const game = state.games[gameId];

      if (!game) {
        return null;
      }

      const now = new Date().toISOString();

      if (stage === 'majority') {
        game.ratingMvpProgressMajoritySentAt = now;
        game.ratingMvpProgressMajorityMessageId = messageId ?? null;
      } else {
        game.ratingMvpProgressLeaderSentAt = now;
        game.ratingMvpProgressLeaderMessageId = messageId ?? null;
      }

      game.updatedAt = now;
      return game;
    });
  }

  async markRatingSummarySent(gameId, options = {}) {
    return this.mutate((state) => {
      const game = state.games[gameId];

      if (!game) {
        return null;
      }

      game.ratingSummarySentAt = new Date().toISOString();
      game.ratingSummaryChatMessageId = options.chatMessageId ?? null;
      game.ratingSummaryPrivatePlayerIds = unique(options.privatePlayerIds ?? []);
      game.updatedAt = new Date().toISOString();
      return game;
    });
  }

  async submitRating({ chatId, gameId, raterPlayerId, targetPlayerId, payload }) {
    return this.mutate((state) => {
      const game = state.games[gameId];
      const chat = game ? state.chats[String(game.chatId)] : state.chats[String(chatId)];

      if (!chat || !game) {
        throw new AppError('game_not_found');
      }

      if (new Date(game.scheduledAt) > new Date()) {
        throw new AppError('game_not_started');
      }

      if (!isRatingWindowOpen(state, game, new Date())) {
        throw new AppError('rating_closed');
      }

      if (raterPlayerId === targetPlayerId) {
        throw new AppError('rate_self');
      }

      if (!game.playerIds.includes(raterPlayerId) || !game.playerIds.includes(targetPlayerId)) {
        throw new AppError('rate_target_only');
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
          chatId: String(game.chatId),
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
      rating.yellowCards = sanitizeCardCount(payload.yellowCards, MAX_YELLOW_CARDS);
      rating.redCards = sanitizeCardCount(payload.redCards, MAX_RED_CARDS);
      rating.updatedAt = new Date().toISOString();
      state.ratings[rating.id] = rating;
      return rating;
    });
  }

  async submitQuickRating({ chatId, gameId, raterPlayerId, payload }) {
    return this.mutate((state) => {
      const game = state.games[gameId];
      const chat = game ? state.chats[String(game.chatId)] : state.chats[String(chatId)];

      if (!chat || !game) {
        throw new AppError('game_not_found');
      }

      if (new Date(game.scheduledAt) > new Date()) {
        throw new AppError('game_not_started');
      }

      if (!isRatingWindowOpen(state, game, new Date())) {
        throw new AppError('rating_closed');
      }

      if (!game.playerIds.includes(raterPlayerId)) {
        throw new AppError('rate_participants_only');
      }

      const mvpPlayerId = String(payload?.mvpPlayerId ?? '');

      if (mvpPlayerId) {
        if (mvpPlayerId === raterPlayerId) {
          throw new AppError('vote_self');
        }

        if (!game.playerIds.includes(mvpPlayerId)) {
          throw new AppError('mvp_participants_only');
        }
      }

      const boostMap = new Map();

      for (const item of Array.isArray(payload?.boosts) ? payload.boosts : []) {
        const targetPlayerId = String(item?.targetPlayerId ?? '');
        const statKey = String(item?.statKey ?? '');
        const points = sanitizeBoostPoints(item?.points);

        if (!points) {
          continue;
        }

        if (targetPlayerId === raterPlayerId) {
          throw new AppError('points_self');
        }

        if (!game.playerIds.includes(targetPlayerId)) {
          throw new AppError('points_participants_only');
        }

        if (!STAT_KEYS.includes(statKey)) {
          throw new AppError('unknown_stat');
        }

        const key = `${targetPlayerId}:${statKey}`;
        boostMap.set(key, {
          targetPlayerId,
          statKey,
          points: (boostMap.get(key)?.points ?? 0) + points
        });
      }

      const boosts = [...boostMap.values()].map((item) => ({
        ...item,
        points: sanitizeBoostPoints(item.points)
      }));
      const totalPoints = boosts.reduce((sum, item) => sum + item.points, 0);
      const achievementMap = new Map();

      for (const item of Array.isArray(payload?.achievements) ? payload.achievements : []) {
        const targetPlayerId = String(item?.targetPlayerId ?? '');
        const achievementKey = String(item?.achievementKey ?? '');

        if (!targetPlayerId || !achievementKey) {
          continue;
        }

        if (targetPlayerId === raterPlayerId) {
          throw new AppError('achievement_self');
        }

        if (!game.playerIds.includes(targetPlayerId)) {
          throw new AppError('achievement_participants_only');
        }

        if (!QUICK_ACHIEVEMENT_KEYS.has(achievementKey)) {
          throw new AppError('achievement_unknown');
        }

        achievementMap.set(achievementKey, {
          targetPlayerId,
          achievementKey
        });
      }

      const achievements = [...achievementMap.values()];

      if (totalPoints > QUICK_RATING_POINTS) {
        throw new AppError('points_limit', { count: QUICK_RATING_POINTS });
      }

      if (!mvpPlayerId && totalPoints === 0 && achievements.length === 0) {
        throw new AppError('rating_empty');
      }

      for (const boostId of Object.keys(state.statBoosts ?? {})) {
        const boost = state.statBoosts[boostId];

        if (boost.gameId === gameId && boost.raterPlayerId === raterPlayerId) {
          delete state.statBoosts[boostId];
        }
      }

      for (const voteId of Object.keys(state.achievementVotes ?? {})) {
        const vote = state.achievementVotes[voteId];

        if (vote.gameId === gameId && vote.raterPlayerId === raterPlayerId) {
          delete state.achievementVotes[voteId];
        }
      }

      for (const boost of boosts) {
        const id = `stat_boost_${state.meta.nextStatBoostId++}`;
        state.statBoosts[id] = {
          id,
          chatId: String(game.chatId),
          gameId,
          raterPlayerId,
          targetPlayerId: boost.targetPlayerId,
          statKey: boost.statKey,
          points: boost.points,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }

      const existingVote = Object.values(state.mvpVotes ?? {}).find(
        (vote) => vote.gameId === gameId && vote.raterPlayerId === raterPlayerId
      );

      if (mvpPlayerId) {
        const vote = existingVote ?? {
          id: `mvp_vote_${state.meta.nextMvpVoteId++}`,
          chatId: String(game.chatId),
          gameId,
          raterPlayerId,
          createdAt: new Date().toISOString()
        };

        vote.targetPlayerId = mvpPlayerId;
        vote.updatedAt = new Date().toISOString();
        state.mvpVotes[vote.id] = vote;
      } else if (existingVote) {
        delete state.mvpVotes[existingVote.id];
      }

      for (const achievement of achievements) {
        const id = `achievement_vote_${state.meta.nextAchievementVoteId++}`;
        state.achievementVotes[id] = {
          id,
          chatId: String(game.chatId),
          gameId,
          raterPlayerId,
          targetPlayerId: achievement.targetPlayerId,
          achievementKey: achievement.achievementKey,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }

      game.updatedAt = new Date().toISOString();

      return {
        boosts,
        mvpPlayerId,
        achievements
      };
    });
  }

  async updateSelfProfile({ chatId, playerId, payload }) {
    return this.mutate((state) => {
      const player = state.players[playerId];

      if (!player) {
        throw new AppError('player_not_found');
      }

      const career = buildGlobalCareerIndex(state, new Date()).get(playerId);

      const updatedAt = new Date().toISOString();

      if (career?.ratedGames > 0) {
        player.selfProfile = {
          ...(player.selfProfile ?? {}),
          position: sanitizeProfilePosition(payload.position),
          updatedAt
        };
        player.updatedAt = updatedAt;
        return player.selfProfile;
      }

      player.selfProfile = {
        position: sanitizeProfilePosition(payload.position),
        stats: Object.fromEntries(
          STAT_KEYS.map((key) => [key, clamp(Number(payload[key] ?? 50), 1, 99)])
        ),
        updatedAt
      };
      player.updatedAt = updatedAt;
      return player.selfProfile;
    });
  }

  async createSession(playerId, chatId) {
    const token = createSessionToken();
    return this.mutate((state) => {
      const session = createSessionRecord(token, playerId, chatId);
      state.sessions[token] = session;
      this.sessions.set(token, session);
      return token;
    });
  }

  isSessionAllowed(session) {
    return session?.authMethod === 'telegram' ||
      (this.allowDevSessions && session?.authMethod === 'dev');
  }

  getSession(token) {
    if (!token) {
      return null;
    }

    const session = this.sessions.get(token);

    if (!session || !this.isSessionAllowed(session)) {
      return null;
    }

    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      delete this.state.sessions[token];
      void this.persist();
      return null;
    }

    return session;
  }

  cleanupSessions() {
    let changed = false;

    for (const [token, session] of this.sessions.entries()) {
      if (session.expiresAt < Date.now()) {
        this.sessions.delete(token);
        delete this.state.sessions[token];
        changed = true;
      }
    }

    if (changed) {
      void this.persist();
    }
  }

  loginDevUser(chatId, username, displayName = '') {
    if (!this.allowDevSessions) throw new Error('Dev login is disabled');
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

      const session = createSessionRecord(token, player.id, chatId, 'dev');
      state.sessions[token] = session;
      this.sessions.set(token, session);

      return { player, token };
    });
  }

  getSnapshot(chatId, viewerPlayerId = null, options = {}) {
    const snapshot = buildChatSnapshot(this.state, String(chatId), viewerPlayerId, new Date(), options);
    return {
      ...snapshot,
      starFive: buildStarFiveView(this.state.starFive?.entries ?? [], snapshot.players),
      viewerAnalyticsId: viewerPlayerId ? this.state.players[viewerPlayerId]?.analyticsId || '' : '',
      ...buildTeamViews(this.state, snapshot.players, viewerPlayerId)
    };
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

  getTeamById(teamId) {
    return this.state.teams?.[teamId] ?? null;
  }

  getTeamChallengeById(challengeId) {
    return this.state.teamChallenges?.[challengeId] ?? null;
  }
}
