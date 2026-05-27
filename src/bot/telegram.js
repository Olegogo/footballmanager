import { parseAnnouncementText } from '../lib/parser.js';
import { renderLineupPng } from '../lib/lineup-image.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCommand(text) {
  const command = String(text ?? '').trim().split(/\s+/)[0];
  return command.split('@')[0].toLowerCase();
}

function normalizeHttpUrl(value) {
  const raw = String(value ?? '').trim();

  if (!raw) {
    return '';
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    return new URL(candidate).toString();
  } catch {
    return '';
  }
}

const BUTTON_ONLY_TEXT = '\u2060';
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export class TelegramBot {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.offset = 0;
    this.running = false;
    this.botUsername = '';
    this.promptTimers = new Map();
  }

  get enabled() {
    return Boolean(this.config.telegramBotToken);
  }

  buildMiniAppUrl(chatId = '') {
    const baseUrl = normalizeHttpUrl(this.config.publicBaseUrl);

    if (!baseUrl) {
      return '';
    }

    const url = new URL(baseUrl);

    if (chatId) {
      url.searchParams.set('chatId', String(chatId));
    }

    return url.toString();
  }

  buildMainMiniAppLink(chatId = '') {
    if (!this.botUsername) {
      return '';
    }

    const url = new URL(`https://t.me/${this.botUsername}`);

    if (chatId) {
      url.searchParams.set('startapp', `chat_${chatId}`);
      return url.toString();
    }

    url.search = 'startapp';
    return url.toString();
  }

  buildMiniAppKeyboard(chatType = 'private', chatId = '', buttonText = 'Открыть миниапп') {
    const publicUrl = this.buildMiniAppUrl(chatId);
    const directMiniAppLink = this.buildMainMiniAppLink(chatId);

    if (chatType !== 'private') {
      const url = directMiniAppLink || publicUrl;

      if (!url) {
        return undefined;
      }

      return {
        inline_keyboard: [
          [
            {
              text: buttonText,
              url
            }
          ]
        ]
      };
    }

    if (!publicUrl) {
      return undefined;
    }

    return {
        inline_keyboard: [
          [
            {
              text: buttonText,
              web_app: {
                url: publicUrl
              }
            }
        ]
      ]
    };
  }

  getMiniAppFallbackUrl(chatId = '') {
    return this.buildMainMiniAppLink(chatId) || this.buildMiniAppUrl(chatId) || '';
  }

  async sendMiniAppEntry(chatId, chatType, targetChatId, options = {}) {
    const primaryText = options.primaryText ?? BUTTON_ONLY_TEXT;
    const buttonText = options.buttonText ?? 'Открыть миниапп';
    const replyMarkup = this.buildMiniAppKeyboard(chatType, targetChatId, buttonText);
    const fallbackUrl = this.getMiniAppFallbackUrl(targetChatId);
    const buttonOnly = options.buttonOnly ?? false;
    const fallbackText = buttonOnly ? fallbackUrl : `${primaryText}\n\n${fallbackUrl}`;

    if (!replyMarkup) {
      if (!fallbackUrl) {
        await this.sendText(chatId, 'Сначала укажите PUBLIC_BASE_URL, чтобы miniapp можно было открыть из Telegram.');
        return;
      }

      await this.sendText(chatId, fallbackText);
      return;
    }

    try {
      return await this.sendText(chatId, primaryText, {
        replyMarkup
      });
    } catch (error) {
      if (!fallbackUrl) {
        throw error;
      }

      return await this.sendText(chatId, fallbackText);
    }
  }

  async ensureBotProfile() {
    if (!this.enabled || this.botUsername) {
      return;
    }

    const me = await this.callApi('getMe');
    this.botUsername = me?.username ?? '';
  }

  async callApi(method, payload = {}) {
    const response = await fetch(`https://api.telegram.org/bot${this.config.telegramBotToken}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.description || `Telegram API error in ${method}`);
    }

    return data.result;
  }

  async callApiMultipart(method, formData) {
    const response = await fetch(`https://api.telegram.org/bot${this.config.telegramBotToken}/${method}`, {
      method: 'POST',
      body: formData
    });
    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.description || `Telegram API error in ${method}`);
    }

    return data.result;
  }

  async sendText(chatId, text, options = {}) {
    return this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: options.replyMarkup
    });
  }

  async answerCallbackQuery(callbackQueryId, text = '') {
    return this.callApi('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text
    });
  }

  async sendPhoto(chatId, photo, options = {}) {
    const formData = new FormData();
    formData.set('chat_id', String(chatId));
    formData.set('photo', new Blob([photo], { type: 'image/png' }), options.filename || 'lineup.png');

    if (options.caption) {
      formData.set('caption', options.caption);
    }

    if (options.replyMarkup) {
      formData.set('reply_markup', JSON.stringify(options.replyMarkup));
    }

    return this.callApiMultipart('sendPhoto', formData);
  }

  async buildGameLineupImage(chatId, gameId) {
    if (typeof this.store.getSnapshot !== 'function') {
      return null;
    }

    const snapshot = this.store.getSnapshot(chatId, null);
    const game = snapshot?.currentGame;

    if (!game || game.id !== gameId || !game.participants?.length) {
      return null;
    }

    return renderLineupPng(game);
  }

  async sendGameDetailsEntry(chatId, chatType, targetChatId, game) {
    const replyMarkup = this.buildMiniAppKeyboard(chatType, targetChatId, 'Детали игры');

    if (replyMarkup && game?.id) {
      try {
        const lineupImage = await this.buildGameLineupImage(targetChatId, game.id);

        if (lineupImage) {
          return await this.sendPhoto(chatId, lineupImage, {
            filename: `lineup-${game.id}.png`,
            replyMarkup
          });
        }
      } catch (error) {
        console.error('Unable to send game lineup image:', error.message);
      }
    }

    return this.sendMiniAppEntry(chatId, chatType, targetChatId, {
      primaryText: BUTTON_ONLY_TEXT,
      buttonText: 'Детали игры',
      buttonOnly: true
    });
  }

  buildManualInviteKeyboard(chatId, gameId) {
    const miniAppUrl = this.buildMiniAppUrl(chatId);

    if (!miniAppUrl) {
      return {
        inline_keyboard: [
          [
            {
              text: 'Не смогу',
              callback_data: `decline_game:${gameId}`
            }
          ]
        ]
      };
    }

    return {
      inline_keyboard: [
        [
          {
            text: 'К игре',
            web_app: {
              url: miniAppUrl
            }
          }
        ],
        [
          {
            text: 'Не смогу',
            callback_data: `decline_game:${gameId}`
          }
        ]
      ]
    };
  }

  formatGameInvite(game) {
    return [
      'Тебя пригласили на игру',
      '',
      `${game.dateLabel} в ${game.time}`,
      game.location ? `Место: ${game.location}` : '',
      '',
      'Открой miniapp, чтобы посмотреть состав и расстановку.'
    ].filter(Boolean).join('\n');
  }

  async notifyPlayersAboutManualGame(gameId) {
    const game = this.store.getGameById?.(gameId);

    if (!game) {
      return;
    }

    for (const playerId of game.playerIds) {
      if (playerId === game.organizerPlayerId) {
        continue;
      }

      const player = this.store.getPlayerById?.(playerId);

      if (!player?.privateChatId) {
        continue;
      }

      try {
        await this.sendText(player.privateChatId, this.formatGameInvite(game), {
          replyMarkup: this.buildManualInviteKeyboard(game.chatId, game.id)
        });
      } catch (error) {
        console.error(`Unable to send manual game invite to ${player.id}:`, error.message);
      }
    }
  }

  async isUserMemberOfChat(chatId, telegramUserId) {
    if (!this.enabled || !chatId || !telegramUserId) {
      return false;
    }

    try {
      const member = await this.callApi('getChatMember', {
        chat_id: chatId,
        user_id: telegramUserId
      });

      return ['creator', 'administrator', 'member', 'restricted'].includes(member?.status);
    } catch (error) {
      console.error('Unable to verify chat membership:', error.message);
      return false;
    }
  }

  clearPromptTimer(gameId) {
    const timer = this.promptTimers.get(gameId);

    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.promptTimers.delete(gameId);
  }

  schedulePromptForGame(game) {
    if (!game?.id || game.ratingsOpenedAt) {
      return;
    }

    const dueAt = new Date(game.scheduledAt).getTime();

    if (!Number.isFinite(dueAt)) {
      return;
    }

    this.clearPromptTimer(game.id);

    const delayMs = dueAt - Date.now();

    if (delayMs <= 0) {
      queueMicrotask(() => {
        void this.processPendingRatingPrompts();
      });
      return;
    }

    const timer = setTimeout(() => {
      this.promptTimers.delete(game.id);

      if (Date.now() < dueAt) {
        this.schedulePromptForGame(game);
        return;
      }

      void this.processPendingRatingPrompts();
    }, Math.min(delayMs + 250, MAX_TIMER_DELAY_MS));

    timer.unref?.();
    this.promptTimers.set(game.id, timer);
  }

  scheduleCurrentGamePrompts() {
    for (const chat of Object.values(this.store.state.chats ?? {})) {
      const game = chat.currentGameId ? this.store.state.games?.[chat.currentGameId] : null;

      if (game && !game.ratingsOpenedAt) {
        this.schedulePromptForGame(game);
      }
    }
  }

  async maybeRefreshPlayerPhoto(chatId, player) {
    if (!player?.telegramUserId || player.photoUrl) {
      return;
    }

    try {
      const photos = await this.callApi('getUserProfilePhotos', {
        user_id: player.telegramUserId,
        limit: 1
      });
      const firstPhoto = photos?.photos?.[0]?.at(-1);

      if (!firstPhoto?.file_id) {
        return;
      }

      const file = await this.callApi('getFile', {
        file_id: firstPhoto.file_id
      });
      const photoUrl = `https://api.telegram.org/file/bot${this.config.telegramBotToken}/${file.file_path}`;
      await this.store.rememberTelegramUser(chatId, {
        id: player.telegramUserId,
        username: player.username,
        first_name: player.firstName,
        last_name: player.lastName
      }, { photoUrl });
    } catch (error) {
      console.error('Failed to refresh Telegram profile photo:', error.message);
    }
  }

  async handleCommand(message) {
    const command = normalizeCommand(message.text);
    const chatId = message.chat.id;
    const targetChatId =
      message.chat.type === 'private' ? this.config.defaultChatId || chatId : chatId;

    if (command === '/start' || command === '/help') {
      const lines = [
        'Я собираю игры, строю FIFA-карточки и открываю miniapp для оценок.',
        '',
        'Команды:',
        '/open - открыть miniapp',
        '/chatid - показать ID чата для импорта истории',
        '',
        'Важно: отключите Privacy Mode у бота через BotFather, чтобы он видел сообщения с анонсами игр.'
      ];
      await this.sendMiniAppEntry(chatId, message.chat.type, targetChatId, {
        primaryText: lines.join('\n'),
        buttonText: 'Открыть миниапп'
      });
      return;
    }

    if (command === '/open') {
      await this.sendMiniAppEntry(chatId, message.chat.type, targetChatId, {
        primaryText: BUTTON_ONLY_TEXT,
        buttonText: 'Открыть футбольчик',
        buttonOnly: true
      });
      return;
    }

    if (command === '/chatid') {
      await this.sendText(
        chatId,
        `ID этого чата: ${chatId}\nИспользуйте его в DEFAULT_CHAT_ID и в скрипте импорта истории.`,
        {}
      );
    }
  }

  async handleAnnouncement(message, options = {}) {
    if (!message.text || message.chat.type === 'private') {
      return;
    }

    const announcement = parseAnnouncementText(message.text, new Date((message.date ?? Math.floor(Date.now() / 1000)) * 1000));

    if (!announcement) {
      return;
    }

    const result = await this.store.recordGameFromAnnouncement({
      chatId: message.chat.id,
      chatTitle: message.chat.title ?? '',
      chatType: message.chat.type,
      messageId: message.message_id,
      rawText: message.text,
      announcement,
      source: 'telegram-message',
      sourceDate: new Date((message.date ?? Math.floor(Date.now() / 1000)) * 1000)
    });

    if (result?.game) {
      this.schedulePromptForGame(result.game);
    }

    if (!options.isEdited && result && (result.created || result.updated)) {
      await this.sendGameDetailsEntry(message.chat.id, message.chat.type, message.chat.id, result.game);
    }
  }

  async handleMessage(message, options = {}) {
    await this.store.ensureChat({
      id: message.chat.id,
      title: message.chat.title ?? `${message.chat.first_name ?? ''} ${message.chat.last_name ?? ''}`.trim(),
      type: message.chat.type,
      username: message.chat.username ?? ''
    });

    if (message.from) {
      const player = await this.store.rememberTelegramUser(message.chat.id, message.from, {
        chatTitle: message.chat.title ?? '',
        chatType: message.chat.type
      });
      await this.maybeRefreshPlayerPhoto(message.chat.id, player);
    }

    if (message.text?.startsWith('/')) {
      await this.handleCommand(message);
      return;
    }

    await this.handleAnnouncement(message, options);
  }

  async handleChatMember(update) {
    const status = update?.new_chat_member?.status;
    const oldStatus = update?.old_chat_member?.status;
    const chat = update?.chat;

    if (!chat || oldStatus === status) {
      return;
    }

    if (['member', 'administrator'].includes(status)) {
      await this.store.ensureChat({
        id: chat.id,
        title: chat.title ?? '',
        type: chat.type,
        username: chat.username ?? ''
      });
      await this.sendText(
        chat.id,
        'Я подключился к чату. Следующие анонсы игр буду ловить автоматически. Для полной истории потом запустите импорт JSON-экспорта из Telegram Desktop.'
      );
    }
  }

  async handleCallbackQuery(callbackQuery) {
    const data = String(callbackQuery?.data ?? '');

    if (!data.startsWith('decline_game:')) {
      return;
    }

    const gameId = data.split(':')[1];
    const player = this.store.getPlayerByTelegramUserId?.(callbackQuery.from?.id);

    if (!player) {
      await this.answerCallbackQuery(callbackQuery.id, 'Не нашел твою карточку игрока');
      return;
    }

    try {
      const result = await this.store.removePlayerFromGame({
        gameId,
        playerId: player.id
      });

      await this.answerCallbackQuery(
        callbackQuery.id,
        result.removed ? 'Ок, убрал тебя из игры' : 'Ты уже не в списке игроков'
      );

      if (result.removed && result.organizer?.privateChatId) {
        await this.sendText(
          result.organizer.privateChatId,
          `${result.player.displayName || `@${result.player.username}`} не сможет сыграть ${result.game.dateLabel} в ${result.game.time}. Нужно искать замену.`
        );
      }
    } catch (error) {
      await this.answerCallbackQuery(callbackQuery.id, error.message || 'Не получилось обновить игру');
    }
  }

  async handleUpdate(update) {
    if (update.message) {
      await this.handleMessage(update.message, { isEdited: false });
    } else if (update.edited_message) {
      await this.handleMessage(update.edited_message, { isEdited: true });
    } else if (update.my_chat_member) {
      await this.handleChatMember(update.my_chat_member);
    } else if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
    }
  }

  async startPolling() {
    if (!this.enabled || this.running) {
      return;
    }

    this.running = true;

    try {
      await this.ensureBotProfile();
      await this.callApi('deleteWebhook', { drop_pending_updates: false });
    } catch (error) {
      console.error('Unable to delete webhook before polling:', error.message);
    }

    this.scheduleCurrentGamePrompts();
    await this.processPendingRatingPrompts();

    while (this.running) {
      try {
        const updates = await this.callApi('getUpdates', {
          offset: this.offset,
          timeout: 25,
          allowed_updates: ['message', 'edited_message', 'my_chat_member', 'callback_query']
        });

        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      } catch (error) {
        console.error('Polling error:', error.message);
        await delay(3000);
      }
    }
  }

  stop() {
    this.running = false;

    for (const gameId of this.promptTimers.keys()) {
      this.clearPromptTimer(gameId);
    }
  }

  async processPendingRatingPrompts() {
    if (!this.enabled) {
      return;
    }

    const games = this.store.listGamesRequiringPrompt(new Date());
    const promptText = 'Не забудьте оценить игру тиммейтов';

    for (const game of games) {
      try {
        const message = await this.sendMiniAppEntry(game.chatId, 'supergroup', game.chatId, {
          primaryText: promptText,
          buttonText: 'Оценить'
        });

        await this.store.markRatingsPromptSent(game.id, message.message_id);
        this.clearPromptTimer(game.id);
      } catch (error) {
        console.error(`Unable to send rating prompt for ${game.id}:`, error.message);
      }
    }
  }
}
