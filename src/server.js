import http from 'node:http';
import path from 'node:path';

import { TelegramBot } from './bot/telegram.js';
import { config } from './config.js';
import { verifyTelegramInitData } from './lib/auth.js';
import { AppStore } from './lib/store.js';
import { getBearerToken, notFound, readJsonBody, sendJson, sendText, serveStaticFile, setCorsHeaders } from './lib/utils.js';

const store = new AppStore(config.dataFile);
await store.init();

const bot = new TelegramBot(config, store);
void bot.startPolling();

setInterval(() => {
  store.cleanupSessions();
  void bot.processPendingRatingPrompts();
}, config.schedulerIntervalMs).unref();

function getChatIdFromRequest(url) {
  return url.searchParams.get('chatId') || config.defaultChatId || 'global';
}

function getViewerSession(req) {
  const token = getBearerToken(req);
  return store.getSession(token);
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

    if (req.method === 'GET' && (url.pathname === '/app.js' || url.pathname === '/app.css' || url.pathname === '/config.js')) {
      serveStaticFile(res, path.join(config.webDir, url.pathname.slice(1)));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/lib/lineup.js') {
      serveStaticFile(res, path.join(config.rootDir, 'src/lib/lineup.js'));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
      const chatId = getChatIdFromRequest(url);
      const session = getViewerSession(req);
      const snapshot = store.getSnapshot(chatId, session?.playerId ?? null);
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

      const token = store.createSession(player.id, chatId);
      const snapshot = store.getSnapshot(chatId, player.id);

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
      const snapshot = store.getSnapshot(chatId, result.player.id);

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

      if (!organizer.privateChatId && !config.allowDevLogin) {
        sendJson(res, 403, { error: 'Сначала запустите бота в личке командой /start' });
        return;
      }

      if (bot.enabled && organizer.telegramUserId) {
        const isMember = await bot.isUserMemberOfChat(session.chatId, organizer.telegramUserId);

        if (!isMember) {
          sendJson(res, 403, { error: 'Создавать игры могут только участники чата, где добавлен бот' });
          return;
        }
      }

      const body = await readJsonBody(req);
      const result = await store.createManualGame({
        chatId: session.chatId,
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

      const snapshot = store.getSnapshot(session.chatId, session.playerId);
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

      const snapshot = store.getSnapshot(session.chatId, session.playerId);
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
      await store.deleteGame({
        chatId: existingGame?.chatId ?? session.chatId,
        gameId,
        requesterPlayerId: session.playerId
      });
      const snapshot = store.getSnapshot(session.chatId, session.playerId);
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
      await store.submitRating({
        chatId: session.chatId,
        gameId,
        raterPlayerId: session.playerId,
        targetPlayerId: body.targetPlayerId,
        payload: body
      });
      const snapshot = store.getSnapshot(session.chatId, session.playerId);
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
      const snapshot = store.getSnapshot(session.chatId, session.playerId);
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
