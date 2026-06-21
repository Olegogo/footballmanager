import {
  POSITION_CHOICES,
  POSITION_META,
  buildTeamFieldAssignments,
  clamp,
  getEffectiveOverall,
  getEffectivePosition,
  getInitials,
  getPositionMeta,
  getSortPosition,
  splitBalancedTeams
} from '/lib/lineup.js';

const STAT_META = [
  ['pace', 'Скорость'],
  ['dribbling', 'Дриблинг'],
  ['shooting', 'Удар'],
  ['defense', 'Защита'],
  ['passing', 'Передачи'],
  ['physical', 'Физика']
];
const QUICK_RATING_POINTS = 3;
const GOALKEEPER_STAT_META = [
  ['pace', 'Игра на линии'],
  ['dribbling', 'Фиксация мяча'],
  ['shooting', 'Выносы'],
  ['defense', 'Рефлексы'],
  ['passing', 'Скорость'],
  ['physical', 'Выбор позиции']
];
const QUICK_ACHIEVEMENTS = [
  { key: 'mvp', title: 'MVP', category: 'Базовые', description: 'Игрок матча по голосам участников.', automatic: false, special: true },
  { key: 'goleador', title: 'Голеадор', category: 'Базовые', description: 'За игрока больше всего проголосовали как за главного голеадора матча.', automatic: false },
  { key: 'hat_trick', title: 'Хет-трикер', category: 'Голы и атака', description: 'Забил 3 гола за матч.', automatic: false },
  { key: 'pokerface', title: 'Покерфейс', category: 'Голы и атака', description: 'Забил 4 гола за матч.', automatic: false },
  { key: 'comeback_maker', title: 'Камбэк-мейкер', category: 'Голы и атака', description: 'Переломил ход игры.', automatic: false },
  { key: 'long_shot', title: 'Дальний выстрел', category: 'Голы и атака', description: 'Забил гол из-за пределов штрафной.', automatic: false },
  { key: 'assistant', title: 'Ассистент', category: 'Пасы и командная игра', description: 'Сделал больше всех голевых передач.', automatic: false },
  { key: 'playmaker', title: 'Плеймейкер', category: 'Пасы и командная игра', description: 'Сделал 3+ голевых передачи за матч.', automatic: false },
  { key: 'unselfish', title: 'Не жадный', category: 'Пасы и командная игра', description: 'Отдал пас на пустые ворота вместо удара.', automatic: false },
  { key: 'conductor', title: 'Дирижёр', category: 'Пасы и командная игра', description: 'Больше всех вовлечён в голевые атаки: голы + ассисты.', automatic: false },
  { key: 'wall', title: 'Стена', category: 'Защита', description: 'Лучший защитник матча.', automatic: false },
  { key: 'pickpocket', title: 'Карманник', category: 'Защита', description: 'Больше всех отборов.', automatic: false },
  { key: 'cat', title: 'Кошка', category: 'Вратарь', description: 'Лучший сейв матча.', automatic: false },
  { key: 'no_toxic', title: 'Без токсика', category: 'Другие', description: '10 матчей без жалоб и конфликтов.', automatic: false },
  { key: 'maguire_day', title: 'Магуайр дня', category: 'Другие', description: 'Смешная ошибка матча.', automatic: false },
  { key: 'planned_it', title: 'Я так и задумал', category: 'Другие', description: 'Забил случайный гол.', automatic: false },
  { key: 'woodworker', title: 'Штангист', category: 'Другие', description: 'Попал в каркас ворот 3 раза.', automatic: false },
  { key: 'debutant', title: 'Дебютант', category: 'Автоматические', description: 'Сыграл первый матч.', automatic: true },
  { key: 'stable_guy', title: 'Стабильный тип', category: 'Автоматические', description: 'Сыграл 5 матчей подряд без пропусков.', automatic: true },
  { key: 'local_guy', title: 'Свой на районе', category: 'Автоматические', description: 'Сыграл 10 матчей на одной площадке.', automatic: true },
  { key: 'yard_veteran', title: 'Ветеран двора', category: 'Автоматические', description: 'Сыграл 50 матчей.', automatic: true },
  { key: 'last_line', title: 'Последний рубеж', category: 'Автоматические', description: 'Получил MVP, играя в воротах.', automatic: true },
  { key: 'support', title: 'Поддержка', category: 'Автоматические', description: 'Поставил оценки всем игрокам после матча.', automatic: true },
  { key: 'organizer', title: 'Организатор', category: 'Автоматические', description: 'Создал первый матч.', automatic: true },
  { key: 'form_up', title: 'Апнул форму', category: 'Автоматические', description: 'Поднял среднюю оценку за последние 5 игр.', automatic: true },
  { key: 'dark_horse', title: 'Темная лошадка', category: 'Автоматические', description: 'Пришёл с низким рейтингом и получил MVP.', automatic: true },
  { key: 'yard_elite', title: 'Элита двора', category: 'Автоматические', description: 'Достиг топ-3 рейтинга.', automatic: true },
  { key: 'underrated', title: 'Недооценённый', category: 'Автоматические', description: 'Высокая статистика, но мало голосов за MVP.', automatic: true }
];
const QUICK_ACHIEVEMENT_BY_KEY = Object.fromEntries(QUICK_ACHIEVEMENTS.map((achievement) => [achievement.key, achievement]));
const QUICK_SELECTABLE_ACHIEVEMENTS = QUICK_ACHIEVEMENTS.filter((achievement) => !achievement.automatic && !achievement.special);

const VENUE_DIRECTORY = [
  {
    match: /сокольник/i,
    venue: 'CityFootball',
    address: 'ул. Короленко, 1А, Москва',
    mapUrl: 'https://yandex.ru/maps/org/cityfootball/1809670236?si=yb6d72pvrvgnt63tbw8y23w900'
  },
  {
    match: /полежаевск/i,
    venue: 'Академия Будущего',
    address: 'Москва, Северный административный округ, Хорошёвский район',
    mapUrl: 'https://yandex.ru/maps/org/akademiya_budushchego/85913064858?si=yb6d72pvrvgnt63tbw8y23w900'
  }
];
const FILTER_CHIPS = [
  { key: 'overall', label: 'Рейтинг' },
  { key: 'games', label: 'Игры' },
  { key: 'goals', label: 'Голы' },
  { key: 'assists', label: 'Передачи' },
  { key: 'pace', label: 'Скорость' },
  { key: 'dribbling', label: 'Дриблинг' },
  { key: 'shooting', label: 'Удар' },
  { key: 'defense', label: 'Защита' },
  { key: 'passing', label: 'Передачи' },
  { key: 'physical', label: 'Физика' }
];
const GAME_FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'mine', label: 'Мои' },
  { key: 'current', label: 'Текущие' },
  { key: 'finished', label: 'Завершенные' }
];
const MONTH_NAME_PATTERN = 'января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря';
const GAME_DATE_REGEX = new RegExp(`(\\d{1,2})\\s+(${MONTH_NAME_PATTERN})`, 'i');
function readLaunchContext() {
  const searchParams = new URLSearchParams(window.location.search);
  const urlChatId = searchParams.get('chatId') || '';
  const urlGameId = searchParams.get('gameId') || '';
  const urlPlayerId = searchParams.get('playerId') || '';
  const view = searchParams.get('view') || '';
  const startParam =
    searchParams.get('tgWebAppStartParam') ||
    window.Telegram?.WebApp?.initDataUnsafe?.start_param ||
    '';

  const gameMatch = String(startParam).match(/^gameid_([a-zA-Z0-9_-]+)$/);
  const playerMatch = String(startParam).match(/^playerid_([a-zA-Z0-9_-]+)$/);
  const chatMatch =
    String(startParam).match(/^game_chat_(-?\d+)$/) ||
    String(startParam).match(/^chat_(-?\d+)$/);
  const selectedGameId = urlGameId || gameMatch?.[1] || '';
  const shouldOpenGame = Boolean(selectedGameId) || view === 'game' || /^game($|_)/.test(String(startParam));
  const selectedPlayerId = urlPlayerId || playerMatch?.[1] || '';
  const shouldOpenPlayer = Boolean(selectedPlayerId) || view === 'players';

  return {
    chatId: urlChatId || chatMatch?.[1] || '',
    gameId: selectedGameId,
    playerId: selectedPlayerId,
    initialTab: shouldOpenGame ? 'game' : shouldOpenPlayer ? 'players' : 'games'
  };
}

const launchContext = readLaunchContext();

function readChatIdFromStartParam() {
  return readLaunchContext().chatId;
}

function readInitialTabFromLaunch() {
  return launchContext.initialTab;
}

function getSafeActiveTab(tab) {
  if (['game', 'games', 'players', 'profile'].includes(tab)) {
    return tab;
  }

  return 'games';
}

const state = {
  chatId: launchContext.chatId,
  token: '',
  snapshot: null,
  allowDevLogin: false,
  activeTab: getSafeActiveTab(readInitialTabFromLaunch()),
  activeSort: 'overall',
  gamesFilter: 'all',
  positionFilter: '',
  playerSearch: '',
  selectedPlayerId: null,
  playerScrollTargetId: launchContext.playerId || '',
  selectedGameId: launchContext.gameId,
  selfProfileDraft: null,
  selfProfileEditing: false,
  selfProfilePromptDismissedFor: '',
  profileActionsOpen: false,
  gameActionsOpen: false,
  achievementDetailKey: '',
  quickAchievementInfoPointerAt: 0,
  ratingDrafts: {},
  quickRatingDrafts: {},
  manualGameOpen: false,
  manualGameMode: 'create',
  manualGameGameId: '',
  manualGameConfirm: null,
  manualPlayerPickerOpen: false,
  manualPlayerSearch: '',
  manualGameDraft: {
    date: '',
    time: '',
    location: '',
    playerIds: []
  }
};
const PROFILE_STEPPER_LONG_TAP_MS = 450;
const profileStepperPressStartedAt = new WeakMap();

const tg = window.Telegram?.WebApp;
const apiBaseUrl = String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
const appShellNode = document.querySelector('.app-shell');
const contentNode = document.getElementById('content');
const chatTitleNode = document.getElementById('chatTitle');
const topbarNode = document.querySelector('.topbar');
const gameTopActionsNode = document.getElementById('gameTopActions');
const gameMenuButtonNode = document.getElementById('gameMenuButton');
const gameShareButtonNode = document.getElementById('gameShareButton');
const closeGameButtonNode = document.getElementById('closeGameButton');
const modalRoot = document.getElementById('modalRoot');
const toastNode = document.getElementById('toast');
let refreshTimer = null;
let countdownTimer = null;
let lastAuthError = '';

function storageKey() {
  return 'fifa-miniapp-token:global';
}

function consumeSessionTokenFromUrl() {
  const url = new URL(window.location.href);
  const sessionToken = url.searchParams.get('session') || '';
  const authError = url.searchParams.get('authError') || '';

  if (sessionToken || authError) {
    url.searchParams.delete('session');
    url.searchParams.delete('authError');
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }

  return { sessionToken, authError };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getPlural(count, forms) {
  const number = Math.abs(Number(count));
  const mod10 = number % 10;
  const mod100 = number % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return forms[0];
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return forms[1];
  }

  return forms[2];
}

function normalizeUsername(value = '') {
  return String(value ?? '').trim().replace(/^@/, '').toLowerCase();
}

function getScreenTitle() {
  if (state.manualGameOpen) {
    return '';
  }

  if (state.activeTab === 'game') {
    return '';
  }

  if (state.activeTab === 'games') {
    return 'Игры';
  }

  if (state.activeTab === 'players') {
    return 'Игроки';
  }

  return '';
}

function isGoalkeeperPosition(position) {
  return position === 'GK';
}

function getStatMetaForPosition(position) {
  return isGoalkeeperPosition(position) ? GOALKEEPER_STAT_META : STAT_META;
}

function getVenueInfo(location = '') {
  return VENUE_DIRECTORY.find((entry) => entry.match.test(String(location))) || null;
}

function showToast(message) {
  toastNode.textContent = message;
  toastNode.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toastNode.classList.add('hidden');
  }, 2200);
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {})
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401 && !options.skipAuthRetry && path !== '/api/auth/telegram' && tg?.initData) {
      state.token = '';
      localStorage.removeItem(storageKey());
      const authenticated = await authenticateTelegram().catch(() => false);

      if (authenticated) {
        return api(path, { ...options, skipAuthRetry: true });
      }
    }

    throw new Error(data.error || 'Request failed');
  }

  return data;
}

async function authenticateTelegram() {
  if (!tg?.initData) {
    lastAuthError = 'Telegram не передал initData. Открой приложение кнопкой бота в личке, не обычной ссылкой.';
    return false;
  }

  let data = null;

  try {
    data = await api('/api/auth/telegram', {
      method: 'POST',
      body: {
        chatId: state.chatId,
        gameId: state.selectedGameId,
        initData: tg.initData
      }
    });
  } catch (error) {
    lastAuthError = `Telegram-авторизация не прошла: ${error.message}`;
    return false;
  }

  state.token = data.token;
  state.snapshot = data.snapshot;
  state.chatId = state.chatId || data.snapshot?.chat?.id || '';
  localStorage.setItem(storageKey(), state.token);
  lastAuthError = '';
  return true;
}

async function loginDev(username, displayName = '') {
  const data = await api('/api/auth/dev', {
    method: 'POST',
    body: {
      chatId: state.chatId,
      username,
      displayName
    }
  });

  state.token = data.token;
  state.snapshot = data.snapshot;
  state.chatId = state.chatId || data.snapshot?.chat?.id || '';
  localStorage.setItem(storageKey(), state.token);
  render();
  showToast('Dev-вход выполнен');
}

async function loadSnapshot() {
  const params = new URLSearchParams();

  if (state.selectedGameId) {
    params.set('gameId', state.selectedGameId);
  }

  if (state.chatId) {
    params.set('chatId', state.chatId);
  }

  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await api(`/api/bootstrap${query}`);
  state.snapshot = data.snapshot;
  state.allowDevLogin = data.allowDevLogin;
  state.chatId = state.chatId || data.snapshot?.chat?.id || '';

  if (state.token && !data.snapshot?.viewerPlayerId) {
    localStorage.removeItem(storageKey());
    state.token = '';
  }
}

function getCurrentGame() {
  if (state.selectedGameId) {
    return getGameDays().find((game) => game.id === state.selectedGameId) ?? state.snapshot?.currentGame ?? null;
  }

  return state.snapshot?.currentGame ?? null;
}

function getGames() {
  return state.snapshot?.games ?? [];
}

function getGameDays() {
  return state.snapshot?.gameDays ?? [];
}

function getPlayers() {
  return state.snapshot?.players ?? [];
}

function getAvailablePlayers() {
  return state.snapshot?.availablePlayers?.length ? state.snapshot.availablePlayers : getPlayers();
}

function getPlayer(playerId) {
  return getPlayers().find((player) => player.id === playerId) ??
    getAvailablePlayers().find((player) => player.id === playerId) ??
    null;
}

