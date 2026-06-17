import { parseAnnouncementText } from '../lib/parser.js';
import { renderLineupPng } from '../lib/lineup-image.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCommand(text) {
  const command = String(text ?? '').trim().split(/\s+/)[0];
  return command.split('@')[0].toLowerCase();
}

function getMessageText(message) {
  return message?.text || message?.caption || '';
}

function getReplyTextSourceCandidates(message) {
  return [
    message?.reply_to_message,
    message?.external_reply,
    message?.external_reply?.message,
    message?.quote,
    message?.text_quote
  ].filter(Boolean);
}

function stripCommandPayload(text) {
  return String(text ?? '').replace(/^\/[a-z0-9_]+(?:@\w+)?\s*/i, '').trim();
}

function escapeTelegramHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
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

  buildMiniAppUrl(chatId = '', options = {}) {
    const baseUrl = normalizeHttpUrl(this.config.publicBaseUrl);

    if (!baseUrl) {
      return '';
    }

    const url = new URL(baseUrl);

    if (chatId) {
      url.searchParams.set('chatId', String(chatId));
    }

    if (options.initialView) {
      url.searchParams.set('view', options.initialView);
    }

    if (options.gameId) {
      url.searchParams.set('gameId', String(options.gameId));
    }

    return url.toString();
  }

  buildMainMiniAppLink(chatId = '', options = {}) {
    if (!this.botUsername) {
      return '';
    }

    const url = new URL(`https://t.me/${this.botUsername}`);
    const view = options.initialView || '';

    if (options.gameId) {
      url.searchParams.set('startapp', `gameid_${options.gameId}`);
      return url.toString();
    }

    if (options.playerId) {
      url.searchParams.set('startapp', `playerid_${options.playerId}`);
      return url.toString();
    }

    if (chatId) {
      url.searchParams.set('startapp', view === 'game' ? `game_chat_${chatId}` : `chat_${chatId}`);
      return url.toString();
    }

    url.searchParams.set('startapp', view || 'app');
    return url.toString();
  }

  buildTelegramLoginUrl(chatId = '', options = {}) {
    const baseUrl = normalizeHttpUrl(this.config.publicBaseUrl);

    if (!baseUrl) {
      return '';
    }

    const url = new URL('/auth/telegram-login', baseUrl);

    if (chatId) {
      url.searchParams.set('chatId', String(chatId));
    }

    if (options.initialView) {
      url.searchParams.set('view', options.initialView);
    }

    if (options.gameId) {
      url.searchParams.set('gameId', String(options.gameId));
    }

    return url.toString();
  }

  buildMiniAppKeyboard(chatType = 'private', chatId = '', buttonText = '⚽', options = {}) {
    const publicUrl = this.buildMiniAppUrl(chatId, options);
    const directMiniAppLink = this.buildMainMiniAppLink(chatId, options);
    const loginUrl = this.buildTelegramLoginUrl(chatId, options);

    if (chatType === 'private' && publicUrl) {
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

    if (chatType !== 'private' && directMiniAppLink) {
      return {
        inline_keyboard: [
          [
            {
              text: buttonText,
              url: directMiniAppLink
            }
          ]
        ]
      };
    }

    if (directMiniAppLink) {
      return {
        inline_keyboard: [
          [
            {
              text: buttonText,
              url: directMiniAppLink
            }
          ]
        ]
      };
    }

    if (chatType !== 'private' && loginUrl) {
      return {
        inline_keyboard: [
          [
            {
              text: buttonText,
              login_url: {
                url: loginUrl,
                request_write_access: true
              }
            }
          ]
        ]
      };
    }

    return undefined;
  }

  buildMiniAppButton(chatType = 'private', chatId = '', buttonText = '⚽', options = {}) {
    return this.buildMiniAppKeyboard(chatType, chatId, buttonText, options)?.inline_keyboard?.[0]?.[0] ?? null;
  }

  getMiniAppFallbackUrl(chatId = '', chatType = 'private', options = {}) {
    const publicUrl = this.buildMiniAppUrl(chatId, options);

    if (chatType === 'private') {
      return publicUrl || this.buildMainMiniAppLink(chatId, options) || '';
    }

    return this.buildMainMiniAppLink(chatId, options) || publicUrl || '';
  }

  buildFallbackUrlKeyboard(chatId = '', chatType = 'private', buttonText = '⚽', options = {}) {
    const fallbackUrl = this.getMiniAppFallbackUrl(chatId, chatType, options);

    if (!fallbackUrl) {
      return undefined;
    }

    return {
      inline_keyboard: [
        [
          {
            text: buttonText,
            url: fallbackUrl
          }
        ]
      ]
    };
  }

  async sendMiniAppEntry(chatId, chatType, targetChatId, options = {}) {
    const primaryText = options.primaryText ?? BUTTON_ONLY_TEXT;
    const buttonText = options.buttonText ?? '⚽';
    const linkOptions = {
      initialView: options.initialView || '',
      gameId: options.gameId || ''
    };
    const replyMarkup = this.buildMiniAppKeyboard(chatType, targetChatId, buttonText, linkOptions);
    const fallbackUrl = this.getMiniAppFallbackUrl(targetChatId, chatType, linkOptions);
    const fallbackReplyMarkup = this.buildFallbackUrlKeyboard(targetChatId, chatType, buttonText, linkOptions);
    const buttonOnly = options.buttonOnly ?? false;
    const parseMode = options.parseMode;
    const fallbackUrlText = parseMode === 'HTML' ? escapeTelegramHtml(fallbackUrl) : fallbackUrl;
    const fallbackText = buttonOnly ? fallbackUrlText : `${primaryText}\n\n${fallbackUrlText}`;

    if (!replyMarkup) {
      if (!fallbackUrl) {
        await this.sendText(chatId, 'Сначала укажите PUBLIC_BASE_URL, чтобы ⚽ можно было открыть из Telegram.');
        return;
      }

      if (fallbackReplyMarkup) {
        return await this.sendText(chatId, primaryText, {
          parseMode,
          replyMarkup: fallbackReplyMarkup
        });
      }

      await this.sendText(chatId, fallbackText, { parseMode });
      return;
    }

    try {
      return await this.sendText(chatId, primaryText, {
        parseMode,
        replyMarkup
      });
    } catch (error) {
      if (!fallbackUrl) {
        throw error;
      }

      if (fallbackReplyMarkup) {
        try {
          return await this.sendText(chatId, primaryText, {
            parseMode,
            replyMarkup: fallbackReplyMarkup
          });
        } catch {
          return await this.sendText(chatId, fallbackText, { parseMode });
        }
      }

      return await this.sendText(chatId, fallbackText, { parseMode });
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
      parse_mode: options.parseMode,
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

  async prepareShareMessage(userId, result) {
    if (!this.enabled || !userId || !result) {
      return null;
    }

    return this.callApi('savePreparedInlineMessage', {
      user_id: userId,
      result,
      allow_user_chats: true,
      allow_bot_chats: false,
      allow_group_chats: true,
      allow_channel_chats: true
    });
  }

  async buildGameLineupImage(chatId, gameId) {
    if (typeof this.store.getSnapshot !== 'function') {
      return null;
    }

    const snapshot = this.store.getSnapshot('global', null, { selectedGameId: gameId }) ?? this.store.getSnapshot(chatId, null);
    const game =
      [snapshot?.currentGame, ...(snapshot?.gameDays ?? [])]
        .find((item) => item?.id === gameId) ?? null;

    if (!game || game.id !== gameId || !game.participants?.length) {
      const storedGame = this.store.getGameById?.(gameId);
      const playersById = new Map((snapshot?.players ?? []).map((player) => [player.id, player]));
      const participants = (storedGame?.playerIds ?? [])
        .map((playerId) => playersById.get(playerId))
        .filter(Boolean);

      if (!storedGame || !participants.length) {
        return null;
      }

      return renderLineupPng({
        id: storedGame.id,
        dateLabel: storedGame.dateLabel,
        location: storedGame.location,
        time: storedGame.time,
        scheduledAt: storedGame.scheduledAt,
        participants
      });
    }

    return renderLineupPng(game);
  }

  async sendGameDetailsEntry(chatId, chatType, targetChatId, game) {
    const replyMarkup = this.buildMiniAppKeyboard(chatType, targetChatId, 'Детали игры', {
      initialView: 'game',
      gameId: game?.id || ''
    });
    const sendDetailsButton = () => this.sendMiniAppEntry(chatId, chatType, targetChatId, {
      primaryText: BUTTON_ONLY_TEXT,
      buttonText: 'Детали игры',
      buttonOnly: true,
      initialView: 'game',
      gameId: game?.id || ''
    });

    if (replyMarkup && game?.id) {
      try {
        const lineupImage = await this.buildGameLineupImage(targetChatId, game.id);

        if (lineupImage) {
          try {
            return await this.sendPhoto(chatId, lineupImage, {
              filename: `lineup-${game.id}.png`,
              replyMarkup
            });
          } catch (error) {
            console.error('Unable to send game lineup image with details button:', error.message);

            try {
              await this.sendPhoto(chatId, lineupImage, {
                filename: `lineup-${game.id}.png`
              });
              return await sendDetailsButton();
            } catch (fallbackError) {
              console.error('Unable to send game lineup image without details button:', fallbackError.message);
            }
          }
        }
      } catch (error) {
        console.error('Unable to render game lineup image:', error.message);
      }
    }

    return sendDetailsButton();
  }

  buildManualInviteKeyboard(chatId, gameId) {
    const miniAppButton = this.buildMiniAppButton('private', chatId, 'К игре', {
      initialView: 'game',
      gameId
    });
    const inlineKeyboard = [];

    if (miniAppButton) {
      inlineKeyboard.push([miniAppButton]);
    }

    inlineKeyboard.push([
      {
        text: 'Не смогу',
        callback_data: `decline_game:${gameId}`
      }
    ]);

    return { inline_keyboard: inlineKeyboard };
  }

  formatGameInvite(game) {
    return [
      'Тебя пригласили на игру',
      '',
      `${game.dateLabel} в ${game.time}`,
      game.location ? `Место: ${game.location}` : '',
      '',
      'Открой ⚽, чтобы посмотреть состав и расстановку.'
    ].filter(Boolean).join('\n');
  }

  getPrivateParticipants(game) {
    const seenChatIds = new Set();
    const participants = [];

    for (const playerId of game?.playerIds ?? []) {
      const player = this.store.getPlayerById?.(playerId);

      if (!player?.privateChatId || seenChatIds.has(String(player.privateChatId))) {
        continue;
      }

      seenChatIds.add(String(player.privateChatId));
      participants.push(player);
    }

    return participants;
  }

  formatCardsText(cards) {
    const parts = [];

    if (cards?.yellow > 0) {
      parts.push(`желтых — ${cards.yellow}`);
    }

    if (cards?.red > 0) {
      parts.push(`красных — ${cards.red}`);
    }

    return parts.join(', ');
  }

  getGameSummaryView(gameId) {
    const snapshot = this.store.getSnapshot?.('global', null, { selectedGameId: gameId });
    return snapshot?.games?.find((game) => game.id === gameId) ?? null;
  }

  formatGameLevel(averageOverall) {
    const rating = Number(averageOverall);

    if (!Number.isFinite(rating)) {
      return '';
    }

    const label = rating < 55 ? 'Низкий' : rating < 70 ? 'Средний' : 'Высокий';
    return `${label} (${Math.round(rating)})`;
  }

  formatMvpSummaryLabel(mvp) {
    if (!mvp) {
      return '';
    }

    const achievementTitles = Array.isArray(mvp.achievements)
      ? mvp.achievements
          .map((achievement) => achievement?.title)
          .filter(Boolean)
      : [];
    const suffix = achievementTitles.length ? achievementTitles.join(', ') : '';

    return `${mvp.displayName}${suffix ? ` (${suffix})` : ''}`;
  }

  formatGameSummary(game) {
    const summary = this.getGameSummaryView(game.id);
    const mvpLabel = this.formatMvpSummaryLabel(summary?.mvp);
    const levelLabel = this.formatGameLevel(summary?.averageOverall);
    const cardsText = this.formatCardsText(summary?.cards);

    return [
      '<b>Итоги игры</b>',
      '',
      `${escapeTelegramHtml(summary?.dateLabel || game.dateLabel)} в ${escapeTelegramHtml(summary?.time || game.time)}`,
      summary?.location || game.location ? `Место: ${escapeTelegramHtml(summary?.location || game.location)}` : '',
      '',
      levelLabel ? `Уровень игры: ${escapeTelegramHtml(levelLabel)}` : '',
      mvpLabel ? `MVP: ${escapeTelegramHtml(mvpLabel)}` : '',
      cardsText ? `Карточки: ${escapeTelegramHtml(cardsText)}` : ''
    ].filter(Boolean).join('\n');
  }

  async notifyPlayersAboutManualGame(gameId) {
    const game = this.store.getGameById?.(gameId);

    if (!game) {
      return;
    }

    const invitePlayerIds = Array.isArray(game.invitedPlayerIds)
      ? game.invitedPlayerIds
      : game.playerIds ?? [];

    for (const playerId of invitePlayerIds) {
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

  formatJoinRequestText(game, player) {
    const username = player?.username ? `@${player.username}` : 'без ника';

    return [
      'Игрок хочет присоединиться к игре',
      '',
      `${player?.displayName || username} (${username})`,
      `${game.dateLabel} в ${game.time}`,
      game.location ? `Место: ${game.location}` : ''
    ].filter(Boolean).join('\n');
  }

  async notifyOrganizerAboutJoinRequest(gameId, playerId) {
    const game = this.store.getGameById?.(gameId);
    const player = this.store.getPlayerById?.(playerId);
    const organizer = game?.organizerPlayerId ? this.store.getPlayerById?.(game.organizerPlayerId) : null;

    if (!game || !player || !organizer?.privateChatId) {
      return;
    }

    try {
      await this.sendMiniAppEntry(organizer.privateChatId, 'private', game.chatId, {
        primaryText: this.formatJoinRequestText(game, player),
        buttonText: 'Подробнее',
        initialView: 'game',
        gameId: game.id
      });
    } catch (error) {
      console.error(`Unable to notify organizer about join request for ${game.id}:`, error.message);
    }
  }

  async notifyPlayerAddedToGame(gameId, playerId) {
    const game = this.store.getGameById?.(gameId);
    const player = this.store.getPlayerById?.(playerId);

    if (!game || !player?.privateChatId) {
      return;
    }

    try {
      await this.sendMiniAppEntry(player.privateChatId, 'private', game.chatId, {
        primaryText: `Тебя добавили в игру ${game.dateLabel} в ${game.time}.`,
        buttonText: 'Детали игры',
        initialView: 'game',
        gameId: game.id
      });
    } catch (error) {
      console.error(`Unable to notify player about join approve for ${game.id}:`, error.message);
    }
  }

  async notifyOrganizerAboutDeclinedGame(gameId, playerId, context = {}) {
    const game = context.game ?? this.store.getGameById?.(gameId);
    const player = context.player ?? this.store.getPlayerById?.(playerId);
    const organizer = context.organizer ?? (game?.organizerPlayerId ? this.store.getPlayerById?.(game.organizerPlayerId) : null);

    if (!game || !player || !organizer?.privateChatId) {
      return;
    }

    try {
      await this.sendText(
        organizer.privateChatId,
        `${player.displayName || `@${player.username}`} не сможет сыграть ${game.dateLabel} в ${game.time}. Нужно искать замену.`
      );
    } catch (error) {
      console.error(`Unable to notify organizer about decline for ${game.id}:`, error.message);
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

  async isUserAdminOfChat(chatId, telegramUserId) {
    if (!this.enabled || !chatId || !telegramUserId) {
      return false;
    }

    try {
      const member = await this.callApi('getChatMember', {
        chat_id: chatId,
        user_id: telegramUserId
      });

      return ['creator', 'administrator'].includes(member?.status);
    } catch (error) {
      console.error('Unable to verify chat admin status:', error.message);
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
    const command = normalizeCommand(getMessageText(message));
    const chatId = message.chat.id;
    const targetChatId =
      message.chat.type === 'private' ? this.config.defaultChatId || chatId : chatId;

    if (command === '/start' || command === '/help') {
      const lines = [
        'Привет👋 Со мной ты можешь создавать и искать игры. Собирать и оценивать игроков. Вести статистику игр и улучшать собственный уровень игры.',
        '',
        'Я создал тебе карточку, можешь найти ее в приложении. Заполни ее на своё усмотрение и получай объективную оценку от тиммейтов после игр. Надеюсь это поможет тебе рости 💪.'
      ];
      await this.sendMiniAppEntry(chatId, message.chat.type, '', {
        primaryText: lines.join('\n'),
        buttonText: 'Открыть приложение'
      });
      return;
    }

    if (command === '/open') {
      await this.sendMiniAppEntry(chatId, message.chat.type, '', {
        primaryText: BUTTON_ONLY_TEXT,
        buttonText: 'Открыть футбольчик',
        buttonOnly: true
      });
      return;
    }

    if (['/game', '/addgame', '/parse'].includes(command)) {
      await this.handleGameParseCommand(message, targetChatId);
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

  getGameParseSource(message) {
    const directPayload = stripCommandPayload(getMessageText(message));

    if (directPayload) {
      return {
        rawText: directPayload,
        sourceMessage: message
      };
    }

    for (const candidate of getReplyTextSourceCandidates(message)) {
      const replyText = getMessageText(candidate);

      if (replyText) {
        return {
          rawText: replyText,
          sourceMessage: candidate
        };
      }
    }

    return null;
  }

  async handleGameParseCommand(message, targetChatId) {
    const source = this.getGameParseSource(message);

    if (!source) {
      if (message.chat.type !== 'private') {
        return;
      }

      await this.sendText(
        message.chat.id,
        'Я вижу команду /game, но Telegram не передал мне текст анонса. Скопируй анонс после /game в одном сообщении или отключи Privacy Mode у бота через BotFather.'
      );
      return;
    }

    const sourceDate = new Date((source.sourceMessage?.date ?? message.date ?? Math.floor(Date.now() / 1000)) * 1000);
    const announcement = parseAnnouncementText(source.rawText, sourceDate, {
      requirePaymentBlock: false
    });

    if (!announcement) {
      await this.sendText(
        message.chat.id,
        'Не смог распознать игру. Проверь, что в анонсе есть дата, время, место и список игроков.'
      );
      return;
    }

    const targetChatType = message.chat.type === 'private' ? 'supergroup' : message.chat.type;
    const targetChatTitle = message.chat.type === 'private' ? '' : message.chat.title ?? '';
    const organizerPlayer = message.from?.id
      ? this.store.getPlayerByTelegramUserId?.(message.from.id)
      : null;
    const result = await this.store.recordGameFromAnnouncement({
      chatId: targetChatId,
      chatTitle: targetChatTitle,
      chatType: targetChatType,
      messageId: source.sourceMessage?.message_id ?? message.message_id,
      rawText: source.rawText,
      announcement,
      organizerPlayerId: organizerPlayer?.id ?? null,
      source: 'telegram-command',
      sourceDate
    });

    if (result?.game) {
      this.schedulePromptForGame(result.game);
    }

    if (result?.game) {
      await this.sendGameDetailsEntry(message.chat.id, message.chat.type, targetChatId, result.game);
      return;
    }

    await this.sendText(message.chat.id, 'Такая игра уже есть или её уже нельзя обновить после старта.');
  }

  async handleAnnouncement(message, options = {}) {
    const rawText = getMessageText(message);

    if (!rawText || message.chat.type === 'private') {
      return;
    }

    const messageTimestamp = options.isEdited
      ? (message.edit_date ?? message.date ?? Math.floor(Date.now() / 1000))
      : (message.date ?? Math.floor(Date.now() / 1000));
    const sourceDate = new Date(messageTimestamp * 1000);
    const existingEditedGame = options.isEdited
      ? this.store.findGameByMessage?.(message.chat.id, message.message_id)
      : null;
    const announcement = parseAnnouncementText(rawText, sourceDate, {
      requirePaymentBlock: false
    });

    if (!announcement) {
      if (rawText.includes('89295991499')) {
        console.warn('Telegram announcement-like message was not parsed', {
          chatId: message.chat.id,
          messageId: message.message_id,
          preview: rawText.slice(0, 160)
        });
      }
      return;
    }

    console.info('Telegram game announcement parsed', {
      chatId: message.chat.id,
      messageId: message.message_id,
      date: announcement.date,
      time: announcement.time,
      players: announcement.playerUsernames.length
    });

    const organizerPlayer = options.authorPlayerId
      ? { id: options.authorPlayerId }
      : message.from?.id
        ? this.store.getPlayerByTelegramUserId?.(message.from.id)
        : null;
    const result = await this.store.recordGameFromAnnouncement({
      chatId: message.chat.id,
      chatTitle: message.chat.title ?? '',
      chatType: message.chat.type,
      messageId: message.message_id,
      rawText,
      announcement,
      organizerPlayerId: organizerPlayer?.id ?? null,
      source: 'telegram-message',
      sourceDate
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

    let authorPlayer = null;

    if (message.from) {
      authorPlayer = await this.store.rememberTelegramUser(message.chat.id, message.from, {
        chatTitle: message.chat.title ?? '',
        chatType: message.chat.type
      });
      await this.maybeRefreshPlayerPhoto(message.chat.id, authorPlayer);
    }

    if (getMessageText(message).trim().startsWith('/')) {
      await this.handleCommand(message);
      return;
    }

    await this.handleAnnouncement(message, {
      ...options,
      authorPlayerId: authorPlayer?.id ?? options.authorPlayerId
    });
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

      if (result.removed) {
        await this.notifyOrganizerAboutDeclinedGame(result.game.id, result.player.id, result);
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
    await this.processPendingGameSummaries();

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
    if (!this.enabled || typeof this.store.listGamesRequiringPrompt !== 'function') {
      return;
    }

    const games = this.store.listGamesRequiringPrompt(new Date());
    const promptText = 'Не забудьте оценить игру тиммейтов';
    const privatePromptText = 'Оценка стартовала. Ты участвуешь в этой игре — не забудь оценить тиммейтов.';

    for (const game of games) {
      try {
        const chat = this.store.state?.chats?.[String(game.chatId)];
        let promptMessageId = null;

        if (chat?.type !== 'global') {
          const message = await this.sendMiniAppEntry(game.chatId, chat?.type || 'supergroup', game.chatId, {
            primaryText: promptText,
            buttonText: 'Оценить',
            initialView: 'game',
            gameId: game.id
          });
          promptMessageId = message?.message_id ?? null;
        }

        await this.store.markRatingsPromptSent(game.id, promptMessageId);
        this.clearPromptTimer(game.id);

        for (const player of this.getPrivateParticipants(game)) {
          try {
            await this.sendMiniAppEntry(player.privateChatId, 'private', game.chatId, {
              primaryText: privatePromptText,
              buttonText: 'Оценить',
              initialView: 'game',
              gameId: game.id
            });
          } catch (error) {
            console.error(`Unable to send private rating prompt to ${player.id}:`, error.message);
          }
        }
      } catch (error) {
        console.error(`Unable to send rating prompt for ${game.id}:`, error.message);
      }
    }
  }

  async processPendingGameSummaries() {
    if (!this.enabled || typeof this.store.listGamesRequiringSummary !== 'function') {
      return;
    }

    const games = this.store.listGamesRequiringSummary(new Date());

    for (const game of games) {
      const summaryText = this.formatGameSummary(game);
      const chat = this.store.state?.chats?.[String(game.chatId)];
      let chatMessageId = null;
      const privatePlayerIds = [];
      let sentAnything = false;

      if (chat && chat.type !== 'private' && chat.type !== 'global') {
        try {
          const message = await this.sendMiniAppEntry(game.chatId, chat.type || 'supergroup', game.chatId, {
            primaryText: summaryText,
            buttonText: 'Детали игры',
            initialView: 'game',
            gameId: game.id,
            parseMode: 'HTML'
          });
          chatMessageId = message?.message_id ?? null;
          sentAnything = true;
        } catch (error) {
          console.error(`Unable to send game summary to chat for ${game.id}:`, error.message);
        }
      }

      for (const player of this.getPrivateParticipants(game)) {
        try {
          await this.sendMiniAppEntry(player.privateChatId, 'private', game.chatId, {
            primaryText: summaryText,
            buttonText: 'Детали игры',
            initialView: 'game',
            gameId: game.id,
            parseMode: 'HTML'
          });
          privatePlayerIds.push(player.id);
          sentAnything = true;
        } catch (error) {
          console.error(`Unable to send private game summary to ${player.id}:`, error.message);
        }
      }

      if (sentAnything) {
        await this.store.markRatingSummarySent(game.id, {
          chatMessageId,
          privatePlayerIds
        });
      }
    }
  }
}
