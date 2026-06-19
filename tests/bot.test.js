import test from 'node:test';
import assert from 'node:assert/strict';

import { TelegramBot } from '../src/bot/telegram.js';

const RATING_PROMPT_TEXT = '⚽️\nОценка стартовала!\nРаздайте баллы самым заметным игрокам матча и выберите MVP...';

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
  assert.equal(sent[0].text, RATING_PROMPT_TEXT);
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[0][0].text, 'Оценить');
  assert.equal(
    sent[0].options.replyMarkup.inline_keyboard[0][0].url,
    'https://t.me/football_test_bot?startapp=gameid_game_1'
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

    if (options.replyMarkup?.inline_keyboard?.[0]?.[0]?.url) {
      throw new Error('Telegram rejected keyboard');
    }

    return { message_id: 88 };
  };

  await bot.processPendingRatingPrompts();

  assert.equal(sent.length, 3);
  assert.equal(
    sent[2].text,
    `${RATING_PROMPT_TEXT}\n\nhttps://t.me/football_test_bot?startapp=gameid_game_2`
  );
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

    if (options.replyMarkup?.inline_keyboard?.[0]?.[0]?.url) {
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

  assert.equal(sent.length, 3);
  assert.equal(sent[0].chatId, -1003);
  assert.equal(sent[2].chatId, -1003);
  assert.equal(
    sent[2].text,
    'https://t.me/football_test_bot?startapp=app'
  );
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
  assert.equal(
    sent[0].options.replyMarkup.inline_keyboard[0][0].url,
    'https://t.me/football_test_bot?startapp=app'
  );
});

test('/open in private chats opens the games list by default', async () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example',
    defaultChatId: '-1001'
  }, store);
  const sent = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 103 };
  };

  await bot.handleCommand({
    text: '/open',
    chat: {
      id: 123,
      type: 'private'
    }
  });

  assert.equal(sent.length, 1);
  assert.equal(
    sent[0].options.replyMarkup.inline_keyboard[0][0].web_app.url,
    'https://app.example/'
  );
});

test('/start sends onboarding copy with app button', async () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const sent = [];

  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 100 };
  };

  await bot.handleCommand({
    text: '/start',
    chat: {
      id: 123,
      type: 'private'
    }
  });

  assert.equal(sent.length, 3);
  assert.equal(sent[0].text, '⚽ Создавай игры, собирай команды и находи новых игроков рядом с собой.');
  assert.equal(sent[1].text, '🎯 Мы уже создали тебе карточку игрока. Заполни её и получай оценки после матчей.');
  assert.equal(sent[2].text, '🤖 Добавь бота в чат с игроками. Он поможет собирать составы, балансировать команды и вести статистику.');
  assert.equal(sent[2].options.replyMarkup.inline_keyboard[0][0].text, 'Открыть приложение');
});

test('/start uses direct web_app url in private chats', async () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example',
    defaultChatId: '-1001'
  }, store);
  const sent = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 100 };
  };

  await bot.handleCommand({
    text: '/start',
    chat: {
      id: 123,
      type: 'private'
    }
  });

  assert.equal(sent.length, 3);
  assert.equal(sent[2].options.replyMarkup.inline_keyboard[0][0].url, undefined);
  assert.equal(
    sent[2].options.replyMarkup.inline_keyboard[0][0].web_app.url,
    'https://app.example/'
  );
});

test('buildManualInviteKeyboard uses the same main miniapp entry when possible', () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);

  bot.botUsername = 'football_test_bot';
  const keyboard = bot.buildManualInviteKeyboard('-1009', 'game_9');

  assert.equal(keyboard.inline_keyboard[0][0].text, 'К игре');
  assert.equal(keyboard.inline_keyboard[0][0].url, undefined);
  assert.equal(keyboard.inline_keyboard[0][0].web_app.url, 'https://app.example/?chatId=-1009&view=game&gameId=game_9');
  assert.equal(keyboard.inline_keyboard[1][0].callback_data, 'decline_game:game_9');
});

