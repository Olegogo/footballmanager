import http from 'node:http';
import path from 'node:path';

import { TelegramBot } from './bot/telegram.js';
import { config } from './config.js';
import { verifyTelegramInitData, verifyTelegramLoginData } from './lib/auth.js';
import { renderLineupPng } from './lib/lineup-image.js';
import { renderPlayerShareCardPng } from './lib/player-card-image.js';
import { AppStore } from './lib/store.js';
import { getBearerToken, notFound, readJsonBody, sendJson, sendText, serveStaticFile, setCorsHeaders } from './lib/utils.js';

const GLOBAL_SNAPSHOT_CHAT_ID = 'global';

const store = new AppStore(config.dataFile);
await store.init();
await store.ensureChat({
  id: GLOBAL_SNAPSHOT_CHAT_ID,
  title: 'Все игры',
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
      const playerId = decodeURIComponent(url.pathname.split('/')[4].replace(/\.png$/, ''));
      const player = getPlayerCard(playerId);

      if (!player) {
        notFound(res);
        return;
      }

      sendPng(res, await renderPlayerShareCardPng(player));
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

    if (req.method === 'GET' && /^\/assets\/achievements\/[a-z0-9-]+\.svg$/.test(url.pathname)) {
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

      if (session && bootstrapChatId) {
        await refreshTelegramChatAdminStatus(bootstrapChatId, store.getPlayerById(session.playerId));
      }

      const snapshot = getGlobalSnapshot(session?.playerId ?? null, {
        selectedGameId: url.searchParams.get('gameId') || ''
      });
      sendJson(res, 200, {
        snapshot,
        allowDevLogin: config.allowDevLogin
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
      let player = await store.rememberTelegramUser(privateChatId, auth.user, {
        photoUrl: auth.user.photo_url ?? '',
        chatType: 'private'
      });

      if (requestedChatId && requestedChatId !== privateChatId) {
        player = await store.rememberTelegramUser(requestedChatId, auth.user, {
          photoUrl: auth.user.photo_url ?? '',
          chatType: 'supergroup'
        });
        await refreshTelegramChatAdminStatus(requestedChatId, player);
      }

      const token = await store.createSession(player.id, GLOBAL_SNAPSHOT_CHAT_ID);
      const snapshot = getGlobalSnapshot(player.id, {
        selectedGameId: body.gameId || ''
      });

      sendJson(res, 200, {
        token,
        snapshot
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/share/profile') {
      const session = getViewerSession(req);

      if (!session) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }

      const player = store.getPlayerById(session.playerId);
      const playerCard = getPlayerCard(session.playerId);

      if (!player || !playerCard) {
        sendJson(res, 404, { error: 'Игрок не найден' });
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
      const imageUrl = buildAbsoluteUrl(req, `/api/share-images/players/${encodeURIComponent(player.id)}.png`);
      const shareText = `${playerCard.displayName} в игре`;
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
              inline_keyboard: [[{ text: 'Посмотреть', url: miniAppUrl }]]
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

      if (!session) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }

      const body = await readJsonBody(req);
      const gameId = String(body.gameId || '');
      const player = store.getPlayerById(session.playerId);
      const game = getGameView(gameId);

      if (!player || !game) {
        sendJson(res, 404, { error: 'Игра не найдена' });
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
      const shareText = `Игра ${game.dateLabel} в ${game.time}${game.location ? `, ${game.location}` : ''}`;
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
              inline_keyboard: [[{ text: 'Посмотреть', url: miniAppUrl }]]
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
      const snapshot = getGlobalSnapshot(result.player.id);

      sendJson(res, 200, {
        token: result.token,
        snapshot
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

    if (req.method === 'POST' && url.pathname === '/api/games') {
      const session = getViewerSession(req);

      if (!session) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }

      const organizer = store.getPlayerById(session.playerId);

      if (!organizer) {
        sendJson(res, 403, { error: 'Игрок не найден' });
        return;
      }

      const body = await readJsonBody(req);

      const result = await store.createManualGame({
        chatId: GLOBAL_SNAPSHOT_CHAT_ID,
        organizerPlayerId: session.playerId,
        date: body.date,
        time: body.time,
        location: body.location,
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

      if (!session) {
        sendJson(res, 401, { error: 'Unauthorized' });
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
        playerIds: body.playerIds,
        timezoneOffset: config.chatTimezoneOffset
      });

      bot.schedulePromptForGame(result.game);

      const snapshot = getGlobalSnapshot(session.playerId);
      sendJson(res, 200, {
        game: { id: result.game.id },
        snapshot
      });
      return;
    }

    if (req.method === 'DELETE' && /^\/api\/games\/[^/]+$/.test(url.pathname)) {
      const session = getViewerSession(req);

      if (!session) {
        sendJson(res, 401, { error: 'Unauthorized' });
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

      if (!session) {
        sendJson(res, 401, { error: 'Unauthorized' });
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

      const snapshot = getGlobalSnapshot(session.playerId, { selectedGameId: gameId });
      sendJson(res, 200, { snapshot });
      return;
    }

    if (req.method === 'DELETE' && /^\/api\/games\/[^/]+\/join-request$/.test(url.pathname)) {
      const session = getViewerSession(req);

      if (!session) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }

      const gameId = decodeURIComponent(url.pathname.split('/')[3]);
      await store.cancelJoinRequest({
        gameId,
        playerId: session.playerId
      });

      const snapshot = getGlobalSnapshot(session.playerId, { selectedGameId: gameId });
      sendJson(res, 200, { snapshot });
      return;
    }

    if (req.method === 'POST' && /^\/api\/games\/[^/]+\/invite\/accept$/.test(url.pathname)) {
      const session = getViewerSession(req);

      if (!session) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }

      const gameId = decodeURIComponent(url.pathname.split('/')[3]);
      const result = await store.acceptGameInvite({
        gameId,
        playerId: session.playerId
      });

      bot.schedulePromptForGame(result.game);

      const snapshot = getGlobalSnapshot(session.playerId, { selectedGameId: gameId });
      sendJson(res, 200, { snapshot });
      return;
    }

    if (req.method === 'DELETE' && /^\/api\/games\/[^/]+\/invite$/.test(url.pathname)) {
      const session = getViewerSession(req);

      if (!session) {
        sendJson(res, 401, { error: 'Unauthorized' });
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

      const snapshot = getGlobalSnapshot(session.playerId, { selectedGameId: gameId });
      sendJson(res, 200, { snapshot });
      return;
    }

    if (req.method === 'POST' && /^\/api\/games\/[^/]+\/join-requests\/[^/]+\/approve$/.test(url.pathname)) {
      const session = getViewerSession(req);

      if (!session) {
        sendJson(res, 401, { error: 'Unauthorized' });
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

      const snapshot = getGlobalSnapshot(session.playerId, { selectedGameId: gameId });
      sendJson(res, 200, { snapshot });
      return;
    }

    if (req.method === 'POST' && /^\/api\/games\/[^/]+\/ratings$/.test(url.pathname)) {
      const session = getViewerSession(req);

      if (!session) {
        sendJson(res, 401, { error: 'Unauthorized' });
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
      const snapshot = getGlobalSnapshot(session.playerId);
      sendJson(res, 200, { snapshot });
      return;
    }

    if (req.method === 'POST' && /^\/api\/games\/[^/]+\/quick-rating$/.test(url.pathname)) {
      const session = getViewerSession(req);

      if (!session) {
        sendJson(res, 401, { error: 'Unauthorized' });
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
      const snapshot = getGlobalSnapshot(session.playerId, { selectedGameId: gameId });
      sendJson(res, 200, { snapshot });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/profile') {
      const session = getViewerSession(req);

      if (!session) {
        sendJson(res, 401, { error: 'Unauthorized' });
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
