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
  return url.searchParams.get('chatId') || config.defaultChatId || '';
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

      if (!chatId) {
        sendJson(res, 400, { error: 'chatId is required' });
        return;
      }

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
      const chatId = String(body.chatId || config.defaultChatId || '');

      if (!chatId) {
        sendJson(res, 400, { error: 'chatId is required' });
        return;
      }

      const auth = verifyTelegramInitData(
        body.initData,
        config.telegramBotToken,
        config.authMaxAgeSeconds
      );

      if (!auth.ok) {
        sendJson(res, 401, { error: auth.reason });
        return;
      }

      const player = await store.rememberTelegramUser(chatId, auth.user, {
        photoUrl: auth.user.photo_url ?? '',
        chatType: 'supergroup'
      });
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
