import http from 'node:http';
import path from 'node:path';

import { TelegramBot } from './bot/telegram.js';
import { config } from './config.js';
import { verifyTelegramInitData, verifyTelegramLoginData } from './lib/auth.js';
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

setInterval(() => {
  store.cleanupSessions();
  void bot.processPendingRatingPrompts();
}, config.schedulerIntervalMs).unref();

function getViewerSession(req) {
  const token = getBearerToken(req);
  return store.getSession(token);
}

function getGlobalSnapshot(viewerPlayerId = null) {
  return store.getSnapshot(GLOBAL_SNAPSHOT_CHAT_ID, viewerPlayerId);
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store'
  });
  res.end();
}

function buildAppUrl(req, params = {}) {
  const baseUrl = config.publicBaseUrl || `https://${req.headers.host || ''}`;
  const appUrl = new URL(baseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      appUrl.searchParams.set(key, String(value));
    }
  }

  return appUrl.toString();
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
        publicBaseUrl: config.publicBaseUrl || null
      });
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      serveStaticFile(res, path.join(config.webDir, 'index.html'));
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

    if (req.method === 'GET' && url.pathname === '/lib/lineup.js') {
      serveStaticFile(res, path.join(config.rootDir, 'src/lib/lineup.js'));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
      const session = getViewerSession(req);
      const snapshot = getGlobalSnapshot(session?.playerId ?? null);
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
      }

      const token = await store.createSession(player.id, GLOBAL_SNAPSHOT_CHAT_ID);
      const snapshot = getGlobalSnapshot(player.id);

      sendJson(res, 200, {
        token,
        snapshot
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