test('buildMainMiniAppLink can deep link to a shared player card', () => {
  const { store } = createBotStore([]);
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);

  bot.botUsername = 'football_test_bot';

  assert.equal(
    bot.buildMainMiniAppLink('', { initialView: 'players', playerId: 'player_42' }),
    'https://t.me/football_test_bot?startapp=playerid_player_42'
  );
});

test('/open uses Telegram miniapp deep link in group chats', async () => {
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
    'https://t.me/football_test_bot?startapp=app'
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
5. @birarov

1000р
89295991499
Альфа, Тинь, Сбер`,
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

test('handleAnnouncement creates game from announcement without payment block', async () => {
  const calls = [];
  const store = {
    state: {
      chats: {},
      games: {}
    },
    async recordGameFromAnnouncement(payload) {
      calls.push(payload);
      return {
        created: true,
        updated: false,
        game: {
          id: 'game_no_payment',
          chatId: String(payload.chatId),
          scheduledAt: payload.announcement.scheduledAt
        }
      };
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);

  bot.botUsername = 'football_test_bot';
  bot.sendText = async () => ({ message_id: 104 });

  await bot.handleAnnouncement({
    text: `30 мая
Сокольники, поле 10
16:00

1. @teterko
2. @dbabanin
3. @satwerz
4. @olegogo
5. @birarov`,
    chat: {
      id: -1008,
      type: 'supergroup',
      title: 'Football'
    },
    date: Math.floor(new Date('2099-05-28T12:00:00+03:00').getTime() / 1000),
    message_id: 88
  }, { isEdited: false });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].announcement.location, 'Сокольники, поле 10');
  assert.equal(calls[0].announcement.time, '16:00');
});

test('handleAnnouncement updates known edited message without payment block', async () => {
  const calls = [];
  const store = {
    state: {
      chats: {},
      games: {}
    },
    findGameByMessage(chatId, messageId) {
      assert.equal(String(chatId), '-1007');
      assert.equal(messageId, 77);
      return {
        id: 'game_7',
        chatId: '-1007',
        messageId: 77,
        scheduledAt: '2099-05-24T16:30:00.000Z'
      };
    },
    async recordGameFromAnnouncement(payload) {
      calls.push(payload);
      return {
        created: false,
        updated: true,
        game: {
          id: 'game_7',
          chatId: '-1007',
          scheduledAt: payload.announcement.scheduledAt
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
    return { message_id: 104 };
  };

  await bot.handleAnnouncement({
    text: `24 мая
Сокольники, поле 10
20:15

1. @teterko
2. @dbabanin
3. @satwerz
4. @olegogo
5. @birarov
6. @dimasharovv`,
    chat: {
      id: -1007,
      type: 'supergroup',
      title: 'Football'
    },
    date: Math.floor(new Date('2099-05-24T10:00:00Z').getTime() / 1000),
    edit_date: Math.floor(new Date('2099-05-24T12:00:00Z').getTime() / 1000),
    message_id: 77
  }, { isEdited: true });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].sourceDate.toISOString(), '2099-05-24T12:00:00.000Z');
  assert.equal(calls[0].announcement.hasPaymentBlock, false);
  assert.equal(calls[0].announcement.time, '20:15');
  assert.equal(calls[0].announcement.playerUsernames.length, 6);
  assert.equal(sent.length, 0);
});

test('handleAnnouncement stores telegram announcement author as organizer', async () => {
  const calls = [];
  const store = {
    state: {
      chats: {},
      games: {}
    },
    getPlayerByTelegramUserId(telegramUserId) {
      assert.equal(telegramUserId, 12345);
      return { id: 'player_author' };
    },
    async recordGameFromAnnouncement(payload) {
      calls.push(payload);
      return {
        created: false,
        updated: false,
        game: {
          id: 'game_author',
          chatId: String(payload.chatId),
          scheduledAt: payload.announcement.scheduledAt,
          ratingsOpenedAt: true
        }
      };
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);

  await bot.handleAnnouncement({
    text: `24 мая
Сокольники, поле 10
19:30

1. @teterko
2. @dbabanin
3. @satwerz
4. @olegogo
5. @birarov

1000р
89295991499
Альфа, Тинь, Сбер`,
    from: {
      id: 12345,
      username: 'organizer'
    },
    chat: {
      id: -1007,
      type: 'supergroup',
      title: 'Football'
    },
    date: Math.floor(new Date('2099-05-24T12:00:00Z').getTime() / 1000),
    message_id: 77
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].organizerPlayerId, 'player_author');
});

test('handleAnnouncement parses game announcement from message captions', async () => {
  const calls = [];
  const store = {
    state: {
      chats: {},
      games: {}
    },
    async recordGameFromAnnouncement(payload) {
      calls.push(payload);
      return {
        created: false,
        updated: false,
        game: {
          id: 'game_caption',
          chatId: String(payload.chatId),
          scheduledAt: payload.announcement.scheduledAt,
          ratingsOpenedAt: true
        }
      };
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);

  await bot.handleAnnouncement({
    caption: `30 мая, суббота

16:00. Поле 10

1. @teterko
2. @Mot0strelok
3. @AlekseyYaselsky
4. @O_legacy
5. @alex_leb999 🤡
6. Alexandr 🤡

1000р
89295991499
Альфа, Тинь, Сбер`,
    chat: {
      id: -1008,
      type: 'supergroup',
      title: 'Football'
    },
    date: Math.floor(new Date('2026-05-28T12:00:00Z').getTime() / 1000),
    message_id: 88
  }, { isEdited: true });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].rawText, calls[0].announcement.rawText);
  assert.equal(calls[0].announcement.location, 'Поле 10');
  assert.equal(calls[0].announcement.playerUsernames.length, 6);
  assert.equal(calls[0].announcement.playerUsernames[5], 'alexandr');
});

test('handleCommand creates game from replied announcement with /game fallback', async () => {
  const calls = [];
  const store = {
    state: {
      chats: {},
      games: {}
    },
    async recordGameFromAnnouncement(payload) {
      calls.push(payload);
      return {
        created: true,
        updated: false,
        game: {
          id: 'game_command',
          chatId: String(payload.chatId),
          scheduledAt: payload.announcement.scheduledAt
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
    return { message_id: 501 };
  };

  await bot.handleCommand({
    text: '/game',
    chat: {
      id: -1010,
      type: 'supergroup',
      title: 'Football'
    },
    date: Math.floor(new Date('2026-05-28T12:00:00Z').getTime() / 1000),
    message_id: 101,
    reply_to_message: {
      message_id: 100,
      date: Math.floor(new Date('2026-05-28T12:00:00Z').getTime() / 1000),
      text: `30 мая, суббота

16:00. Поле 10

1. @teterko
2. @Mot0strelok
3. @AlekseyYaselsky
4. @O_legacy
5. @alex_leb999 🤡
6. Alexandr 🤡

1000р
89295991499
Альфа, Тинь, Сбер`
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].chatId, -1010);
  assert.equal(calls[0].messageId, 100);
  assert.equal(calls[0].source, 'telegram-command');
  assert.equal(calls[0].announcement.location, 'Поле 10');
  assert.equal(calls[0].announcement.playerUsernames[5], 'alexandr');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[0][0].text, 'Детали игры');
});

test('handleCommand ignores bare /game in groups to avoid chat spam', async () => {
  let recordCalled = false;
  const store = {
    state: {
      chats: {},
      games: {}
    },
    async recordGameFromAnnouncement() {
      recordCalled = true;
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const sent = [];

  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 502 };
  };

  await bot.handleCommand({
    text: '/game',
    chat: {
      id: -1011,
      type: 'supergroup',
      title: 'Football'
    },
    date: Math.floor(new Date('2026-05-28T12:00:00Z').getTime() / 1000),
    message_id: 102
  });

  assert.equal(recordCalled, false);
  assert.equal(sent.length, 0);
});

test('handleAnnouncement sends lineup image with details button when snapshot is available', async () => {
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
    },
    getSnapshot() {
      return {
        currentGame: {
          id: 'game_7',
          dateLabel: '24 мая',
          location: 'Сокольники, поле 10',
          time: '19:30',
          participants: [
            {
              id: 'player_1',
              username: 'teterko',
              displayName: 'Teterko',
              photoUrl: '',
              overall: 81,
              position: 'CM',
              ratedGames: 2
            },
            {
              id: 'player_2',
              username: 'dbabanin',
              displayName: 'Babanin',
              photoUrl: '',
              overall: 74,
              position: 'GK',
              ratedGames: 1
            },
            {
              id: 'player_3',
              username: 'satwerz',
              displayName: 'Satwerz',
              photoUrl: '',
              overall: 76,
              position: 'GK',
              ratedGames: 1
            },
            {
              id: 'player_4',
              username: 'olegogo',
              displayName: 'Oleg',
              photoUrl: '',
              overall: 70,
              position: 'ST',
              ratedGames: 1
            },
            {
              id: 'player_5',
              username: 'birarov',
              displayName: 'Birarov',
              photoUrl: '',
              overall: 68,
              position: 'CB',
              ratedGames: 1
            }
          ]
        }
      };
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const texts = [];
  const photos = [];

  bot.botUsername = 'football_test_bot';
  bot.sendText = async (chatId, text, options = {}) => {
    texts.push({ chatId, text, options });
    return { message_id: 103 };
  };
  bot.sendPhoto = async (chatId, photo, options = {}) => {
    photos.push({ chatId, photo, options });
    return { message_id: 104 };
  };

  await bot.handleAnnouncement({
    text: `24 мая
Сокольники, поле 10
19:30

1. @teterko
2. @dbabanin
3. @satwerz
4. @olegogo
5. @birarov

1000р
89295991499
Альфа, Тинь, Сбер`,
    chat: {
      id: -1007,
      type: 'supergroup',
      title: 'Football'
    },
    date: Math.floor(Date.now() / 1000),
    message_id: 77
  }, { isEdited: false });

  assert.equal(texts.length, 0);
  assert.equal(photos.length, 1);
  assert.equal(photos[0].chatId, -1007);
  assert.ok(Buffer.isBuffer(photos[0].photo));
  assert.equal(photos[0].options.replyMarkup.inline_keyboard[0][0].text, 'Детали игры');
});

test('sendGameDetailsEntry renders lineup image for selected game outside currentGame', async () => {
  const store = {
    state: {
      chats: {},
      games: {}
    },
    getSnapshot() {
      return {
        currentGame: {
          id: 'game_current',
          participants: []
        },
        gameDays: [],
        players: [
          {
            id: 'player_1',
            username: 'oleg',
            displayName: 'Oleg',
            photoUrl: '',
            overall: 59,
            position: 'LW',
            ratedGames: 1
          },
          {
            id: 'player_2',
            username: 'teammate',
            displayName: 'Teammate',
            photoUrl: '',
            overall: 55,
            position: 'GK',
            ratedGames: 1
          }
        ]
      };
    },
    getGameById(gameId) {
      assert.equal(gameId, 'game_selected');
      return {
        id: 'game_selected',
        chatId: '-1007',
        dateLabel: '7 июня',
        location: 'Сокольники, поле 10',
        time: '19:00',
        scheduledAt: '2099-06-07T16:00:00.000Z',
        playerIds: ['player_1', 'player_2']
      };
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const photos = [];

  bot.botUsername = 'football_test_bot';
  bot.sendPhoto = async (chatId, photo, options = {}) => {
    photos.push({ chatId, photo, options });
    return { message_id: 105 };
  };
  bot.sendText = async () => {
    throw new Error('Expected photo instead of text fallback');
  };

  await bot.sendGameDetailsEntry(-1007, 'supergroup', -1007, {
    id: 'game_selected'
  });

  assert.equal(photos.length, 1);
  assert.equal(photos[0].chatId, -1007);
  assert.ok(Buffer.isBuffer(photos[0].photo));
  assert.equal(photos[0].options.replyMarkup.inline_keyboard[0][0].text, 'Детали игры');
});

test('sendGameDetailsEntry sends bare lineup image when photo keyboard is rejected', async () => {
  const store = {
    state: {
      chats: {},
      games: {}
    },
    getSnapshot() {
      return {
        currentGame: {
          id: 'game_selected',
          participants: [
            {
              id: 'player_1',
              username: 'oleg',
              displayName: 'Oleg',
              photoUrl: '',
              overall: 59,
              position: 'LW',
              ratedGames: 1
            },
            {
              id: 'player_2',
              username: 'teammate',
              displayName: 'Teammate',
              photoUrl: '',
              overall: 55,
              position: 'GK',
              ratedGames: 1
            }
          ]
        },
        gameDays: [],
        players: []
      };
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const photos = [];
  const texts = [];

  bot.botUsername = 'football_test_bot';
  bot.sendPhoto = async (chatId, photo, options = {}) => {
    photos.push({ chatId, photo, options });

    if (options.replyMarkup) {
      throw new Error('Telegram rejected photo keyboard');
    }

    return { message_id: 106 };
  };
  bot.sendText = async (chatId, text, options = {}) => {
    texts.push({ chatId, text, options });
    return { message_id: 107 };
  };

  await bot.sendGameDetailsEntry(-1007, 'supergroup', -1007, {
    id: 'game_selected'
  });

  assert.equal(photos.length, 2);
  assert.ok(photos[0].options.replyMarkup);
  assert.equal(photos[1].options.replyMarkup, undefined);
  assert.equal(texts.length, 1);
  assert.equal(texts[0].options.replyMarkup.inline_keyboard[0][0].text, 'Детали игры');
  assert.equal(texts[0].options.replyMarkup.inline_keyboard[0][0].url, 'https://t.me/football_test_bot?startapp=gameid_game_selected');
});

test('notifyPlayersAboutManualGame sends private invites with decline button', async () => {
  const store = {
    state: {
      chats: {},
      games: {}
    },
    getGameById() {
      return {
        id: 'game_9',
        chatId: '-1009',
        organizerPlayerId: 'player_1',
        dateLabel: '30 мая',
        time: '16:00',
        location: 'Сокольники, поле 10',
        playerIds: ['player_1', 'player_2', 'player_3']
      };
    },
    getPlayerById(playerId) {
      return {
        player_1: {
          id: 'player_1',
          displayName: 'Organizer',
          privateChatId: '111'
        },
        player_2: {
          id: 'player_2',
          displayName: 'Invited',
          privateChatId: '222'
        },
        player_3: {
          id: 'player_3',
          displayName: 'No private'
        }
      }[playerId];
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);
  const sent = [];

  bot.sendText = async (chatId, text, options = {}) => {
    sent.push({ chatId, text, options });
    return { message_id: 300 };
  };

  await bot.notifyPlayersAboutManualGame('game_9');

  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, '222');
  assert.match(sent[0].text, /Тебя пригласили на игру/);
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[0][0].text, 'К игре');
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[1][0].text, 'Не смогу');
  assert.equal(sent[0].options.replyMarkup.inline_keyboard[1][0].callback_data, 'decline_game:game_9');
});

test('handleCallbackQuery removes declined player and notifies organizer', async () => {
  const calls = [];
  const store = {
    state: {
      chats: {},
      games: {}
    },
    getPlayerByTelegramUserId(telegramUserId) {
      assert.equal(telegramUserId, 888);
      return {
        id: 'player_2',
        displayName: 'Invited',
        username: 'invited'
      };
    },
    async removePlayerFromGame(payload) {
      assert.deepEqual(payload, {
        gameId: 'game_9',
        playerId: 'player_2'
      });

      return {
        removed: true,
        player: {
          displayName: 'Invited',
          username: 'invited'
        },
        organizer: {
          privateChatId: '111'
        },
        game: {
          dateLabel: '30 мая',
          time: '16:00'
        }
      };
    }
  };
  const bot = new TelegramBot({
    telegramBotToken: 'token',
    publicBaseUrl: 'https://app.example'
  }, store);

  bot.answerCallbackQuery = async (id, text) => {
    calls.push({ type: 'answer', id, text });
  };
  bot.sendText = async (chatId, text) => {
    calls.push({ type: 'text', chatId, text });
    return { message_id: 301 };
  };

  await bot.handleCallbackQuery({
    id: 'callback_1',
    data: 'decline_game:game_9',
    from: {
      id: 888
    }
  });

  assert.deepEqual(calls[0], {
    type: 'answer',
    id: 'callback_1',
    text: 'Ок, убрал тебя из игры'
  });
  assert.equal(calls[1].type, 'text');
  assert.equal(calls[1].chatId, '111');
  assert.match(calls[1].text, /Invited не сможет сыграть/);
});