function getViewerPlayer() {
  const sessionPlayer = getPlayer(state.snapshot?.viewerPlayerId);

  if (sessionPlayer) {
    return sessionPlayer;
  }

  const telegramUser = tg?.initDataUnsafe?.user ?? null;
  const username = normalizeUsername(telegramUser?.username);

  if (username) {
    const matchedPlayer = getPlayers().find((player) => normalizeUsername(player.username) === username);

    if (matchedPlayer) {
      return matchedPlayer;
    }
  }

  if (!telegramUser?.id) {
    return null;
  }

  return {
    id: `telegram_${telegramUser.id}`,
    username: username || 'unknown',
    displayName: [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ') || (username ? `@${username}` : 'Игрок'),
    firstName: telegramUser.first_name || '',
    lastName: telegramUser.last_name || '',
    photoUrl: telegramUser.photo_url || '',
    overall: 50,
    position: 'N/A',
    stats: Object.fromEntries(STAT_META.map(([key]) => [key, 50])),
    games: 0,
    ratedGames: 0,
    goals: 0,
    assists: 0,
    isMvp: false
  };
}

function closeGameScreen() {
  state.activeTab = 'games';
  state.selectedGameId = '';
  state.gameActionsOpen = false;
  render();
}

function resetManualGameState() {
  state.manualGameOpen = false;
  state.manualGameMode = 'create';
  state.manualGameGameId = '';
  state.manualGameConfirm = null;
  state.manualPlayerPickerOpen = false;
  state.manualPlayerSearch = '';
  state.manualGameDraft = {
    date: '',
    time: '',
    location: '',
    playerIds: []
  };
}

function openManualGameCreate() {
  resetManualGameState();
  state.manualGameOpen = true;
  render();
}

function openManualGameEdit(game) {
  state.gameActionsOpen = false;
  state.manualGameOpen = true;
  state.manualGameMode = 'edit';
  state.manualGameGameId = game.id;
  state.manualGameConfirm = null;
  state.manualPlayerPickerOpen = false;
  state.manualPlayerSearch = '';
  state.manualGameDraft = {
    date: new Date(game.scheduledAt).toISOString().slice(0, 10),
    time: game.time || '19:30',
    location: game.location || '',
    playerIds: [
      ...game.participants.map((player) => player.id),
      ...(game.invitedPlayers ?? []).map((player) => player.id)
    ]
  };
  render();
}

function getRatingDraftKey(gameId, playerId) {
  return `${gameId}:${playerId}`;
}

function getQuickRatingDraftKey(gameId) {
  return `quick:${gameId}`;
}

function normalizeQuickBoosts(boosts = []) {
  const boostMap = new Map();

  for (const boost of Array.isArray(boosts) ? boosts : []) {
    const targetPlayerId = String(boost?.targetPlayerId || '');
    const statKey = String(boost?.statKey || '');
    const points = Math.max(0, Math.min(QUICK_RATING_POINTS, Math.round(Number(boost?.points ?? 0))));

    if (!targetPlayerId || !STAT_META.some(([key]) => key === statKey) || !points) {
      continue;
    }

    const key = `${targetPlayerId}:${statKey}`;
    boostMap.set(key, {
      targetPlayerId,
      statKey,
      points: Math.min(QUICK_RATING_POINTS, (boostMap.get(key)?.points ?? 0) + points)
    });
  }

  return [...boostMap.values()];
}

function normalizeQuickAchievements(achievements = []) {
  const achievementMap = new Map();

  for (const achievement of Array.isArray(achievements) ? achievements : []) {
    const targetPlayerId = String(achievement?.targetPlayerId || '');
    const achievementKey = String(achievement?.achievementKey || '');

    if (!achievementKey || !QUICK_SELECTABLE_ACHIEVEMENTS.some((item) => item.key === achievementKey)) {
      continue;
    }

    achievementMap.set(achievementKey, {
      targetPlayerId,
      achievementKey
    });
  }

  return [...achievementMap.values()];
}

function getQuickRatingDraft(game) {
  if (!game?.id) {
    return {
      mvpPlayerId: '',
      boosts: [],
      achievements: [],
      achievementPickerOpen: false
    };
  }

  const draftKey = getQuickRatingDraftKey(game.id);

  if (!state.quickRatingDrafts[draftKey]) {
    state.quickRatingDrafts[draftKey] = {
      mvpPlayerId: game.viewerQuickRating?.mvpPlayerId || '',
      boosts: normalizeQuickBoosts(game.viewerQuickRating?.boosts),
      achievements: normalizeQuickAchievements(game.viewerQuickRating?.achievements),
      achievementPickerOpen: false
    };
  }

  return state.quickRatingDrafts[draftKey];
}

function getQuickRatingPointsUsed(draft) {
  return normalizeQuickBoosts(draft?.boosts).reduce((sum, boost) => sum + boost.points, 0);
}

function getQuickBoostPoints(draft, targetPlayerId, statKey) {
  return normalizeQuickBoosts(draft?.boosts).find(
    (boost) => boost.targetPlayerId === targetPlayerId && boost.statKey === statKey
  )?.points ?? 0;
}

function setQuickBoostPoints(game, targetPlayerId, statKey, points) {
  const draft = getQuickRatingDraft(game);
  const nextBoosts = normalizeQuickBoosts(draft.boosts)
    .filter((boost) => !(boost.targetPlayerId === targetPlayerId && boost.statKey === statKey));

  if (points > 0) {
    nextBoosts.push({
      targetPlayerId,
      statKey,
      points: Math.max(0, Math.min(QUICK_RATING_POINTS, Math.round(Number(points))))
    });
  }

  draft.boosts = normalizeQuickBoosts(nextBoosts);
}

function setQuickAchievementTarget(game, achievementKey, targetPlayerId) {
  const draft = getQuickRatingDraft(game);
  const nextAchievements = normalizeQuickAchievements(draft.achievements)
    .filter((achievement) => achievement.achievementKey !== achievementKey);

  if (targetPlayerId) {
    nextAchievements.push({
      achievementKey,
      targetPlayerId
    });
  }

  draft.achievements = normalizeQuickAchievements(nextAchievements);
}

function getQuickAchievementTarget(draft, achievementKey) {
  return normalizeQuickAchievements(draft?.achievements).find(
    (achievement) => achievement.achievementKey === achievementKey
  )?.targetPlayerId ?? '';
}

function hasVisibleRating(player, currentStats = null) {
  return Boolean(currentStats?.hasRatings || player.ratedGames > 0);
}

function hasVisibleStats(player, currentStats = null) {
  return Boolean(currentStats?.hasRatings || player?.ratedGames > 0 || player?.hasSelfProfile);
}

function isPlayerCardUnfilled(player, currentStats = null) {
  return !hasVisibleStats(player, currentStats ?? player?.currentGameStats ?? null);
}

function getEmptyPlayerStatusLabel(player, game = null) {
  if (isPlayerCardUnfilled(player)) {
    return 'Не заполнен';
  }

  if (game?.hasStarted || game?.ratingWindowOpen || game?.status === 'live' || game?.status === 'finished') {
    return 'Не оценён';
  }

  return 'Нет рейтинга';
}

function getCardStatusLabel(player, currentStats = null) {
  if (isPlayerCardUnfilled(player, currentStats)) {
    return 'Не заполнен';
  }

  if (!hasVisibleRating(player, currentStats)) {
    return 'Нет рейтинга';
  }

  return '';
}

function getPlayerOverallLabel(player, currentStats = null) {
  if (!hasVisibleRating(player, currentStats)) {
    return '';
  }

  return String(Math.round(Number(currentStats?.hasRatings ? currentStats.overall : player.overall)));
}

function getMatchOverallLabel(player) {
  return player.currentGameStats?.hasRatings
    ? String(Math.round(Number(player.currentGameStats.overall)))
    : '';
}

function getGameMiniCardRatingLabel(player, game = null) {
  if (game?.hasStarted) {
    return getMatchOverallLabel(player);
  }

  return getPlayerOverallLabel(player, player.currentGameStats);
}

function getGamePlayerRatingState(player, game = null) {
  const currentStats = player.currentGameStats ?? null;
  const ratingsCount = Number(currentStats?.ratingsCount ?? 0);
  const hasMatchRating = Boolean(currentStats?.hasRatings);
  const matchRating = hasMatchRating ? Math.round(Number(currentStats.overall)) : null;
  const hasStarted = Boolean(game?.hasStarted || game?.status === 'live' || game?.status === 'finished');

  if (game?.ratingWindowOpen) {
    return {
      phase: ratingsCount > 0 ? 'live-rated' : 'live-empty',
      ratingsCount,
      rating: matchRating,
      hasMatchRating
    };
  }

  if (hasStarted) {
    return {
      phase: hasMatchRating ? 'closed-rated' : 'closed-empty',
      ratingsCount,
      rating: matchRating,
      hasMatchRating
    };
  }

  return {
    phase: player.ratedGames > 0 ? 'pre-game-rated' : 'pre-game-empty',
    ratingsCount,
    rating: player.ratedGames > 0 ? Math.round(Number(player.overall)) : null,
    hasMatchRating
  };
}

function getGamePlayerPositionLabel(player) {
  const currentStats = player.currentGameStats ?? null;
  const position = currentStats?.hasRatings && currentStats.position
    ? currentStats.position
    : (player.position || 'N/A');
  const positionLabel = getPositionMeta(position).short;

  return positionLabel === '—' ? 'Позиция не выбрана' : positionLabel;
}

function renderRatingCountBadge(count, className = 'rating-count-badge') {
  return `
    <span class="${escapeHtml(className)}" aria-label="${escapeHtml(count)} оценили">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 12a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Zm-7.4 8.2c.6-3.7 3.5-6.2 7.4-6.2s6.8 2.5 7.4 6.2c.1.5-.3.9-.8.9H5.4c-.5 0-.9-.4-.8-.9Z"></path>
      </svg>
      <strong>${escapeHtml(count)}</strong>
    </span>
  `;
}

function getRatingTrend(delta) {
  const number = Number(delta);

  if (!Number.isFinite(number) || Math.abs(number) < 0.5) {
    return null;
  }

  return number > 0 ? 'up' : 'down';
}

function renderRatingValue(value, delta, className = 'rating-value') {
  const trend = getRatingTrend(delta);
  const classes = ['rating-value'];

  if (className && className !== 'rating-value') {
    classes.push(className);
  }

  if (trend) {
    classes.push(`rating-value--${trend}`);
  }

  if (!value && value !== 0) {
    return '';
  }

  return `
    <span class="${classes.map(escapeHtml).join(' ')}">
      <strong>${escapeHtml(value)}</strong>
      ${
        trend
          ? `
            <i class="rating-trend-arrow rating-trend-arrow--${trend}" aria-hidden="true">
              <svg viewBox="0 0 64 64" focusable="false">
                <path d="${trend === 'up' ? 'M32 54V10M14 28 32 10l18 18' : 'M32 10v44M14 36l18 18 18-18'}"></path>
              </svg>
            </i>
          `
          : ''
      }
    </span>
  `;
}

function renderGamePlayerState(player, game) {
  const ratingState = getGamePlayerRatingState(player, game);
  const ratingValue = renderRatingValue(
    ratingState.rating,
    player.currentGameStats?.ratingDelta,
    'game-player-rating'
  );

  if (ratingState.phase === 'live-rated') {
    return `
      <div class="game-player-badges">
        ${renderRatingCountBadge(ratingState.ratingsCount, 'game-player-count')}
        ${ratingValue}
      </div>
    `;
  }

  if (ratingState.phase === 'closed-rated' || ratingState.phase === 'pre-game-rated') {
    return ratingValue;
  }

  return `<div class="game-player-unrated">${escapeHtml(getEmptyPlayerStatusLabel(player, game))}</div>`;
}

function renderEditorStateBadge(player, gamePlayer, game) {
  if (!gamePlayer) {
    return '<span class="editor-status">Карточка игрока</span>';
  }

  const ratingState = getGamePlayerRatingState(gamePlayer, game);

  if (ratingState.phase === 'live-rated') {
    return `
      <div class="editor-status-group">
        ${renderRatingCountBadge(ratingState.ratingsCount, 'editor-count-badge')}
        ${renderRatingValue(ratingState.rating, gamePlayer.currentGameStats?.ratingDelta, 'editor-live-rating')}
      </div>
    `;
  }

  if (ratingState.phase === 'closed-rated') {
    return renderRatingValue(ratingState.rating, gamePlayer.currentGameStats?.ratingDelta, 'editor-final-rating');
  }

  if (ratingState.phase === 'pre-game-rated') {
    return '<span class="editor-status">Оценка матча</span>';
  }

  return `<span class="editor-status">${escapeHtml(getEmptyPlayerStatusLabel(gamePlayer, game))}</span>`;
}

function getGameDateShort(dateLabel = '') {
  const match = String(dateLabel || '').replaceAll(',', ' ').match(GAME_DATE_REGEX);

  if (match) {
    return `${Number(match[1])} ${match[2].toLowerCase()}`;
  }

  return String(dateLabel || '');
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function getRatingCountdownLabel(endAt) {
  const endTime = new Date(endAt).getTime();

  if (!Number.isFinite(endTime)) {
    return '';
  }

  return formatCountdown(endTime - Date.now());
}

function sortPlayers(players) {
  return [...players].sort((left, right) => {
    if (left.isMvp !== right.isMvp) {
      return left.isMvp ? -1 : 1;
    }

    if (state.activeSort === 'position') {
      const leftOrder = getSortPosition(left.position);
      const rightOrder = getSortPosition(right.position);

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
    } else if (state.activeSort === 'games' && right.games !== left.games) {
      return right.games - left.games;
    } else if (state.activeSort === 'goals' && right.goals !== left.goals) {
      return right.goals - left.goals;
    } else if (state.activeSort === 'assists' && right.assists !== left.assists) {
      return right.assists - left.assists;
    } else if (STAT_META.some(([key]) => key === state.activeSort)) {
      if (right.stats[state.activeSort] !== left.stats[state.activeSort]) {
        return right.stats[state.activeSort] - left.stats[state.activeSort];
      }
    } else if (right.overall !== left.overall) {
      return right.overall - left.overall;
    }

    if (right.overall !== left.overall) {
      return right.overall - left.overall;
    }

    if (right.games !== left.games) {
      return right.games - left.games;
    }

    return left.displayName.localeCompare(right.displayName, 'ru');
  });
}

function renderCardHero(player) {
  if (player.photoUrl) {
    return `
      <div class="fifa-card-hero-media">
        <img src="${escapeHtml(player.photoUrl)}" alt="${escapeHtml(player.displayName)}">
      </div>
    `;
  }

  return `
    <div class="fifa-card-hero-media fifa-card-hero-media--fallback">
      <span>${escapeHtml(getInitials(player))}</span>
    </div>
  `;
}

function renderMiniAvatar(player) {
  if (player.photoUrl) {
    return `<img src="${escapeHtml(player.photoUrl)}" alt="${escapeHtml(player.displayName)}">`;
  }

  return `<span>${escapeHtml(getInitials(player))}</span>`;
}

function renderShareIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.9 19.4c2.2-6.7 6.9-10.5 13.1-11.1V4.7c0-.9 1.1-1.4 1.8-.8l4.6 4.6c.5.5.5 1.2 0 1.7l-4.6 4.6c-.7.7-1.8.2-1.8-.8v-3.1c-4.8.2-8.6 2.5-12 8-.4.6-1.3.3-1.1-.5Z"></path>
    </svg>
  `;
}

function renderDotsIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="2.2"></circle>
      <circle cx="12" cy="12" r="2.2"></circle>
      <circle cx="19" cy="12" r="2.2"></circle>
    </svg>
  `;
}

function getDisciplineCards(source = {}) {
  const yellow = Number(source?.cards?.yellow ?? source?.yellowCards ?? 0);
  const red = Number(source?.cards?.red ?? source?.redCards ?? 0);

  return {
    yellow: Math.max(0, Math.round(Number.isFinite(yellow) ? yellow : 0)),
    red: Math.max(0, Math.round(Number.isFinite(red) ? red : 0))
  };
}

function hasDisciplineCards(source = {}) {
  const cards = getDisciplineCards(source);
  return cards.yellow > 0 || cards.red > 0;
}

function renderDisciplineCards(source = {}, className = 'discipline-cards') {
  const cards = getDisciplineCards(source);

  if (!cards.yellow && !cards.red) {
    return '';
  }

  return `
    <span class="${escapeHtml(className)}">
      ${
        cards.yellow
          ? `<span class="discipline-card-chip"><i class="discipline-card-icon discipline-card-icon--yellow"></i><strong>${escapeHtml(cards.yellow)}</strong></span>`
          : ''
      }
      ${
        cards.red
          ? `<span class="discipline-card-chip"><i class="discipline-card-icon discipline-card-icon--red"></i><strong>${escapeHtml(cards.red)}</strong></span>`
          : ''
      }
    </span>
  `;
}

function renderPositionSelector(label, value) {
  return `
    <div class="position-selector">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.7 8.8a1 1 0 0 1 1.4 0L12 12.7l3.9-3.9a1 1 0 1 1 1.4 1.4l-4.6 4.6a1 1 0 0 1-1.4 0L6.7 10.2a1 1 0 0 1 0-1.4z"></path>
      </svg>
    </div>
  `;
}

function renderEditablePositionSelector(label, value, selectedPosition, canEdit) {
  const selectedValue = selectedPosition || 'N/A';

  if (!canEdit) {
    return renderPositionSelector(label, value);
  }

  return `
    <label class="position-selector position-selector--editable">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <select data-profile-position-select aria-label="${escapeHtml(label)}">
        ${POSITION_CHOICES
          .map((position) => `
            <option value="${position}" ${selectedValue === position ? 'selected' : ''}>
              ${escapeHtml(getPositionMeta(position).title)}
            </option>
          `)
          .join('')}
      </select>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.7 8.8a1 1 0 0 1 1.4 0L12 12.7l3.9-3.9a1 1 0 1 1 1.4 1.4l-4.6 4.6a1 1 0 0 1-1.4 0L6.7 10.2a1 1 0 0 1 0-1.4z"></path>
      </svg>
    </label>
  `;
}

function renderMetricCell(label, value, options = {}) {
  const classes = ['metric-cell'];

  if (options.outlined) {
    classes.push('metric-cell--outlined');
  }

  if (options.emphasis) {
    classes.push('metric-cell--emphasis');
  }

  return `
    <div class="${classes.join(' ')}">
      <span>${escapeHtml(label)}</span>
      <strong>${options.html ? value : escapeHtml(value)}</strong>
    </div>
  `;
}

function renderFifaCard(player, options = {}) {
  const currentStats = options.currentStats || null;
  const variant = options.variant || 'player-list';
  const clickable = options.clickable !== false;
  const actionLabel = options.actionLabel || '';
  const ratingsCount = currentStats?.ratingsCount ?? 0;
  const hasCurrentRatings = Boolean(currentStats?.hasRatings);
  const hasCareerRatings = player.ratedGames > 0;
  const hasRating = hasVisibleRating(player, currentStats);
  const hasStats = hasVisibleStats(player, currentStats);
  const isRatingCard = variant === 'game-rating';
  const viewerHasRatedTarget = Boolean(player.viewerHasRatedTarget);
  const hideMatchDetailsUntilViewerRates = isRatingCard && !viewerHasRatedTarget;
  const showKnownStats = !hideMatchDetailsUntilViewerRates && hasStats;
  const showRatedTotals = !hideMatchDetailsUntilViewerRates && hasRating;
  const overall = hasCurrentRatings ? currentStats.overall : hasCareerRatings ? player.overall : null;
  const ratingDelta = currentStats?.ratingDelta ?? player.ratingDelta ?? null;
  const effectivePosition = hasCurrentRatings ? (currentStats?.position || player.position || 'N/A') : (player.position || 'N/A');
  const position = hasRating || player.hasSelfProfile ? effectivePosition : null;
  const statValues = hasCurrentRatings ? currentStats?.stats : player.stats;
  const statusLabel = getCardStatusLabel(player, currentStats);
  const statPlaceholder = '-';
  const statMeta = getStatMetaForPosition(effectivePosition);
  const overviewCells = [
    { label: 'игр', value: hideMatchDetailsUntilViewerRates ? statPlaceholder : player.games }
  ];
  const statCells = statMeta.map(([key, label]) => [
    label.toLowerCase(),
    !hideMatchDetailsUntilViewerRates && showKnownStats ? statValues[key] : statPlaceholder
  ]);
  const openAttribute = clickable ? ` data-open-player="${escapeHtml(player.id)}"` : '';
  const actionNote = isRatingCard && ratingsCount > 0 ? `${ratingsCount} уже оценили` : '';
  const achievements = getUnlockedPlayerAchievements(player, currentStats);

  return `
    <article class="fifa-card fifa-card--${escapeHtml(variant)} ${player.isMvp ? 'is-mvp' : ''} ${clickable ? 'is-clickable' : ''}" data-player-card-id="${escapeHtml(player.id)}"${openAttribute}>
      ${player.isMvp ? '<span class="mvp-badge">MVP</span>' : ''}
      <div class="fifa-card-hero">
        ${renderCardHero(player)}
        ${statusLabel ? `<div class="status-badge">${escapeHtml(statusLabel)}</div>` : ''}
        ${
          hasRating
            ? `
              <div class="hero-score ${statusLabel ? 'hero-score--with-status' : ''}">
                ${renderRatingValue(overall, ratingDelta, 'hero-rating-value')}
                <span>${escapeHtml(getPositionMeta(position).card)}</span>
              </div>
            `
            : ''
        }
      </div>
      <div class="fifa-card-panel">
        <div class="fifa-card-nameblock">
          <div class="card-name">${escapeHtml(player.displayName)}</div>
          <div class="card-nick">@${escapeHtml(player.username || 'unknown')}</div>
        </div>
        ${
          isRatingCard
            ? renderPositionSelector('Позиция', effectivePosition === 'N/A' ? 'Не выбрана' : getPositionMeta(effectivePosition).title)
            : ''
        }
        <div class="metric-grid metric-grid--summary ${overviewCells.length === 1 ? 'metric-grid--single' : ''}">
          ${overviewCells.map((cell) => renderMetricCell(cell.label, cell.value, cell)).join('')}
        </div>
        <div class="metric-grid metric-grid--stats">
          ${statCells.map(([label, value]) => renderMetricCell(label, value, { outlined: isRatingCard })).join('')}
        </div>
        ${renderAchievementPills(achievements, { title: true })}
        ${
          actionLabel
            ? `
              <button type="button" class="primary-button card-action" data-open-player="${escapeHtml(player.id)}">
                ${escapeHtml(actionLabel)}
                ${actionNote ? `<span class="card-action-note">${escapeHtml(actionNote)}</span>` : ''}
              </button>
            `
            : ''
        }
      </div>
    </article>
  `;
}

function renderEditorStepper(name, label, value, max = 20) {
  return `
    <div class="editor-stepper" data-stepper-name="${escapeHtml(name)}">
      <span>${escapeHtml(label)}</span>
      <strong data-stepper-value>${escapeHtml(value)}</strong>
      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" min="0" max="${escapeHtml(max)}">
      <div class="editor-stepper-actions">
        <button type="button" class="editor-stepper-button" data-stepper-action="decrement" data-stepper-name="${escapeHtml(name)}">−</button>
        <button type="button" class="editor-stepper-button" data-stepper-action="increment" data-stepper-name="${escapeHtml(name)}">+</button>
      </div>
    </div>
  `;
}

function renderEditorCardStepper(name, label, kind, value, max) {
  return `
    <div class="editor-card-stepper" data-stepper-name="${escapeHtml(name)}">
      <span class="editor-card-label">
        <i class="discipline-card-icon discipline-card-icon--${escapeHtml(kind)}"></i>
        ${escapeHtml(label)}
      </span>
      <strong data-stepper-value>${escapeHtml(value)}</strong>
      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" min="0" max="${escapeHtml(max)}">
      <div class="editor-card-actions">
        <button type="button" class="editor-stepper-button" data-stepper-action="decrement" data-stepper-name="${escapeHtml(name)}">−</button>
        <button type="button" class="editor-stepper-button" data-stepper-action="increment" data-stepper-name="${escapeHtml(name)}">+</button>
      </div>
    </div>
  `;
}

function renderEditorCards(defaults) {
  const cards = getDisciplineCards(defaults);
  const enabled = Boolean(defaults.cardsEnabled ?? (cards.yellow > 0 || cards.red > 0));

  return `
    <section class="editor-cards-control ${enabled ? 'is-enabled' : ''}" data-card-control>
      <label class="editor-cards-toggle">
        <span>Карточки</span>
        <input type="checkbox" name="cardsEnabled" data-cards-toggle ${enabled ? 'checked' : ''}>
        <i aria-hidden="true"></i>
      </label>
      <div class="editor-cards-controls">
        ${renderEditorCardStepper('yellowCards', 'желтые', 'yellow', cards.yellow, 2)}
        ${renderEditorCardStepper('redCards', 'красная', 'red', cards.red, 1)}
      </div>
    </section>
  `;
}

function renderEditorRange(name, label, value) {
  return `
    <label class="editor-range">
      <div class="editor-range-box">
        <span>${escapeHtml(label)}</span>
        <strong class="editor-range-value">${escapeHtml(value)}</strong>
      </div>
      <input type="range" min="1" max="99" name="${escapeHtml(name)}" value="${escapeHtml(value)}">
    </label>
  `;
}

function renderSelfProfileStatStepper(name, label, value) {
  const safeValue = Math.max(1, Math.min(99, Math.round(Number(value ?? 50))));

  return `
    <div class="profile-stat-stepper quick-card-stat" data-stepper-name="${escapeHtml(name)}">
      <button
        type="button"
        data-stepper-action="decrement"
        data-stepper-name="${escapeHtml(name)}"
        aria-label="Уменьшить ${escapeHtml(label)}"
      >−</button>
      <span>${escapeHtml(label)}</span>
      <strong><span data-stepper-value>${escapeHtml(safeValue)}</span></strong>
      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(safeValue)}" min="1" max="99">
      <button
        type="button"
        data-stepper-action="increment"
        data-stepper-name="${escapeHtml(name)}"
        aria-label="Увеличить ${escapeHtml(label)}"
      >+</button>
    </div>
  `;
}

function renderEditorScreen(player, gamePlayer, editable, defaults, game) {
  const currentStats = gamePlayer?.currentGameStats ?? null;
  const statMeta = getStatMetaForPosition(defaults.position);
  const isGoalkeeper = isGoalkeeperPosition(defaults.position);

  return `
    <div class="editor-overlay" data-modal-backdrop="true">
      <section class="editor-screen" role="dialog" aria-modal="true" aria-label="${escapeHtml(player.displayName)}">
        <div class="editor-hero">
          ${renderCardHero(player)}
          ${renderEditorStateBadge(player, gamePlayer, game)}
          <button class="editor-close" type="button" data-close-modal="true">×</button>
        </div>
        <div class="editor-body">
          <div class="editor-nameblock">
            <div class="editor-name">${escapeHtml(player.displayName)}</div>
            <div class="editor-nick">@${escapeHtml(player.username || 'unknown')}</div>
          </div>
          ${
            editable
              ? `
                <div class="editor-form editor-form--quick">
                  <div class="quick-rating-block">
                    <span class="quick-rating-label">MVP матча</span>
                    ${renderQuickRatingMvpButton(player, game, getQuickRatingDraft(game))}
                  </div>
                  <div class="quick-rating-block">
                    <span class="quick-rating-label">Очки статов</span>
                    <p class="quick-rating-hint">Всего на матч доступно ${QUICK_RATING_POINTS} очка. Можно отдать все одному игроку или распределить между несколькими.</p>
                    ${renderQuickStatControls(player, game, getQuickRatingDraft(game))}
                  </div>
                  <button type="button" class="primary-button card-action editor-submit" data-submit-quick-rating="${escapeHtml(game.id)}">Сохранить</button>
                </div>
              `
              : `
                ${renderFifaCard(player, {
                  currentStats,
                  variant: gamePlayer ? 'game-summary' : 'player-list',
                  clickable: false
                })}
                <div class="panel subtle-panel">
                  <p>Этого игрока сейчас можно только посмотреть. Оценка доступна после старта матча и только для других участников текущей игры.</p>
                </div>
              `
          }
        </div>
      </section>
    </div>
  `;
}

function renderGameHeader(game) {
  const statusText = game.status === 'upcoming' ? 'Игра впереди' : game.status === 'live' ? 'Идет игра' : 'Игра закончена';
  const venue = getVenueInfo(game.location);

  return `
    <section class="panel game-info-panel ${game.ratingWindowOpen ? 'game-info-panel--rating' : ''}">
      <div class="game-summary">
        <div>
          <h2>${escapeHtml(getGameDateShort(game.dateLabel))}</h2>
          <p class="game-location">${escapeHtml(game.location || 'Не указано')}</p>
        </div>
        <span class="status-pill ${escapeHtml(game.status)}">${escapeHtml(statusText)}</span>
      </div>
      <div class="game-facts">
        <div>
          <span>Время</span>
          <strong>${escapeHtml(game.time)}</strong>
        </div>
        <div>
          <span>Игроков</span>
          <strong>${game.participants.length}</strong>
        </div>
      </div>
      <div class="game-venue">
        <div class="game-venue-copy">
          <span>Адрес</span>
          <strong>${escapeHtml(venue?.venue || game.location || 'Не указано')}</strong>
          <p>${escapeHtml(venue?.address || game.location || 'Не указано')}</p>
        </div>
        ${
          venue?.mapUrl
            ? `<button type="button" class="primary-button map-button" data-map-link="${escapeHtml(venue.mapUrl)}">На карте</button>`
            : ''
        }
      </div>
    </section>
  `;
}

function renderRatingBanner(game) {
  if (game.ratingWindowOpen) {
    const countdownLabel = getRatingCountdownLabel(game.ratingWindowEndsAt);
    const timer = countdownLabel
      ? `<strong data-rating-countdown="${escapeHtml(game.ratingWindowEndsAt)}">${escapeHtml(countdownLabel)}</strong>`
      : '';

    if (!game.viewerIsParticipant) {
      return `
        <section class="notice-banner notice-banner--rating-live notice-banner--rating-viewer">
          <div class="rating-live-main">
            <p>Оценка для участников стартовала</p>
            ${timer}
          </div>
        </section>
      `;
    }

    const draft = getQuickRatingDraft(game);
    const remainingPoints = Math.max(0, Number(game.quickRatingPoints ?? QUICK_RATING_POINTS) - getQuickRatingPointsUsed(draft));
    const ratedCount = Math.max(0, Math.round(Number(game.quickRatersCount ?? 0)));

    return `
      <section class="notice-banner notice-banner--rating-live">
        <div class="rating-live-main">
          <p>Раздай до ${escapeHtml(game.quickRatingPoints ?? QUICK_RATING_POINTS)} очков и выбери MVP</p>
          ${timer}
        </div>
        <div class="rating-live-chips">
          <span>${escapeHtml(remainingPoints)} ${escapeHtml(getPlural(remainingPoints, ['очко', 'очка', 'очков']))} осталось</span>
          ${
            ratedCount
              ? `<span>${escapeHtml(ratedCount)} уже ${escapeHtml(ratedCount === 1 ? 'оценил' : 'оценили')}</span>`
              : ''
          }
        </div>
      </section>
    `;
  }

  if (game.hasStarted && !game.ratingWindowOpen) {
    return '';
  }

  let message = 'Оцените игроков после начала игры';

  if (game.hasStarted && !game.viewerIsParticipant) {
    message = 'Оценивать могут только участники текущего матча.';
  }

  return `
    <section class="notice-banner">
      <p>${escapeHtml(message)}</p>
    </section>
  `;
}

function renderQuickRatingMvpButton(player, game, draft) {
  const selected = draft.mvpPlayerId === player.id;

  return `
    <button
      type="button"
      class="quick-mvp-chip ${selected ? 'is-selected' : ''}"
      data-quick-mvp="${escapeHtml(player.id)}"
      data-game-id="${escapeHtml(game.id)}"
    >
      <span class="quick-mvp-avatar">${renderMiniAvatar(player)}</span>
      <span>${escapeHtml(player.displayName)}</span>
    </button>
  `;
}

function getQuickRatingTargets(game) {
  return (game.participants ?? []).filter((player) => player.canRateTarget);
}

function renderQuickPlayerSelect(game, selectedPlayerId, attributes = '') {
  const targets = getQuickRatingTargets(game);

  return `
    <select ${attributes}>
      <option value="">не выбран</option>
      ${targets
        .map((player) => `
          <option value="${escapeHtml(player.id)}" ${selectedPlayerId === player.id ? 'selected' : ''}>
            ${escapeHtml(player.displayName)}
          </option>
        `)
        .join('')}
    </select>
  `;
}

function renderQuickAchievementInfoButton(achievementKey) {
  const achievement = QUICK_ACHIEVEMENT_BY_KEY[achievementKey];

  if (!achievement) {
    return '';
  }

  return `
    <button
      type="button"
      class="achievement-info-button"
      data-achievement-detail="${escapeHtml(achievement.key)}"
      aria-label="${escapeHtml(achievement.title)}"
    >i</button>
  `;
}

function renderQuickSelectField({ label, valueLabel, selectHtml }) {
  return `
    <label class="quick-select-field">
      <span>${escapeHtml(label)}</span>
      <div class="quick-select-control">
        ${selectHtml}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6.7 8.8a1 1 0 0 1 1.4 0L12 12.7l3.9-3.9a1 1 0 1 1 1.4 1.4l-4.6 4.6a1 1 0 0 1-1.4 0L6.7 10.2a1 1 0 0 1 0-1.4z"></path>
        </svg>
      </div>
      ${valueLabel ? `<strong>${escapeHtml(valueLabel)}</strong>` : ''}
    </label>
  `;
}

function renderQuickAchievementField(game, draft, achievementKey) {
  const achievement = QUICK_ACHIEVEMENT_BY_KEY[achievementKey];

  if (!achievement) {
    return '';
  }

  const selectedPlayerId = getQuickAchievementTarget(draft, achievementKey);

  return renderQuickSelectField({
    label: achievement.title,
    achievementKey,
    selectHtml: renderQuickPlayerSelect(
      game,
      selectedPlayerId,
      `data-quick-achievement-target="${escapeHtml(achievementKey)}" data-game-id="${escapeHtml(game.id)}"`
    )
  });
}

function renderQuickAchievementPicker(game, draft) {
  if (!draft.achievementPickerOpen) {
    return '';
  }

  const usedKeys = new Set(normalizeQuickAchievements(draft.achievements).map((achievement) => achievement.achievementKey));
  const achievements = QUICK_SELECTABLE_ACHIEVEMENTS.filter((achievement) => !usedKeys.has(achievement.key));
  const groupedAchievements = achievements.reduce((groups, achievement) => {
    const category = achievement.category || 'другое';
    groups.set(category, [...(groups.get(category) || []), achievement]);
    return groups;
  }, new Map());

  return `
    <div class="quick-achievement-picker">
      ${Array.from(groupedAchievements.entries())
        .map(([category, items]) => `
          <div class="quick-achievement-group">
            <span>${escapeHtml(category)}</span>
            ${items
              .map((achievement) => `
                <div class="quick-achievement-option">
                  <button
                    type="button"
                    data-add-quick-achievement="${escapeHtml(achievement.key)}"
                    data-game-id="${escapeHtml(game.id)}"
                  >
                    ${escapeHtml(achievement.title)}
                  </button>
                  ${renderQuickAchievementInfoButton(achievement.key)}
                </div>
              `)
              .join('')}
          </div>
        `)
        .join('')}
    </div>
  `;
}

function renderQuickAchievementFields(game, draft) {
  const selectedAchievements = normalizeQuickAchievements(draft.achievements);
  const extraAchievementKeys = selectedAchievements
    .map((achievement) => achievement.achievementKey)
    .filter((key) => key !== 'goleador');
  const showGoleador = Boolean(draft.mvpPlayerId || getQuickAchievementTarget(draft, 'goleador') || extraAchievementKeys.length);
  const showExtra = Boolean(showGoleador && getQuickAchievementTarget(draft, 'goleador'));

  return `
    <section class="panel quick-rating-panel quick-rating-panel--simple ${draft.achievementPickerOpen ? 'is-picker-open' : ''}">
      <h2>Оценка</h2>
      <div class="quick-rating-fields">
        ${renderQuickSelectField({
          label: 'MVP',
          achievementKey: 'mvp',
          selectHtml: renderQuickPlayerSelect(
            game,
            draft.mvpPlayerId,
            `data-quick-mvp-select data-game-id="${escapeHtml(game.id)}"`
          )
        })}
        ${showGoleador ? renderQuickAchievementField(game, draft, 'goleador') : ''}
        ${
          showExtra
            ? `
              ${extraAchievementKeys.map((key) => renderQuickAchievementField(game, draft, key)).join('')}
              <div class="quick-add-achievement-wrap ${draft.achievementPickerOpen ? 'is-open' : ''}">
                <button type="button" class="quick-add-achievement" data-toggle-quick-achievements="${escapeHtml(game.id)}">
                  Добавить
                </button>
                ${renderQuickAchievementPicker(game, draft)}
              </div>
            `
          : ''
        }
      </div>
    </section>
  `;
}

function renderQuickFloatingSave(game) {
  if (!game?.canViewerRate) {
    return '';
  }

  return `
    <div class="quick-floating-save">
      <button type="button" class="primary-button" data-submit-quick-rating="${escapeHtml(game.id)}">Сохранить</button>
    </div>
  `;
}

function renderQuickStatControls(player, game, draft) {
  const used = getQuickRatingPointsUsed(draft);
  const remaining = Math.max(0, QUICK_RATING_POINTS - used);
  const statMeta = getStatMetaForPosition(player.currentGameStats?.position || player.position || 'N/A');

  return `
    <div class="quick-stat-grid">
      ${statMeta
        .map(([key, label]) => {
          const points = getQuickBoostPoints(draft, player.id, key);
          const disabled = remaining <= 0 && points <= 0;

          return `
            <div class="quick-stat-chip ${points ? 'is-active' : ''}">
              <button
                type="button"
                data-quick-boost-remove="${escapeHtml(player.id)}"
                data-quick-boost-stat="${escapeHtml(key)}"
                data-game-id="${escapeHtml(game.id)}"
                ${points ? '' : 'disabled'}
                aria-label="Убрать очко ${escapeHtml(label)}"
              >−</button>
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(points ? `+${points}` : '+')}</strong>
              <button
                type="button"
                data-quick-boost-add="${escapeHtml(player.id)}"
                data-quick-boost-stat="${escapeHtml(key)}"
                data-game-id="${escapeHtml(game.id)}"
                ${disabled ? 'disabled' : ''}
                aria-label="Добавить очко ${escapeHtml(label)}"
              >+</button>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function getPlayerDraftAchievements(player, game, draft) {
  const achievements = normalizeQuickAchievements(draft?.achievements)
    .filter((achievement) => achievement.targetPlayerId === player.id)
    .map((achievement) => ({
      key: achievement.achievementKey,
      count: 1,
      source: 'draft'
    }));

  if (!game?.ratingWindowOpen && game?.mvp?.playerId === player.id) {
    achievements.push({ key: 'mvp', count: 1, source: 'result' });
  }

  const counts = player.currentGameStats?.achievementCounts ?? {};

  for (const [key, count] of Object.entries(counts)) {
    if (key === 'mvp' && game?.ratingWindowOpen) {
      continue;
    }

    if (!achievements.some((achievement) => achievement.key === key)) {
      achievements.push({ key, count, source: 'result' });
    }
  }

  return achievements;
}

function getUnlockedPlayerAchievements(player, currentStats = null) {
  const counts = {
    ...(player.achievementCounts ?? {}),
    ...(currentStats?.achievementCounts ?? {})
  };

  return Object.entries(counts)
    .map(([key, count]) => ({
      key,
      count: Math.max(0, Math.round(Number(count ?? 0))),
      source: 'career'
    }))
    .filter((achievement) => achievement.count > 0 && QUICK_ACHIEVEMENT_BY_KEY[achievement.key])
    .sort((left, right) => {
      const leftIndex = QUICK_ACHIEVEMENTS.findIndex((achievement) => achievement.key === left.key);
      const rightIndex = QUICK_ACHIEVEMENTS.findIndex((achievement) => achievement.key === right.key);
      return leftIndex - rightIndex;
    });
}

function getAchievementsTotalCount(achievements) {
  return achievements.reduce((total, achievement) => (
    total + Math.max(0, Math.round(Number(achievement.count ?? 0)))
  ), 0);
}

function renderAchievementTitle(achievements) {
  const total = getAchievementsTotalCount(achievements);

  return `
    <div class="achievement-section-title">
      <span>Достижения</span>
      ${total > 1 ? `<strong>${escapeHtml(total)}</strong>` : ''}
    </div>
  `;
}

function renderAchievementPills(achievements, options = {}) {
  if (!achievements.length) {
    return '';
  }

  return `
    <div class="quick-achievements">
      ${options.title ? renderAchievementTitle(achievements) : ''}
      <div class="quick-achievement-pills">
        ${achievements
          .map((achievement) => {
            const meta = QUICK_ACHIEVEMENT_BY_KEY[achievement.key];

            if (!meta) {
              return '';
            }

            return `
              <button type="button" class="quick-achievement-pill" data-achievement-detail="${escapeHtml(meta.key)}">
                ${renderAchievementIcon(meta.key)}
                ${achievement.count > 1 ? `<span>${escapeHtml(achievement.count)}</span>` : ''}
              </button>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}

function renderQuickPlayerStatControl(player, game, draft, key, label) {
  const points = getQuickBoostPoints(draft, player.id, key);
  const used = getQuickRatingPointsUsed(draft);
  const remaining = Math.max(0, QUICK_RATING_POINTS - used);
  const disabled = remaining <= 0 && points <= 0;
  const currentStats = player.currentGameStats ?? null;
  const statValue = currentStats?.hasRatings
    ? currentStats.stats?.[key]
    : player.ratedGames > 0 || player.hasSelfProfile
      ? player.stats?.[key]
      : null;

  return `
    <div class="quick-card-stat ${points ? 'is-active' : ''}">
      <button
        type="button"
        data-quick-boost-remove="${escapeHtml(player.id)}"
        data-quick-boost-stat="${escapeHtml(key)}"
        data-game-id="${escapeHtml(game.id)}"
        ${points ? '' : 'disabled'}
        aria-label="Убрать очко ${escapeHtml(label)}"
      >−</button>
      <span>${escapeHtml(label.toLowerCase())}</span>
      <strong>
        ${statValue ? escapeHtml(Math.round(Number(statValue))) : '-'}
        ${points ? `<em>+${escapeHtml(points)}</em>` : ''}
      </strong>
      <button
        type="button"
        data-quick-boost-add="${escapeHtml(player.id)}"
        data-quick-boost-stat="${escapeHtml(key)}"
        data-game-id="${escapeHtml(game.id)}"
        ${disabled ? 'disabled' : ''}
        aria-label="Добавить очко ${escapeHtml(label)}"
      >+</button>
    </div>
  `;
}

function renderQuickGamePlayerCard(player, game, draft) {
  const ratingState = getGamePlayerRatingState(player, game);
  const currentStats = player.currentGameStats ?? null;
  const ratingLabel = ratingState.hasMatchRating
    ? ratingState.rating
    : game?.ratingWindowOpen
      ? ''
      : player.ratedGames > 0
        ? Math.round(Number(player.overall))
        : '';
  const positionLabel = getGamePlayerPositionLabel(player);
  const statMeta = getStatMetaForPosition(currentStats?.position || player.position || 'N/A');

  return `
    <article class="quick-game-card ${ratingState.phase === 'live-empty' ? 'is-unrated' : ''}">
      <div class="quick-game-card-head is-clickable" data-scroll-player="${escapeHtml(player.id)}">
        <div class="game-player-avatar">${renderMiniAvatar(player)}</div>
        <div class="quick-game-card-title">
          <strong>${escapeHtml(player.displayName)}</strong>
          <span>${escapeHtml(positionLabel)}</span>
        </div>
        ${
          ratingLabel
            ? renderRatingValue(ratingLabel, currentStats?.ratingDelta, 'quick-game-card-rating')
            : `<div class="game-player-unrated">${escapeHtml(getEmptyPlayerStatusLabel(player, game))}</div>`
        }
      </div>
      <div class="quick-card-grid">
        ${statMeta.map(([key, label]) => renderQuickPlayerStatControl(player, game, draft, key, label)).join('')}
      </div>
    </article>
  `;
}

function renderQuickRatingPanel(game) {
  if (!game.canViewerRate) {
    return '';
  }

  const targets = game.participants.filter((player) => player.canRateTarget);

  if (!targets.length) {
    return '';
  }

  const draft = getQuickRatingDraft(game);

  return renderQuickAchievementFields(game, draft);
}

function renderField(game, options = {}) {
  const participants = game.participants ?? [];
  const teams = splitBalancedTeams(participants);
  const emptyMessage = !participants.length ? options.emptyMessage : '';

  return `
    <section class="panel field-panel ${options.className ? escapeHtml(options.className) : ''}">
      <div class="field">
        <div class="field-line mid"></div>
        <div class="field-circle"></div>
        <div class="field-box top"></div>
        <div class="field-box bottom"></div>
        ${emptyMessage ? `<div class="field-empty">${escapeHtml(emptyMessage)}</div>` : ''}
        ${teams
          .map((team) => {
            const assignments = buildTeamFieldAssignments(team.players, team.key);
            return `
              <div class="field-team field-team--${escapeHtml(team.key)}">
                ${assignments
                  .map(({ player, slot }) => {
                    const isInteractive = Boolean(player.canRateTarget);
                    const openAttribute = isInteractive ? `data-open-player="${escapeHtml(player.id)}"` : '';
                    const ratingLabel = getGameMiniCardRatingLabel(player, game);
                    return `
                      <button
                        type="button"
                        class="field-player-card ${isInteractive ? '' : 'field-player-card--static'}"
                        ${openAttribute}
                        style="left:${slot.x}%; top:${slot.y}%"
                      >
                        <div class="field-player-photo">${renderMiniAvatar(player)}</div>
                        <div class="field-player-info">
                          ${ratingLabel ? `<strong>${escapeHtml(ratingLabel)}</strong>` : ''}
                          <span>${escapeHtml(player.displayName.split(' ')[0])}</span>
                        </div>
                      </button>
                    `;
                  })
                  .join('')}
              </div>
            `;
          })
          .join('')}
      </div>
    </section>
  `;
}

function renderGamePlayerRow(player) {
  const game = getCurrentGame();
  const positionLabel = getGamePlayerPositionLabel(player);

  return `
    <article class="game-player-row is-clickable" data-scroll-player="${escapeHtml(player.id)}">
      <div class="game-player-avatar">${renderMiniAvatar(player)}</div>
      <div class="game-player-main">
        <strong>${escapeHtml(player.displayName)}</strong>
        <span>${escapeHtml(positionLabel)}</span>
        ${renderDisciplineCards(player.currentGameStats, 'game-player-cards')}
      </div>
      ${renderGamePlayerState(player, game)}
    </article>
  `;
}

function renderJoinRequestCard(player, game) {
  const rating = getPlayerOverallLabel(player);
  const positionLabel = getPositionMeta(player.position || 'N/A').short;
  const statusBadge = isPlayerCardUnfilled(player)
    ? 'Не заполнен'
    : rating
      ? ''
      : getEmptyPlayerStatusLabel(player, game);
  const actions = [
    player.canViewerAcceptInvite
      ? `<button type="button" class="primary-button join-request-action" data-accept-game-invite="${escapeHtml(game.id)}">Принять</button>`
      : '',
    player.canViewerDeclineInvite
      ? `<button type="button" class="ghost-action join-request-action" data-decline-game-invite="${escapeHtml(game.id)}">Отклонить</button>`
      : '',
    player.canViewerApproveJoin
      ? `<button type="button" class="primary-button join-request-action" data-approve-join-player="${escapeHtml(player.id)}" data-game-id="${escapeHtml(game.id)}">Добавить</button>`
      : '',
    player.canViewerCancelJoin
      ? `<button type="button" class="ghost-action join-request-action" data-cancel-join-request="${escapeHtml(game.id)}" data-cancel-join-player="${escapeHtml(player.id)}">Отменить</button>`
      : ''
  ].filter(Boolean);
  const actionClass = actions.length === 1 ? 'join-request-actions join-request-actions--single' : 'join-request-actions';

  return `
    <article class="game-player-row join-request-card ${actions.length ? 'join-request-card--with-actions' : ''} is-clickable" data-scroll-player="${escapeHtml(player.id)}">
      <div class="game-player-avatar">${renderMiniAvatar(player)}</div>
      <div class="game-player-main">
        <strong>${escapeHtml(player.displayName)}</strong>
        <span>${escapeHtml(positionLabel === '—' ? 'Нет позиции' : positionLabel)}</span>
      </div>
      <div class="join-request-meta">
        ${rating ? renderRatingValue(rating, player.ratingDelta, 'game-player-rating') : ''}
        ${statusBadge ? `<span class="game-player-unrated">${escapeHtml(statusBadge)}</span>` : ''}
      </div>
      ${actions.length ? `<div class="${actionClass}">${actions.join('')}</div>` : ''}
    </article>
  `;
}

function renderJoinControls(game) {
  if (game.viewerJoinStatus === 'pending' || game.viewerJoinStatus === 'invited') {
    return '';
  }

  if (!game.canViewerRequestJoin) {
    return '';
  }

  return `
    <section class="join-cta">
      <button type="button" class="primary-button join-cta-button" data-join-game="${escapeHtml(game.id)}">Присоединиться</button>
    </section>
  `;
}

function getWaitingPlayers(game) {
  const invitedPlayers = game.invitedPlayers ?? [];
  const pendingPlayers = game.pendingJoinPlayers ?? [];

  return [
    ...invitedPlayers,
    ...(game.canViewerManage
      ? pendingPlayers
      : pendingPlayers.filter((player) => player.canViewerCancelJoin))
  ];
}

function renderGamePlayersList(game) {
  const players = game.participants ?? [];

  if (!players.length) {
    return '';
  }

  if (game.ratingWindowOpen && game.canViewerRate) {
    const draft = getQuickRatingDraft(game);

    return `
      <section class="quick-game-cards">
        ${players
          .filter((player) => player.id !== state.snapshot?.viewerPlayerId)
          .map((player) => renderQuickGamePlayerCard(player, game, draft))
          .join('')}
      </section>
    `;
  }

  return `
    <section class="game-player-list">
      ${players.map((player) => renderGamePlayerRow(player)).join('')}
    </section>
  `;
}

function renderWaitingPlayersSection(game) {
  const waitingPlayers = getWaitingPlayers(game);
  const ratingIsClosed = Boolean(game.hasStarted && !game.ratingWindowOpen);

  if (ratingIsClosed || !waitingPlayers.length) {
    return '';
  }

  return `
    <section class="join-requests-panel">
      <div class="join-requests-head">
        <h3>Ожидают</h3>
      </div>
      <div class="join-requests-list">
        ${waitingPlayers.map((player) => renderJoinRequestCard(player, game)).join('')}
      </div>
    </section>
  `;
}

function renderGameTab() {
  const game = getCurrentGame();

  if (!game) {
    return `
      <section class="empty-state">
        <h2>Пока нет игр</h2>
        <p>Как только бот увидит сообщение с датой, местом, временем и списком отмеченных игроков, здесь появится текущий матч.</p>
      </section>
    `;
  }

  const isRatingMode = Boolean(game.ratingWindowOpen && game.canViewerRate);

  return `
    ${renderGameHeader(game)}
    ${renderRatingBanner(game)}
    ${isRatingMode ? renderQuickRatingPanel(game) : ''}
    ${isRatingMode ? '' : renderJoinControls(game)}
    ${isRatingMode ? '' : renderField(game)}
    ${renderGamePlayersList(game)}
    ${isRatingMode ? '' : renderWaitingPlayersSection(game)}
    ${isRatingMode ? '' : renderQuickRatingPanel(game)}
    ${isRatingMode ? renderQuickFloatingSave(game) : ''}
  `;
}

function getGameStatusLabel(status) {
  if (status === 'upcoming') {
    return 'Скоро игра';
  }

  return status === 'live' ? 'Игра идет' : 'Игра закончена';
}

function getGameLevelMeta(averageOverall) {
  const rating = Number(averageOverall);

  if (!Number.isFinite(rating) || rating <= 0) {
    return null;
  }

  if (rating < 55) {
    return { label: 'Низкий', tone: 'low', rating: Math.round(rating) };
  }

  if (rating < 70) {
    return { label: 'Средний', tone: 'mid', rating: Math.round(rating) };
  }

  return { label: 'Высокий', tone: 'high', rating: Math.round(rating) };
}

function renderGameLevelBadges(averageOverall) {
  const level = getGameLevelMeta(averageOverall);

  if (!level) {
    return '';
  }

  return `
      <span class="game-level-badges">
        <span class="game-level-badge game-level-badge--${escapeHtml(level.tone)}">${escapeHtml(level.label)}</span>
      <span class="game-level-badge game-level-rating">${escapeHtml(level.rating)}</span>
    </span>
  `;
}

function getFilteredGames() {
  return getGames().filter((game) => {
    if (state.gamesFilter === 'mine') {
      return Boolean(game.viewerIsParticipant || game.viewerIsOrganizer);
    }

    if (state.gamesFilter === 'current') {
      return game.status === 'upcoming' || game.status === 'live';
    }

    if (state.gamesFilter === 'finished') {
      return game.status === 'finished';
    }

    return true;
  });
}

function renderGamesFilterBar() {
  return `
    <div class="filter-row games-filter-row">
      ${GAME_FILTERS.map(
        (filter) => `
          <button type="button" class="chip ${state.gamesFilter === filter.key ? 'active' : ''}" data-games-filter="${escapeHtml(filter.key)}">
            ${escapeHtml(filter.label)}
          </button>
        `
      ).join('')}
    </div>
  `;
}

function renderGameCard(game) {
  const isOpenable = true;
  const openAttribute = ` data-open-game="${escapeHtml(game.id)}"`;
  const mvpBadges = game.mvp
    ? `
      <span class="game-level-badges game-mvp-badges">
        <span class="game-level-badge game-level-badge--mid">${escapeHtml(game.mvp.displayName)}</span>
      </span>
    `
    : '';
  const gameLevelBadges = renderGameLevelBadges(game.averageOverall);

  return `
    <article class="game-card ${isOpenable ? 'game-card--openable' : ''}"${openAttribute}>
      <div class="game-card-head">
        <div>
          <h2>${escapeHtml(getGameDateShort(game.dateLabel))}</h2>
          <p>${escapeHtml(game.time)}</p>
        </div>
        <span class="status-pill ${escapeHtml(game.status)}">${escapeHtml(getGameStatusLabel(game.status))}</span>
      </div>
      <p class="game-card-location">${escapeHtml(game.location || 'Не указано')}</p>
      <div class="game-card-stats">
        ${
          game.status !== 'upcoming' && mvpBadges
            ? `
              <div>
                <span>MVP</span>
                <strong class="game-card-badges-value">${mvpBadges}</strong>
              </div>
            `
            : ''
        }
        ${
          gameLevelBadges
            ? `
              <div>
                <span>Уровень игры</span>
                <strong class="game-card-badges-value">${gameLevelBadges}</strong>
              </div>
            `
            : ''
        }
        ${
          hasDisciplineCards(game.cards)
            ? `
              <div>
                <span>Карточки</span>
                <strong class="game-card-cards">${renderDisciplineCards(game.cards, 'game-summary-cards')}</strong>
              </div>
            `
            : ''
        }
        <div>
          <span>Игроков</span>
          <strong>${escapeHtml(game.playersCount)}</strong>
        </div>
      </div>
    </article>
  `;
}

function toDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function ensureManualGameDraftDefaults() {
  if (!state.manualGameDraft.date) {
    state.manualGameDraft.date = toDateInputValue(new Date());
  }

  if (!state.manualGameDraft.time) {
    state.manualGameDraft.time = '19:30';
  }
}

function getManualSelectedPlayers() {
  const selectedIds = new Set(state.manualGameDraft.playerIds);
  return getAvailablePlayers().filter((player) => selectedIds.has(player.id));
}

function getManualFilteredPlayers() {
  const query = normalizeUsername(state.manualPlayerSearch).replace(/\s+/g, '');
  const selectedIds = new Set(state.manualGameDraft.playerIds);
  const availablePlayers = getAvailablePlayers().filter((player) => !selectedIds.has(player.id));

  if (!query) {
    return availablePlayers;
  }

  return availablePlayers.filter((player) => {
    const username = normalizeUsername(player.username);
    const displayName = normalizeUsername(player.displayName).replace(/\s+/g, '');
    return username.includes(query) || displayName.includes(query);
  });
}

function renderManualPlayerCard(player) {
  const rating = getPlayerOverallLabel(player);
  const position = getPositionMeta(player.position).short;

  return `
    <button
      type="button"
      class="manual-player-card"
      data-add-manual-player="${escapeHtml(player.id)}"
    >
      <span class="game-player-avatar">${renderMiniAvatar(player)}</span>
      <span class="manual-player-info">
        <strong>${escapeHtml(player.displayName)}</strong>
        <small>@${escapeHtml(player.username || 'unknown')}</small>
      </span>
      <span class="manual-player-meta">
        ${rating ? `<strong>${escapeHtml(rating)}</strong>` : ''}
        <small>${escapeHtml(position === '—' ? 'позиция?' : position)}</small>
      </span>
    </button>
  `;
}

function renderManualSelectedPlayers() {
  const selectedPlayers = getManualSelectedPlayers();

  if (!selectedPlayers.length) {
    return '<p class="manual-selected-empty">Выбранные игроки появятся здесь.</p>';
  }

  return `
    <div class="manual-selected-row">
      ${selectedPlayers
        .map((player) => `
          <button type="button" class="manual-selected-chip" data-remove-manual-player="${escapeHtml(player.id)}">
            <span>${escapeHtml(player.displayName)}</span>
            <strong>×</strong>
          </button>
        `)
        .join('')}
    </div>
  `;
}

function renderManualPlayerPicker() {
  if (!state.manualPlayerPickerOpen) {
    return '';
  }

  const players = getManualFilteredPlayers();

  return `
    <section class="manual-player-picker" aria-label="Выбор игроков">
      ${
        players.length
          ? players.map((player) => renderManualPlayerCard(player)).join('')
          : '<p class="achievement-empty">Никого не нашли. Попробуйте другой запрос.</p>'
      }
    </section>
  `;
}

function refreshManualPlayerPicker() {
  const picker = document.querySelector('.manual-player-picker');

  if (!picker) {
    return;
  }

  const players = getManualFilteredPlayers();
  picker.innerHTML = players.length
    ? players.map((player) => renderManualPlayerCard(player)).join('')
    : '<p class="achievement-empty">Никого не нашли. Попробуйте другой запрос.</p>';
}

function renderManualFieldPreview() {
  const selectedPlayers = getManualSelectedPlayers();

  return renderField({
    participants: selectedPlayers.map((player) => ({
      ...player,
      canRateTarget: false,
      currentGameStats: null
    }))
  }, {
    className: 'manual-field-panel',
    emptyMessage: 'Добавьте игроков, и здесь появится баланс команд и расстановка по позициям.'
  });
}

function readManualGameForm(form) {
  const formData = new FormData(form);

  return {
    date: String(formData.get('date') || ''),
    time: String(formData.get('time') || ''),
    location: String(formData.get('location') || '').trim(),
    playerIds: [...state.manualGameDraft.playerIds]
  };
}

function saveManualGameDraft(form) {
  if (!form) {
    return;
  }

  state.manualGameDraft = {
    ...state.manualGameDraft,
    ...readManualGameForm(form)
  };
}

function renderCreateGameModal() {
  if (state.manualGameConfirm) {
    return `
      <div class="modal-backdrop modal-backdrop--center" data-create-backdrop="true">
        <section class="modal-card confirm-card" role="dialog" aria-modal="true" aria-label="Сообщить игрокам">
          <button class="modal-close" type="button" data-close-create-game="true">×</button>
          <h2>Сообщить игрокам об игре?</h2>
          <p>Игроки, которые запускали бота, смогут подтвердить участие.</p>
          <div class="confirm-actions">
            <button type="button" class="primary-button" data-create-game-confirm="yes">Да</button>
            <button type="button" class="ghost-action" data-create-game-confirm="skip">Пропустить</button>
          </div>
        </section>
      </div>
    `;
  }

  return '';
}

function renderCreateGameScreen() {
  if (!state.manualGameOpen) {
    return '';
  }

  ensureManualGameDraftDefaults();
  const isEditing = state.manualGameMode === 'edit';

  return `
    <section class="create-game-screen" aria-label="${isEditing ? 'Редактировать игру' : 'Новая игра'}">
      <header class="create-game-header">
        <h2>${isEditing ? 'Редактировать игру' : 'Новая игра'}</h2>
        <button class="create-game-close" type="button" data-close-create-game="true" aria-label="Закрыть">×</button>
      </header>
      <form id="manualGameForm" class="manual-game-form">
        <section class="panel create-game-details">
          <div class="game-summary">
            <div>
              <h2>Детали игры</h2>
            </div>
          </div>
          <div class="manual-fields">
            <label>
              <span>Дата</span>
              <input type="date" name="date" value="${escapeHtml(state.manualGameDraft.date)}" required>
            </label>
            <label>
              <span>Время</span>
              <input type="time" name="time" value="${escapeHtml(state.manualGameDraft.time)}" required>
            </label>
            <label class="manual-field-wide">
              <span>Место</span>
              <input type="text" name="location" value="${escapeHtml(state.manualGameDraft.location)}" placeholder="Например: Сокольники, поле 10" required>
            </label>
          </div>
        </section>
        <section class="panel manual-player-panel">
          <div class="manual-section-title">
            <h3>Игроки</h3>
            <span>${escapeHtml(state.manualGameDraft.playerIds.length)} выбрано</span>
          </div>
          <div class="manual-player-search-wrap">
            <input
              type="search"
              class="manual-player-search"
              name="playerSearch"
              value="${escapeHtml(state.manualPlayerSearch)}"
              placeholder="Поиск по имени или @нику"
              autocomplete="off"
              data-manual-player-search="true"
            >
            ${renderManualPlayerPicker()}
          </div>
          ${renderManualSelectedPlayers()}
        </section>
        ${renderManualFieldPreview()}
        <button type="submit" class="primary-button card-action manual-submit">${isEditing ? 'Сохранить' : 'Создать'}</button>
      </form>
    </section>
  `;
}

function renderGameActionsModal() {
  const game = getCurrentGame();

  if (!state.gameActionsOpen || !game) {
    return '';
  }

  return `
    <div class="modal-backdrop modal-backdrop--compact" data-game-actions-backdrop="true">
      <section class="modal-card game-actions-card" role="dialog" aria-modal="true" aria-label="Действия с игрой">
        <h2>Действия</h2>
        <button type="button" class="game-action-button" data-share-game="true">Пошерить игру</button>
        ${
          game.canViewerManage
            ? `
              <button type="button" class="game-action-button" data-edit-game="true">Редактировать</button>
              <button type="button" class="game-action-button game-action-button--danger" data-delete-game="true">Удалить игру</button>
            `
            : ''
        }
      </section>
    </div>
  `;
}

function renderProfileActionsModal() {
  if (!state.profileActionsOpen) {
    return '';
  }

  return `
    <div class="modal-backdrop modal-backdrop--compact" data-profile-actions-backdrop="true">
      <section class="modal-card profile-actions-card" role="dialog" aria-modal="true" aria-label="Настройки профиля">
        <h2>Настройки</h2>
        <button type="button" class="game-action-button" data-share-profile="true">Пошерить карточку</button>
        <button type="button" class="game-action-button" data-edit-self-profile="true">Редактировать</button>
      </section>
    </div>
  `;
}

function renderAchievementDetailModal() {
  const achievement = QUICK_ACHIEVEMENT_BY_KEY[state.achievementDetailKey];

  if (!achievement) {
    return '';
  }

  return `
    <div class="modal-backdrop modal-backdrop--center" data-achievement-detail-backdrop="true">
      <section class="modal-card achievement-detail-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(achievement.title)}">
        <button type="button" class="editor-close achievement-detail-close" data-close-achievement-detail="true">×</button>
        <div class="achievement-detail-icon">${renderAchievementIcon(achievement.key)}</div>
        <h2>${escapeHtml(achievement.title)}</h2>
        <p>${escapeHtml(achievement.description)}</p>
      </section>
    </div>
  `;
}

function shouldShowSelfProfilePrompt() {
  const player = getViewerPlayer();

  return Boolean(
    player &&
    state.selfProfilePromptDismissedFor !== player.id &&
    isPlayerCardUnfilled(player) &&
    !state.selfProfileEditing &&
    !state.manualGameOpen &&
    !state.selectedPlayerId &&
    !state.achievementDetailKey &&
    !state.profileActionsOpen
  );
}

function renderSelfProfilePromptModal() {
  if (!shouldShowSelfProfilePrompt()) {
    return '';
  }

  return `
    <div class="modal-backdrop modal-backdrop--center" data-self-profile-prompt-backdrop="true">
      <section class="modal-card self-profile-prompt" role="dialog" aria-modal="true" aria-label="Заполни карточку игрока">
        <button class="modal-close" type="button" data-dismiss-self-profile-prompt="true">×</button>
        <h2>Твоя карточка игрока не заполнена</h2>
        <p>Пройди самооценку, чтобы лучше подобрать игру и помочь командам распределяться честнее.</p>
        <button type="button" class="primary-button" data-start-self-profile="true">Пройти</button>
      </section>
    </div>
  `;
}

function renderGamesTab() {
  const games = getFilteredGames();

  return `
    ${renderGamesFilterBar()}
    ${
      games.length
        ? `<section class="stack games-stack">${games.map((game) => renderGameCard(game)).join('')}</section>`
        : `
          <section class="empty-state">
            <h2>Игр нет</h2>
            <p>В этом фильтре пока нет матчей.</p>
          </section>
        `
    }
    <button type="button" class="floating-create-button" data-open-create-game="true" aria-label="Создать игру">+</button>
  `;
}

function renderFilterBar() {
  return `
    <div class="filter-row">
      ${FILTER_CHIPS.map(
        (filter) => `
          <button type="button" class="chip ${state.activeSort === filter.key ? 'active' : ''}" data-sort="${escapeHtml(filter.key)}">
            ${escapeHtml(filter.label)}
          </button>
        `
      ).join('')}
      <label class="chip chip-select ${state.positionFilter ? 'active' : ''}">
        <select id="positionFilter">
          <option value="">Позиция</option>
          ${['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'ST', 'LW', 'RW']
            .map((position) => `<option value="${position}" ${state.positionFilter === position ? 'selected' : ''}>${escapeHtml(getPositionMeta(position).short)}</option>`)
            .join('')}
        </select>
      </label>
    </div>
  `;
}

function getFilteredPlayers() {
  const searchQuery = String(state.playerSearch || '').trim().toLowerCase();
  const positionFilteredPlayers = state.positionFilter
    ? getPlayers().filter((player) => player.position === state.positionFilter)
    : getPlayers();

  if (!searchQuery) {
    return sortPlayers(positionFilteredPlayers);
  }

  return sortPlayers(
    positionFilteredPlayers.filter((player) => {
      const searchable = [
        player.displayName,
        player.username ? `@${player.username}` : '',
        player.username
      ].filter(Boolean).join(' ').toLowerCase();

      return searchable.includes(searchQuery);
    })
  );
}

function renderPlayerSearch() {
  return `
    <div class="players-search-wrap" data-player-search-wrap>
      <label class="players-search-field">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10.7 4.2a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm5.2 9.1 3.4 3.4a1 1 0 0 1-1.4 1.4l-3.4-3.4a1 1 0 0 1 1.4-1.4Z"></path>
        </svg>
        <input
          type="search"
          data-player-search
          value="${escapeHtml(state.playerSearch)}"
          placeholder="Поиск по игрокам"
          autocomplete="off"
        >
        <button type="button" data-clear-player-search ${state.playerSearch ? '' : 'hidden'} aria-label="Очистить поиск">×</button>
      </label>
    </div>
  `;
}

function renderPlayersResults() {
  const players = getFilteredPlayers();

  if (!players.length) {
    return `
      <section class="empty-state players-empty" data-players-results>
        <h2>Никого не нашли</h2>
        <p>Попробуй другое имя или ник в Telegram.</p>
      </section>
    `;
  }

  return `
    <section class="stack cards-stack cards-stack--players" data-players-results>
      ${players.map((player) => renderFifaCard(player, { variant: 'player-list', clickable: false })).join('')}
    </section>
  `;
}

function refreshPlayersResults() {
  const resultsNode = document.querySelector('[data-players-results]');

  if (resultsNode) {
    resultsNode.outerHTML = renderPlayersResults();
  }

  const clearButton = document.querySelector('[data-clear-player-search]');
  if (clearButton) {
    clearButton.hidden = !state.playerSearch;
  }
}

function renderPlayersTab() {
  return `
    ${renderPlayerSearch()}
    ${renderFilterBar()}
    ${renderPlayersResults()}
  `;
}

function renderAchievementBall(cx, cy, radius = 12) {
  return `
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="currentColor" stroke-width="5"></circle>
    <path d="M${cx - radius * 0.5} ${cy}h${radius}M${cx} ${cy - radius * 0.5}v${radius}" stroke="currentColor" stroke-width="4" stroke-linecap="round"></path>
  `;
}

function renderAchievementIcon(type) {
  const assetIcons = {
    mvp: '/assets/achievements/mvp.svg',
    debutant: '/assets/achievements/debutant.svg',
    support: '/assets/achievements/support.svg',
    last_line: '/assets/achievements/last-line.svg',
    dark_horse: '/assets/achievements/dark-horse.svg',
    yard_elite: '/assets/achievements/yard-elite.svg',
    organizer: '/assets/achievements/organizer.svg'
  };
  const assetSrc = assetIcons[type];

  if (assetSrc) {
    return `
      <img
        class="achievement-icon achievement-icon--asset achievement-icon--${escapeHtml(type)}"
        src="${escapeHtml(assetSrc)}"
        alt=""
        aria-hidden="true"
        loading="lazy"
      >
    `;
  }

  const shapes = {
    crown: `<path class="achievement-icon-shape" d="M45 79 57 49l23 22 25-30 12 38H45Z"></path>`,
    goal: `<path class="achievement-icon-shape achievement-icon-stroke" d="M41 96V53h78v43M49 61h62M63 61v35M80 61v35M97 61v35"></path>`,
    balls: `${renderAchievementBall(80, 79, 22)}${renderAchievementBall(52, 57, 12)}${renderAchievementBall(108, 57, 12)}`,
    cards: `<rect class="achievement-icon-shape achievement-icon-stroke" x="48" y="45" width="33" height="45" rx="7" transform="rotate(-9 64 68)"></rect><rect class="achievement-icon-shape achievement-icon-stroke" x="80" y="45" width="33" height="45" rx="7" transform="rotate(9 96 68)"></rect>`,
    arrow: `<path class="achievement-icon-shape achievement-icon-stroke" d="M45 92a38 38 0 0 1 55-45M100 47V70h23"></path>`,
    target: `<circle class="achievement-icon-shape achievement-icon-stroke" cx="80" cy="73" r="34"></circle><circle class="achievement-icon-shape achievement-icon-stroke" cx="80" cy="73" r="18"></circle><path class="achievement-icon-shape achievement-icon-stroke" d="M80 39v68M46 73h68"></path>`,
    pass: `<path class="achievement-icon-shape achievement-icon-stroke" d="M44 92c25-28 48-41 76-44M102 40l18 8-13 16"></path>${renderAchievementBall(48, 96, 11)}`,
    network: `<circle class="achievement-icon-shape" cx="50" cy="62" r="9"></circle><circle class="achievement-icon-shape" cx="110" cy="62" r="9"></circle><circle class="achievement-icon-shape" cx="80" cy="97" r="9"></circle><path class="achievement-icon-shape achievement-icon-stroke" d="M58 67 72 90M102 67 88 90M60 62h40"></path>`,
    heart: `<path class="achievement-icon-shape" d="M80 103S49 85 49 63c0-12 8-20 19-20 6 0 10 3 12 7 2-4 6-7 12-7 11 0 19 8 19 20 0 22-31 40-31 40Z"></path>`,
    baton: `<path class="achievement-icon-shape achievement-icon-stroke" d="M48 101 103 46"></path><path class="achievement-icon-shape achievement-icon-stroke" d="M98 45c16 15 19 37 8 55M54 45c-14 17-14 38 0 55"></path>`,
    shield: `<path class="achievement-icon-shape" d="M80 39 116 54v28c0 24-15 40-36 49-21-9-36-25-36-49V54Z"></path>`,
    boot: `<path class="achievement-icon-shape" d="M43 85h39c17 0 26 7 35 18l-8 15H47c-12 0-18-9-14-20Z"></path><path class="achievement-icon-shape achievement-icon-cut" d="M62 85v18M82 85v18"></path>`,
    gloves: `<path class="achievement-icon-shape" d="M49 50c8 0 13 6 13 15v34H39V65c0-9 3-15 10-15ZM86 49c8 0 13 6 13 15v35H76V64c0-9 3-15 10-15ZM111 57c8 0 12 6 12 15v27h-20V72c0-9 2-15 8-15Z"></path>`,
    peace: `<circle class="achievement-icon-shape" cx="61" cy="80" r="16"></circle><circle class="achievement-icon-shape" cx="99" cy="80" r="16"></circle><path class="achievement-icon-shape achievement-icon-stroke" d="M50 108c19 14 41 14 60 0"></path>`,
    alert: `<path class="achievement-icon-shape" d="M80 39 122 113H38Z"></path><path class="achievement-icon-shape achievement-icon-cut" d="M80 62v28M80 103h.1"></path>`,
    spark: `<path class="achievement-icon-shape" d="M80 38 89 65l27 9-27 9-9 27-9-27-27-9 27-9Z"></path><path class="achievement-icon-shape achievement-icon-stroke" d="M107 42l14-14M48 112l-12 12"></path>`,
    post: `<path class="achievement-icon-shape achievement-icon-stroke" d="M105 38v82M51 38h54"></path>${renderAchievementBall(57, 64, 16)}`,
    shirt: `<path class="achievement-icon-shape" d="M50 54 68 43h24l18 11-12 20-8-5v54H70V69l-8 5Z"></path>`,
    calendar: `<rect class="achievement-icon-shape achievement-icon-stroke" x="43" y="48" width="74" height="66" rx="8"></rect><path class="achievement-icon-shape achievement-icon-stroke" d="M58 38v22M102 38v22M43 70h74"></path>`,
    pin: `<path class="achievement-icon-shape" d="M80 39c20 0 34 14 34 33 0 25-34 58-34 58S46 97 46 72c0-19 14-33 34-33Z"></path><circle class="achievement-icon-cut-fill" cx="80" cy="72" r="12"></circle>`,
    medal: `<circle class="achievement-icon-shape achievement-icon-stroke" cx="80" cy="82" r="30"></circle><path class="achievement-icon-shape achievement-icon-stroke" d="M62 37 80 58 98 37"></path>`,
    keeper: `<path class="achievement-icon-shape achievement-icon-stroke" d="M42 94V55h76v39M55 103c14-23 32-34 56-40"></path>${renderAchievementBall(112, 61, 11)}`,
    support: `<circle class="achievement-icon-shape" cx="55" cy="67" r="11"></circle><circle class="achievement-icon-shape" cx="105" cy="67" r="11"></circle><path class="achievement-icon-shape achievement-icon-stroke" d="M43 106c7-16 19-24 37-24s30 8 37 24M65 111l10 10 23-28"></path>`,
    clipboard: `<rect class="achievement-icon-shape achievement-icon-stroke" x="48" y="45" width="64" height="78" rx="8"></rect><path class="achievement-icon-shape" d="M66 38h28l5 16H61Z"></path><path class="achievement-icon-shape achievement-icon-stroke" d="M63 78h34M63 99h34"></path>`,
    chart: `<path class="achievement-icon-shape achievement-icon-stroke" d="M44 119h72M56 119V91M80 119V72M104 119V51M50 78c24-23 43-34 68-40M118 38v22H96"></path>`,
    horse: `<path class="achievement-icon-shape" d="M49 101c10-30 32-51 70-58l-13 22 18 14-29 8-7 28-18-17Z"></path>`,
    top: `<path class="achievement-icon-shape" d="M46 78 58 48l21 25 25-31 12 36Z"></path><path class="achievement-icon-shape achievement-icon-stroke" d="M50 105h60"></path>`,
    hidden: `<path class="achievement-icon-shape achievement-icon-stroke" d="M39 80c19-26 63-26 82 0-19 26-63 26-82 0Z"></path><circle class="achievement-icon-shape" cx="80" cy="80" r="14"></circle>`
  };
  const glyphs = {
    mvp: shapes.crown,
    goleador: shapes.goal,
    hat_trick: shapes.balls,
    pokerface: shapes.cards,
    comeback_maker: shapes.arrow,
    long_shot: shapes.target,
    assistant: shapes.pass,
    playmaker: shapes.network,
    unselfish: shapes.heart,
    conductor: shapes.baton,
    wall: shapes.shield,
    pickpocket: shapes.boot,
    cat: shapes.gloves,
    no_toxic: shapes.peace,
    maguire_day: shapes.alert,
    planned_it: shapes.spark,
    woodworker: shapes.post,
    debutant: shapes.shirt,
    stable_guy: shapes.calendar,
    local_guy: shapes.pin,
    yard_veteran: shapes.medal,
    last_line: shapes.keeper,
    support: shapes.support,
    organizer: shapes.clipboard,
    form_up: shapes.chart,
    dark_horse: shapes.horse,
    yard_elite: shapes.top,
    underrated: shapes.hidden
  };
  const icon = glyphs[type] || glyphs.mvp;

  return `
    <svg class="achievement-icon achievement-icon--${escapeHtml(type)}" viewBox="0 0 160 160" aria-hidden="true">
      <g class="achievement-icon-glyph">${icon}</g>
    </svg>
  `;
}

function formatAchievementCount(count) {
  return count === 1 ? '1 раз' : `${count} раз`;
}

function getPlayerAchievements(player) {
  const achievementCounts = player.achievementCounts ?? {};

  return QUICK_ACHIEVEMENTS.map((achievement) => ({
    ...achievement,
    count: achievementCounts[achievement.key] ?? 0,
    detail: achievementCounts[achievement.key]
      ? formatAchievementCount(achievementCounts[achievement.key])
      : 'ещё не получено'
  }));
}

function renderAchievementCard(achievement) {
  const tooltip = `${achievement.title}: ${achievement.description}. ${achievement.detail}`;

  return `
    <button
      type="button"
      class="achievement-button"
      data-achievement-detail="${escapeHtml(achievement.key)}"
      aria-label="${escapeHtml(tooltip)}"
    >
      ${renderAchievementIcon(achievement.key)}
      ${achievement.count > 1 ? `<span class="achievement-counter">${escapeHtml(achievement.count)}</span>` : ''}
      <span class="achievement-tooltip" role="tooltip">
        <strong>${escapeHtml(achievement.title)}</strong>
        <span>${escapeHtml(achievement.description)}</span>
        <small>${escapeHtml(achievement.detail)}</small>
      </span>
    </button>
  `;
}

function renderSelfProfileForm(player, defaults, options = {}) {
  const includeStats = options.includeStats !== false;
  const effectivePosition = defaults.position || 'N/A';

  return `
    <form id="selfProfileForm" class="profile-form">
      <label class="editor-select">
        <span>позиция</span>
        <select name="position">
          ${POSITION_CHOICES
            .map((position) => `
              <option value="${position}" ${effectivePosition === position ? 'selected' : ''}>
                ${escapeHtml(getPositionMeta(position).title)}
              </option>
            `)
            .join('')}
        </select>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6.7 8.8a1 1 0 0 1 1.4 0L12 12.7l3.9-3.9a1 1 0 1 1 1.4 1.4l-4.6 4.6a1 1 0 0 1-1.4 0L6.7 10.2a1 1 0 0 1 0-1.4z"></path>
        </svg>
      </label>
      ${
        includeStats
          ? `
            <div class="profile-stat-grid">
              ${getStatMetaForPosition(effectivePosition)
                .map(([key, label]) => renderSelfProfileStatStepper(key, label.toLowerCase(), defaults[key] ?? 50))
                .join('')}
            </div>
          `
          : ''
      }
      <div class="profile-floating-actions">
        <button type="submit" class="primary-button profile-submit">Сохранить</button>
        <button type="button" class="ghost-action profile-cancel" data-cancel-self-profile="true">Отменить</button>
      </div>
    </form>
  `;
}

function renderProfileTab() {
  const player = getViewerPlayer();

  if (!player) {
    return `
      <section class="empty-state">
        <h2>Профиль пока недоступен</h2>
        <p>Открой ⚽ из Telegram или войди через dev-вход, чтобы увидеть свою карточку игрока.</p>
      </section>
    `;
  }

  const hasCareerRatings = player.ratedGames > 0;
  const baseSelfProfileDefaults = {
    position: player.position || 'N/A',
    ...Object.fromEntries(STAT_META.map(([key]) => [key, player.stats?.[key] ?? 50]))
  };
  const selfProfileDefaults = state.selfProfileEditing && state.selfProfileDraft
    ? {
        ...baseSelfProfileDefaults,
        ...state.selfProfileDraft
      }
    : baseSelfProfileDefaults;
  const effectivePosition = selfProfileDefaults.position || 'N/A';
  const canEditOwnProfile = Boolean(state.token && state.snapshot?.viewerPlayerId === player.id);
  const isEditingSelfProfile = canEditOwnProfile && state.selfProfileEditing;
  const showProfileValues = hasCareerRatings || player.hasSelfProfile;
  const statMeta = getStatMetaForPosition(effectivePosition);
  const overviewCells = [
    { label: 'игр', value: player.games }
  ];
  if (hasDisciplineCards(player)) {
    overviewCells.push({
      label: 'карточки',
      value: renderDisciplineCards(player.cards || player, 'profile-cards-total'),
      html: true
    });
  }
  const statCells = statMeta.map(([key, label]) => [
    label.toLowerCase(),
    showProfileValues ? player.stats[key] : '-'
  ]);
  const achievements = getPlayerAchievements(player);
  const unlockedAchievements = achievements.filter((achievement) => achievement.count > 0);
  const profileStatusLabel = getCardStatusLabel(player);

  return `
    <section class="editor-screen profile-screen" aria-label="Профиль игрока">
      <div class="editor-hero profile-hero">
        ${renderCardHero(player)}
        ${
          canEditOwnProfile
            ? `
              <button type="button" class="profile-menu-button" data-open-profile-actions aria-label="Настройки профиля">
                ${renderDotsIcon()}
              </button>
            `
            : ''
        }
        <button type="button" class="profile-share-button" data-share-profile aria-label="Поделиться профилем">
          ${renderShareIcon()}
        </button>
        ${profileStatusLabel ? `<span class="editor-status">${escapeHtml(profileStatusLabel)}</span>` : ''}
        ${
          hasCareerRatings
            ? `
              <div class="hero-score ${profileStatusLabel ? 'hero-score--with-status' : ''}">
                ${renderRatingValue(player.overall, player.ratingDelta, 'hero-rating-value')}
                <span>${escapeHtml(getPositionMeta(effectivePosition).card)}</span>
              </div>
            `
            : ''
        }
      </div>
      <div class="editor-body profile-body">
        <div class="editor-nameblock">
          <div class="editor-name">${escapeHtml(player.displayName)}</div>
          <div class="editor-nick">@${escapeHtml(player.username || 'unknown')}</div>
        </div>
        ${
          isEditingSelfProfile
            ? renderSelfProfileForm(player, selfProfileDefaults, { includeStats: !hasCareerRatings })
            : `
              ${renderEditablePositionSelector(
                'позиция',
                effectivePosition === 'N/A' ? 'Не выбрана' : getPositionMeta(effectivePosition).title,
                effectivePosition,
                canEditOwnProfile
              )}
            `
        }
        ${
          isEditingSelfProfile
            ? ''
            : `
              <div class="profile-card-metrics">
                <div class="metric-grid metric-grid--summary ${overviewCells.length === 1 ? 'metric-grid--single' : ''}">
                  ${overviewCells.map((cell) => renderMetricCell(cell.label, cell.value, cell)).join('')}
                </div>
                <div class="metric-grid metric-grid--stats">
                  ${statCells.map(([label, value]) => renderMetricCell(label, value)).join('')}
                </div>
              </div>
            `
        }
        ${
          isEditingSelfProfile
            ? ''
            : `
              <section class="profile-achievements" aria-label="Достижения">
                ${renderAchievementTitle(unlockedAchievements)}
                ${
                  unlockedAchievements.length
                    ? `
                      <div class="achievement-grid">
                        ${unlockedAchievements.map((achievement) => renderAchievementCard(achievement)).join('')}
                      </div>
                    `
                    : '<p class="achievement-empty">Тут будут твои достижения</p>'
                }
              </section>
            `
        }
      </div>
    </section>
  `;
}

function renderActiveTab() {
  if (state.activeTab === 'game') {
    return renderGameTab();
  }

  if (state.activeTab === 'games') {
    return renderGamesTab();
  }

  if (state.activeTab === 'profile') {
    return renderProfileTab();
  }

  return renderPlayersTab();
}

function renderLoginPanel() {
  if (!state.allowDevLogin || state.token || tg?.initData) {
    return '';
  }

  return `
    <section class="panel dev-panel">
      <h2>Dev-вход</h2>
      <p>Для локальной проверки можно войти как любой игрок по username.</p>
      <form id="devLoginForm" class="dev-form">
        <input type="text" name="username" placeholder="username без @" required>
        <input type="text" name="displayName" placeholder="Имя для карточки">
        <button type="submit" class="primary-button">Войти</button>
      </form>
    </section>
  `;
}

function readRatingFormDraft(form) {
  const formData = new FormData(form);
  const draft = {
    position: String(formData.get('position') || 'N/A'),
    goals: Number(formData.get('goals') || 0),
    assists: Number(formData.get('assists') || 0),
    cardsEnabled: formData.get('cardsEnabled') === 'on',
    yellowCards: Number(formData.get('yellowCards') || 0),
    redCards: Number(formData.get('redCards') || 0)
  };

  for (const [key] of STAT_META) {
    draft[key] = Number(formData.get(key) || 50);
  }

  return draft;
}

function readSelfProfileForm(form) {
  const formData = new FormData(form);
  const draft = {
    position: String(formData.get('position') || 'N/A')
  };

  for (const [key] of STAT_META) {
    if (formData.has(key)) {
      draft[key] = Number(formData.get(key) || 50);
    }
  }

  return draft;
}

function saveSelfProfileDraft(form) {
  if (!form) {
    return;
  }

  state.selfProfileDraft = readSelfProfileForm(form);
}

function saveRatingFormDraft(form) {
  const draftKey = form?.dataset?.draftKey;

  if (!draftKey) {
    return;
  }

  state.ratingDrafts[draftKey] = readRatingFormDraft(form);
}

function renderModal() {
  const player = getPlayer(state.selectedPlayerId);
  const game = getCurrentGame();
  const gamePlayer = game?.participants?.find((item) => item.id === state.selectedPlayerId) ?? null;
  const createGameModal = renderCreateGameModal();
  const gameActionsModal = renderGameActionsModal();
  const profileActionsModal = renderProfileActionsModal();
  const achievementDetailModal = renderAchievementDetailModal();
  const selfProfilePromptModal = renderSelfProfilePromptModal();

  if (!player) {
    modalRoot.innerHTML = [createGameModal, gameActionsModal, profileActionsModal, achievementDetailModal, selfProfilePromptModal].join('');
    return;
  }

  const editable = Boolean(gamePlayer?.canRateTarget && game);
  const viewerRating = gamePlayer?.viewerRating ?? null;
  const serverDefaults = {
    position: viewerRating?.position || player.position || 'N/A',
    goals: viewerRating?.goals ?? 0,
    assists: viewerRating?.assists ?? 0,
    yellowCards: viewerRating?.yellowCards ?? viewerRating?.cards?.yellow ?? 0,
    redCards: viewerRating?.redCards ?? viewerRating?.cards?.red ?? 0,
    cardsEnabled: hasDisciplineCards(viewerRating),
    ...Object.fromEntries(
      STAT_META.map(([key]) => [key, viewerRating?.stats?.[key] ?? player.stats?.[key] ?? 50])
    )
  };
  const draftKey = game ? getRatingDraftKey(game.id, player.id) : '';
  const defaults = editable && draftKey && state.ratingDrafts[draftKey]
    ? { ...serverDefaults, ...state.ratingDrafts[draftKey] }
    : serverDefaults;

  modalRoot.innerHTML = [
    renderEditorScreen(player, gamePlayer, editable, defaults, game),
    createGameModal,
    gameActionsModal,
    profileActionsModal,
    achievementDetailModal,
    selfProfilePromptModal
  ].join('');
}

function scrollToTargetPlayerCard() {
  if (!state.playerScrollTargetId || state.activeTab !== 'players') {
    return;
  }

  const targetPlayerId = state.playerScrollTargetId;

  requestAnimationFrame(() => {
    if (state.playerScrollTargetId !== targetPlayerId || state.activeTab !== 'players') {
      return;
    }

    const card = [...document.querySelectorAll('[data-player-card-id]')]
      .find((node) => node.dataset.playerCardId === targetPlayerId);

    if (!card) {
      return;
    }

    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('is-share-target');
    state.playerScrollTargetId = '';

    window.setTimeout(() => {
      card.classList.remove('is-share-target');
    }, 2600);
  });
}

function syncTabbar() {
  document.querySelectorAll('.tab-button').forEach((button) => {
    const activeTab = state.manualGameOpen || state.activeTab === 'game' ? '' : state.activeTab;
    button.classList.toggle('active', button.dataset.tab === activeTab);
  });
}

function render() {
  const screenTitle = getScreenTitle();
  chatTitleNode.textContent = screenTitle;
  topbarNode?.classList.toggle('topbar--titleless', !screenTitle);
  topbarNode?.classList.toggle('topbar--game', state.activeTab === 'game');
  if (gameTopActionsNode) {
    gameTopActionsNode.hidden = state.manualGameOpen || state.activeTab !== 'game';
  }
  if (gameMenuButtonNode) {
    const game = getCurrentGame();
    gameMenuButtonNode.hidden = state.manualGameOpen || !(state.activeTab === 'game' && game);
  }
  if (gameShareButtonNode) {
    gameShareButtonNode.hidden = true;
  }
  const currentGame = getCurrentGame();
  const canShowFloatingJoin = Boolean(
    !state.manualGameOpen &&
    state.activeTab === 'game' &&
    currentGame?.canViewerRequestJoin &&
    !['pending', 'invited'].includes(currentGame.viewerJoinStatus)
  );
  appShellNode?.classList.toggle('app-shell--profile', state.activeTab === 'profile');
  appShellNode?.classList.toggle('app-shell--profile-edit', state.activeTab === 'profile' && state.selfProfileEditing);
  appShellNode?.classList.toggle('app-shell--manual', state.manualGameOpen);
  appShellNode?.classList.toggle('app-shell--game', !state.manualGameOpen && state.activeTab === 'game');
  appShellNode?.classList.toggle('app-shell--join-floating', canShowFloatingJoin);
  syncTabbar();

  if (!state.snapshot?.chat) {
    contentNode.innerHTML = `
      ${renderLoginPanel()}
      <section class="empty-state">
        <h2>Чат еще не инициализирован</h2>
        <p>Добавьте бота в футбольный чат, отправьте <code>/open</code> или первое сообщение с анонсом игры, и данные подтянутся сюда.</p>
      </section>
    `;
    renderModal();
    return;
  }

  contentNode.innerHTML = `
    ${renderLoginPanel()}
    ${state.manualGameOpen ? renderCreateGameScreen() : renderActiveTab()}
  `;

  renderModal();
  scrollToTargetPlayerCard();
}

async function submitRating(form) {
  saveRatingFormDraft(form);
  const gameId = form.dataset.gameId;
  const targetPlayerId = form.dataset.playerId;
  const formData = new FormData(form);
  const cardsEnabled = formData.get('cardsEnabled') === 'on';
  const payload = {
    targetPlayerId,
    position: formData.get('position'),
    goals: Number(formData.get('goals') || 0),
    assists: Number(formData.get('assists') || 0),
    yellowCards: cardsEnabled ? Number(formData.get('yellowCards') || 0) : 0,
    redCards: cardsEnabled ? Number(formData.get('redCards') || 0) : 0
  };

  for (const [key] of STAT_META) {
    payload[key] = Number(formData.get(key) || 50);
  }

  const data = await api(`/api/games/${encodeURIComponent(gameId)}/ratings`, {
    method: 'POST',
    body: payload
  });

  state.snapshot = data.snapshot;
  delete state.ratingDrafts[getRatingDraftKey(gameId, targetPlayerId)];
  state.selectedPlayerId = null;
  render();
  showToast('Оценка сохранена');
}

async function submitQuickRating(gameId) {
  const game = getGameDays().find((item) => item.id === gameId) ?? getCurrentGame();

  if (!game?.id) {
    throw new Error('Игра не найдена');
  }

  const draft = getQuickRatingDraft(game);
  const payload = {
    mvpPlayerId: draft.mvpPlayerId || '',
    boosts: normalizeQuickBoosts(draft.boosts),
    achievements: normalizeQuickAchievements(draft.achievements)
  };

  const data = await api(`/api/games/${encodeURIComponent(gameId)}/quick-rating`, {
    method: 'POST',
    body: payload
  });

  state.snapshot = data.snapshot;
  delete state.quickRatingDrafts[getQuickRatingDraftKey(gameId)];
  state.selectedPlayerId = null;
  render();
  showToast('Оценка сохранена');
}

async function submitSelfProfile(form) {
  saveSelfProfileDraft(form);
  const payload = state.selfProfileDraft || readSelfProfileForm(form);
  const data = await api('/api/profile', {
    method: 'POST',
    body: payload
  });

  state.snapshot = data.snapshot;
  state.selfProfileDraft = null;
  state.selfProfileEditing = false;
  render();
  showToast('Карточка сохранена');
}

async function updateProfilePosition(position) {
  const data = await api('/api/profile', {
    method: 'POST',
    body: { position: position || 'N/A' }
  });

  state.snapshot = data.snapshot;
  state.selfProfileDraft = null;
  state.selfProfileEditing = false;
  render();
  showToast('Сохранено');
}

async function submitManualGame(notifyPlayers) {
  const payload = state.manualGameConfirm;

  if (!payload) {
    return;
  }

  const isEditing = state.manualGameMode === 'edit';
  const data = await api(isEditing ? `/api/games/${encodeURIComponent(state.manualGameGameId)}` : '/api/games', {
    method: isEditing ? 'PUT' : 'POST',
    body: isEditing
      ? payload
      : {
          ...payload,
          notifyPlayers
        }
  });

  state.snapshot = data.snapshot;
  state.selectedGameId = data.game?.id || '';
  state.activeTab = 'game';
  resetManualGameState();
  render();
  showToast(isEditing ? 'Игра сохранена' : notifyPlayers ? 'Игра создана, приглашения отправлены' : 'Игра создана');
}

async function deleteCurrentGame() {
  const game = getCurrentGame();

  if (!game) {
    return;
  }

  const data = await api(`/api/games/${encodeURIComponent(game.id)}`, {
    method: 'DELETE'
  });

  state.snapshot = data.snapshot;
  state.gameActionsOpen = false;
  state.selectedGameId = '';
  state.activeTab = 'games';
  render();
  showToast('Игра удалена');
}

async function ensureAuthorizedForAction() {
  if (state.token) {
    return true;
  }

  const authenticated = await authenticateTelegram().catch(() => false);

  if (!authenticated) {
    showToast(lastAuthError || 'Открой ⚽ из Telegram, чтобы продолжить');
    return false;
  }

  return true;
}

async function requestJoinGame(gameId) {
  if (!(await ensureAuthorizedForAction())) {
    return;
  }

  const data = await api(`/api/games/${encodeURIComponent(gameId)}/join-request`, {
    method: 'POST'
  });
  state.snapshot = data.snapshot;
  render();
  showToast('Заявка отправлена');
}

async function cancelJoinRequest(gameId, playerId = '') {
  if (!(await ensureAuthorizedForAction())) {
    return;
  }

  const data = await api(`/api/games/${encodeURIComponent(gameId)}/join-request`, {
    method: 'DELETE',
    body: playerId ? { playerId } : null
  });
  state.snapshot = data.snapshot;
  render();
  showToast('Заявка отменена');
}

async function approveJoinRequest(gameId, playerId) {
  if (!(await ensureAuthorizedForAction())) {
    return;
  }

  const data = await api(`/api/games/${encodeURIComponent(gameId)}/join-requests/${encodeURIComponent(playerId)}/approve`, {
    method: 'POST'
  });
  state.snapshot = data.snapshot;
  render();
  showToast('Игрок добавлен');
}

async function acceptGameInvite(gameId) {
  if (!(await ensureAuthorizedForAction())) {
    return;
  }

  const data = await api(`/api/games/${encodeURIComponent(gameId)}/invite/accept`, {
    method: 'POST'
  });
  state.snapshot = data.snapshot;
  render();
  showToast('Ты в составе');
}

async function declineGameInvite(gameId) {
  if (!(await ensureAuthorizedForAction())) {
    return;
  }

  const data = await api(`/api/games/${encodeURIComponent(gameId)}/invite`, {
    method: 'DELETE'
  });
  state.snapshot = data.snapshot;
  render();
  showToast('Приглашение отклонено');
}

async function shareFallback(fallback = {}) {
  const title = fallback.title || 'Футбольчик';
  const text = fallback.text || title;
  const url = fallback.url || window.location.href;

  if (navigator.share) {
    await navigator.share({ title, text, url });
    return;
  }

  const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;

  if (tg?.openTelegramLink) {
    tg.openTelegramLink(telegramShareUrl);
    return;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    showToast('Ссылка скопирована');
    return;
  }

  window.open(telegramShareUrl, '_blank', 'noopener,noreferrer');
}

async function sharePreparedOrFallback(data) {
  if (data?.preparedMessageId && tg?.shareMessage) {
    try {
      tg.shareMessage(data.preparedMessageId, (success) => {
        if (!success) {
          showToast('Шаринг отменён');
        }
      });
      return;
    } catch {
      // Fall through to link sharing below.
    }
  }

  await shareFallback(data?.fallback);
}

async function shareProfile() {
  if (!(await ensureAuthorizedForAction())) {
    return;
  }

  const data = await api('/api/share/profile', {
    method: 'POST'
  });
  await sharePreparedOrFallback(data);
}

async function shareCurrentGame() {
  const game = getCurrentGame();

  if (!game) {
    showToast('Игра не найдена');
    return;
  }

  if (!(await ensureAuthorizedForAction())) {
    return;
  }

  const data = await api('/api/share/game', {
    method: 'POST',
    body: {
      gameId: game.id
    }
  });
  await sharePreparedOrFallback(data);
}

function shouldSkipSilentRefresh() {
  const game = getCurrentGame();

  return Boolean(
    state.manualGameOpen ||
    state.selfProfileEditing ||
    state.selectedPlayerId ||
    document.getElementById('ratingForm') ||
    document.getElementById('selfProfileForm') ||
    document.getElementById('manualGameForm') ||
    (state.activeTab === 'game' && game?.canViewerRate)
  );
}

async function refreshSnapshot({ silent = false } = {}) {
  try {
    if (silent && shouldSkipSilentRefresh()) {
      return;
    }

    const activeRatingForm = document.getElementById('ratingForm');
    if (activeRatingForm) {
      saveRatingFormDraft(activeRatingForm);
    }
    const activeSelfProfileForm = document.getElementById('selfProfileForm');
    if (activeSelfProfileForm) {
      saveSelfProfileDraft(activeSelfProfileForm);
    }
    const manualGameForm = document.getElementById('manualGameForm');
    if (manualGameForm) {
      saveManualGameDraft(manualGameForm);
    }

    await loadSnapshot();
    render();
    if (!silent) {
      showToast('Обновлено');
    }
  } catch (error) {
    if (!silent) {
      showToast(error.message);
    }
  }
}

function setupAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  if (countdownTimer) {
    clearInterval(countdownTimer);
  }

  refreshTimer = setInterval(() => {
    void refreshSnapshot({ silent: true });
  }, 30000);

  countdownTimer = setInterval(() => {
    document.querySelectorAll('[data-rating-countdown]').forEach((node) => {
      node.textContent = getRatingCountdownLabel(node.dataset.ratingCountdown);
    });
  }, 1000);
}

