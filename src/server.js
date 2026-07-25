import http from 'node:http';
import path from 'node:path';

import { TelegramBot } from './bot/telegram.js';
import { config } from './config.js';
import { verifyTelegramInitData, verifyTelegramLoginData } from './lib/auth.js';
import { renderLineupPng } from './lib/lineup-image.js';
import { renderPlayerShareCardPng } from './lib/player-card-image.js';
import { AppStore } from './lib/store.js';
import { getBearerToken, notFound, readJsonBody, sendJson, sendText, serveStaticFile, setCorsHeaders } from './lib/utils.js';
import { getDictionary, normalizeLocale, translate } from '../packages/i18n/index.js';

const GLOBAL_SNAPSHOT_CHAT_ID = 'global';

const store = new AppStore(config.dataFile);
await store.init();
await store.ensureChat({
  id: GLOBAL_SNAPSHOT_CHAT_ID,
  title: translate('ru', 'common.misc.all_games'),
  type: 'global'
});

const bot = new TelegramBot(config, store);
void bot.startPolling();

const KNOWN_LEGACY_HOST_REDIRECTS = new Map([
  ['footballmanager-production.up.railway.app', 'https://footballmanager-production-cafd.up.railway.app']
]);

setInterval(() => {
  store.cleanupSessions();
  void bot.processPendingRatingPrompts();
  void bot.processPendingGameSummaries();
}, config.schedulerIntervalMs).unref();

function getViewerSession(req) {
  const token = getBearerToken(req);
  return store.getSession(token);
}

function getGlobalSnapshot(viewerPlayerId = null, options = {}) {
  return store.getSnapshot(GLOBAL_SNAPSHOT_CHAT_ID, viewerPlayerId, options);
}

async function refreshTelegramChatAdminStatus(chatId, player) {
  const targetChatId = String(chatId || '');

  if (
    !targetChatId ||
    targetChatId === GLOBAL_SNAPSHOT_CHAT_ID ||
    !targetChatId.startsWith('-') ||
    !player?.id ||
    !player.telegramUserId ||
    !bot.enabled
  ) {
    return;
  }

  const isAdmin = await bot.isUserAdminOfChat(targetChatId, player.telegramUserId);
  await store.setChatAdminStatus(targetChatId, player.id, isAdmin);
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store'
  });
  res.end();
}

function normalizeHttpUrl(value) {
  const raw = String(value ?? '').trim();

  if (!raw) {
    return '';
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    return new URL(candidate).toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function getRequestHostname(req) {
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || String(req.headers.host || '').trim();

  return host.split(':')[0].toLowerCase();
}

function getCanonicalBaseUrl(req) {
  const configuredCanonical = normalizeHttpUrl(config.canonicalBaseUrl);

  if (configuredCanonical) {
    return configuredCanonical;
  }

  const requestHost = getRequestHostname(req);
  const knownRedirect = KNOWN_LEGACY_HOST_REDIRECTS.get(requestHost);

  if (knownRedirect) {
    return knownRedirect;
  }

  return normalizeHttpUrl(config.publicBaseUrl);
}

function maybeRedirectToCanonical(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method || '') || url.pathname === '/health') {
    return false;
  }

  const canonicalBaseUrl = getCanonicalBaseUrl(req);

  if (!canonicalBaseUrl) {
    return false;
  }

  const requestHost = getRequestHostname(req);
  const canonicalUrl = new URL(canonicalBaseUrl);

  if (requestHost === canonicalUrl.hostname.toLowerCase()) {
    return false;
  }

  const shouldRedirect =
    Boolean(config.canonicalBaseUrl) ||
    KNOWN_LEGACY_HOST_REDIRECTS.has(requestHost);

  if (!shouldRedirect) {
    return false;
  }

  canonicalUrl.pathname = url.pathname;
  canonicalUrl.search = url.search;
  redirect(res, canonicalUrl.toString());
  return true;
}

function buildAppUrl(req, params = {}) {
  const baseUrl = getCanonicalBaseUrl(req) || config.publicBaseUrl || `https://${req.headers.host || ''}`;
  const appUrl = new URL(baseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      appUrl.searchParams.set(key, String(value));
    }
  }

  return appUrl.toString();
}

