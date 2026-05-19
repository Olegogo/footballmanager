import { parseAnnouncementText } from '../lib/parser.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCommand(text) {
  const command = String(text ?? '').trim().split(/\s+/)[0];
  return command.split('@')[0].toLowerCase();
}

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
    if (!this.config.publicBaseUrl) {
      return '';
    }

    const url = new URL(this.config.publicBaseUrl);

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

  buildMiniAppKeyboard(chatType = 'private', chatId = '') {
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
              text: 'Открыть миниапп',
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
            text: 'Открыть миниапп',
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

  async sendMiniAppEntry(chatId, chatType, targetChatId, primaryText) {
    const replyMarkup = this.buildMiniAppKeyboard(chatType, targetChatId);
    const fallbackUrl = this.getMiniAppFallbackUrl(targetChatId);

    if (!replyMarkup) {
      if (!fallbackUrl) {
        await this.sendText(chatId, 'Сначала укажите PUBLIC_BASE_URL, чтобы miniapp можно было открыть из Telegram.');
        return;
      }

      await this.sendText(chatId, `${primaryText}\n\n${fallbackUrl}`);
      return;
    }

    try {
      await this.sendText(chatId, primaryText, {
        replyMarkup
      });
    } catch (error) {
      if (!fallbackUrl) {
        throw error;
      }

      await this.sendText(chatId, `${primaryText}\n\n${fallbackUrl}`);
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

  async sendText(chatId, text, options = {}) {
    return this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: options.replyMarkup
    });
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
      void this.processPendingRatingPrompts();
    }, delayMs + 250);

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
      await this.sendMiniAppEntry(chatId, message.chat.type, targetChatId, lines.join('\n'));
      return;
    }

    if (command === '/open') {
      const helpLine =
        message.chat.type === 'private'
          ? 'Miniapp готов. Открывайте по кнопке ниже.'
          : 'Miniapp готов. В группе Telegram откроет его по безопасной ссылке ниже.';

      await this.sendMiniAppEntry(chatId, message.chat.type, targetChatId, helpLine);
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

  async handleAnnouncement(message) {
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
  }

  async handleMessage(message) {
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

    await this.handleAnnouncement(message);
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

  async handleUpdate(update) {
    if (update.message) {
      await this.handleMessage(update.message);
    } else if (update.edited_message) {
      await this.handleMessage(update.edited_message);
    } else if (update.my_chat_member) {
      await this.handleChatMember(update.my_chat_member);
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
          allowed_updates: ['message', 'edited_message', 'my_chat_member']
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
    const promptText = 'Игра началась. Участники матча уже могут оценить игроков в miniapp: выставить позицию, рейтинг, голы и голевые передачи за текущую игру.';

    for (const game of games) {
      try {
        const replyMarkup = this.buildMiniAppKeyboard('supergroup', game.chatId);
        let message;

        try {
          message = await this.sendText(game.chatId, promptText, {
            replyMarkup
          });
        } catch (error) {
          const fallbackUrl = this.buildMainMiniAppLink(game.chatId) || this.buildMiniAppUrl(game.chatId);

          if (!fallbackUrl) {
            throw error;
          }

          message = await this.sendText(
            game.chatId,
            `${promptText}\n\n${fallbackUrl}`
          );
        }

        await this.store.markRatingsPromptSent(game.id, message.message_id);
        this.clearPromptTimer(game.id);
      } catch (error) {
        console.error(`Unable to send rating prompt for ${game.id}:`, error.message);
      }
    }
  }
}