function updateStepper(form, name, delta) {
  const input = form.querySelector(`input[name="${name}"]`);
  const container = form.querySelector(`[data-stepper-name="${name}"]`);

  if (!input || !container) {
    return;
  }

  const min = Number(input.getAttribute('min') || 0);
  const max = Number(input.getAttribute('max') || 20);
  const currentValue = Number(input.value || 0);
  const nextValue = clamp(currentValue + delta, min, max);
  input.value = String(nextValue);
  const valueNode = container.querySelector('[data-stepper-value]');

  if (valueNode) {
    valueNode.textContent = String(nextValue);
  }

  if (form.id === 'selfProfileForm') {
    saveSelfProfileDraft(form);
  } else {
    saveRatingFormDraft(form);
  }
}

function isProfileStatStepperButton(button) {
  return Boolean(button?.closest('#selfProfileForm .profile-stat-stepper'));
}

function getStepperDelta(button) {
  const direction = button.dataset.stepperAction === 'increment' ? 1 : -1;

  if (!isProfileStatStepperButton(button)) {
    return direction;
  }

  const startedAt = profileStepperPressStartedAt.get(button);
  profileStepperPressStartedAt.delete(button);

  if (!Number.isFinite(startedAt)) {
    return direction;
  }

  return direction * (performance.now() - startedAt >= PROFILE_STEPPER_LONG_TAP_MS ? 10 : 1);
}