function buildAbsoluteUrl(req, pathname, params = {}) {
  const baseUrl = getCanonicalBaseUrl(req) || config.publicBaseUrl || `https://${req.headers.host || ''}`;
  const absoluteUrl = new URL(pathname, baseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      absoluteUrl.searchParams.set(key, String(value));
    }
  }

  return absoluteUrl.toString();
}

function sendPng(res, buffer) {
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=120'
  });
  res.end(buffer);
}

function getGameView(gameId) {
  const snapshot = getGlobalSnapshot(null, { selectedGameId: gameId });
  return [snapshot.currentGame, ...(snapshot.gameDays ?? [])]
    .find((game) => game?.id === gameId) ?? null;
}

function getPlayerCard(playerId) {
  const snapshot = getGlobalSnapshot(null);
  return (snapshot.players ?? []).find((player) => player.id === playerId) ?? null;
}

function getLocalePayload(locale) {
  const normalizedLocale = normalizeLocale(locale);

  return {
    locale: normalizedLocale,
    translations: getDictionary(normalizedLocale)
  };
}

function getRequestLocale(req, url, session = null) {
  if (session?.playerId) {
    return store.getPlayerLocale(session.playerId);
  }

  const headerLocale = String(req.headers['accept-language'] || '').split(',')[0];
  return normalizeLocale(url.searchParams.get('locale') || headerLocale);
}

