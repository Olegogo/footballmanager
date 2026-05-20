import test from 'node:test';
import assert from 'node:assert/strict';

import { TelegramBot } from '../src/bot/telegram.js';

function createBotStore(games) {
  const marked = [];
  const store = {
    state: {
      chats: {},
      games: {}
    },
    listGamesRequiringPrompt() {
      return games;
    },
    async markRatingsPromptSent(gameId, messageId) {
      marked.push({ gameId, messageId });
    }
  };

  return { store, marked };
}

test('processPendingRatingPrompts sends a rating prompt with miniapp link', async () => {
  const games = [
    {
      id: 'game_1',
      chatId: '-1001',
      scheduledAt: '2099-05-19T16:30:00.000Z'
    }
  ];
  const { store, marked } = createBotStore(games);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const sent = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 77 };
  };

  await bot.processPendingRatingPrompts();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, '-1001');
  assert.equal(sent[0].text, 'Не забудьте оценить игру тиммейтов');
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[0][0].text, 'Оценить');
  assert.equal(
    sent[0].options.replyMarkup.inline_keyboard[0][0].url,
    'https://t.me/football_test_bot?startapp=chat_-1001'
  );
  assert.deepEqual(marked, [{ gameId: 'game_1', messageId: 77 }]);
});

test('processPendingRatingPrompts falls back to plain link when keyboard send fails', async () => {
  const games = [
    {
      id: 'game_2',
      chatId: '-1002',
      scheduledAt: '2099-05-19T16:30:00.000Z'
    }
  ];
  const { store, marked } = createBotStore(games);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const sent = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });

    if (options.replyMarkup) {
      throw new Error('Telegram rejected keyboard');
    }

    return { message_id: 88 };
  };

  await bot.processPendingRatingPrompts();

  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /https:\/\/t\.me\/football_test_bot\?startapp=chat_-1002/);
  assert.deepEqual(marked, [{ gameId: 'game_2', messageId: 88 }]);
});

test('/open falls back to plain link when Telegram rejects keyboard', async () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const sent = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });

    if (options.replyMarkup) {
      throw new Error('Telegram rejected keyboard');
    }

    return { message_id: 99 };
  };

  await bot.handleCommand({
    text: '/open',
    chat: {
      id: -1003,
      type: 'supergroup'
    }
  });

  assert.equal(sent.length, 2);
  assert.equal(sent[0].chatId, -1003);
  assert.equal(sent[1].chatId, -1003);
  assert.match(sent[1].text, /https:\/\/t\.me\/football_test_bot\?startapp=chat_-1003/);
});

test('/open sends only button text with custom label when keyboard works', async () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const sent = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 102 };
  };

  await bot.handleCommand({
    text: '/open',
    chat: {
      id: -1006,
      type: 'supergroup'
    }
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, '\u2060');
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[0][0].text, 'Открыть футбольчик');
});

test('/open tolerates PUBLIC_BASE_URL without scheme in group chats', async () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'footballmanager-production.up.railway.app'
  }, store);
  const sent = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 101 };
  };

  await bot.handleCommand({
    text: '/open',
    chat: {
      id: -1004,
      type: 'supergroup'
    }
  });

  assert.equal(sent.length, 1);
  assert.equal(
    sent[0].options.replyMarkup.inline_keyboard[0][0].url,
    'https://t.me/football_test_bot?startapp=chat_-1004'
  );
});

test('buildMiniAppUrl normalizes PUBLIC_BASE_URL without scheme for private chat usage', async () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'footballmanager-production.up.railway.app'
  }, store);

  assert.equal(
    bot.buildMiniAppUrl('-1005'),
    'https://footballmanager-production.up.railway.app/?chatId=-1005'
  );
});

test('handleAnnouncement sends details button only for fresh messages', async () => {
  const store = {
    state: {
      chats: {},
      games: {}
    },
    async recordGameFromAnnouncement() {
      return {
        created: true,
        updated: false,
        game: {
          id: 'game_7',
          chatId: '-1007',
          scheduledAt: '2099-05-24T16:30:00.000Z'
        }
      };
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const sent = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 103 };
  };

  const message = {
    text: `24 мая
Сокольники, поле 10
19:30

1. @teterko
2. @dbabanin
3. @satwerz
4. @olegogo
5. @birarov`,
    chat: {
      id: -1007,
      type: 'supergroup',
      title: 'Football'
    },
    date: Math.floor(Date.now() / 1000),
    message_id: 77
  };

  await bot.handleAnnouncement(message, { isEdited: false });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, '\u2060');
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[0][0].text, 'Детали игры');

  sent.length = 0;
  await bot.handleAnnouncement(message, { isEdited: true });
  assert.equal(sent.length, 0);
});