document.getElementById('refreshButton')?.addEventListener('click', async () => {
  await refreshSnapshot();
});

closeGameButtonNode?.addEventListener('click', closeGameScreen);

gameShareButtonNode?.addEventListener('click', () => {
  shareCurrentGame().catch((error) => {
    showToast(error.message);
  });
});

gameMenuButtonNode?.addEventListener('click', () => {
  state.gameActionsOpen = true;
  renderModal();
});

document.addEventListener('pointerdown', (event) => {
  const quickAchievementDetailButton = event.target.closest('.quick-achievement-picker [data-achievement-detail]');

  if (quickAchievementDetailButton) {
    event.preventDefault();
    event.stopPropagation();
    state.quickAchievementInfoPointerAt = Date.now();
    state.achievementDetailKey = quickAchievementDetailButton.dataset.achievementDetail || '';
    renderModal();
    return;
  }

  const stepperButton = event.target.closest('[data-stepper-action]');

  if (!isProfileStatStepperButton(stepperButton)) {
    return;
  }

  profileStepperPressStartedAt.set(stepperButton, performance.now());
});

document.addEventListener('pointercancel', (event) => {
  const stepperButton = event.target.closest('[data-stepper-action]');

  if (stepperButton) {
    profileStepperPressStartedAt.delete(stepperButton);
  }
});