function t(locale, key, params = {}) {
  return translate(locale, key, params);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    setCorsHeaders(req, res, config.corsAllowedOrigins);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        botEnabled: bot.enabled,
        publicBaseUrl: config.publicBaseUrl || null,
        canonicalBaseUrl: getCanonicalBaseUrl(req) || null
      });
      return;
    }

    if (maybeRedirectToCanonical(req, res, url)) {
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      serveStaticFile(res, path.join(config.webDir, 'index.html'));
      return;
    }

    if (req.method === 'GET' && /^\/api\/share-images\/players\/[^/]+\.png$/.test(url.pathname)) {
      const session = getViewerSession(req);
      const locale = getRequestLocale(req, url, session);
      const playerId = decodeURIComponent(url.pathname.split('/')[4].replace(/\.png$/, ''));
      const player = getPlayerCard(playerId);

      if (!player) {
        notFound(res);
        return;
      }

      sendPng(res, await renderPlayerShareCardPng(player, locale));
      return;
    }

    if (req.method === 'GET' && /^\/api\/share-images\/games\/[^/]+\.png$/.test(url.pathname)) {
      const gameId = decodeURIComponent(url.pathname.split('/')[4].replace(/\.png$/, ''));
      const game = getGameView(gameId);

      if (!game) {
        notFound(res);
        return;
      }

      sendPng(res, await renderLineupPng(game));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/auth/telegram-login') {
      const auth = verifyTelegramLoginData(
        url.searchParams,
        config.telegramBotToken,
        config.authMaxAgeSeconds
      );
      const chatId = String(url.searchParams.get('chatId') || config.defaultChatId || '');
      const view = url.searchParams.get('view') || '';
      const gameId = url.searchParams.get('gameId') || '';

      if (!auth.ok) {
        redirect(res, buildAppUrl(req, {
          chatId,
          view,
          gameId,
          authError: auth.reason
        }));
        return;
      }

      const privateChatId = String(auth.user.id);
      let player = await store.rememberTelegramUser(privateChatId, auth.user, {
        photoUrl: auth.user.photo_url ?? '',
        chatType: 'private'
      });

      if (chatId && chatId !== privateChatId) {
        player = await store.rememberTelegramUser(chatId, auth.user, {
          photoUrl: auth.user.photo_url ?? '',
          chatType: 'supergroup'
        });
        await refreshTelegramChatAdminStatus(chatId, player);
      }

      const token = await store.createSession(player.id, GLOBAL_SNAPSHOT_CHAT_ID);
      redirect(res, buildAppUrl(req, {
        chatId,
        view,
        gameId,
        session: token
      }));
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/app.js' || url.pathname === '/app.css' || url.pathname === '/config.js')) {
      serveStaticFile(res, path.join(config.webDir, url.pathname.slice(1)));
      return;
    }

    if (
      req.method === 'GET' &&
      /^\/assets\/(?:achievements|field|icons)\/[a-z0-9_.-]+\.(?:svg|png|webp)$/i.test(url.pathname)
    ) {
      serveStaticFile(res, path.join(config.webDir, url.pathname.slice(1)));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/lib/lineup.js') {
      serveStaticFile(res, path.join(config.rootDir, 'src/lib/lineup.js'));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
      const session = getViewerSession(req);
      const bootstrapChatId = String(url.searchParams.get('chatId') || '');
      const locale = getRequestLocale(req, url, session);

      if (session && bootstrapChatId) {
        await refreshTelegramChatAdminStatus(bootstrapChatId, store.getPlayerById(session.playerId));
      }

      const snapshot = getGlobalSnapshot(session?.playerId ?? null, {
        selectedGameId: url.searchParams.get('gameId') || ''
      });
      sendJson(res, 200, {
        snapshot,
        allowDevLogin: config.allowDevLogin,
        ...getLocalePayload(locale)
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/telegram') {
      const body = await readJsonBody(req);
      const requestedChatId = String(body.chatId || config.defaultChatId || '');

      const auth = verifyTelegramInitData(
        body.initData,
        config.telegramBotToken,
        config.authMaxAgeSeconds
      );

      if (!auth.ok) {
        sendJson(res, 401, { error: auth.reason });
        return;
      }

      const privateChatId = String(auth.user.id);
      const chatId = requestedChatId || privateChatId;
      const telegramUser = {
        ...auth.user,
        language_code: auth.user.language_code || body.locale
      };
      let player = await store.rememberTelegramUser(privateChatId, telegramUser, {
        photoUrl: auth.user.photo_url ?? '',
        chatType: 'private'
      });

      if (requestedChatId && requestedChatId !== privateChatId) {
        player = await store.rememberTelegramUser(requestedChatId, telegramUser, {
          photoUrl: auth.user.photo_url ?? '',
          chatType: 'supergroup'
        });
        await refreshTelegramChatAdminStatus(requestedChatId, player);
      }

      const token = await store.createSession(player.id, GLOBAL_SNAPSHOT_CHAT_ID);
      const locale = store.getPlayerLocale(player.id);
      const snapshot = getGlobalSnapshot(player.id, {
        selectedGameId: body.gameId || ''
      });

      sendJson(res, 200, {
        token,
        snapshot,
        ...getLocalePayload(locale)
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/share/profile') {
      const session = getViewerSession(req);
      const locale = getRequestLocale(req, url, session);

      if (!session) {
        sendJson(res, 401, { error: t(locale, 'errors.unauthorized') });
        return;
      }

      const player = store.getPlayerById(session.playerId);
      const playerCard = getPlayerCard(session.playerId);

      if (!player || !playerCard) {
        sendJson(res, 404, { error: t(locale, 'errors.player_not_found') });
        return;
      }

      const appUrl = buildAppUrl(req, {
        view: 'players',
        playerId: player.id
      });
      const miniAppUrl = bot.buildMainMiniAppLink('', {
        initialView: 'players',
        playerId: player.id
      }) || appUrl;
      const imageUrl = buildAbsoluteUrl(req, `/api/share-images/players/${encodeURIComponent(player.id)}.png`, { locale });
      const shareText = t(locale, 'common.share.profile_text', { name: playerCard.displayName });
      let preparedMessageId = '';

      if (player.telegramUserId && bot.enabled) {
        try {
          const prepared = await bot.prepareShareMessage(player.telegramUserId, {
            id: `player-${player.id}`,
            type: 'photo',
            title: shareText,
            photo_url: imageUrl,
            thumbnail_url: imageUrl,
            caption: shareText,
            reply_markup: {
              inline_keyboard: [[{ text: t(locale, 'common.buttons.view'), url: miniAppUrl }]]
            }
          });
          preparedMessageId = prepared?.id || '';
        } catch (error) {
          console.error('Unable to prepare profile share:', error.message);
        }
      }

      sendJson(res, 200, {
        preparedMessageId,
        fallback: {
          title: shareText,
          text: shareText,
          url: appUrl
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/share/game') {
      const session = getViewerSession(req);
      const locale = getRequestLocale(req, url, session);

      if (!session) {
        sendJson(res, 401, { error: t(locale, 'errors.unauthorized') });
        return;
      }

      const body = await readJsonBody(req);
      const gameId = String(body.gameId || '');
      const player = store.getPlayerById(session.playerId);
      const game = getGameView(gameId);

      if (!player || !game) {
        sendJson(res, 404, { error: t(locale, 'errors.game_not_found') });
        return;
      }

      const appUrl = buildAppUrl(req, {
        view: 'game',
        gameId: game.id
      });
      const miniAppUrl = bot.buildMainMiniAppLink('', {
        initialView: 'game',
        gameId: game.id
      }) || appUrl;
      const imageUrl = buildAbsoluteUrl(req, `/api/share-images/games/${encodeURIComponent(game.id)}.png`);
      const shareText = t(locale, 'common.share.game_text', {
        date: game.dateLabel,
        time: game.time,
        location: game.location ? `, ${game.location}` : ''
      });
      let preparedMessageId = '';

      if (player.telegramUserId && bot.enabled) {
        try {
          const prepared = await bot.prepareShareMessage(player.telegramUserId, {
            id: `game-${game.id}`,
            type: 'photo',
            title: shareText,
            photo_url: imageUrl,
            thumbnail_url: imageUrl,
            caption: shareText,
            reply_markup: {
              inline_keyboard: [[{ text: t(locale, 'common.buttons.view'), url: miniAppUrl }]]
            }
          });
          preparedMessageId = prepared?.id || '';
        } catch (error) {
          console.error('Unable to prepare game share:', error.message);
        }
      }

      sendJson(res, 200, {
        preparedMessageId,
        fallback: {
          title: shareText,
          text: shareText,
          url: appUrl
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/dev') {
      if (!config.allowDevLogin) {
        sendJson(res, 403, { error: 'Dev login is disabled' });
        return;
      }

      const body = await readJsonBody(req);
      const chatId = String(body.chatId || config.defaultChatId || '');

      if (!chatId || !body.username) {
        sendJson(res, 400, { error: 'chatId and username are required' });
        return;
      }

      const result = await store.loginDevUser(chatId, body.username, body.displayName || '');

      if (body.locale) {
        await store.setPlayerLocale(result.player.id, body.locale, 'manual');
      }

      const locale = store.getPlayerLocale(result.player.id);
      const snapshot = getGlobalSnapshot(result.player.id);

      sendJson(res, 200, {
        token: result.token,
        snapshot,
        ...getLocalePayload(locale)
      });
      return;
    }

    if (req.method === 'PATCH' && url.pathname === '/api/locale') {
      const session = getViewerSession(req);
      const locale = getRequestLocale(req, url, session);

      if (!session) {
        sendJson(res, 401, {
          errorKey: 'errors.unauthorized',
          error: t(locale, 'errors.unauthorized')
        });
        return;
      }

      const body = await readJsonBody(req);
      const player = await store.setPlayerLocale(session.playerId, body.locale, 'manual');
      const updatedLocale = store.getPlayerLocale(player.id);
      const snapshot = getGlobalSnapshot(session.playerId);

      sendJson(res, 200, {
        snapshot,
        ...getLocalePayload(updatedLocale)
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/import-history') {
      if (!config.adminImportToken) {
        sendJson(res, 403, { error: 'Admin import is disabled' });
        return;
      }

      if (req.headers['x-admin-token'] !== config.adminImportToken) {
        sendJson(res, 401, { error: 'Invalid admin token' });
        return;
      }

      const body = await readJsonBody(req);
      const chatId = String(body.chatId || config.defaultChatId || '');

      if (!chatId || !body.payload) {
        sendJson(res, 400, { error: 'chatId and payload are required' });
        return;
      }

      const result = await store.importTelegramExport({
        chatId,
        chatTitle: body.chatTitle || 'Football Chat',
        chatType: body.chatType || 'supergroup',
        payload: body.payload
      });
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/import-history-text') {
      if (!config.adminImportToken) {
        sendJson(res, 403, { error: 'Admin import is disabled' });
        return;
      }

      if (req.headers['x-admin-token'] !== config.adminImportToken) {
        sendJson(res, 401, { error: 'Invalid admin token' });
        return;
      }

      const body = await readJsonBody(req);
      const chatId = String(body.chatId || config.defaultChatId || '');

      if (!chatId || !body.text) {
        sendJson(res, 400, { error: 'chatId and text are required' });
        return;
      }

      const result = await store.importAnnouncementTextLog({
        chatId,
        chatTitle: body.chatTitle || 'Football Chat',
        chatType: body.chatType || 'supergroup',
        text: body.text
      });
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/import-career-seed') {
      if (!config.adminImportToken) {
        sendJson(res, 403, { error: 'Admin import is disabled' });
        return;
      }

      if (req.headers['x-admin-token'] !== config.adminImportToken) {
        sendJson(res, 401, { error: 'Invalid admin token' });
        return;
      }

      const body = await readJsonBody(req);
      const result = await store.importCareerSeed({
        players: body.players
      });
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/export-state') {
      if (!config.adminImportToken) {
        sendJson(res, 403, { error: 'Admin export is disabled' });
        return;
      }

      if (req.headers['x-admin-token'] !== config.adminImportToken) {
        sendJson(res, 401, { error: 'Invalid admin token' });
        return;
      }

      sendJson(res, 200, { state: store.state });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/merge-state') {
      if (!config.adminImportToken) {
        sendJson(res, 403, { error: 'Admin merge is disabled' });
        return;
      }

      if (req.headers['x-admin-token'] !== config.adminImportToken) {
        sendJson(res, 401, { error: 'Invalid admin token' });
        return;
      }

      const body = await readJsonBody(req);
      const result = await store.mergeState(body.state);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/import-bootstrap-snapshot') {
      if (!config.adminImportToken) {
        sendJson(res, 403, { error: 'Admin import is disabled' });
        return;
      }

      if (req.headers['x-admin-token'] !== config.adminImportToken) {
        sendJson(res, 401, { error: 'Invalid admin token' });
        return;
      }

      const body = await readJsonBody(req);
      const result = await store.importBootstrapSnapshot(body.snapshot);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/teams') {
      const session = getViewerSession(req);

      if (!session) {
        sendJson(res, 401, { error: 'Требуется авторизация' });
        return;
      }

      const body = await readJsonBody(req);
      const result = await store.createTeam({
        requesterPlayerId: session.playerId,
        name: body.name,
        city: body.city,
        format: body.format,
        level: body.level,
        captainPlayerId: body.captainPlayerId,
        playerIds: body.playerIds,
        status: body.status
      });
      sendJson(res, 200, {
        team: { id: result.team.id },
        snapshot: getGlobalSnapshot(session.playerId)
      });
      return;
    }

    if (req.method === 'PUT' && /^\/api\/teams\/[^/]+$/.test(url.pathname)) {
      const session = getViewerSession(req);

      if (!session) {
        sendJson(res, 401, { error: 'Требуется авторизация' });
        return;
      }

      const body = await readJsonBody(req);
      const teamId = decodeURIComponent(url.pathname.split('/')[3]);
      const result = await store.updateTeam({
        teamId,
        requesterPlayerId: session.playerId,
        payload: body
      });
      sendJson(res, 200, {
        team: { id: result.team.id },
        snapshot: getGlobalSnapshot(session.playerId)
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/team-challenges') {
      const session = getViewerSession(req);

      if (!session) {
        sendJson(res, 401, { error: 'Требуется авторизация' });
        return;
      }

      const body = await readJsonBody(req);
      const result = await store.createTeamChallenge({
        requesterPlayerId: session.playerId,
        challengerTeamId: body.challengerTeamId,
        opponentTeamId: body.opponentTeamId,
        payload: body
      });
      await bot.notifyTeamChallenge?.(result.challenge.id);
      sendJson(res, 200, {
        challenge: { id: result.challenge.id },
        snapshot: getGlobalSnapshot(session.playerId)
      });
      return;
    }

    if (req.method === 'PATCH' && /^\/api\/team-challenges\/[^/]+$/.test(url.pathname)) {
      const session = getViewerSession(req);

      if (!session) {
        sendJson(res, 401, { error: 'Требуется авторизация' });
        return;
      }

      const body = await readJsonBody(req);
      const challengeId = decodeURIComponent(url.pathname.split('/')[3]);
      const result = body.action === 'edit'
        ? await store.updateTeamChallenge({
          challengeId,
          requesterPlayerId: session.playerId,
          payload: body
        })
        : body.action === 'cancel'
          ? await store.cancelTeamChallenge({
            challengeId,
            requesterPlayerId: session.playerId
          })
          : await store.respondToTeamChallenge({
            challengeId,
            requesterPlayerId: session.playerId,
            action: body.action,
            payload: body,
            timezoneOffset: config.chatTimezoneOffset
          });

      if (result.game) {
        bot.schedulePromptForGame(result.game);
        await bot.notifyPlayersAboutManualGame(result.game.id);
      } else if (body.action === 'counter') {
        await bot.notifyTeamChallenge?.(result.challenge.id);
      }

      sendJson(res, 200, {
        challenge: { id: result.challenge.id },
        game: result.game ? { id: result.game.id } : null,
        snapshot: getGlobalSnapshot(session.playerId)
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/games') {
      const session = getViewerSession(req);
      const locale = getRequestLocale(req, url, session);

      if (!session) {
        sendJson(res, 401, { error: t(locale, 'errors.unauthorized') });
        return;
      }

      const organizer = store.getPlayerById(session.playerId);

      if (!organizer) {
        sendJson(res, 403, { error: t(locale, 'errors.player_not_found') });
        return;
      }

      const body = await readJsonBody(req);

      const result = await store.createManualGame({
        chatId: GLOBAL_SNAPSHOT_CHAT_ID,
        organizerPlayerId: session.playerId,
        date: body.date,
        time: body.time,
        location: body.location,
        additionalInfo: body.additionalInfo,
        playerIds: body.playerIds,
        timezoneOffset: config.chatTimezoneOffset
      });

      bot.schedulePromptForGame(result.game);

      if (body.notifyPlayers) {
        await bot.notifyPlayersAboutManualGame(result.game.id);
      }

      const snapshot = getGlobalSnapshot(session.playerId);
      sendJson(res, 200, {
        game: { id: result.game.id },
        snapshot
      });
      return;
    }

    if (req.method === 'PUT' && /^\/api\/games\/[^/]+$/.test(url.pathname)) {
      const session = getViewerSession(req);
      const locale = getRequestLocale(req, url, session);

      if (!session) {
        sendJson(res, 401, { error: t(locale, 'errors.unauthorized') });
        return;
      }

      const body = await readJsonBody(req);
      const gameId = decodeURIComponent(url.pathname.split('/')[3]);
      const existingGame = store.getGameById(gameId);
      const result = await store.updateManualGame({
        chatId: existingGame?.chatId ?? session.chatId,
        gameId,
        requesterPlayerId: session.playerId,
        date: body.date,
        time: body.time,
        location: body.location,
        additionalInfo: body.additionalInfo,
        playerIds: body.playerIds,
        timezoneOffset: config.chatTimezoneOffset
      });

      bot.schedulePromptForGame(result.game);
      await bot.publishOrSyncGameAnnouncement?.(result.game.id);

      const snapshot = getGlobalSnapshot(session.playerId);
      sendJson(res, 200, {
        game: { id: result.game.id },
        snapshot
      });
      return;
    }

    if (req.method === 'PATCH' && /^\/api\/games\/[^/]+\/roster-lock$/.test(url.pathname)) {
      const session = getViewerSession(req);
      const locale = getRequestLocale(req, url, session);

      if (!session) {
        sendJson(res, 401, { error: t(locale, 'errors.unauthorized') });
        return;
      }

      const gameId = decodeURIComponent(url.pathname.split('/')[3]);
      const body = await readJsonBody(req).catch(() => ({}));
      await store.setGameRosterLocked({
        gameId,
        requesterPlayerId: session.playerId,
        rosterLocked: Boolean(body.rosterLocked)
      });
      await bot.publishOrSyncGameAnnouncement?.(gameId);
      const snapshot = getGlobalSnapshot(session.playerId, { selectedGameId: gameId });
      sendJson(res, 200, { snapshot });
      return;
    }

    if (req.method === 'DELETE' && /^\/api\/games\/[^/]+$/.test(url.pathname)) {
      const session = getViewerSession(req);
      const locale = getRequestLocale(req, url, session);

      if (!session) {
        sendJson(res, 401, { error: t(locale, 'errors.unauthorized') });
        return;
      }

      const gameId = decodeURIComponent(url.pathname.split('/')[3]);
      const existingGame = store.getGameById(gameId);
      const snapshotChatId = existingGame?.chatId ?? session.chatId;
      await store.deleteGame({
        chatId: snapshotChatId,
        gameId,
        requesterPlayerId: session.playerId
      });
      const snapshot = getGlobalSnapshot(session.playerId);
      sendJson(res, 200, { snapshot });
      return;
    }

    if (req.method === 'POST' && /^\/api\/games\/[^/]+\/join-request$/.test(url.pathname)) {
      const session = getViewerSession(req);
      const locale = getRequestLocale(req, url, session);

      if (!session) {
        sendJson(res, 401, { error: t(locale, 'errors.unauthorized') });
        return;
      }

      const gameId = decodeURIComponent(url.pathname.split('/')[3]);
      const result = await store.requestJoinGame({
        gameId,
        playerId: session.playerId
      });

      if (result.requested) {
        await bot.notifyOrganizerAboutJoinRequest(result.game.id, result.player.id);
      }
      await bot.publishOrSyncGameAnnouncement?.(result.game.id);

      const snapshot = getGlobalSnapshot(session.playerId, { selectedGameId: gameId });
      sendJson(res, 200, { snapshot });
      return;
    }

    if (req.method === 'DELETE' && /^\/api\/games\/[^/]+\/join-request$/.test(url.pathname)) {
      const session = getViewerSession(req);
      const locale = getRequestLocale(req, url, session);

      if (!session) {
        sendJson(res, 401, { error: t(locale, 'errors.unauthorized') });
        return;
      }

      const gameId = decodeURIComponent(url.pathname.split('/')[3]);
      const body = await readJsonBody(req).catch(() => ({}));
      const targetPlayerId = String(body?.playerId || session.playerId);
      await store.cancelJoinRequest({
        gameId,
        playerId: targetPlayerId,
        requesterPlayerId: session.playerId
      });
      await bot.publishOrSyncGameAnnouncement?.(gameId);

      const snapshot = getGlobalSnapshot(session.playerId, { selectedGameId: gameId });
      sendJson(res, 200, { snapshot });
      return;
    }

    if (req.method === 'POST' && /^\/api\/games\/[^/]+\/invite\/accept$/.test(url.pathname)) {
      const session = getViewerSession(req);
      const locale = getRequestLocale(req, url, session);

      if (!session) {
        sendJson(res, 401, { error: t(locale, 'errors.unauthorized') });
        return;
      }

      const gameId = decodeURIComponent(url.pathname.split('/')[3]);
      const result = await store.acceptGameInvite({
        gameId,
        playerId: session.playerId
      });

      bot.schedulePromptForGame(result.game);
      await bot.publishOrSyncGameAnnouncement?.(result.game.id);

      const snapshot = getGlobalSnapshot(session.playerId, { selectedGameId: gameId });
      sendJson(res, 200, { snapshot });
      return;
    }

    if (req.method === 'DELETE' && /^\/api\/games\/[^/]+\/invite$/.test(url.pathname)) {
      const session = getViewerSession(req);
      const locale = getRequestLocale(req, url, session);

      if (!session) {
        sendJson(res, 401, { error: t(locale, 'errors.unauthorized') });
        return;
      }

      const gameId = decodeURIComponent(url.pathname.split('/')[3]);
      const result = await store.removePlayerFromGame({
        gameId,
        playerId: session.playerId
      });

      if (result.removed && result.organizer?.privateChatId) {
        await bot.notifyOrganizerAboutDeclinedGame(result.game.id, result.player.id, result);
      }
      await bot.publishOrSyncGameAnnouncement?.(result.game.id);

      const snapshot = getGlobalSnapshot(session.playerId, { selectedGameId: gameId });
      sendJson(res, 200, { snapshot });
      return;
    }

    if (req.method === 'POST' && /^\/api\/games\/[^/]+\/join-requests\/[^/]+\/approve$/.test(url.pathname)) {
      const session = getViewerSession(req);
      const locale = getRequestLocale(req, url, session);

      if (!session) {
        sendJson(res, 401, { error: t(locale, 'errors.unauthorized') });
        return;
      }

      const parts = url.pathname.split('/');
      const gameId = decodeURIComponent(parts[3]);
      const playerId = decodeURIComponent(parts[5]);
      const result = await store.approveJoinRequest({
        gameId,
        requesterPlayerId: session.playerId,
        playerId
      });

      bot.schedulePromptForGame(result.game);
      await bot.notifyPlayerAddedToGame(result.game.id, result.player.id);
      await bot.publishOrSyncGameAnnouncement?.(result.game.id);

      const snapshot = getGlobalSnapshot(session.playerId, { selectedGameId: gameId });
      sendJson(res, 200, { snapshot });
      return;
    }

    if (req.method === 'POST' && /^\/api\/games\/[^/]+\/ratings$/.test(url.pathname)) {
      const session = getViewerSession(req);
      const locale = getRequestLocale(req, url, session);

      if (!session) {
        sendJson(res, 401, { error: t(locale, 'errors.unauthorized') });
        return;
      }

      const body = await readJsonBody(req);
      const gameId = url.pathname.split('/')[3];
      const existingGame = store.getGameById(gameId);
      await store.submitRating({
        chatId: session.chatId,
        gameId,
        raterPlayerId: session.playerId,
        targetPlayerId: body.targetPlayerId,
        payload: body
      });
      await bot.publishOrSyncGameAnnouncement?.(gameId);
      const snapshot = getGlobalSnapshot(session.playerId);
      sendJson(res, 200, { snapshot });
      return;
    }

    if (req.method === 'POST' && /^\/api\/games\/[^/]+\/quick-rating$/.test(url.pathname)) {
      const session = getViewerSession(req);
      const locale = getRequestLocale(req, url, session);

      if (!session) {
        sendJson(res, 401, { error: t(locale, 'errors.unauthorized') });
        return;
      }

      const body = await readJsonBody(req);
      const gameId = url.pathname.split('/')[3];
      await store.submitQuickRating({
        chatId: session.chatId,
        gameId,
        raterPlayerId: session.playerId,
        payload: body
      });
      await bot.publishOrSyncGameAnnouncement?.(gameId);

      const snapshot = getGlobalSnapshot(session.playerId, { selectedGameId: gameId });
      sendJson(res, 200, { snapshot });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/profile') {
      const session = getViewerSession(req);
      const locale = getRequestLocale(req, url, session);

      if (!session) {
        sendJson(res, 401, { error: t(locale, 'errors.unauthorized') });
        return;
      }

      const body = await readJsonBody(req);
      await store.updateSelfProfile({
        chatId: session.chatId,
        playerId: session.playerId,
        payload: body
      });
      const snapshot = getGlobalSnapshot(session.playerId);
      sendJson(res, 200, { snapshot });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/robots.txt') {
      sendText(res, 200, 'User-agent: *\nDisallow:');
      return;
    }

    notFound(res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      error: error.message || 'Internal server error'
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Server running at http://${config.host}:${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    bot.stop();
    server.close(() => process.exit(0));
  });
}
