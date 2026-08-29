import { parseAnnouncementText } from '../lib/parser.js';
import { renderLineupPng } from '../lib/lineup-image.js';
import { LOCALE_LABELS, SUPPORTED_LOCALES, createTranslator, normalizeLocale } from '../../packages/i18n/index.js';

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

function isScheduledInPast(scheduledAt, now = new Date()) {
  const scheduledMs = new Date(scheduledAt).getTime();
  const currentMinuteMs = Math.floor(now.getTime() / 60_000) * 60_000;
  return Number.isFinite(scheduledMs) && scheduledMs < currentMinuteMs;
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
    this.botUsername = String(this.config.telegramBotUsername || '').replace(/^@/, '');
    this.promptTimers = new Map();
  }

  get enabled() {
    return Boolean(this.config.telegramBotToken);
  }

  getMessageLocale(message) {
    if (message?.chat?.type === 'private') {
      const player = message?.from?.id
        ? this.store.getPlayerByTelegramUserId?.(message.from.id)
        : null;
      return normalizeLocale(player?.locale || message?.from?.language_code);
    }

    return this.store.getChatLocale?.(message?.chat?.id) || 'ru';
  }

  getPlayerLocale(player) {
    return normalizeLocale(player?.locale || 'ru');
  }

  getGameLocale(game) {
    return this.store.getChatLocale?.(game?.chatId) || 'ru';
  }

  t(locale, key, params = {}) {
    return createTranslator(locale)(key, params);
  }

  buildLanguageKeyboard(scope = 'user') {
    return {
      inline_keyboard: [
        SUPPORTED_LOCALES.map((locale) => ({
          text: LOCALE_LABELS[locale],
          callback_data: `set_locale:${scope}:${locale}`
        }))
      ]
    };
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

  buildAboutUrl() {
    const baseUrl = normalizeHttpUrl(this.config.publicBaseUrl);
    return baseUrl ? new URL('/about', baseUrl).toString() : '';
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

    // Always enter through Telegram's Main Mini App. Opening the deployment
    // directly loses initData in previews and creates a different session.
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
    const directMiniAppLink = this.buildMainMiniAppLink(chatId, options);
    const loginUrl = this.buildTelegramLoginUrl(chatId, options);
    return directMiniAppLink || (chatType === 'private'
      ? publicUrl || ''
      : loginUrl || publicUrl || '');
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
    const locale = options.locale || 'ru';
    const primaryText = options.primaryText ?? BUTTON_ONLY_TEXT;
    const buttonText = options.buttonText ?? '⚽';
    const additionalKeyboardRows = options.additionalKeyboardRows || [];
    const linkOptions = {
      initialView: options.initialView || '',
      gameId: options.gameId || ''
    };
    const appendKeyboardRows = (keyboard) => {
      if (!keyboard || additionalKeyboardRows.length === 0) {
        return keyboard;
      }

      return {
        ...keyboard,
        inline_keyboard: [
          ...keyboard.inline_keyboard,
          ...additionalKeyboardRows
        ]
      };
    };
    const replyMarkup = appendKeyboardRows(
      this.buildMiniAppKeyboard(chatType, targetChatId, buttonText, linkOptions)
    );
    const fallbackUrl = this.getMiniAppFallbackUrl(targetChatId, chatType, linkOptions);
    const fallbackReplyMarkup = appendKeyboardRows(
      this.buildFallbackUrlKeyboard(targetChatId, chatType, buttonText, linkOptions)
    );
    const buttonOnly = options.buttonOnly ?? false;
    const parseMode = options.parseMode;
    const fallbackUrlText = parseMode === 'HTML' ? escapeTelegramHtml(fallbackUrl) : fallbackUrl;
    const fallbackText = buttonOnly ? fallbackUrlText : `${primaryText}\n\n${fallbackUrlText}`;

    if (!replyMarkup) {
      if (!fallbackUrl) {
        await this.sendText(chatId, this.t(locale, 'bot.config_missing'));
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

  async syncDefaultMenuButton() {
    const url = this.buildMiniAppUrl();

    if (!url) {
      return;
    }

    await this.callApi('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: 'Open',
        web_app: { url }
      }
    });
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

  async deleteMessage(chatId, messageId) {
    return this.callApi('deleteMessage', {
      chat_id: chatId,
      message_id: messageId
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

    if (options.parseMode) {
      formData.set('parse_mode', options.parseMode);
    }

    if (options.replyMarkup) {
      formData.set('reply_markup', JSON.stringify(options.replyMarkup));
    }

    return this.callApiMultipart('sendPhoto', formData);
  }

  async editPhotoMessage(chatId, messageId, photo, options = {}) {
    const formData = new FormData();
    formData.set('chat_id', String(chatId));
    formData.set('message_id', String(messageId));
    formData.set('photo', new Blob([photo], { type: 'image/png' }), options.filename || 'lineup.png');
    formData.set('media', JSON.stringify({
      type: 'photo',
      media: 'attach://photo',
      caption: options.caption || '',
      parse_mode: options.parseMode
    }));

    if (options.replyMarkup) {
      formData.set('reply_markup', JSON.stringify(options.replyMarkup));
    }

    return this.callApiMultipart('editMessageMedia', formData);
  }

  async editTextMessage(chatId, messageId, text, options = {}) {
    return this.callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: options.parseMode,
      reply_markup: options.replyMarkup
    });
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

  getGameAnnouncementView(game) {
    const snapshot = this.store.getSnapshot?.('global', null, { selectedGameId: game.id });
    const gameView = [snapshot?.currentGame, ...(snapshot?.gameDays ?? [])]
      .find((item) => item?.id === game.id);
    const playersById = new Map((snapshot?.players ?? []).map((player) => [player.id, player]));
    const participants = gameView?.participants?.length
      ? gameView.participants
      : (game.playerIds ?? []).map((playerId) => playersById.get(playerId)).filter(Boolean);
    const ratedPlayers = participants.filter(
      (player) => Number(player?.ratedGames) > 0 && Number(player?.overall) > 0
    );
    const lineupReadyPlayers = participants.filter((player) => {
      const position = player?.currentGameStats?.position || player?.position;
      return (
        Number(player?.ratedGames) > 0
        && Number(player?.overall) > 0
        && Boolean(position)
        && position !== 'N/A'
      );
    });
    const averageRating = ratedPlayers.length
      ? Math.round(ratedPlayers.reduce((sum, player) => sum + Number(player.overall), 0) / ratedPlayers.length)
      : null;

    return {
      participants,
      playerCount: participants.length || game.playerIds?.length || 0,
      averageRating,
      hasLineupMajority: participants.length > 0 && lineupReadyPlayers.length > participants.length / 2
    };
  }

  shouldShowGameLineup(game) {
    return this.getGameAnnouncementView(game).hasLineupMajority;
  }

  formatGameAnnouncementCaption(game) {
    const { playerCount, averageRating } = this.getGameAnnouncementView(game);
    const lines = [
      '⚽ <b>Игра</b>',
      `${escapeTelegramHtml(game.dateLabel || game.date || '')} · ${escapeTelegramHtml(game.time || '')}`,
      escapeTelegramHtml(game.location || ''),
      '',
      `Игроков: <b>${playerCount}</b>`
    ];

    if (averageRating !== null) {
      lines.push(`Уровень игры: <b>${averageRating}</b>`);
    }

    return lines.filter((line, index) => line || index === 3).join('\n').trim();
  }

  formatRatingStartedCaption(game) {
    const { playerCount, averageRating } = this.getGameAnnouncementView(game);
    const lines = [
      '⚽ <b>Игра стартовала</b>',
      `${escapeTelegramHtml(game.dateLabel || game.date || '')} · ${escapeTelegramHtml(game.time || '')}`,
      escapeTelegramHtml(game.location || ''),
      '',
      `Игроков: <b>${playerCount}</b>`
    ];

    if (averageRating !== null) {
      lines.push(`Уровень игры: <b>${averageRating}</b>`);
    }

    lines.push(
      '',
      'Не забудьте раздать баллы самым заметным игрокам и выбрать MVP'
    );

    return lines.join('\n').trim();
  }

  buildRatingStartedKeyboard(game) {
    const chat = this.store.state?.chats?.[String(game.chatId)];
    const rateButton = this.buildMiniAppButton(
      chat?.type || 'supergroup',
      game.chatId,
      'Оценить игроков',
      { initialView: 'game', gameId: game.id }
    );

    return {
      inline_keyboard: rateButton ? [[rateButton]] : []
    };
  }

  async sendRatingStartedChatPrompt(game) {
    const chat = this.store.state?.chats?.[String(game.chatId)];
    const caption = this.formatRatingStartedCaption(game);
    const replyMarkup = this.buildRatingStartedKeyboard(game);

    if (this.shouldShowGameLineup(game)) {
      try {
        const lineupImage = await this.buildGameLineupImage(game.chatId, game.id);

        if (lineupImage) {
          return await this.sendPhoto(game.chatId, lineupImage, {
            filename: `lineup-${game.id}.png`,
            caption,
            parseMode: 'HTML',
            replyMarkup
          });
        }
      } catch (error) {
        console.error(`Unable to send rating lineup for ${game.id}:`, error.message);
      }
    }

    return this.sendMiniAppEntry(game.chatId, chat?.type || 'supergroup', game.chatId, {
      primaryText: caption,
      buttonText: 'Оценить игроков',
      parseMode: 'HTML',
      locale: this.getGameLocale(game),
      initialView: 'game',
      gameId: game.id
    });
  }

  buildGameAnnouncementKeyboard(game) {
    const chat = this.store.state?.chats?.[String(game.chatId)];
    const detailsButton = this.buildMiniAppButton(
      chat?.type || 'supergroup',
      game.chatId,
      'Детали игры',
      { initialView: 'game', gameId: game.id }
    );
    const rows = [];

    if (game.ratingsOpenedAt) {
      const rateButton = this.buildMiniAppButton(
        chat?.type || 'supergroup',
        game.chatId,
        'Оценить',
        { initialView: 'game', gameId: game.id }
      );
      const actionRow = [rateButton, detailsButton].filter(Boolean);

      if (actionRow.length) {
        rows.push(actionRow);
      }
    } else {
      rows.push([
        { text: 'Участвую', callback_data: `game_join:${game.id}` },
        { text: 'Не смогу', callback_data: `decline_game:${game.id}` }
      ]);

      if (detailsButton) {
        rows.push([detailsButton]);
      }
    }

    return { inline_keyboard: rows };
  }

  async publishOrSyncGameAnnouncement(gameId, options = {}) {
    const game = this.store.getGameById?.(gameId);

    if (!this.enabled || !game) {
      return null;
    }

    const chatId = String(game.botAnnouncementChatId || options.chatId || game.chatId || '');
    const chat = this.store.state?.chats?.[chatId];

    if (!chatId || chat?.type === 'private' || chat?.type === 'global') {
      return null;
    }

    const caption = this.formatGameAnnouncementCaption(game);
    const replyMarkup = this.buildGameAnnouncementKeyboard(game);
    const lineupImage = this.shouldShowGameLineup(game)
      ? await this.buildGameLineupImage(chatId, game.id)
      : null;
    const previousMessageId = game.botAnnouncementMessageId;

    if (previousMessageId && lineupImage) {
      try {
        return await this.editPhotoMessage(
          chatId,
          previousMessageId,
          lineupImage,
          {
            filename: `lineup-${game.id}.png`,
            caption,
            parseMode: 'HTML',
            replyMarkup
          }
        );
      } catch (error) {
        if (/message is not modified/i.test(error.message || '')) {
          return null;
        }
        console.error(`Unable to update game announcement ${game.id}:`, error.message);
      }
    }

    if (previousMessageId && !lineupImage) {
      try {
        return await this.editTextMessage(
          chatId,
          previousMessageId,
          caption,
          { parseMode: 'HTML', replyMarkup }
        );
      } catch (error) {
        if (/message is not modified/i.test(error.message || '')) {
          return null;
        }
        console.error(`Unable to update game announcement ${game.id}:`, error.message);
      }
    }

    const message = lineupImage
      ? await this.sendPhoto(chatId, lineupImage, {
        filename: `lineup-${game.id}.png`,
        caption,
        parseMode: 'HTML',
        replyMarkup
      })
      : await this.sendText(chatId, caption, { parseMode: 'HTML', replyMarkup });

    await this.store.setGameBotAnnouncement?.(game.id, {
      chatId,
      messageId: message.message_id
    });

    if (previousMessageId && String(previousMessageId) !== String(message.message_id)) {
      try {
        await this.deleteMessage(chatId, previousMessageId);
      } catch (error) {
        console.error(`Unable to remove replaced game announcement ${game.id}:`, error.message);
      }
    }

    return message;
  }

  formatAnnouncementDraft(draft) {
    const announcement = draft.announcement;
    const playerCount = announcement.playerRefs?.length || announcement.playerUsernames?.length || 0;

    return [
      '⚽ <b>Анонс игры</b>',
      `${escapeTelegramHtml(announcement.dateLabel || announcement.date || '')} · ${escapeTelegramHtml(announcement.time || '')}`,
      escapeTelegramHtml(announcement.location || ''),
      `Игроков: <b>${playerCount}</b>`,
      '',
      'Создать и опубликовать игру?'
    ].join('\n');
  }

  buildAnnouncementDraftKeyboard(draftId) {
    return {
      inline_keyboard: [[
        { text: 'Создать игру', callback_data: `confirm_announcement:${draftId}` },
        { text: 'Отмена', callback_data: `cancel_announcement:${draftId}` }
      ]]
    };
  }

  async publishOrSyncAnnouncementDraft(draft) {
    const text = this.formatAnnouncementDraft(draft);
    const replyMarkup = this.buildAnnouncementDraftKeyboard(draft.id);

    if (draft.confirmationMessageId) {
      try {
        return await this.editTextMessage(
          draft.confirmationChatId || draft.chatId,
          draft.confirmationMessageId,
          text,
          { parseMode: 'HTML', replyMarkup }
        );
      } catch (error) {
        if (/message is not modified/i.test(error.message || '')) {
          return null;
        }
        console.error(`Unable to update announcement draft ${draft.id}:`, error.message);
      }
    }

    const message = await this.sendText(draft.chatId, text, {
      parseMode: 'HTML',
      replyMarkup
    });
    await this.store.setAnnouncementDraftConfirmation?.(draft.id, {
      chatId: draft.chatId,
      messageId: message.message_id
    });
    return message;
  }

  async sendGameDetailsEntry(chatId, chatType, targetChatId, game) {
    const locale = this.getGameLocale(game);
    const detailsLabel = this.t(locale, 'common.buttons.details');
    const replyMarkup = this.buildMiniAppKeyboard(chatType, targetChatId, detailsLabel, {
      initialView: 'game',
      gameId: game?.id || ''
    });
    const sendDetailsButton = () => this.sendMiniAppEntry(chatId, chatType, targetChatId, {
      primaryText: BUTTON_ONLY_TEXT,
      buttonText: detailsLabel,
      buttonOnly: true,
      locale,
      initialView: 'game',
      gameId: game?.id || ''
    });

    const storedGame = game?.id ? this.store.getGameById?.(game.id) ?? game : game;

    if (replyMarkup && game?.id && this.shouldShowGameLineup(storedGame)) {
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

  buildManualInviteKeyboard(chatId, gameId, locale = '') {
    const game = this.store.getGameById?.(gameId);
    const effectiveLocale = locale || this.getGameLocale(game);
    const miniAppButton = this.buildMiniAppButton('private', chatId, this.t(effectiveLocale, 'common.buttons.open_game'), {
      initialView: 'game',
      gameId
    });
    const inlineKeyboard = [];

    if (miniAppButton) {
      inlineKeyboard.push([miniAppButton]);
    }

    inlineKeyboard.push([
      {
        text: this.t(effectiveLocale, 'bot.invite_decline'),
        callback_data: `decline_game:${gameId}`
      }
    ]);

    return { inline_keyboard: inlineKeyboard };
  }

  formatGameInvite(game, locale = this.getGameLocale(game)) {
    const locationLine = game.location ? `${this.t(locale, 'common.labels.location')}: ${game.location}` : '';

    return this.t(locale, 'bot.invite_text', {
      date: game.dateLabel,
      time: game.time,
      locationLine
    });
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

  formatCardsText(cards, locale = 'ru') {
    const parts = [];

    if (cards?.yellow > 0) {
      parts.push(`${this.t(locale, 'common.labels.yellow_cards')} — ${cards.yellow}`);
    }

    if (cards?.red > 0) {
      parts.push(`${this.t(locale, 'common.labels.red_card')} — ${cards.red}`);
    }

    return parts.join(', ');
  }

  getGameSummaryView(gameId) {
    const snapshot = this.store.getSnapshot?.('global', null, { selectedGameId: gameId });
    return snapshot?.games?.find((game) => game.id === gameId) ?? null;
  }

  formatGameLevel(averageOverall, locale = 'ru') {
    const rating = Number(averageOverall);

    if (!Number.isFinite(rating)) {
      return '';
    }

    const label = rating < 55
      ? this.t(locale, 'match.level_low')
      : rating < 70
        ? this.t(locale, 'match.level_mid')
        : this.t(locale, 'match.level_high');
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

  formatGameSummary(game, locale = this.getGameLocale(game)) {
    const summary = this.getGameSummaryView(game.id);
    const mvpLabel = this.formatMvpSummaryLabel(summary?.mvp);
    const levelLabel = this.formatGameLevel(summary?.averageOverall, locale);
    const cardsText = this.formatCardsText(summary?.cards, locale);

    return [
      `<b>${escapeTelegramHtml(this.t(locale, 'match.summary_title'))}</b>`,
      '',
      escapeTelegramHtml(this.t(locale, 'bot.summary_datetime', {
        date: summary?.dateLabel || game.dateLabel,
        time: summary?.time || game.time
      })),
      summary?.location || game.location ? `${escapeTelegramHtml(this.t(locale, 'common.labels.location'))}: ${escapeTelegramHtml(summary?.location || game.location)}` : '',
      '',
      levelLabel ? `${escapeTelegramHtml(this.t(locale, 'common.labels.rating'))}: ${escapeTelegramHtml(levelLabel)}` : '',
      mvpLabel ? `${escapeTelegramHtml(this.t(locale, 'mvp.label'))}: ${escapeTelegramHtml(mvpLabel)}` : '',
      cardsText ? `${escapeTelegramHtml(this.t(locale, 'common.labels.cards'))}: ${escapeTelegramHtml(cardsText)}` : ''
    ].filter(Boolean).join('\n');
  }

  formatQuickRatingProgress(game, progress, locale = this.getGameLocale(game)) {
    const summary = this.getGameSummaryView(game.id);
    const levelLabel = this.formatGameLevel(summary?.averageOverall, locale);
    const leaderText = progress.stage === 'majority'
      ? this.t(locale, 'bot.mvp_progress_majority', { name: progress.playerName })
      : this.t(locale, 'bot.mvp_progress_leader', {
          votes: progress.votes,
          total: progress.total,
          name: progress.playerName
        });

    return [
      escapeTelegramHtml(leaderText),
      levelLabel ? `${escapeTelegramHtml(this.t(locale, 'common.labels.rating'))}: ${escapeTelegramHtml(levelLabel)}` : '',
      escapeTelegramHtml(this.t(locale, 'bot.mvp_progress_achievements', { count: progress.achievementCount ?? 0 }))
    ].filter(Boolean).join('\n');
  }

  async processQuickRatingProgressForGame(gameId) {
    if (!this.enabled || typeof this.store.getQuickRatingMvpProgress !== 'function') {
      return;
    }

    for (let attempts = 0; attempts < 2; attempts += 1) {
      const progress = this.store.getQuickRatingMvpProgress(gameId);

      if (!progress?.game) {
        return;
      }

      const game = progress.game;
      const chat = this.store.state?.chats?.[String(game.chatId)];
      const chatLocale = this.getGameLocale(game);
      let chatMessageId = null;
      let sentAnything = false;

      if (chat && chat.type !== 'private' && chat.type !== 'global') {
        try {
          const message = await this.sendMiniAppEntry(game.chatId, chat.type || 'supergroup', game.chatId, {
            primaryText: this.formatQuickRatingProgress(game, progress, chatLocale),
            buttonText: this.t(chatLocale, 'common.buttons.details'),
            locale: chatLocale,
            initialView: 'game',
            gameId: game.id,
            parseMode: 'HTML'
          });
          chatMessageId = message?.message_id ?? null;
          sentAnything = true;
        } catch (error) {
          console.error(`Unable to send quick rating progress to chat for ${game.id}:`, error.message);
        }
      }

      for (const player of this.getPrivateParticipants(game)) {
        try {
          const playerLocale = this.getPlayerLocale(player);
          await this.sendMiniAppEntry(player.privateChatId, 'private', game.chatId, {
            primaryText: this.formatQuickRatingProgress(game, progress, playerLocale),
            buttonText: this.t(playerLocale, 'common.buttons.details'),
            locale: playerLocale,
            initialView: 'game',
            gameId: game.id,
            parseMode: 'HTML'
          });
          sentAnything = true;
        } catch (error) {
          console.error(`Unable to send quick rating progress to ${player.id}:`, error.message);
        }
      }

      if (!sentAnything || typeof this.store.markQuickRatingMvpProgressSent !== 'function') {
        return;
      }

      await this.store.markQuickRatingMvpProgressSent(game.id, progress.stage, chatMessageId);
    }
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
        await this.sendText(player.privateChatId, this.formatGameInvite(game, this.getPlayerLocale(player)), {
          replyMarkup: this.buildManualInviteKeyboard(game.chatId, game.id, this.getPlayerLocale(player))
        });
      } catch (error) {
        console.error(`Unable to send manual game invite to ${player.id}:`, error.message);
      }
    }
  }

  async notifyTeamChallenge(challengeId) {
    const challenge = this.store.getTeamChallengeById?.(challengeId);

    if (!challenge?.awaitingTeamId) {
      return;
    }

    const challenger = this.store.getTeamById?.(challenge.challengerTeamId);
    const opponent = this.store.getTeamById?.(challenge.opponentTeamId);
    const recipientTeam = this.store.getTeamById?.(challenge.awaitingTeamId);
    const senderTeam = recipientTeam?.id === challenger?.id ? opponent : challenger;
    const captain = recipientTeam?.captainPlayerId
      ? this.store.getPlayerById?.(recipientTeam.captainPlayerId)
      : null;

    if (!captain?.privateChatId || !senderTeam) {
      return;
    }

    const locale = this.getPlayerLocale(captain);
    const mode = challenge.mode === 'ranked'
      ? (locale === 'en' ? 'Ranked' : 'Рейтинговый')
      : (locale === 'en' ? 'Friendly' : 'Товарищеский');
    const isCounter = challenge.status === 'counter';
    const text = locale === 'en'
      ? `<b>${senderTeam.name} ${isCounter ? 'suggests new terms' : 'challenges your team'}</b>\n${challenge.format}, ${challenge.date} ${challenge.time}\n${challenge.location}\n${mode}`
      : `<b>${senderTeam.name} ${isCounter ? 'предлагает новые условия' : 'бросает вам вызов'}</b>\n${challenge.format}, ${challenge.date} ${challenge.time}\n${challenge.location}\n${mode}`;
    const appLink = this.buildMainMiniAppLink('', { initialView: 'teams' });

    try {
      await this.sendText(captain.privateChatId, text, {
        parseMode: 'HTML',
        replyMarkup: {
          inline_keyboard: [
            [
              {
                text: locale === 'en' ? 'Accept' : 'Принять',
                callback_data: `team_challenge_accept:${challenge.id}`
              },
              {
                text: locale === 'en' ? 'Decline' : 'Отклонить',
                callback_data: `team_challenge_decline:${challenge.id}`
              }
            ],
            ...(appLink ? [[{
              text: locale === 'en' ? 'Suggest another time' : 'Предложить другое время',
              url: appLink
            }]] : [])
          ]
        }
      });
    } catch (error) {
      console.error(`Unable to send team challenge ${challenge.id}:`, error.message);
    }
  }

  formatJoinRequestText(game, player) {
    const locale = this.getGameLocale(game);
    const username = player?.username ? `@${player.username}` : this.t(locale, 'bot.no_username');
    const locationLine = game.location ? `${this.t(locale, 'common.labels.location')}: ${game.location}` : '';

    return this.t(locale, 'bot.join_request', {
      name: player?.displayName || username,
      username,
      date: game.dateLabel,
      time: game.time,
      locationLine
    });
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
        buttonText: this.t(this.getPlayerLocale(organizer), 'common.buttons.details'),
        locale: this.getPlayerLocale(organizer),
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
        primaryText: this.t(this.getPlayerLocale(player), 'bot.invite_added', {
          date: game.dateLabel,
          time: game.time
        }),
        buttonText: this.t(this.getPlayerLocale(player), 'common.buttons.details'),
        locale: this.getPlayerLocale(player),
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
        this.t(this.getPlayerLocale(organizer), 'bot.declined_notify', {
          name: player.displayName || `@${player.username}`,
          date: game.dateLabel,
          time: game.time
        })
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
    const locale = this.getMessageLocale(message);

    if (command === '/start' || command === '/help') {
      const lines = [
        this.t(locale, 'onboarding.message_1'),
        this.t(locale, 'onboarding.message_2'),
        this.t(locale, 'onboarding.message_3')
      ];

      for (const line of lines.slice(0, -1)) {
        await this.sendText(chatId, line);
      }

      await this.sendMiniAppEntry(chatId, message.chat.type, '', {
        primaryText: lines.at(-1),
        buttonText: this.t(locale, 'common.buttons.open_app'),
        locale,
        additionalKeyboardRows: [
          ...(this.buildAboutUrl() ? [[
            {
              text: this.t(locale, 'onboarding.about_button'),
              url: this.buildAboutUrl()
            }
          ]] : []),
          [
            {
              text: this.t(locale, 'onboarding.commands_button'),
              callback_data: 'show_commands'
            }
          ]
        ]
      });
      return;
    }

    if (command === '/open') {
      await this.sendMiniAppEntry(chatId, message.chat.type, '', {
        primaryText: BUTTON_ONLY_TEXT,
        buttonText: this.t(locale, 'common.buttons.open_football'),
        locale,
        buttonOnly: true
      });
      return;
    }

    if (command === '/language') {
      if (message.chat.type !== 'private') {
        const isAdmin = await this.isUserAdminOfChat(message.chat.id, message.from?.id);

        if (!isAdmin) {
          await this.sendText(chatId, this.t(locale, 'settings.language.only_admin'));
          return;
        }
      }

      await this.sendText(chatId, this.t(locale, 'settings.language.choose'), {
        replyMarkup: this.buildLanguageKeyboard(message.chat.type === 'private' ? 'user' : 'chat')
      });
      return;
    }

    if (['/game', '/addgame', '/parse', '/editgame', '/updategame'].includes(command)) {
      await this.handleGameParseCommand(message, targetChatId, {
        requireConfirmation: command === '/game' && message.chat.type !== 'private'
      });
      return;
    }

    if (command === '/chatid') {
      await this.sendText(
        chatId,
        this.t(locale, 'bot.chat_id', { chatId }),
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

  async handleGameParseCommand(message, targetChatId, options = {}) {
    const source = this.getGameParseSource(message);
    const locale = this.getMessageLocale(message);

    if (!source) {
      if (message.chat.type !== 'private') {
        await this.sendMiniAppEntry(message.chat.id, message.chat.type, targetChatId, {
          primaryText: this.t(locale, 'match.game_command_help'),
          buttonText: this.t(locale, 'match.create_game'),
          locale,
          initialView: 'create-game'
        });
        return;
      }

      await this.sendText(
        message.chat.id,
        this.t(locale, 'match.parse_missing_text')
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
        this.t(locale, 'match.parse_failed')
      );
      return;
    }

    if (isScheduledInPast(announcement.scheduledAt)) {
      await this.sendText(message.chat.id, this.t(locale, 'match.past_game'));
      return;
    }

    const targetChatType = message.chat.type === 'private' ? 'supergroup' : message.chat.type;
    const targetChatTitle = message.chat.type === 'private' ? '' : message.chat.title ?? '';
    const organizerPlayer = message.from?.id
      ? this.store.getPlayerByTelegramUserId?.(message.from.id)
      : null;

    if (options.requireConfirmation && typeof this.store.saveAnnouncementDraft === 'function') {
      const result = await this.store.saveAnnouncementDraft({
        chatId: targetChatId,
        chatTitle: targetChatTitle,
        chatType: targetChatType,
        sourceMessageId: source.sourceMessage?.message_id ?? message.message_id,
        rawText: source.rawText,
        announcement,
        organizerPlayerId: organizerPlayer?.id ?? null,
        authorTelegramUserId: message.from?.id ?? null,
        sourceDate
      });
      await this.publishOrSyncAnnouncementDraft(result.draft);
      return;
    }

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
      await this.publishOrSyncGameAnnouncement(result.game.id, { chatId: targetChatId });

      if (message.chat.type === 'private') {
        await this.sendMiniAppEntry(message.chat.id, 'private', targetChatId, {
          primaryText: 'Игра создана',
          buttonText: 'Детали игры',
          locale: this.getGameLocale(result.game),
          initialView: 'game',
          gameId: result.game.id
        });
      }
      return;
    }

    await this.sendText(message.chat.id, this.t(this.getMessageLocale(message), 'match.already_exists'));
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
    const existingGame = this.store.findGameByMessage?.(message.chat.id, message.message_id);
    const existingDraft = this.store.findAnnouncementDraftByMessage?.(message.chat.id, message.message_id);
    const announcement = parseAnnouncementText(rawText, sourceDate, {
      requirePaymentBlock: false
    });

    if (!announcement) {
      if (options.isEdited && existingDraft) {
        await this.store.deleteAnnouncementDraft?.(existingDraft.id);
        await this.editTextMessage(
          existingDraft.confirmationChatId || existingDraft.chatId,
          existingDraft.confirmationMessageId,
          'Анонс изменён и больше не распознаётся. Анонс отменён.',
          { replyMarkup: { inline_keyboard: [] } }
        ).catch(() => {});
      }
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

    if (existingGame) {
      const result = await this.store.recordGameFromAnnouncement({
        chatId: message.chat.id,
        chatTitle: message.chat.title ?? '',
        chatType: message.chat.type,
        messageId: message.message_id,
        rawText,
        announcement,
        organizerPlayerId: organizerPlayer?.id ?? existingGame.organizerPlayerId ?? null,
        source: 'telegram-confirmed',
        sourceDate
      });

      if (result?.game) {
        this.schedulePromptForGame(result.game);
        await this.publishOrSyncGameAnnouncement(result.game.id, { chatId: message.chat.id });
      }
      return;
    }

    if (isScheduledInPast(announcement.scheduledAt)) {
      if (existingDraft) {
        await this.store.deleteAnnouncementDraft?.(existingDraft.id);
      }
      await this.sendText(message.chat.id, this.t(this.getMessageLocale(message), 'match.past_game'));
      return;
    }

    if (typeof this.store.saveAnnouncementDraft !== 'function') {
      return;
    }

    const result = await this.store.saveAnnouncementDraft({
      chatId: message.chat.id,
      chatTitle: message.chat.title ?? '',
      chatType: message.chat.type,
      sourceMessageId: message.message_id,
      rawText,
      announcement,
      organizerPlayerId: organizerPlayer?.id ?? null,
      authorTelegramUserId: message.from?.id ?? null,
      sourceDate
    });
    await this.publishOrSyncAnnouncementDraft(result.draft);
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
      const locale = this.store.getChatLocale?.(chat.id) || 'ru';
      await this.sendText(
        chat.id,
        this.t(locale, 'bot.chat_connected')
      );
    }
  }

  async handleCallbackQuery(callbackQuery) {
    const data = String(callbackQuery?.data ?? '');

    if (data === 'show_commands') {
      const chat = callbackQuery.message?.chat;
      const locale = this.getMessageLocale({
        ...callbackQuery.message,
        chat,
        from: callbackQuery.from
      });

      await this.answerCallbackQuery(callbackQuery.id);
      await this.sendMiniAppEntry(chat.id, chat.type, '', {
        primaryText: this.t(locale, 'onboarding.commands_help'),
        buttonText: this.t(locale, 'common.buttons.open_app'),
        locale
      });
      return;
    }

    if (data.startsWith('set_locale:')) {
      const [, scope, rawLocale] = data.split(':');
      const locale = normalizeLocale(rawLocale);
      const messageChat = callbackQuery.message?.chat;

      if (scope === 'chat') {
        const isAdmin = await this.isUserAdminOfChat(messageChat?.id, callbackQuery.from?.id);

        if (!isAdmin) {
          const currentLocale = this.store.getChatLocale?.(messageChat?.id) || locale;
          await this.answerCallbackQuery(callbackQuery.id, this.t(currentLocale, 'settings.language.only_admin'));
          return;
        }

        await this.store.setChatLocale(messageChat.id, locale, 'manual');
        await this.answerCallbackQuery(callbackQuery.id, this.t(locale, 'settings.language.chat_updated'));
        await this.sendText(messageChat.id, this.t(locale, 'settings.language.chat_updated'));
        return;
      }

      await this.store.setPlayerLocaleByTelegramUserId(callbackQuery.from?.id, locale, 'manual');
      await this.answerCallbackQuery(callbackQuery.id, this.t(locale, 'settings.language.updated'));
      await this.sendText(callbackQuery.from.id, this.t(locale, 'settings.language.updated'));
      return;
    }

    if (data.startsWith('team_challenge_accept:') || data.startsWith('team_challenge_decline:')) {
      const player = this.store.getPlayerByTelegramUserId?.(callbackQuery.from?.id);
      const locale = this.getPlayerLocale(player);

      if (!player) {
        await this.answerCallbackQuery(callbackQuery.id, locale === 'en' ? 'Player not found' : 'Игрок не найден');
        return;
      }

      try {
        const challengeId = data.split(':')[1];
        const action = data.startsWith('team_challenge_accept:') ? 'accept' : 'decline';
        const result = await this.store.respondToTeamChallenge({
          challengeId,
          requesterPlayerId: player.id,
          action,
          payload: {},
          timezoneOffset: this.config.chatTimezoneOffset
        });

        if (result.game) {
          this.schedulePromptForGame(result.game);
          await this.notifyPlayersAboutManualGame(result.game.id);
        }

        await this.answerCallbackQuery(
          callbackQuery.id,
          action === 'accept'
            ? (locale === 'en' ? 'Challenge accepted' : 'Вызов принят')
            : (locale === 'en' ? 'Challenge declined' : 'Вызов отклонён')
        );
      } catch (error) {
        await this.answerCallbackQuery(callbackQuery.id, error.message);
      }
      return;
    }

    if (data.startsWith('confirm_announcement:') || data.startsWith('cancel_announcement:')) {
      const draftId = data.split(':')[1];
      const draft = this.store.getAnnouncementDraftById?.(draftId);

      if (!draft) {
        await this.answerCallbackQuery(callbackQuery.id, 'Черновик уже недоступен');
        return;
      }

      const isAuthor = String(draft.authorTelegramUserId ?? '') === String(callbackQuery.from?.id ?? '');
      const isAdmin = isAuthor
        ? false
        : await this.isUserAdminOfChat(draft.chatId, callbackQuery.from?.id);

      if (!isAuthor && !isAdmin) {
        await this.answerCallbackQuery(callbackQuery.id, 'Подтвердить может автор или администратор');
        return;
      }

      if (data.startsWith('cancel_announcement:')) {
        await this.store.deleteAnnouncementDraft?.(draft.id);
        await this.editTextMessage(
          draft.confirmationChatId || draft.chatId,
          draft.confirmationMessageId,
          '⚽ Анонс отменён',
          { replyMarkup: { inline_keyboard: [] } }
        ).catch(() => {});
        await this.answerCallbackQuery(callbackQuery.id, 'Анонс отменён');
        return;
      }

      try {
        if (isScheduledInPast(draft.announcement?.scheduledAt)) {
          await this.store.deleteAnnouncementDraft?.(draft.id);
          await this.editTextMessage(
            draft.confirmationChatId || draft.chatId,
            draft.confirmationMessageId,
            '⚽ Игра не создана: дата и время уже прошли.',
            { replyMarkup: { inline_keyboard: [] } }
          ).catch(() => {});
          await this.answerCallbackQuery(callbackQuery.id, 'Нельзя создать игру в прошлом');
          return;
        }

        const result = await this.store.recordGameFromAnnouncement({
          chatId: draft.chatId,
          chatTitle: draft.chatTitle,
          chatType: draft.chatType,
          messageId: draft.sourceMessageId,
          rawText: draft.rawText,
          announcement: draft.announcement,
          organizerPlayerId: draft.organizerPlayerId,
          source: 'telegram-confirmed',
          sourceDate: new Date(draft.sourceDate)
        });

        if (!result?.game) {
          await this.answerCallbackQuery(callbackQuery.id, 'Игра уже существует');
          return;
        }

        this.schedulePromptForGame(result.game);
        await this.publishOrSyncGameAnnouncement(result.game.id, { chatId: draft.chatId });
        await this.store.deleteAnnouncementDraft?.(draft.id);
        await this.editTextMessage(
          draft.confirmationChatId || draft.chatId,
          draft.confirmationMessageId,
          '⚽ <b>Игра создана</b>',
          { parseMode: 'HTML', replyMarkup: { inline_keyboard: [] } }
        ).catch(() => {});
        await this.answerCallbackQuery(callbackQuery.id, 'Игра создана');
      } catch (error) {
        await this.answerCallbackQuery(callbackQuery.id, error.message || 'Не удалось создать игру');
      }
      return;
    }

    if (data.startsWith('game_join:')) {
      const gameId = data.split(':')[1];
      const game = this.store.getGameById?.(gameId);

      if (!game) {
        await this.answerCallbackQuery(callbackQuery.id, 'Игра не найдена');
        return;
      }

      try {
        const chat = this.store.state?.chats?.[String(game.chatId)];
        const player = await this.store.rememberTelegramUser(game.chatId, callbackQuery.from, {
          chatTitle: chat?.title || '',
          chatType: chat?.type || 'supergroup'
        });
        const result = await this.store.joinGameFromBot({
          gameId,
          playerId: player.id
        });

        await this.publishOrSyncGameAnnouncement(result.game.id);
        await this.answerCallbackQuery(
          callbackQuery.id,
          result.joined ? 'Ты в составе' : 'Ты уже в составе'
        );
      } catch (error) {
        await this.answerCallbackQuery(callbackQuery.id, error.message || 'Не удалось присоединиться');
      }
      return;
    }

    if (!data.startsWith('decline_game:')) {
      return;
    }

    const gameId = data.split(':')[1];
    const player = this.store.getPlayerByTelegramUserId?.(callbackQuery.from?.id);
    const locale = this.getPlayerLocale(player);

    if (!player) {
      await this.answerCallbackQuery(callbackQuery.id, this.t(locale, 'bot.decline_missing_player'));
      return;
    }

    try {
      const result = await this.store.removePlayerFromGame({
        gameId,
        playerId: player.id
      });

      await this.answerCallbackQuery(
        callbackQuery.id,
        result.removed ? this.t(locale, 'bot.decline_removed') : this.t(locale, 'bot.decline_unchanged')
      );

      if (result.removed) {
        await this.notifyOrganizerAboutDeclinedGame(result.game.id, result.player.id, result);
      }
      await this.publishOrSyncGameAnnouncement(result.game.id);
    } catch (error) {
      await this.answerCallbackQuery(callbackQuery.id, error.message || this.t(locale, 'bot.update_game_failed'));
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
    } catch (error) {
      console.error('Unable to load bot profile:', error.message);
    }

    try {
      await this.syncDefaultMenuButton();
    } catch (error) {
      console.error('Unable to update Telegram menu button:', error.message);
    }

    try {
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

    for (const game of games) {
      try {
        const chat = this.store.state?.chats?.[String(game.chatId)];
        const chatLocale = this.getGameLocale(game);
        let promptMessageId = null;
        let sentAnyPrompt = false;

        if (chat?.type !== 'global') {
          try {
            const message = await this.sendRatingStartedChatPrompt(game);
            promptMessageId = message?.message_id ?? null;
            sentAnyPrompt = true;
          } catch (error) {
            console.error(`Unable to send chat rating prompt for ${game.id}:`, error.message);
          }
        }

        for (const player of this.getPrivateParticipants(game)) {
          try {
            const playerLocale = this.getPlayerLocale(player);
            await this.sendMiniAppEntry(player.privateChatId, 'private', game.chatId, {
              primaryText: `${this.t(playerLocale, 'rating.started')} ${this.t(playerLocale, 'rating.give_points')}.`,
              buttonText: this.t(playerLocale, 'common.buttons.rate'),
              locale: playerLocale,
              initialView: 'game',
              gameId: game.id
            });
            sentAnyPrompt = true;
          } catch (error) {
            console.error(`Unable to send private rating prompt to ${player.id}:`, error.message);
          }
        }

        if (sentAnyPrompt || chat?.type === 'global') {
          await this.store.markRatingsPromptSent(game.id, promptMessageId);
          this.clearPromptTimer(game.id);
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
      const chatLocale = this.getGameLocale(game);
      const summaryText = this.formatGameSummary(game, chatLocale);
      const chat = this.store.state?.chats?.[String(game.chatId)];
      let chatMessageId = null;
      const privatePlayerIds = [];
      let sentAnything = false;

      if (chat && chat.type !== 'private' && chat.type !== 'global') {
        try {
          const message = await this.sendMiniAppEntry(game.chatId, chat.type || 'supergroup', game.chatId, {
            primaryText: summaryText,
            buttonText: this.t(chatLocale, 'common.buttons.details'),
            locale: chatLocale,
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
          const playerLocale = this.getPlayerLocale(player);
          await this.sendMiniAppEntry(player.privateChatId, 'private', game.chatId, {
            primaryText: this.formatGameSummary(game, playerLocale),
            buttonText: this.t(playerLocale, 'common.buttons.details'),
            locale: playerLocale,
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