document.addEventListener('contextmenu', (event) => {
  if (!isProfileStatStepperButton(event.target.closest('[data-stepper-action]'))) {
    return;
  }

  event.preventDefault();
});

document.querySelector('.tabbar').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]');

  if (!button) {
    return;
  }

  if (state.manualGameOpen) {
    resetManualGameState();
  }

  state.activeTab = button.dataset.tab;
  if (state.activeTab !== 'game') {
    state.selectedGameId = '';
  }
  if (state.activeTab !== 'profile') {
    state.selfProfileEditing = false;
    state.selfProfileDraft = null;
    state.profileActionsOpen = false;
  }
  render();
});

document.addEventListener('click', async (event) => {
  const editSelfProfileButton = event.target.closest('[data-edit-self-profile]');

  if (editSelfProfileButton) {
    state.profileActionsOpen = false;
    state.selfProfileEditing = true;
    render();
    return;
  }

  const profileActionsButton = event.target.closest('[data-open-profile-actions]');

  if (profileActionsButton) {
    state.profileActionsOpen = true;
    renderModal();
    return;
  }

  const cancelSelfProfileButton = event.target.closest('[data-cancel-self-profile]');

  if (cancelSelfProfileButton) {
    state.selfProfileEditing = false;
    state.selfProfileDraft = null;
    render();
    return;
  }

  const shareProfileButton = event.target.closest('[data-share-profile]');

  if (shareProfileButton) {
    state.profileActionsOpen = false;
    renderModal();
    shareProfile().catch((error) => {
      showToast(error.message);
    });
    return;
  }

  const shareGameButton = event.target.closest('[data-share-game]');

  if (shareGameButton) {
    state.gameActionsOpen = false;
    renderModal();
    shareCurrentGame().catch((error) => {
      showToast(error.message);
    });
    return;
  }

  const achievementDetailButton = event.target.closest('[data-achievement-detail]');

  if (achievementDetailButton) {
    event.preventDefault();
    event.stopPropagation();
    state.achievementDetailKey = achievementDetailButton.dataset.achievementDetail || '';
    renderModal();
    return;
  }

  const openCreateButton = event.target.closest('[data-open-create-game]');

  if (openCreateButton) {
    if (!state.token) {
      const authenticated = await authenticateTelegram().catch(() => false);

      if (!authenticated) {
        showToast(lastAuthError || 'Открой ⚽ из Telegram, чтобы создать игру');
        return;
      }
    }

    if (!state.snapshot?.viewerCanCreateGames && !state.allowDevLogin) {
      showToast('Сначала запусти бота в личке командой /start');
      return;
    }

    openManualGameCreate();
    return;
  }

  const closeCreateButton = event.target.closest('[data-close-create-game]');

  if (closeCreateButton || event.target.matches('[data-create-backdrop]')) {
    resetManualGameState();
    render();
    return;
  }

  const gameActionsBackdrop = event.target.matches('[data-game-actions-backdrop]');

  if (gameActionsBackdrop) {
    state.gameActionsOpen = false;
    renderModal();
    return;
  }

  if (event.target.matches('[data-profile-actions-backdrop]')) {
    state.profileActionsOpen = false;
    renderModal();
    return;
  }

  if (event.target.matches('[data-self-profile-prompt-backdrop]') || event.target.closest('[data-dismiss-self-profile-prompt]')) {
    const player = getViewerPlayer();
    state.selfProfilePromptDismissedFor = player?.id || 'dismissed';
    renderModal();
    return;
  }

  const startSelfProfileButton = event.target.closest('[data-start-self-profile]');

  if (startSelfProfileButton) {
    const player = getViewerPlayer();
    state.selfProfilePromptDismissedFor = player?.id || 'started';
    state.profileActionsOpen = false;
    state.activeTab = 'profile';
    state.selfProfileEditing = true;
    state.selectedPlayerId = null;
    state.manualGameOpen = false;
    render();
    return;
  }

  if (event.target.matches('[data-achievement-detail-backdrop]') || event.target.closest('[data-close-achievement-detail]')) {
    state.achievementDetailKey = '';
    renderModal();
    return;
  }

  const editGameButton = event.target.closest('[data-edit-game]');

  if (editGameButton) {
    const game = getCurrentGame();

    if (game) {
      openManualGameEdit(game);
    }
    return;
  }

  const deleteGameButton = event.target.closest('[data-delete-game]');

  if (deleteGameButton) {
    deleteCurrentGame().catch((error) => {
      showToast(error.message);
    });
    return;
  }

  const manualSearchInput = event.target.closest('[data-manual-player-search]');

  if (manualSearchInput) {
    if (!state.manualPlayerPickerOpen) {
      state.manualPlayerPickerOpen = true;
      render();
      setTimeout(() => {
        document.querySelector('[data-manual-player-search]')?.focus();
      }, 0);
    }
    return;
  }

  const removeManualPlayerButton = event.target.closest('[data-remove-manual-player]');

  if (removeManualPlayerButton) {
    const form = document.getElementById('manualGameForm');
    saveManualGameDraft(form);
    const playerId = removeManualPlayerButton.dataset.removeManualPlayer;
    const selected = new Set(state.manualGameDraft.playerIds);
    selected.delete(playerId);
    state.manualGameDraft.playerIds = [...selected];
    render();
    return;
  }

  const manualPlayerButton = event.target.closest('[data-add-manual-player]');

  if (manualPlayerButton) {
    const form = document.getElementById('manualGameForm');
    saveManualGameDraft(form);
    const playerId = manualPlayerButton.dataset.addManualPlayer;
    const selected = new Set(state.manualGameDraft.playerIds);

    if (!selected.has(playerId)) {
      selected.add(playerId);
    }

    state.manualGameDraft.playerIds = [...selected];
    state.manualPlayerSearch = '';
    state.manualPlayerPickerOpen = false;
    render();
    return;
  }

  if (
    state.manualGameOpen &&
    state.manualPlayerPickerOpen &&
    !event.target.closest('.manual-player-search-wrap')
  ) {
    const form = document.getElementById('manualGameForm');
    saveManualGameDraft(form);
    state.manualPlayerPickerOpen = false;
    render();
    return;
  }

  const createGameConfirmButton = event.target.closest('[data-create-game-confirm]');

  if (createGameConfirmButton) {
    submitManualGame(createGameConfirmButton.dataset.createGameConfirm === 'yes').catch((error) => {
      showToast(error.message);
    });
    return;
  }

  const stepperButton = event.target.closest('[data-stepper-action]');

  if (stepperButton) {
    const form = stepperButton.closest('form');

    if (!form) {
      return;
    }

    updateStepper(
      form,
      stepperButton.dataset.stepperName,
      getStepperDelta(stepperButton)
    );
    return;
  }

  const achievementButton = event.target.closest('[data-achievement]');

  if (achievementButton) {
    document.querySelectorAll('.achievement-button.is-open').forEach((button) => {
      if (button !== achievementButton) {
        button.classList.remove('is-open');
      }
    });
    achievementButton.classList.toggle('is-open');
    return;
  }

  const clearPlayerSearchButton = event.target.closest('[data-clear-player-search]');

  if (clearPlayerSearchButton) {
    state.playerSearch = '';
    const searchInput = document.querySelector('[data-player-search]');
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
    }
    refreshPlayersResults();
    return;
  }

  const joinGameButton = event.target.closest('[data-join-game]');

  if (joinGameButton) {
    requestJoinGame(joinGameButton.dataset.joinGame).catch((error) => {
      showToast(error.message);
    });
    return;
  }

  const cancelJoinButton = event.target.closest('[data-cancel-join-request]');

  if (cancelJoinButton) {
    cancelJoinRequest(cancelJoinButton.dataset.cancelJoinRequest, cancelJoinButton.dataset.cancelJoinPlayer).catch((error) => {
      showToast(error.message);
    });
    return;
  }

  const approveJoinButton = event.target.closest('[data-approve-join-player]');

  if (approveJoinButton) {
    approveJoinRequest(approveJoinButton.dataset.gameId, approveJoinButton.dataset.approveJoinPlayer).catch((error) => {
      showToast(error.message);
    });
    return;
  }

  const acceptInviteButton = event.target.closest('[data-accept-game-invite]');

  if (acceptInviteButton) {
    acceptGameInvite(acceptInviteButton.dataset.acceptGameInvite).catch((error) => {
      showToast(error.message);
    });
    return;
  }

  const declineInviteButton = event.target.closest('[data-decline-game-invite]');

  if (declineInviteButton) {
    declineGameInvite(declineInviteButton.dataset.declineGameInvite).catch((error) => {
      showToast(error.message);
    });
    return;
  }

  const quickMvpButton = event.target.closest('[data-quick-mvp]');

  if (quickMvpButton) {
    const game = getGameDays().find((item) => item.id === quickMvpButton.dataset.gameId) ?? getCurrentGame();
    const draft = getQuickRatingDraft(game);
    const playerId = quickMvpButton.dataset.quickMvp;
    draft.mvpPlayerId = draft.mvpPlayerId === playerId ? '' : playerId;
    render();
    return;
  }

  const toggleQuickAchievementsButton = event.target.closest('[data-toggle-quick-achievements]');

  if (toggleQuickAchievementsButton) {
    const game = getGameDays().find((item) => item.id === toggleQuickAchievementsButton.dataset.toggleQuickAchievements) ?? getCurrentGame();
    const draft = getQuickRatingDraft(game);
    draft.achievementPickerOpen = !draft.achievementPickerOpen;
    render();
    return;
  }

  const addQuickAchievementButton = event.target.closest('[data-add-quick-achievement]');

  if (addQuickAchievementButton) {
    if (
      event.target.closest('[data-achievement-detail]') ||
      Date.now() - Number(state.quickAchievementInfoPointerAt || 0) < 500
    ) {
      return;
    }

    const game = getGameDays().find((item) => item.id === addQuickAchievementButton.dataset.gameId) ?? getCurrentGame();
    const draft = getQuickRatingDraft(game);
    const achievementKey = addQuickAchievementButton.dataset.addQuickAchievement;
    const nextAchievements = normalizeQuickAchievements(draft.achievements);

    if (!nextAchievements.some((achievement) => achievement.achievementKey === achievementKey)) {
      nextAchievements.push({ achievementKey, targetPlayerId: '' });
    }

    draft.achievements = nextAchievements;
    draft.achievementPickerOpen = false;
    render();
    return;
  }

  const quickBoostAddButton = event.target.closest('[data-quick-boost-add]');

  if (quickBoostAddButton) {
    const game = getGameDays().find((item) => item.id === quickBoostAddButton.dataset.gameId) ?? getCurrentGame();
    const draft = getQuickRatingDraft(game);
    const used = getQuickRatingPointsUsed(draft);

    if (used >= QUICK_RATING_POINTS) {
      showToast(`Можно раздать максимум ${QUICK_RATING_POINTS} очка`);
      return;
    }

    const playerId = quickBoostAddButton.dataset.quickBoostAdd;
    const statKey = quickBoostAddButton.dataset.quickBoostStat;
    setQuickBoostPoints(game, playerId, statKey, getQuickBoostPoints(draft, playerId, statKey) + 1);
    render();
    return;
  }

  const quickBoostRemoveButton = event.target.closest('[data-quick-boost-remove]');

  if (quickBoostRemoveButton) {
    const game = getGameDays().find((item) => item.id === quickBoostRemoveButton.dataset.gameId) ?? getCurrentGame();
    const draft = getQuickRatingDraft(game);
    const playerId = quickBoostRemoveButton.dataset.quickBoostRemove;
    const statKey = quickBoostRemoveButton.dataset.quickBoostStat;
    setQuickBoostPoints(game, playerId, statKey, Math.max(0, getQuickBoostPoints(draft, playerId, statKey) - 1));
    render();
    return;
  }

  const quickSubmitButton = event.target.closest('[data-submit-quick-rating]');

  if (quickSubmitButton) {
    submitQuickRating(quickSubmitButton.dataset.submitQuickRating).catch((error) => {
      showToast(error.message);
    });
    return;
  }

  const scrollPlayerButton = event.target.closest('[data-scroll-player]');

  if (scrollPlayerButton) {
    state.activeTab = 'players';
    state.selectedGameId = '';
    state.manualGameOpen = false;
    state.playerSearch = '';
    state.positionFilter = '';
    state.playerScrollTargetId = scrollPlayerButton.dataset.scrollPlayer || '';
    render();
    return;
  }

  const openButton = event.target.closest('[data-open-player]');

  if (openButton) {
    state.selectedPlayerId = openButton.dataset.openPlayer;
    renderModal();
    return;
  }

  const mapButton = event.target.closest('[data-map-link]');

  if (mapButton) {
    const url = mapButton.dataset.mapLink;

    if (url) {
      if (tg?.openLink) {
        tg.openLink(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
    return;
  }

  const gameCard = event.target.closest('[data-open-game]');

  if (gameCard) {
    state.selectedGameId = gameCard.dataset.openGame;
    state.activeTab = 'game';
    try {
      await loadSnapshot();
    } catch (error) {
      showToast(error.message);
    }
    render();
    return;
  }

  if (event.target.closest('[data-close-modal]') || event.target.matches('[data-modal-backdrop]')) {
    state.selectedPlayerId = null;
    renderModal();
  }

  const sortButton = event.target.closest('[data-sort]');

  if (sortButton) {
    state.activeSort = sortButton.dataset.sort;
    render();
  }

  const gamesFilterButton = event.target.closest('[data-games-filter]');

  if (gamesFilterButton) {
    state.gamesFilter = gamesFilterButton.dataset.gamesFilter;
    render();
    return;
  }

  if (!event.target.closest('.achievement-button')) {
    document.querySelectorAll('.achievement-button.is-open').forEach((button) => {
      button.classList.remove('is-open');
    });
  }
});

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-manual-player-search]')) {
    state.manualPlayerSearch = event.target.value;
    state.manualPlayerPickerOpen = true;
    refreshManualPlayerPicker();
    return;
  }

  if (event.target.closest('#manualGameForm')) {
    saveManualGameDraft(event.target.closest('#manualGameForm'));
    return;
  }

  if (event.target.id === 'positionFilter') {
    state.positionFilter = event.target.value;
    render();
    return;
  }

  if (event.target.matches('[data-quick-mvp-select]')) {
    const game = getGameDays().find((item) => item.id === event.target.dataset.gameId) ?? getCurrentGame();
    const draft = getQuickRatingDraft(game);
    draft.mvpPlayerId = event.target.value || '';
    render();
    return;
  }

  if (event.target.matches('[data-quick-achievement-target]')) {
    const game = getGameDays().find((item) => item.id === event.target.dataset.gameId) ?? getCurrentGame();
    setQuickAchievementTarget(game, event.target.dataset.quickAchievementTarget, event.target.value || '');
    render();
    return;
  }

  if (event.target.matches('#ratingForm select[name="position"]')) {
    const form = event.target.closest('form');
    saveRatingFormDraft(form);
    renderModal();
    return;
  }

  if (event.target.matches('[data-cards-toggle]')) {
    const control = event.target.closest('[data-card-control]');
    const form = event.target.closest('form');
    control?.classList.toggle('is-enabled', event.target.checked);
    saveRatingFormDraft(form);
    return;
  }

  if (event.target.matches('#selfProfileForm select[name="position"]')) {
    const form = event.target.closest('form');
    saveSelfProfileDraft(form);
    render();
    return;
  }

  if (event.target.matches('[data-profile-position-select]')) {
    updateProfilePosition(event.target.value).catch((error) => {
      showToast(error.message);
    });
    return;
  }

  if (event.target.matches('input[type="range"]')) {
    const valueNode =
      event.target.closest('.editor-range')?.querySelector('.editor-range-value') ||
      event.target.parentElement.querySelector('.range-value');
    if (valueNode) {
      valueNode.textContent = event.target.value;
    }
    saveRatingFormDraft(event.target.closest('form'));
    saveSelfProfileDraft(event.target.closest('#selfProfileForm'));
  }
});

document.addEventListener('input', (event) => {
  if (event.target.matches('[data-player-search]')) {
    state.playerSearch = event.target.value;
    refreshPlayersResults();
    return;
  }

  if (event.target.matches('[data-manual-player-search]')) {
    state.manualPlayerSearch = event.target.value;
    state.manualPlayerPickerOpen = true;
    refreshManualPlayerPicker();
    return;
  }

  if (event.target.closest('#manualGameForm')) {
    saveManualGameDraft(event.target.closest('#manualGameForm'));
    return;
  }

  if (event.target.matches('input[type="range"]')) {
    const valueNode =
      event.target.closest('.editor-range')?.querySelector('.editor-range-value') ||
      event.target.parentElement.querySelector('.range-value');
    if (valueNode) {
      valueNode.textContent = event.target.value;
    }
    saveRatingFormDraft(event.target.closest('form'));
    saveSelfProfileDraft(event.target.closest('#selfProfileForm'));
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    void refreshSnapshot({ silent: true });
  }
});

window.addEventListener('focus', () => {
  void refreshSnapshot({ silent: true });
});

document.addEventListener('submit', async (event) => {
  if (event.target.id === 'manualGameForm') {
    event.preventDefault();
    saveManualGameDraft(event.target);
    const payload = readManualGameForm(event.target);

    if (!payload.date || !payload.time || !payload.location) {
      showToast('Заполните дату, время и место');
      return;
    }

    if (new Set([state.snapshot?.viewerPlayerId, ...payload.playerIds].filter(Boolean)).size < 2) {
      showToast('Добавьте минимум двух игроков');
      return;
    }

    if (state.manualGameMode === 'edit') {
      state.manualGameConfirm = payload;
      submitManualGame(false).catch((error) => {
        showToast(error.message);
      });
      return;
    }

    state.manualGameConfirm = payload;
    renderModal();
    return;
  }

  if (event.target.id === 'ratingForm') {
    event.preventDefault();
    try {
      await submitRating(event.target);
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  if (event.target.id === 'devLoginForm') {
    event.preventDefault();
    const formData = new FormData(event.target);
    try {
      await loginDev(String(formData.get('username') || ''), String(formData.get('displayName') || ''));
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  if (event.target.id === 'selfProfileForm') {
    event.preventDefault();
    try {
      await submitSelfProfile(event.target);
    } catch (error) {
      showToast(error.message);
    }
  }
});

async function init() {
  if (tg) {
    tg.ready();
    tg.expand();
    document.body.style.setProperty('--tg-bg', tg.themeParams.bg_color || '#07140f');
    document.body.style.setProperty('--tg-text', tg.themeParams.text_color || '#f4f3ea');
    state.chatId = state.chatId || readChatIdFromStartParam();
  }

  state.token = localStorage.getItem(storageKey()) || '';
  const { sessionToken, authError } = consumeSessionTokenFromUrl();

  if (sessionToken) {
    state.token = sessionToken;
    localStorage.setItem(storageKey(), sessionToken);
  }

  try {
    if (sessionToken) {
      await loadSnapshot();
    } else {
      const authenticated = await authenticateTelegram().catch(() => false);
      if (!authenticated) {
        await loadSnapshot();
      }
    }
  } catch (error) {
    contentNode.innerHTML = `<section class="empty-state"><h2>Ошибка</h2><p>${escapeHtml(error.message)}</p></section>`;
    return;
  }

  render();
  if (authError) {
    showToast(`Telegram-авторизация не прошла: ${authError}`);
  }
  setupAutoRefresh();
}

void init();
