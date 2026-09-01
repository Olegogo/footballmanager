import {
  POSITION_CHOICES,
  POSITION_META,
  buildFullFieldAssignments,
  clamp,
  getEffectiveOverall,
  getEffectivePosition,
  getInitials,
  getMaximumTeamCount,
  getPositionMeta,
  getSortPosition,
  splitBalancedTeams
} from '/lib/lineup.js';
import { getProfileStatBenchmark } from '/lib/profile-benchmark.js';

const STAT_META = [
  ['pace', 'Pace'],
  ['dribbling', 'Dribbling'],
  ['shooting', 'Shooting'],
  ['defense', 'Defense'],
  ['passing', 'Passing'],
  ['physical', 'Physical']
];
const QUICK_RATING_POINTS = 3;
const GOALKEEPER_STAT_META = [
  ['pace', 'Line play'],
  ['dribbling', 'Handling'],
  ['shooting', 'Clearances'],
  ['defense', 'Reflexes'],
  ['passing', 'Speed'],
  ['physical', 'Positioning']
];
const QUICK_ACHIEVEMENTS = [
  { key: 'mvp', title: 'MVP', category: 'Base', categoryKey: 'base', description: 'Player of the match by participant votes.', automatic: false, special: true },
  { key: 'goleador', title: 'Top scorer', category: 'Base', categoryKey: 'base', description: 'Most voted main scorer of the match.', automatic: false },
  { key: 'hat_trick', title: 'Hat-tricker', category: 'Goals and attack', categoryKey: 'attack', description: 'Scored 3 goals in a match.', automatic: false },
  { key: 'pokerface', title: 'Poker face', category: 'Goals and attack', categoryKey: 'attack', description: 'Scored 4 goals in a match.', automatic: false },
  { key: 'comeback_maker', title: 'Comeback maker', category: 'Goals and attack', categoryKey: 'attack', description: 'Changed the flow of the match.', automatic: false },
  { key: 'long_shot', title: 'Long shot', category: 'Goals and attack', categoryKey: 'attack', description: 'Scored from outside the box.', automatic: false },
  { key: 'assistant', title: 'Assistant', category: 'Passing and team play', categoryKey: 'team', description: 'Made the most assists.', automatic: false },
  { key: 'playmaker', title: 'Playmaker', category: 'Passing and team play', categoryKey: 'team', description: 'Made 3+ assists in a match.', automatic: false },
  { key: 'unselfish', title: 'Unselfish', category: 'Passing and team play', categoryKey: 'team', description: 'Passed into an empty net instead of shooting.', automatic: false },
  { key: 'conductor', title: 'Conductor', category: 'Passing and team play', categoryKey: 'team', description: 'Most involved in goal attacks: goals + assists.', automatic: false },
  { key: 'wall', title: 'Wall', category: 'Defense', categoryKey: 'defense', description: 'Best defender of the match.', automatic: false },
  { key: 'pickpocket', title: 'Pickpocket', category: 'Defense', categoryKey: 'defense', description: 'Most tackles.', automatic: false },
  { key: 'cat', title: 'Cat', category: 'Goalkeeper', categoryKey: 'goalkeeper', description: 'Best save of the match.', automatic: false },
  { key: 'no_toxic', title: 'No toxicity', category: 'Other', categoryKey: 'other', description: '10 matches without complaints or conflicts.', automatic: false },
  { key: 'maguire_day', title: 'Maguire day', category: 'Other', categoryKey: 'other', description: 'Funny mistake of the match.', automatic: false },
  { key: 'planned_it', title: 'Planned it', category: 'Other', categoryKey: 'other', description: 'Scored an accidental goal.', automatic: false },
  { key: 'woodworker', title: 'Woodworker', category: 'Other', categoryKey: 'other', description: 'Hit the frame 3 times.', automatic: false },
  { key: 'debutant', title: 'Debutant', category: 'Automatic', categoryKey: 'auto', description: 'Played the first match.', automatic: true },
  { key: 'stable_guy', title: 'Stable guy', category: 'Automatic', categoryKey: 'auto', description: 'Played 5 matches in a row.', automatic: true },
  { key: 'local_guy', title: 'Local guy', category: 'Automatic', categoryKey: 'auto', description: 'Played 10 matches at one venue.', automatic: true },
  { key: 'yard_veteran', title: 'Yard veteran', category: 'Automatic', categoryKey: 'auto', description: 'Played 50 matches.', automatic: true },
  { key: 'last_line', title: 'Last line', category: 'Automatic', categoryKey: 'auto', description: 'Got MVP while playing goalkeeper.', automatic: true },
  { key: 'support', title: 'Support', category: 'Automatic', categoryKey: 'auto', description: 'Rated every player after a match.', automatic: true },
  { key: 'organizer', title: 'Organizer', category: 'Automatic', categoryKey: 'auto', description: 'Created the first match.', automatic: true },
  { key: 'form_up', title: 'Form up', category: 'Automatic', categoryKey: 'auto', description: 'Raised the average rating over the last 5 games.', automatic: true },
  { key: 'dark_horse', title: 'Dark horse', category: 'Automatic', categoryKey: 'auto', description: 'Came in with a low rating and got MVP.', automatic: true },
  { key: 'yard_elite', title: 'Yard elite', category: 'Automatic', categoryKey: 'auto', description: 'Reached top-3 rating.', automatic: true },
  { key: 'underrated', title: 'Underrated', category: 'Automatic', categoryKey: 'auto', description: 'High stats but few MVP votes.', automatic: true }
];
const QUICK_ACHIEVEMENT_BY_KEY = Object.fromEntries(QUICK_ACHIEVEMENTS.map((achievement) => [achievement.key, achievement]));
const QUICK_SELECTABLE_ACHIEVEMENTS = QUICK_ACHIEVEMENTS.filter((achievement) => !achievement.automatic && !achievement.special);

const VENUE_DIRECTORY = [
  {
    match: /сокольник/i,
    venue: {
      ru: 'CityFootball',
      en: 'CityFootball'
    },
    address: {
      ru: 'ул. Короленко, 1А, Москва',
      en: 'Korolenko St., 1A, Moscow'
    },
    mapUrl: 'https://yandex.ru/maps/org/cityfootball/1809670236?si=yb6d72pvrvgnt63tbw8y23w900'
  },
  {
    match: /полежаевск/i,
    venue: {
      ru: 'Академия Будущего',
      en: 'Academy of the Future'
    },
    address: {
      ru: 'Москва, Северный административный округ, Хорошёвский район',
      en: 'Khoroshyovsky District, Northern Administrative Okrug, Moscow'
    },
    mapUrl: 'https://yandex.ru/maps/org/akademiya_budushchego/85913064858?si=yb6d72pvrvgnt63tbw8y23w900'
  }
];
const FILTER_CHIPS = [];
const GAME_FILTERS = [
  { key: 'all', labelKey: 'match.filters.all' },
  { key: 'mine', labelKey: 'match.filters.mine' },
  { key: 'current', labelKey: 'match.filters.current' },
  { key: 'finished', labelKey: 'match.filters.finished' }
];
const MONTH_NAME_PATTERN = 'января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря';
const MONTH_INDEX_BY_RU_LABEL = new Map(MONTH_NAME_PATTERN.split('|').map((month, index) => [month, index + 1]));
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
  if (['game', 'games', 'players', 'teams', 'profile'].includes(tab)) {
    return tab;
  }

  return 'games';
}

const state = {
  chatId: launchContext.chatId,
  token: '',
  snapshot: null,
  locale: 'ru',
  translations: {},
  allowDevLogin: false,
  activeTab: getSafeActiveTab(readInitialTabFromLaunch()),
  activeSort: 'overall',
  gamesFilter: 'all',
  positionFilter: '',
  achievementFilter: '',
  skillFilter: '',
  fieldTeamFilter: 'top',
  fieldTeamCount: 2,
  playerSearch: '',
  showCreateGameTooltip: false,
  showCreateTeamTooltip: false,
  teamScreen: 'list',
  teamSearch: '',
  teamSort: 'rating',
  selectedTeamId: '',
  selectedChallengeId: '',
  teamActionsOpen: false,
  teamAvatarActionsOpen: false,
  teamEditingId: '',
  teamPlayerSearch: '',
  teamDraft: null,
  challengeDraft: null,
  selectedPlayerId: null,
  playerScrollTargetId: launchContext.playerId || '',
  selectedGameId: launchContext.gameId,
  profileReturnTab: 'games',
  selfProfileDraft: null,
  selfProfileEditing: false,
  selfProfilePromptDismissedFor: '',
  profileActionsOpen: false,
  gameActionsOpen: false,
  mapChoice: null,
  achievementDetailKey: '',
  achievementAwardQueue: [],
  achievementAwardIndex: 0,
  achievementAwardsChecked: false,
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
    additionalInfo: '',
    playerIds: []
  }
};
let createGameTooltipTimer = null;
let createTeamTooltipTimer = null;
const PROFILE_STEPPER_LONG_TAP_MS = 450;
const profileStepperPressStartedAt = new WeakMap();

const tg = window.Telegram?.WebApp;
const apiBaseUrl = String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
const appShellNode = document.querySelector('.app-shell');
const contentNode = document.getElementById('content');
const chatTitleNode = document.getElementById('chatTitle');
const topbarNode = document.querySelector('.topbar');
const gameTeamControlsNode = document.getElementById('gameTeamControls');
const profileEntrySlotNode = document.getElementById('profileEntrySlot');
const gameTopActionsNode = document.getElementById('gameTopActions');
const gameMenuButtonNode = document.getElementById('gameMenuButton');
const gameShareButtonNode = document.getElementById('gameShareButton');
const closeGameButtonNode = document.getElementById('closeGameButton');
const modalRoot = document.getElementById('modalRoot');
const toastNode = document.getElementById('toast');
let refreshTimer = null;
let countdownTimer = null;
let lastAuthError = '';

function syncAppShellBounds() {
  if (!appShellNode) {
    return;
  }

  const rect = appShellNode.getBoundingClientRect();
  if (!rect.width) {
    return;
  }

  document.documentElement.style.setProperty('--app-shell-left', `${Math.max(0, rect.left)}px`);
  document.documentElement.style.setProperty('--app-shell-width', `${rect.width}px`);
}

window.addEventListener('resize', syncAppShellBounds);
window.addEventListener('orientationchange', syncAppShellBounds);

if (window.ResizeObserver && appShellNode) {
  new ResizeObserver(syncAppShellBounds).observe(appShellNode);
}

requestAnimationFrame(syncAppShellBounds);

function getTelegramLocale() {
  return String(tg?.initDataUnsafe?.user?.language_code || navigator.language || 'ru')
    .trim()
    .toLowerCase()
    .startsWith('en') ? 'en' : 'ru';
}

function getTranslationValue(key) {
  return String(key || '')
    .split('.')
    .reduce((value, part) => (value && typeof value === 'object' ? value[part] : undefined), state.translations);
}

function t(key, params = {}) {
  const value = getTranslationValue(key);
  const template = typeof value === 'string' ? value : key;

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
    const paramValue = params[name];
    return paramValue === undefined || paramValue === null ? '' : String(paramValue);
  });
}

function getTranslatedObject(key) {
  const value = getTranslationValue(key);
  return value && typeof value === 'object' ? value : null;
}

function getStatLabel(key, position = 'N/A') {
  const labelKey = isGoalkeeperPosition(position) ? `stats.goalkeeper.${key}` : `stats.${key}`;
  return t(labelKey);
}

function getPositionLabel(position = 'N/A', field = 'title') {
  const meta = getPositionMeta(position);
  const translated = getTranslatedObject(`players.positions.${position}`);
  return translated?.[field] || meta[field] || meta.title;
}

function getAchievementMeta(achievementKey) {
  const base = QUICK_ACHIEVEMENT_BY_KEY[achievementKey] || {};
  const translated = getTranslatedObject(`achievements.${achievementKey}`);

  return {
    ...base,
    title: translated?.title || base.title || achievementKey,
    description: translated?.description || base.description || ''
  };
}

function getLocalizedAchievement(achievement) {
  const meta = getAchievementMeta(achievement.key);
  return {
    ...achievement,
    ...meta
  };
}

function applyI18nPayload(data = {}) {
  if (data.locale) {
    state.locale = data.locale;
  }

  if (data.translations && typeof data.translations === 'object') {
    state.translations = data.translations;
  }
}

function storageKey() {
  return 'fifa-miniapp-token:global';
}

function achievementSeenStorageKey(playerId) {
  return `fifa-achievements-seen:${playerId}`;
}

function readSeenAchievementCounts(playerId) {
  if (!playerId) {
    return {};
  }

  try {
    const rawValue = localStorage.getItem(achievementSeenStorageKey(playerId));
    const parsedValue = rawValue ? JSON.parse(rawValue) : {};

    return parsedValue && typeof parsedValue === 'object' ? parsedValue : {};
  } catch {
    return {};
  }
}

function writeSeenAchievementCounts(playerId, counts) {
  if (!playerId) {
    return;
  }

  try {
    localStorage.setItem(achievementSeenStorageKey(playerId), JSON.stringify(counts ?? {}));
  } catch {
    // Ignore storage failures: awards can still be shown during the current session.
  }
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

function getPluralCategory(count) {
  const number = Math.abs(Number(count));

  if (state.locale === 'en') {
    return number === 1 ? 'one' : 'other';
  }

  const integer = Math.trunc(number);
  const mod10 = integer % 10;
  const mod100 = integer % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return 'one';
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'few';
  }

  return 'many';
}

function getPointWord(count) {
  const forms = getTranslatedObject('rating.point_forms');
  const category = getPluralCategory(count);
  return forms?.[category] || forms?.other || 'points';
}

function normalizeUsername(value = '') {
  return String(value ?? '').trim().replace(/^@/, '').toLowerCase();
}

function getScreenTitle() {
  if (state.manualGameOpen || (state.activeTab === 'teams' && state.teamScreen !== 'list')) {
    return '';
  }

  if (state.activeTab === 'game') {
    return '';
  }

  if (state.activeTab === 'games') {
    return t('common.labels.games');
  }

  if (state.activeTab === 'players') {
    return t('players.title');
  }

  if (state.activeTab === 'teams') {
    return t('common.labels.teams');
  }

  return '';
}

function isGoalkeeperPosition(position) {
  return position === 'GK';
}

function getStatMetaForPosition(position) {
  const meta = isGoalkeeperPosition(position) ? GOALKEEPER_STAT_META : STAT_META;
  return meta.map(([key]) => [key, getStatLabel(key, position)]);
}

function getLocalizedValue(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  return value[state.locale] || value.ru || Object.values(value)[0] || '';
}

function getVenueInfo(location = '') {
  const entry = VENUE_DIRECTORY.find((venue) => venue.match.test(String(location)));

  if (!entry) {
    return null;
  }

  return {
    ...entry,
    venue: getLocalizedValue(entry.venue),
    address: getLocalizedValue(entry.address)
  };
}

function getMapQuery(game, venue) {
  return [venue?.venue, venue?.address].filter(Boolean).join(', ') || game?.location || '';
}

function getMapChoiceOptions(game, venue) {
  const query = getMapQuery(game, venue);
  const encodedQuery = encodeURIComponent(query);

  if (!query) {
    return [];
  }

  return [
    {
      key: 'yandex',
      label: t('maps.yandex'),
      url: venue?.mapUrl || `https://yandex.ru/maps/?text=${encodedQuery}`
    },
    {
      key: 'google',
      label: t('maps.google'),
      url: `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`
    },
    {
      key: 'apple',
      label: t('maps.apple'),
      url: `https://maps.apple.com/?q=${encodedQuery}`
    }
  ];
}

function openExternalLink(url) {
  if (!url) {
    return;
  }

  if (tg?.openLink) {
    tg.openLink(url);
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

function showToast(message, options = {}) {
  toastNode.textContent = message;
  toastNode.classList.toggle('toast--benchmark', options.variant === 'benchmark');
  toastNode.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toastNode.classList.add('hidden');
  }, options.duration ?? 2200);
}

function getProfileBenchmarkLabel(form, statKey, value) {
  const benchmark = getProfileStatBenchmark(getPlayers(), {
    viewerPlayerId: getViewerPlayerId(),
    position: String(form?.elements?.position?.value || 'N/A'),
    statKey,
    value
  });

  if (benchmark.kind === 'top') {
    return t('players.benchmark.top', { percent: benchmark.topPercent });
  }

  return t(`players.benchmark.${benchmark.kind}`);
}

function showProfileBenchmark(form, statKey, value) {
  showToast(getProfileBenchmarkLabel(form, statKey, value), {
    variant: 'benchmark',
    duration: 1800
  });
}

function trackAnalyticsEvent(eventName) {
  window.umami?.track(eventName);
}

function hideCreateGameTooltip() {
  state.showCreateGameTooltip = false;
  clearTimeout(createGameTooltipTimer);
  createGameTooltipTimer = null;
}

function showCreateGameTooltip() {
  if (state.activeTab !== 'games' || state.manualGameOpen) {
    return;
  }

  state.showCreateGameTooltip = true;
  clearTimeout(createGameTooltipTimer);
  createGameTooltipTimer = setTimeout(() => {
    state.showCreateGameTooltip = false;
    createGameTooltipTimer = null;

    if (state.activeTab === 'games' && !state.manualGameOpen) {
      render();
    }
  }, 4000);
}

function hideCreateTeamTooltip() {
  state.showCreateTeamTooltip = false;
  clearTimeout(createTeamTooltipTimer);
  createTeamTooltipTimer = null;
}

function showCreateTeamTooltip() {
  if (state.activeTab !== 'teams' || state.teamScreen !== 'list') {
    return;
  }

  state.showCreateTeamTooltip = true;
  clearTimeout(createTeamTooltipTimer);
  createTeamTooltipTimer = setTimeout(() => {
    state.showCreateTeamTooltip = false;
    createTeamTooltipTimer = null;
    if (state.activeTab === 'teams' && state.teamScreen === 'list') render();
  }, 4000);
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
    lastAuthError = t('auth.open_from_telegram');
    return false;
  }

  let data = null;

  try {
    data = await api('/api/auth/telegram', {
      method: 'POST',
      body: {
        chatId: state.chatId,
        gameId: state.selectedGameId,
        initData: tg.initData,
        locale: getTelegramLocale()
      }
    });
  } catch (error) {
    lastAuthError = t('auth.telegram_failed', { reason: error.message });
    return false;
  }

  state.token = data.token;
  state.snapshot = data.snapshot;
  applyI18nPayload(data);
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
      displayName,
      locale: state.locale || getTelegramLocale()
    }
  });

  state.token = data.token;
  state.snapshot = data.snapshot;
  applyI18nPayload(data);
  state.chatId = state.chatId || data.snapshot?.chat?.id || '';
  localStorage.setItem(storageKey(), state.token);
  render();
  showToast(t('auth.dev_done'));
}

async function loadSnapshot() {
  const params = new URLSearchParams();

  if (state.selectedGameId) {
    params.set('gameId', state.selectedGameId);
  }

  if (state.chatId) {
    params.set('chatId', state.chatId);
  }

  params.set('locale', state.locale || getTelegramLocale());

  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await api(`/api/bootstrap${query}`);
  state.snapshot = data.snapshot;
  applyI18nPayload(data);
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

function getGameById(gameId) {
  const targetId = String(gameId || '');

  if (!targetId) {
    return null;
  }

  return getGameDays().find((game) => game.id === targetId) || getGames().find((game) => game.id === targetId) || null;
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

function getViewerPlayerId() {
  return state.snapshot?.viewerPlayerId || getViewerPlayer()?.id || '';
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
    displayName: [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ') || (username ? `@${username}` : t('players.unknown_player')),
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
  showCreateGameTooltip();
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
    additionalInfo: '',
    playerIds: []
  };
}

function ensureManualGameDraftCreator() {
  if (state.manualGameMode !== 'create') {
    return;
  }

  const viewerPlayerId = getViewerPlayerId();

  if (!viewerPlayerId || state.manualGameDraft.playerIds.includes(viewerPlayerId)) {
    return;
  }

  state.manualGameDraft.playerIds = [viewerPlayerId, ...state.manualGameDraft.playerIds];
}

function openManualGameCreate() {
  resetManualGameState();
  state.manualGameOpen = true;
  ensureManualGameDraftCreator();
  hideCreateGameTooltip();
  render();
}

function getTimeInputStartValue(time) {
  const match = String(time ?? '').match(/([01]\d|2[0-3]):([0-5]\d)/);
  return match ? `${match[1]}:${match[2]}` : '19:30';
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
    time: getTimeInputStartValue(game.time),
    location: game.location || '',
    additionalInfo: [...(game.priceLine ? [game.priceLine] : []), ...(game.paymentLines ?? [])].join('\n'),
    playerIds: [
      ...game.participants.map((player) => player.id),
      ...(game.invitedPlayers ?? []).map((player) => player.id)
    ]
  };
  render();
}

function openManualGameCopy(game) {
  state.gameActionsOpen = false;
  state.manualGameOpen = true;
  state.manualGameMode = 'create';
  state.manualGameGameId = '';
  state.manualGameConfirm = null;
  state.manualPlayerPickerOpen = false;
  state.manualPlayerSearch = '';
  state.manualGameDraft = {
    date: new Date(game.scheduledAt).toISOString().slice(0, 10),
    time: getTimeInputStartValue(game.time),
    location: game.location || '',
    additionalInfo: getGameAdditionalInfo(game),
    playerIds: [
      ...new Set([
        ...game.participants.map((player) => player.id),
        ...(game.invitedPlayers ?? []).map((player) => player.id)
      ])
    ]
  };
  hideCreateGameTooltip();
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

function sortQuickBoosts(boosts = []) {
  return normalizeQuickBoosts(boosts).sort((left, right) => {
    const leftKey = `${left.targetPlayerId}:${left.statKey}`;
    const rightKey = `${right.targetPlayerId}:${right.statKey}`;
    return leftKey.localeCompare(rightKey);
  });
}

function sortQuickAchievements(achievements = []) {
  return normalizeQuickAchievements(achievements)
    .filter((achievement) => achievement.targetPlayerId)
    .sort((left, right) => left.achievementKey.localeCompare(right.achievementKey));
}

function getQuickRatingSnapshot(rating = {}) {
  return {
    mvpPlayerId: String(rating?.mvpPlayerId || ''),
    boosts: sortQuickBoosts(rating?.boosts),
    achievements: sortQuickAchievements(rating?.achievements)
  };
}

function isQuickRatingDraftChanged(game, draft = null) {
  if (!game?.id) {
    return false;
  }

  const currentDraft = draft ?? getQuickRatingDraft(game);
  const baseline = getQuickRatingSnapshot(game.viewerQuickRating || {});
  const current = getQuickRatingSnapshot(currentDraft);
  return JSON.stringify(current) !== JSON.stringify(baseline);
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
    return t('players.not_filled');
  }

  if (game?.hasStarted || game?.ratingWindowOpen || game?.status === 'live' || game?.status === 'finished') {
    return t('players.not_rated');
  }

  return t('players.not_rated_generic');
}

function getCardStatusLabel(player, currentStats = null) {
  if (isPlayerCardUnfilled(player, currentStats)) {
    return t('players.not_filled');
  }

  if (!hasVisibleRating(player, currentStats)) {
    return t('players.not_rated_generic');
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

  return positionLabel === '—' ? t('players.position_not_selected') : getPositionLabel(position, 'short');
}

function renderRatingCountBadge(count, className = 'rating-count-badge') {
  return `
    <span class="${escapeHtml(className)}" aria-label="${escapeHtml(t('rating.already_rated', { count }))}">
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
    return `<span class="editor-status">${escapeHtml(t('players.card_title'))}</span>`;
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
    return `<span class="editor-status">${escapeHtml(t('rating.title'))}</span>`;
  }

  return `<span class="editor-status">${escapeHtml(getEmptyPlayerStatusLabel(gamePlayer, game))}</span>`;
}

function getMonthLabel(monthNumber) {
  const months = getTranslatedObject('common.months');
  return months?.[String(monthNumber)] || '';
}

function getGameDateShort(dateLabel = '', scheduledAt = '') {
  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;

  if (scheduledDate && !Number.isNaN(scheduledDate.getTime())) {
    return `${scheduledDate.getDate()} ${getMonthLabel(scheduledDate.getMonth() + 1)}`.trim();
  }

  const match = String(dateLabel || '').replaceAll(',', ' ').match(GAME_DATE_REGEX);

  if (match) {
    const monthNumber = MONTH_INDEX_BY_RU_LABEL.get(match[2].toLowerCase());
    return `${Number(match[1])} ${getMonthLabel(monthNumber) || match[2].toLowerCase()}`;
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

function getPlayerAchievementCount(player, achievementKey) {
  if (!achievementKey) {
    return 0;
  }

  return Math.max(0, Number(player?.achievementCounts?.[achievementKey] ?? 0));
}

function getEarnedAchievementOptions() {
  const earnedKeys = new Set();

  for (const player of getPlayers()) {
    for (const [achievementKey, count] of Object.entries(player.achievementCounts ?? {})) {
      if (QUICK_ACHIEVEMENT_BY_KEY[achievementKey] && Number(count) > 0) {
        earnedKeys.add(achievementKey);
      }
    }
  }

  return QUICK_ACHIEVEMENTS
    .filter((achievement) => earnedKeys.has(achievement.key))
    .map((achievement) => getAchievementMeta(achievement.key));
}

function sortPlayers(players) {
  return [...players].sort((left, right) => {
    if (left.isMvp !== right.isMvp) {
      return left.isMvp ? -1 : 1;
    }

    if (state.achievementFilter) {
      const leftAchievementCount = getPlayerAchievementCount(left, state.achievementFilter);
      const rightAchievementCount = getPlayerAchievementCount(right, state.achievementFilter);

      if (rightAchievementCount !== leftAchievementCount) {
        return rightAchievementCount - leftAchievementCount;
      }
    }

    if (state.skillFilter) {
      const leftValue = Number(left.stats?.[state.skillFilter] ?? 0);
      const rightValue = Number(right.stats?.[state.skillFilter] ?? 0);

      if (rightValue !== leftValue) {
        return rightValue - leftValue;
      }
    } else if (state.activeSort === 'position') {
      const leftOrder = getSortPosition(left.position);
      const rightOrder = getSortPosition(right.position);

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
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

    return left.displayName.localeCompare(right.displayName, state.locale || 'ru');
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

function renderProfileEntryButton() {
  const player = getViewerPlayer();

  if (!player) {
    return '';
  }

  const rating = hasVisibleRating(player) ? getPlayerOverallLabel(player) : '';
  const shouldFillProfile = !rating && isPlayerCardUnfilled(player);

  return `
    <button type="button" class="profile-entry-button" data-open-profile-entry aria-label="${escapeHtml(t('common.labels.profile'))}">
      <span class="profile-entry-avatar">${renderMiniAvatar(player)}</span>
      ${rating ? `<span class="profile-entry-rating">${escapeHtml(rating)}</span>` : ''}
      ${shouldFillProfile ? '<span class="profile-entry-dot" aria-hidden="true"></span>' : ''}
    </button>
  `;
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
              ${escapeHtml(getPositionLabel(position, 'title'))}
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

function formatMetricLabel(label) {
  const text = String(label || '').trim();
  return text ? text.charAt(0).toLocaleUpperCase('ru-RU') + text.slice(1) : '';
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
      <span>${escapeHtml(formatMetricLabel(label))}</span>
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
  const showPositionSelector = isRatingCard || Boolean(options.showPositionSelector);
  const editablePosition = Boolean(options.editablePosition);
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
    { label: t('stats.games'), value: hideMatchDetailsUntilViewerRates ? statPlaceholder : player.games }
  ];
  const statCells = statMeta.map(([key, label]) => [
    label,
    !hideMatchDetailsUntilViewerRates && showKnownStats ? statValues[key] : statPlaceholder
  ]);
  const openAttribute = clickable ? ` data-open-player="${escapeHtml(player.id)}"` : '';
  const actionNote = isRatingCard && ratingsCount > 0 ? t('rating.already_rated', { count: ratingsCount }) : '';
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
                <span>${escapeHtml(getPositionLabel(position, 'card'))}</span>
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
          showPositionSelector
            ? editablePosition
              ? renderEditablePositionSelector(
                  t('common.labels.position'),
                  effectivePosition === 'N/A' ? t('common.misc.not_selected') : getPositionLabel(effectivePosition, 'title'),
                  effectivePosition,
                  true
                )
              : renderPositionSelector(t('common.labels.position'), effectivePosition === 'N/A' ? t('common.misc.not_selected') : getPositionLabel(effectivePosition, 'title'))
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
        <span>${escapeHtml(t('common.labels.cards'))}</span>
        <input type="checkbox" name="cardsEnabled" data-cards-toggle ${enabled ? 'checked' : ''}>
        <i aria-hidden="true"></i>
      </label>
      <div class="editor-cards-controls">
        ${renderEditorCardStepper('yellowCards', t('common.labels.yellow_cards'), 'yellow', cards.yellow, 2)}
        ${renderEditorCardStepper('redCards', t('common.labels.red_card'), 'red', cards.red, 1)}
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
        aria-label="${escapeHtml(t('common.aria.decrease', { label }))}"
      >−</button>
      <span>${escapeHtml(label)}</span>
      <strong><span data-stepper-value>${escapeHtml(safeValue)}</span></strong>
      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(safeValue)}" min="1" max="99">
      <button
        type="button"
        data-stepper-action="increment"
        data-stepper-name="${escapeHtml(name)}"
        aria-label="${escapeHtml(t('common.aria.increase', { label }))}"
      >+</button>
    </div>
  `;
}

function renderEditorScreen(player, gamePlayer, editable, defaults, game) {
  const currentStats = gamePlayer?.currentGameStats ?? null;
  const statMeta = getStatMetaForPosition(defaults.position);
  const isGoalkeeper = isGoalkeeperPosition(defaults.position);

  if (!editable) {
    return `
      <div class="editor-overlay player-preview-overlay" data-modal-backdrop="true">
        <section class="player-preview-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(player.displayName)}">
          <button class="editor-close player-preview-close" type="button" data-close-modal="true" aria-label="${escapeHtml(t('common.buttons.close'))}">×</button>
          ${renderFifaCard(player, {
            currentStats,
            variant: 'player-preview',
            clickable: false,
            showPositionSelector: true
          })}
        </section>
      </div>
    `;
  }

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
          <div class="editor-form editor-form--quick">
            <div class="quick-rating-block">
              <span class="quick-rating-label">${escapeHtml(t('mvp.vote_title'))}</span>
              ${renderQuickRatingMvpButton(player, game, getQuickRatingDraft(game))}
            </div>
            <div class="quick-rating-block">
              <span class="quick-rating-label">${escapeHtml(t('rating.stat_points'))}</span>
              <p class="quick-rating-hint">${escapeHtml(t('rating.stat_points_hint', { count: QUICK_RATING_POINTS }))}</p>
              ${renderQuickStatControls(player, game, getQuickRatingDraft(game))}
            </div>
            ${isQuickRatingDraftChanged(game) ? `<button type="button" class="primary-button card-action editor-submit" data-submit-quick-rating="${escapeHtml(game.id)}">${escapeHtml(t('common.buttons.save'))}</button>` : ''}
                </div>
        </div>
      </section>
    </div>
  `;
}

function renderGameHeader(game) {
  const statusText = game.status === 'upcoming' ? t('match.forward') : game.status === 'live' ? t('match.live') : t('match.finished');
  const venue = getVenueInfo(game.location);
  const playerCountBadges = renderPlayerCountBadges(game.playersCount ?? game.participants.length, game);
  const mapOptions = getMapChoiceOptions(game, venue);

  return `
    <section class="panel game-info-panel ${game.ratingWindowOpen ? 'game-info-panel--rating' : ''}">
      <div class="game-summary">
        <div>
          <h2>${escapeHtml(getGameDateShort(game.dateLabel, game.scheduledAt))}</h2>
        </div>
        <span class="status-pill ${escapeHtml(game.status)}">${escapeHtml(statusText)}</span>
      </div>
      <div class="game-facts">
        <div class="game-stat-field game-stat-field--badges">
          <span>${escapeHtml(t('common.labels.time'))}</span>
          <strong class="game-card-badges-value">
            <span class="game-level-badges">
              <span class="game-level-badge game-level-rating game-time-badge">${escapeHtml(game.time)}</span>
            </span>
          </strong>
        </div>
        <div class="game-stat-field game-stat-field--badges">
          <span>${escapeHtml(t('common.labels.players'))}</span>
          <strong class="game-card-badges-value">${playerCountBadges}</strong>
        </div>
      </div>
      <div class="game-venue">
        <div class="game-venue-copy">
          <span>${escapeHtml(t('common.labels.location'))}</span>
          <strong>${escapeHtml(venue?.venue || game.location || t('common.misc.not_specified'))}</strong>
          <p>${escapeHtml(venue?.address || game.location || t('common.misc.not_specified'))}</p>
        </div>
        ${
          mapOptions.length
            ? `
              <button type="button" class="map-icon-button" data-open-map-choice="true" aria-label="${escapeHtml(t('common.buttons.open_map'))}">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 2.75a7.15 7.15 0 0 0-7.15 7.15c0 4.95 5.33 9.98 6.72 11.2a.66.66 0 0 0 .86 0c1.39-1.22 6.72-6.25 6.72-11.2A7.15 7.15 0 0 0 12 2.75Zm0 9.85a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4Z"></path>
                </svg>
              </button>
            `
            : ''
        }
      </div>
    </section>
  `;
}

function getGameAdditionalInfo(game) {
  return [...(game.priceLine ? [game.priceLine] : []), ...(game.paymentLines ?? [])]
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .join('\n');
}

function getTelegramProfileUrl(player) {
  const username = normalizeUsername(player?.username);

  return username ? `https://t.me/${encodeURIComponent(username)}` : '';
}

function renderOrganizerPanel(game) {
  const organizer = getPlayer(game.organizerPlayerId);
  const additionalInfo = getGameAdditionalInfo(game);

  if (!organizer && !additionalInfo) {
    return '';
  }

  const telegramUrl = getTelegramProfileUrl(organizer);

  return `
    <section class="panel game-organizer-panel">
      <h2>${escapeHtml(t('match.organizer'))}</h2>
      ${
        organizer
          ? `
            <div class="game-organizer-row">
              <span class="game-organizer-avatar">${renderMiniAvatar(organizer)}</span>
              <span class="game-organizer-copy">
                <strong>${escapeHtml(organizer.displayName)}</strong>
                <small>@${escapeHtml(organizer.username || 'unknown')}</small>
              </span>
              ${
                telegramUrl
                  ? `
                    <button type="button" class="game-action-button game-organizer-write" data-open-external-link="${escapeHtml(telegramUrl)}" aria-label="${escapeHtml(t('common.buttons.write'))}">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6.55 17.28h-.98a2.8 2.8 0 0 1-2.8-2.8V6.55a2.8 2.8 0 0 1 2.8-2.8h12.86a2.8 2.8 0 0 1 2.8 2.8v7.93a2.8 2.8 0 0 1-2.8 2.8h-5.5l-4.46 3.35a1.2 1.2 0 0 1-1.92-.96v-2.39Zm.2-7.75a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm5.25 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm5.25 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"></path>
                      </svg>
                    </button>
                  `
                  : ''
              }
            </div>
          `
          : ''
      }
      ${
        additionalInfo
          ? `
            <div class="game-stat-field game-organizer-additional">
              <span>${escapeHtml(t('common.labels.details'))}</span>
              <strong>${escapeHtml(additionalInfo).replace(/\n/g, '<br>')}</strong>
            </div>
          `
          : ''
      }
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
            <p>${escapeHtml(t('rating.for_participants_started'))}</p>
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
          <p>${escapeHtml(t('rating.give_points'))}</p>
          ${timer}
        </div>
        <div class="rating-live-chips">
          <span>${escapeHtml(t('rating.points_left', {
            count: remainingPoints,
            word: getPointWord(remainingPoints)
          }))}</span>
          ${
            ratedCount
              ? `<span>${escapeHtml(t('rating.already_rated', { count: ratedCount }))}</span>`
              : ''
          }
        </div>
      </section>
    `;
  }

  if (game.hasStarted && !game.ratingWindowOpen) {
    return '';
  }

  let message = t('rating.available_after_start');

  if (game.hasStarted && !game.viewerIsParticipant) {
    message = t('rating.not_allowed');
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
      <option value="">${escapeHtml(t('rating.not_selected'))}</option>
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
  const achievement = getAchievementMeta(achievementKey);

  if (!achievement?.key) {
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
  const achievement = getAchievementMeta(achievementKey);

  if (!achievement?.key) {
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
    const category = achievement.categoryKey ? t(`achievements.category.${achievement.categoryKey}`) : (achievement.category || t('achievements.category.other'));
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
                <div
                  class="quick-achievement-option"
                  role="button"
                  tabindex="0"
                  data-add-quick-achievement="${escapeHtml(achievement.key)}"
                  data-game-id="${escapeHtml(game.id)}"
                >
                  <span class="quick-achievement-option-title">${escapeHtml(getAchievementMeta(achievement.key).title)}</span>
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
      <h2>${escapeHtml(t('rating.title'))}</h2>
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
                  ${escapeHtml(t('common.buttons.add'))}
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

  const hasChanges = isQuickRatingDraftChanged(game);

  if (!hasChanges) {
    return '';
  }

  return `
    <div class="quick-floating-save">
      <button type="button" class="primary-button" data-submit-quick-rating="${escapeHtml(game.id)}">${escapeHtml(t('common.buttons.save'))}</button>
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
                aria-label="${escapeHtml(t('common.aria.decrease', { label }))}"
              >−</button>
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(points ? `+${points}` : '+')}</strong>
              <button
                type="button"
                data-quick-boost-add="${escapeHtml(player.id)}"
                data-quick-boost-stat="${escapeHtml(key)}"
                data-game-id="${escapeHtml(game.id)}"
                ${disabled ? 'disabled' : ''}
                aria-label="${escapeHtml(t('common.aria.increase', { label }))}"
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

function getPlayerAchievementCounts(player) {
  return Object.fromEntries(
    Object.entries(player?.achievementCounts ?? {})
      .map(([key, count]) => [key, Math.max(0, Math.round(Number(count ?? 0)))])
      .filter(([key, count]) => count > 0 && QUICK_ACHIEVEMENT_BY_KEY[key])
  );
}

function getNewAchievementAwards(player) {
  if (!player?.id) {
    return [];
  }

  const currentCounts = getPlayerAchievementCounts(player);
  const seenCounts = readSeenAchievementCounts(player.id);

  return Object.entries(currentCounts)
    .filter(([key, count]) => count > Math.max(0, Math.round(Number(seenCounts[key] ?? 0))))
    .map(([key, count]) => ({
      key,
      count,
      delta: count - Math.max(0, Math.round(Number(seenCounts[key] ?? 0)))
    }))
    .sort((left, right) => {
      const leftIndex = QUICK_ACHIEVEMENTS.findIndex((achievement) => achievement.key === left.key);
      const rightIndex = QUICK_ACHIEVEMENTS.findIndex((achievement) => achievement.key === right.key);
      return leftIndex - rightIndex;
    });
}

function syncAchievementAwards() {
  if (state.achievementAwardsChecked || state.achievementAwardQueue.length || state.achievementDetailKey) {
    return;
  }

  const player = getViewerPlayer();

  if (!player?.id) {
    return;
  }

  const newAwards = getNewAchievementAwards(player);
  state.achievementAwardsChecked = true;

  if (!newAwards.length) {
    return;
  }

  state.achievementAwardQueue = newAwards;
  state.achievementAwardIndex = 0;
  writeSeenAchievementCounts(player.id, getPlayerAchievementCounts(player));
}

function dismissAchievementAwards() {
  const player = getViewerPlayer();

  if (player?.id) {
    writeSeenAchievementCounts(player.id, getPlayerAchievementCounts(player));
  }

  state.achievementAwardQueue = [];
  state.achievementAwardIndex = 0;
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
      <span>${escapeHtml(t('players.achievements'))}</span>
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
                ${achievement.count > 1 ? `<span class="achievement-counter">${escapeHtml(achievement.count)}</span>` : ''}
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
        aria-label="${escapeHtml(t('common.aria.decrease', { label }))}"
      >−</button>
      <span>${escapeHtml(label)}</span>
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
        aria-label="${escapeHtml(t('common.aria.increase', { label }))}"
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
      <div class="quick-game-card-head is-clickable" data-open-player="${escapeHtml(player.id)}">
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

function getFieldTeams(game) {
  return splitBalancedTeams(game.participants ?? [], state.fieldTeamCount);
}

function getSelectedFieldTeam(game) {
  const teams = getFieldTeams(game);
  const requestedTeam = teams.find((team) => team.key === state.fieldTeamFilter && team.players.length);

  return requestedTeam || teams.find((team) => team.players.length) || teams[0] || { key: 'top', players: [] };
}

function renderFieldTeamControl(activeTeamKey, game) {
  const teamCount = Math.min(state.fieldTeamCount, getMaximumTeamCount(game.participants?.length ?? 0));
  const teamMeta = [
    { key: 'top', asset: 'shirt-white-44.svg' },
    { key: 'bottom', asset: 'shirt-red-44.svg' },
    { key: 'green', asset: 'shirt-green-44.svg' },
    { key: 'blue', asset: 'shirt-blue-44.svg' }
  ].slice(0, teamCount);
  const canChangeTeamCount = Boolean(game.canViewerEditTeamCount);
  const canAddTeam = canChangeTeamCount && teamCount < getMaximumTeamCount(game.participants?.length ?? 0);
  const canResetTeams = canChangeTeamCount && teamCount === 4;
  const countAction = canResetTeams
    ? `<button type="button" class="field-team-count-button" data-field-team-count-action="reset" aria-label="${escapeHtml(t('match.reset_teams'))}">&times;</button>`
    : canAddTeam
      ? `<button type="button" class="field-team-count-button" data-field-team-count-action="add" aria-label="${escapeHtml(t('match.add_team'))}">+</button>`
      : '';

  return `
    <div class="field-team-control" aria-label="${escapeHtml(t('match.teams'))}">
      ${teamMeta.map((team, index) => `
        <button type="button" class="${activeTeamKey === team.key ? 'active' : ''}" data-field-team-filter="${team.key}" aria-label="${escapeHtml(`${t('match.teams')} ${index + 1}`)}">
          <img src="/assets/field/${team.asset}" alt="">
        </button>
      `).join('')}
      ${countAction}
    </div>
  `;
}

function renderField(game, options = {}) {
  const participants = game.participants ?? [];
  const selectedTeam = options.showTeamControl ? getSelectedFieldTeam(game) : null;
  const fieldPlayers = options.singleField || !options.showTeamControl
    ? participants
    : selectedTeam.players;
  const selectedTeamIndex = getFieldTeams(game).findIndex((team) => team.key === selectedTeam?.key);
  const shouldMirrorTeam = Boolean(options.showTeamControl && !options.singleField && selectedTeamIndex % 2 === 1);
  const assignments = buildFullFieldAssignments(fieldPlayers).map(({ player, slot }) => ({
    player,
    slot: shouldMirrorTeam ? { ...slot, x: 100 - slot.x } : slot
  }));
  const emptyMessage = !participants.length ? options.emptyMessage : '';

  return `
    <section class="panel field-panel field-panel--static ${options.className ? escapeHtml(options.className) : ''}">
      <div class="field">
        <div class="field-image field-image--top" aria-hidden="true">
          <img src="/assets/field/field-pull-down-topview-cropped-clean.webp" alt="">
        </div>
        ${emptyMessage ? `<div class="field-empty">${escapeHtml(emptyMessage)}</div>` : ''}
        <div class="field-player-layer">
          ${assignments
            .map(({ player, slot }) => {
              const isInteractive = options.interactive !== false && Boolean(player.id);
              const openAttribute = isInteractive ? `data-open-player="${escapeHtml(player.id)}"` : '';
              const ratingLabel = getGameMiniCardRatingLabel(player, game);
              return `
                <button
                  type="button"
                  class="field-player-card ${isInteractive ? '' : 'field-player-card--static'}"
                  ${openAttribute}
                  style="left:${slot.x}%; top:${slot.y}%"
                >
                  <div class="field-player-photo">
                    ${renderMiniAvatar(player)}
                    ${ratingLabel ? `<span class="field-player-rating-badge">${escapeHtml(ratingLabel)}</span>` : ''}
                  </div>
                  <span class="field-player-name">${escapeHtml(player.displayName.split(' ')[0])}</span>
                </button>
              `;
            })
            .join('')}
        </div>
      </div>
    </section>
  `;
}

function renderGamePlayerRow(player) {
  const game = getCurrentGame();
  const positionLabel = getGamePlayerPositionLabel(player);

  return `
    <article class="game-player-row is-clickable" data-open-player="${escapeHtml(player.id)}">
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
  const positionLabel = getPositionLabel(player.position || 'N/A', 'short');
  const statusBadge = isPlayerCardUnfilled(player)
    ? t('players.not_filled')
    : rating
      ? ''
      : getEmptyPlayerStatusLabel(player, game);
  const actions = [
    player.canViewerAcceptInvite
      ? `<button type="button" class="primary-button join-request-action" data-accept-game-invite="${escapeHtml(game.id)}">${escapeHtml(t('common.buttons.accept'))}</button>`
      : '',
    player.canViewerDeclineInvite
      ? `<button type="button" class="ghost-action join-request-action" data-decline-game-invite="${escapeHtml(game.id)}">${escapeHtml(t('common.buttons.decline'))}</button>`
      : '',
    player.canViewerApproveJoin
      ? `<button type="button" class="primary-button join-request-action" data-approve-join-player="${escapeHtml(player.id)}" data-game-id="${escapeHtml(game.id)}">${escapeHtml(t('common.buttons.add'))}</button>`
      : ''
  ].filter(Boolean);
  const actionClass = actions.length === 1 ? 'join-request-actions join-request-actions--single' : 'join-request-actions';

  return `
    <article class="game-player-row join-request-card ${actions.length ? 'join-request-card--with-actions' : ''} is-clickable" data-open-player="${escapeHtml(player.id)}">
      <div class="game-player-avatar">${renderMiniAvatar(player)}</div>
      <div class="game-player-main">
        <strong>${escapeHtml(player.displayName)}</strong>
        <span>${escapeHtml(positionLabel === '—' ? t('players.no_position') : positionLabel)}</span>
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
      <button type="button" class="primary-button join-cta-button" data-join-game="${escapeHtml(game.id)}">${escapeHtml(t('common.buttons.join'))}</button>
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
    <section class="panel game-roster-panel">
      <h2>${escapeHtml(t('match.squad'))}</h2>
      <div class="game-player-list">
        ${players.map((player) => renderGamePlayerRow(player)).join('')}
      </div>
    </section>
  `;
}

function renderRosterLockControls(game) {
  if (!game.canViewerToggleRosterLock || game.status !== 'upcoming' || game.ratingWindowOpen) {
    return '';
  }

  const nextLocked = !game.rosterLocked;
  const label = game.rosterLocked ? t('match.roster_lock_open') : t('match.roster_lock_closed');

  return `
    <section class="roster-lock-actions">
      <button
        type="button"
        class="${game.rosterLocked ? 'ghost-action' : 'primary-button'} roster-lock-button"
        data-toggle-roster-lock="${escapeHtml(game.id)}"
        data-roster-locked="${escapeHtml(String(nextLocked))}"
      >
        ${escapeHtml(label)}
      </button>
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
    <section class="panel game-roster-panel join-requests-panel">
      <h2>${escapeHtml(t('match.waiting'))}</h2>
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
        <h2>${escapeHtml(t('match.no_current_game'))}</h2>
        <p>${escapeHtml(t('match.no_current_game_description'))}</p>
      </section>
    `;
  }

  const isRatingMode = Boolean(game.ratingWindowOpen && game.canViewerRate);

  return `
    ${renderField(game, { showTeamControl: true })}
    ${renderGameHeader(game)}
    ${game.ratingWindowOpen ? '' : renderOrganizerPanel(game)}
    ${renderRatingBanner(game)}
    ${isRatingMode ? renderQuickRatingPanel(game) : ''}
    ${isRatingMode ? '' : renderJoinControls(game)}
    ${renderGamePlayersList(game)}
    ${isRatingMode ? '' : renderWaitingPlayersSection(game)}
    ${isRatingMode ? '' : renderRosterLockControls(game)}
    ${isRatingMode ? renderQuickFloatingSave(game) : ''}
  `;
}

function getGameStatusLabel(status) {
  if (status === 'upcoming') {
    return t('match.soon');
  }

  return status === 'live' ? t('match.live') : t('match.finished');
}

function getGameLevelMeta(averageOverall) {
  const rating = Number(averageOverall);

  if (!Number.isFinite(rating) || rating <= 0) {
    return null;
  }

  if (rating < 55) {
    return { label: t('match.level_low'), tone: 'low', rating: Math.round(rating) };
  }

  if (rating < 70) {
    return { label: t('match.level_mid'), tone: 'mid', rating: Math.round(rating) };
  }

  return { label: t('match.level_high'), tone: 'high', rating: Math.round(rating) };
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

function renderPlayerCountBadges(count, game) {
  const shouldShowRosterStatus = game.status === 'upcoming';
  const rosterLabel = game.rosterLocked ? t('match.lineup_closed') : t('match.lineup_open');
  const rosterTone = game.rosterLocked ? 'roster-closed' : 'roster-open';

  return `
    <span class="game-level-badges game-roster-badges">
      <span class="game-level-badge game-level-rating">${escapeHtml(count)}</span>
      ${
        shouldShowRosterStatus
          ? `<span class="game-level-badge game-level-badge--${escapeHtml(rosterTone)}">${escapeHtml(rosterLabel)}</span>`
          : ''
      }
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
            ${escapeHtml(t(filter.labelKey))}
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
          <h2>${escapeHtml(getGameDateShort(game.dateLabel, game.scheduledAt))}</h2>
          <p>${escapeHtml(game.time)}</p>
        </div>
        <span class="status-pill ${escapeHtml(game.status)}">${escapeHtml(getGameStatusLabel(game.status))}</span>
      </div>
      <p class="game-card-location">${escapeHtml(game.location || t('common.misc.not_specified'))}</p>
      <div class="game-card-stats">
        ${
          game.status !== 'upcoming' && mvpBadges
            ? `
              <div class="game-stat-field game-stat-field--badges game-stat-field--full game-stat-field--mvp">
                <span>MVP</span>
                <strong class="game-card-badges-value">${mvpBadges}</strong>
              </div>
            `
            : ''
        }
        <div class="game-card-stats-row">
          <div class="game-stat-field game-stat-field--badges">
            <span>${escapeHtml(t('common.labels.players'))}</span>
            <strong class="game-card-badges-value">${renderPlayerCountBadges(game.playersCount, game)}</strong>
          </div>
          ${
            gameLevelBadges
              ? `
                <div class="game-stat-field game-stat-field--badges">
                  <span>${escapeHtml(t('match.level'))}</span>
                  <strong class="game-card-badges-value">${gameLevelBadges}</strong>
                </div>
              `
              : ''
          }
        </div>
        ${
          hasDisciplineCards(game.cards)
            ? `
              <div class="game-stat-field game-stat-field--badges">
                <span>${escapeHtml(t('common.labels.cards'))}</span>
                <strong class="game-card-cards">${renderDisciplineCards(game.cards, 'game-summary-cards')}</strong>
              </div>
            `
            : ''
        }
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

  ensureManualGameDraftCreator();
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
        <small>${escapeHtml(position === '—' ? t('players.no_position') : position)}</small>
      </span>
    </button>
  `;
}

function renderManualSelectedPlayers() {
  const selectedPlayers = getManualSelectedPlayers();

  if (!selectedPlayers.length) {
    return `<p class="manual-selected-empty">${escapeHtml(t('match.players_selected_empty'))}</p>`;
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
    <section class="manual-player-picker" aria-label="${escapeHtml(t('match.picker_label'))}">
      ${
        players.length
          ? players.map((player) => renderManualPlayerCard(player)).join('')
          : `<p class="achievement-empty">${escapeHtml(t('match.picker_empty'))}</p>`
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
    : `<p class="achievement-empty">${escapeHtml(t('match.picker_empty'))}</p>`;
}

function resizeManualTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function resizeManualTextareas(root = document) {
  root.querySelectorAll('textarea[data-manual-autosize]').forEach((textarea) => {
    resizeManualTextarea(textarea);
  });
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
    interactive: false,
    static: true,
    emptyMessage: t('match.field_empty')
  });
}

function readManualGameForm(form) {
  const formData = new FormData(form);

  return {
    date: String(formData.get('date') || ''),
    time: String(formData.get('time') || ''),
    location: String(formData.get('location') || '').trim(),
    additionalInfo: String(formData.get('additionalInfo') || '').trim(),
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
        <section class="modal-card confirm-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('match.manual_confirm'))}">
          <button class="modal-close" type="button" data-close-create-game="true">×</button>
          <h2>${escapeHtml(t('match.manual_confirm'))}</h2>
          <p>${escapeHtml(t('match.manual_confirm_description'))}</p>
          <div class="confirm-actions">
            <button type="button" class="primary-button" data-create-game-confirm="yes">${escapeHtml(t('common.buttons.yes'))}</button>
            <button type="button" class="ghost-action" data-create-game-confirm="skip">${escapeHtml(t('common.buttons.pass'))}</button>
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
    <section class="create-game-screen" aria-label="${escapeHtml(isEditing ? t('match.edit_game') : t('match.new_game'))}">
      <header class="create-game-header">
        <h2>${escapeHtml(isEditing ? t('match.edit_game') : t('match.new_game'))}</h2>
        <button class="create-game-close" type="button" data-close-create-game="true" aria-label="${escapeHtml(t('common.buttons.close'))}">×</button>
      </header>
      <form id="manualGameForm" class="manual-game-form">
        <section class="panel create-game-details">
          <div class="game-summary">
            <div>
              <h2>${escapeHtml(t('match.details_title'))}</h2>
            </div>
          </div>
          <div class="manual-fields">
            <label>
              <span>${escapeHtml(t('common.labels.date'))}</span>
              <input type="date" name="date" min="${escapeHtml(toDateInputValue(new Date()))}" value="${escapeHtml(state.manualGameDraft.date)}" required>
            </label>
            <label>
              <span>${escapeHtml(t('common.labels.time'))}</span>
              <input type="time" name="time" value="${escapeHtml(state.manualGameDraft.time)}" required>
            </label>
            <label class="manual-field-wide">
              <span>${escapeHtml(t('common.labels.location'))}</span>
              <textarea name="location" rows="1" data-manual-autosize="true" placeholder="${escapeHtml(t('match.location_placeholder'))}" required>${escapeHtml(state.manualGameDraft.location)}</textarea>
            </label>
            <label class="manual-field-wide">
              <span>${escapeHtml(t('common.labels.details'))}</span>
              <textarea name="additionalInfo" rows="1" data-manual-autosize="true" placeholder="${escapeHtml(t('match.additional_placeholder'))}">${escapeHtml(state.manualGameDraft.additionalInfo)}</textarea>
            </label>
          </div>
        </section>
        <section class="panel manual-player-panel">
          <div class="manual-section-title">
            <h3>${escapeHtml(t('match.players_title'))}</h3>
            <span>${escapeHtml(t('match.players_selected', { count: state.manualGameDraft.playerIds.length }))}</span>
          </div>
          <div class="manual-player-search-wrap">
            <input
              type="search"
              class="manual-player-search"
              name="playerSearch"
              value="${escapeHtml(state.manualPlayerSearch)}"
              placeholder="${escapeHtml(t('match.players_search'))}"
              autocomplete="off"
              data-manual-player-search="true"
            >
            ${renderManualPlayerPicker()}
          </div>
          ${renderManualSelectedPlayers()}
        </section>
        ${renderManualFieldPreview()}
        <button type="submit" class="primary-button card-action manual-submit">${escapeHtml(isEditing ? t('common.buttons.save') : t('common.buttons.create'))}</button>
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
      <section class="modal-card game-actions-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('match.actions'))}">
        <h2>${escapeHtml(t('match.actions'))}</h2>
        <button type="button" class="game-action-button" data-share-game="true">${escapeHtml(t('common.buttons.share_game'))}</button>
        <button type="button" class="game-action-button" data-copy-game="${escapeHtml(game.id)}">${escapeHtml(t('common.buttons.copy_game'))}</button>
        ${
          game.canViewerManage
            ? `
              <button type="button" class="game-action-button" data-edit-game="true">${escapeHtml(t('common.buttons.edit'))}</button>
              <button type="button" class="game-action-button game-action-button--danger" data-delete-game="true">${escapeHtml(t('common.buttons.delete'))}</button>
            `
            : ''
        }
      </section>
    </div>
  `;
}

function renderTeamActionsModal() {
  const team = getSelectedTeam();

  if (!state.teamActionsOpen || !team?.canManage) {
    return '';
  }

  return `
    <div class="modal-backdrop modal-backdrop--compact" data-team-actions-backdrop="true">
      <section class="modal-card game-actions-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('teams.actions'))}">
        <h2>${escapeHtml(t('teams.actions'))}</h2>
        <button type="button" class="game-action-button" data-edit-team="${escapeHtml(team.id)}">${escapeHtml(t('common.buttons.edit'))}</button>
        <button type="button" class="game-action-button game-action-button--danger" data-delete-team="${escapeHtml(team.id)}">${escapeHtml(t('common.buttons.delete'))}</button>
      </section>
    </div>
  `;
}

function renderTeamAvatarActionsModal() {
  const team = getSelectedTeam();

  if (!state.teamAvatarActionsOpen || !team?.canManage) {
    return '';
  }

  return `
    <div class="modal-backdrop modal-backdrop--compact" data-team-avatar-actions-backdrop="true">
      <section class="modal-card game-actions-card team-avatar-actions-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('teams.logo_actions'))}">
        <h2>${escapeHtml(t('teams.logo_actions'))}</h2>
        <label class="game-action-button team-avatar-action-upload">
          <input type="file" accept="image/png,image/jpeg,image/webp" data-team-logo-input>
          <span>${escapeHtml(t(team.imageUrl ? 'teams.change_avatar' : 'teams.upload_avatar'))}</span>
        </label>
        ${team.imageUrl ? `<button type="button" class="game-action-button game-action-button--danger" data-delete-team-logo>${escapeHtml(t('teams.remove_avatar'))}</button>` : ''}
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
      <section class="modal-card profile-actions-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('players.settings'))}">
        <h2>${escapeHtml(t('players.settings'))}</h2>
        <label class="language-select-field">
          <span class="language-select-label">${escapeHtml(t('settings.language.label'))}</span>
          <span class="language-select-control">
            <select data-locale-select aria-label="${escapeHtml(t('settings.language.choose'))}">
              <option value="ru" ${state.locale === 'ru' ? 'selected' : ''}>${escapeHtml(t('settings.language.ru_short'))}</option>
              <option value="en" ${state.locale === 'en' ? 'selected' : ''}>${escapeHtml(t('settings.language.en_short'))}</option>
            </select>
          </span>
        </label>
        <button type="button" class="game-action-button" data-share-profile="true">${escapeHtml(t('common.buttons.share_card'))}</button>
        <button type="button" class="game-action-button" data-edit-self-profile="true">${escapeHtml(t('common.buttons.edit'))}</button>
      </section>
    </div>
  `;
}

function renderMapChoiceModal() {
  if (!state.mapChoice?.options?.length) {
    return '';
  }

  return `
    <div class="modal-backdrop modal-backdrop--compact" data-map-choice-backdrop="true">
      <section class="modal-card game-actions-card map-choice-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('maps.title'))}">
        <h2>${escapeHtml(t('maps.title'))}</h2>
        ${state.mapChoice.options
          .map((option) => `
            <button type="button" class="game-action-button" data-open-map-option="${escapeHtml(option.key)}">
              ${escapeHtml(option.label)}
            </button>
          `)
          .join('')}
      </section>
    </div>
  `;
}

function renderAchievementDetailModal() {
  if (!state.achievementDetailKey) {
    return '';
  }

  const achievement = getAchievementMeta(state.achievementDetailKey);

  if (!achievement?.key) {
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

function renderAchievementAwardModal() {
  const awards = state.achievementAwardQueue;
  const awardIndex = Math.min(Math.max(0, state.achievementAwardIndex), Math.max(0, awards.length - 1));
  const award = awards[awardIndex];
  const achievement = getAchievementMeta(award?.key);

  if (!achievement?.key) {
    return '';
  }

  const remainingCount = Math.max(0, awards.length - awardIndex - 1);

  return `
    <div class="modal-backdrop modal-backdrop--center" data-achievement-award-backdrop="true">
      <section class="modal-card achievement-detail-card achievement-award-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(achievement.title)}">
        <button type="button" class="editor-close achievement-detail-close" data-close-achievement-award="true">×</button>
        <div class="achievement-detail-icon">${renderAchievementIcon(achievement.key)}</div>
        <span class="achievement-award-badge">${escapeHtml(t('achievements.award_badge'))}</span>
        <h2>${escapeHtml(achievement.title)}</h2>
        <p>${escapeHtml(achievement.description)}</p>
        <div class="achievement-award-actions ${remainingCount > 0 ? 'achievement-award-actions--split' : ''}">
          <button type="button" class="primary-button" data-close-achievement-award="true">${escapeHtml(t('common.buttons.ok'))}</button>
          ${
            remainingCount > 0
              ? `<button type="button" class="ghost-action" data-next-achievement-award="true">${escapeHtml(t('common.buttons.next', { count: remainingCount }))}</button>`
              : ''
          }
        </div>
      </section>
    </div>
  `;
}

function hasAchievementAwardModalOpen() {
  return state.achievementAwardQueue.length > 0;
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
    !hasAchievementAwardModalOpen() &&
    !state.profileActionsOpen
  );
}

function renderSelfProfilePromptModal() {
  if (!shouldShowSelfProfilePrompt()) {
    return '';
  }

  return `
    <div class="modal-backdrop modal-backdrop--center" data-self-profile-prompt-backdrop="true">
      <section class="modal-card self-profile-prompt" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('players.self_profile_prompt_title'))}">
        <button class="modal-close" type="button" data-dismiss-self-profile-prompt="true">×</button>
        <h2>${escapeHtml(t('players.self_profile_prompt_title'))}</h2>
        <p>${escapeHtml(t('players.self_profile_prompt_description'))}</p>
        <button type="button" class="primary-button" data-start-self-profile="true">${escapeHtml(t('common.buttons.enter'))}</button>
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
            <h2>${escapeHtml(t('match.empty'))}</h2>
            <p>${escapeHtml(t('match.empty_description'))}</p>
          </section>
        `
    }
    <div class="floating-create-action">
      ${
        state.showCreateGameTooltip
          ? `<div class="floating-create-tooltip" role="status">${escapeHtml(t('match.create_tooltip'))}</div>`
          : ''
      }
      <button type="button" class="floating-create-button" data-open-create-game="true" aria-label="${escapeHtml(t('match.create_tooltip'))}">
        <span aria-hidden="true">+</span>
      </button>
    </div>
  `;
}

function renderFilterBar() {
  const achievementOptions = getEarnedAchievementOptions();
  const notSelectedLabel = t('players.filters.not_selected');
  const positionDisplay = state.positionFilter
    ? getPositionLabel(state.positionFilter, 'short')
    : t('common.labels.position');
  const achievementDisplay = state.achievementFilter
    ? getAchievementMeta(state.achievementFilter).title
    : t('players.filters.achievements');
  const skillDisplay = state.skillFilter
    ? t(`players.filters.${state.skillFilter}`)
    : t('players.filters.skills');

  return `
    <div class="filter-row">
      ${FILTER_CHIPS.map(
        (filter) => `
          <button type="button" class="chip ${state.activeSort === filter.key && !state.skillFilter ? 'active' : ''}" data-sort="${escapeHtml(filter.key)}">
            ${escapeHtml(t(filter.labelKey))}
          </button>
        `
      ).join('')}
      <label class="chip chip-select ${state.positionFilter ? 'active' : ''}">
        <span class="chip-select-display">${escapeHtml(positionDisplay)}</span>
        <select id="positionFilter">
          <option value="">${escapeHtml(notSelectedLabel)}</option>
          ${['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'ST', 'LW', 'RW']
            .map((position) => `<option value="${position}" ${state.positionFilter === position ? 'selected' : ''}>${escapeHtml(getPositionLabel(position, 'short'))}</option>`)
            .join('')}
        </select>
      </label>
      <label class="chip chip-select ${state.achievementFilter ? 'active' : ''}">
        <span class="chip-select-display">${escapeHtml(achievementDisplay)}</span>
        <select id="achievementFilter">
          <option value="">${escapeHtml(notSelectedLabel)}</option>
          ${achievementOptions
            .map((achievement) => `<option value="${escapeHtml(achievement.key)}" ${state.achievementFilter === achievement.key ? 'selected' : ''}>${escapeHtml(achievement.title)}</option>`)
            .join('')}
        </select>
      </label>
      <label class="chip chip-select ${state.skillFilter ? 'active' : ''}">
        <span class="chip-select-display">${escapeHtml(skillDisplay)}</span>
        <select id="skillFilter">
          <option value="">${escapeHtml(notSelectedLabel)}</option>
          ${STAT_META
            .map(([skillKey]) => `<option value="${escapeHtml(skillKey)}" ${state.skillFilter === skillKey ? 'selected' : ''}>${escapeHtml(t(`players.filters.${skillKey}`))}</option>`)
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
  const achievementFilteredPlayers = state.achievementFilter
    ? positionFilteredPlayers.filter((player) => getPlayerAchievementCount(player, state.achievementFilter) > 0)
    : positionFilteredPlayers;

  if (!searchQuery) {
    return sortPlayers(achievementFilteredPlayers);
  }

  return sortPlayers(
    achievementFilteredPlayers.filter((player) => {
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
          placeholder="${escapeHtml(t('players.search'))}"
          autocomplete="off"
        >
        <button type="button" data-clear-player-search ${state.playerSearch ? '' : 'hidden'} aria-label="${escapeHtml(t('players.search_clear'))}">×</button>
      </label>
    </div>
  `;
}

function renderPlayersResults() {
  const players = getFilteredPlayers();

  if (!players.length) {
    return `
      <section class="empty-state players-empty" data-players-results>
        <h2>${escapeHtml(t('players.not_found'))}</h2>
        <p>${escapeHtml(t('players.not_found_description'))}</p>
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
    goleador: '/assets/achievements/goleador.svg',
    hat_trick: '/assets/achievements/hat-trick.svg',
    pokerface: '/assets/achievements/pokerface.svg',
    comeback_maker: '/assets/achievements/comeback-maker.svg',
    long_shot: '/assets/achievements/long-shot.svg',
    assistant: '/assets/achievements/assistant.svg',
    playmaker: '/assets/achievements/playmaker.svg',
    unselfish: '/assets/achievements/unselfish.svg',
    conductor: '/assets/achievements/conductor.svg',
    wall: '/assets/achievements/wall.svg',
    pickpocket: '/assets/achievements/pickpocket.svg',
    cat: '/assets/achievements/cat.svg',
    no_toxic: '/assets/achievements/no-toxic.svg',
    maguire_day: '/assets/achievements/maguire-day.svg',
    planned_it: '/assets/achievements/planned-it.svg',
    woodworker: '/assets/achievements/woodworker.svg',
    debutant: '/assets/achievements/debutant.svg',
    stable_guy: '/assets/achievements/stable-guy.svg',
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
  return t('achievements.times', { count });
}

function getPlayerAchievements(player) {
  const achievementCounts = player.achievementCounts ?? {};

  return QUICK_ACHIEVEMENTS.map((achievement) => ({
    ...getAchievementMeta(achievement.key),
    count: achievementCounts[achievement.key] ?? 0,
    detail: achievementCounts[achievement.key]
      ? formatAchievementCount(achievementCounts[achievement.key])
      : t('achievements.not_received')
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
        <span>${escapeHtml(t('common.labels.position').toLowerCase())}</span>
        <select name="position">
          ${POSITION_CHOICES
            .map((position) => `
              <option value="${position}" ${effectivePosition === position ? 'selected' : ''}>
                ${escapeHtml(getPositionLabel(position, 'title'))}
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
                .map(([key, label]) => renderSelfProfileStatStepper(key, label, defaults[key] ?? 50))
                .join('')}
            </div>
          `
          : ''
      }
      <div class="profile-floating-actions">
        <button type="submit" class="primary-button profile-submit">${escapeHtml(t('common.buttons.save'))}</button>
        <button type="button" class="ghost-action profile-cancel" data-cancel-self-profile="true">${escapeHtml(t('common.buttons.cancel'))}</button>
      </div>
    </form>
  `;
}

function renderProfileTab() {
  const player = getViewerPlayer();

  if (!player) {
    return `
      <section class="empty-state">
        <h2>${escapeHtml(t('players.profile_unavailable'))}</h2>
        <p>${escapeHtml(t('players.profile_unavailable_description'))}</p>
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
  return `
    <section class="profile-screen ${isEditingSelfProfile ? 'profile-screen--editing' : ''}" aria-label="${escapeHtml(t('players.card_title'))}">
      <header class="profile-toolbar">
        <button type="button" class="profile-back-button" data-close-profile aria-label="${escapeHtml(t('common.buttons.back'))}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 5.3a1 1 0 0 1 0 1.4L9.4 12l5.3 5.3a1 1 0 1 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0Z"></path></svg>
        </button>
        ${
          canEditOwnProfile
            ? `
              <button type="button" class="profile-menu-button" data-open-profile-actions aria-label="${escapeHtml(t('players.settings'))}">
                ${renderDotsIcon()}
              </button>
            `
            : '<span class="profile-toolbar-spacer" aria-hidden="true"></span>'
        }
      </header>
      ${
        isEditingSelfProfile
          ? `
            <article class="fifa-card fifa-card--profile fifa-card--profile-editing">
              <div class="fifa-card-hero">
                ${renderCardHero(player)}
                ${hasCareerRatings ? `<div class="hero-score">${renderRatingValue(player.overall, player.ratingDelta, 'hero-rating-value')}<span>${escapeHtml(getPositionLabel(effectivePosition, 'card'))}</span></div>` : ''}
              </div>
              <div class="fifa-card-panel">
                <div class="fifa-card-nameblock">
                  <div class="card-name">${escapeHtml(player.displayName)}</div>
                  <div class="card-nick">@${escapeHtml(player.username || 'unknown')}</div>
                </div>
                ${renderSelfProfileForm(player, selfProfileDefaults, { includeStats: !hasCareerRatings })}
              </div>
            </article>
          `
          : renderFifaCard(player, {
              variant: 'profile',
              clickable: false,
              showPositionSelector: true,
              editablePosition: canEditOwnProfile
            })
      }
    </section>
  `;
}

function renderTeamsTab() {
  if (state.teamScreen === 'editor') return renderTeamEditor();
  if (state.teamScreen === 'detail') return renderTeamDetail();
  if (state.teamScreen === 'challenge-detail') return renderTeamChallengeDetail();
  if (state.teamScreen === 'challenge') return renderTeamChallengeEditor();
  return renderTeamsList();
}

function getTeams() {
  return state.snapshot?.teams ?? [];
}

function getTeamChallenges() {
  return state.snapshot?.teamChallenges ?? [];
}

function getSelectedTeam() {
  return getTeams().find((team) => team.id === state.selectedTeamId) ?? null;
}

function getManagedTeams() {
  return getTeams().filter((team) => team.canManage);
}

function teamChoiceLabel(group, value) {
  return t(`teams.${group}.${value}`);
}

function renderTeamAvatar(team) {
  const initials = String(team?.name || '?').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return `<span class="team-avatar">${team?.imageUrl ? `<img src="${escapeHtml(team.imageUrl)}" alt="">` : escapeHtml(initials)}</span>`;
}

function renderTeamCard(team) {
  return `
    <button type="button" class="team-card" data-open-team="${escapeHtml(team.id)}">
      ${renderTeamAvatar(team)}
      <span class="team-card-identity">
        <strong>${escapeHtml(team.name)}</strong>
        <span>${escapeHtml(team.city)}</span>
      </span>
      <span class="team-card-rating">${renderRatingValue(team.rating || '—', team.rating ? 1 : null, 'team-card-rating-value')}</span>
      <span class="team-card-meta">
        <span>${escapeHtml(teamChoiceLabel('formats', team.format))}</span>
        <span>${escapeHtml(teamChoiceLabel('levels', team.level))}</span>
        <span>${escapeHtml(t('teams.players_count', { count: team.players?.length ?? 0 }))}</span>
      </span>
    </button>
  `;
}

function renderTeamsList() {
  const query = String(state.teamSearch || '').trim().toLowerCase();
  const teams = [...getTeams()]
    .filter((team) => !query || `${team.name} ${team.city}`.toLowerCase().includes(query))
    .sort((left, right) => state.teamSort === 'players'
      ? (right.players?.length ?? 0) - (left.players?.length ?? 0) || right.rating - left.rating
      : right.rating - left.rating || (right.players?.length ?? 0) - (left.players?.length ?? 0));
  const openChallenges = getTeamChallenges().filter((challenge) => challenge.status === 'open');

  return `
    <section class="teams-list-screen">
      <label class="team-search-field">
        <input type="search" value="${escapeHtml(state.teamSearch)}" data-team-search placeholder="${escapeHtml(t('teams.search'))}" aria-label="${escapeHtml(t('teams.search'))}">
      </label>
      <div class="teams-sort-row">
        <button type="button" class="chip ${state.teamSort === 'rating' ? 'active' : ''}" data-team-sort="rating">${escapeHtml(t('teams.sort_rating'))}</button>
        <button type="button" class="chip ${state.teamSort === 'players' ? 'active' : ''}" data-team-sort="players">${escapeHtml(t('teams.sort_players'))}</button>
      </div>
      ${openChallenges.length ? `
        <section class="team-open-challenges">
          <h2>${escapeHtml(t('teams.open_challenges'))}</h2>
          ${openChallenges.map((challenge) => renderChallengeCard(challenge, true)).join('')}
        </section>
      ` : ''}
      ${teams.length
        ? `<section class="team-grid">${teams.map(renderTeamCard).join('')}</section>`
        : `<section class="empty-state teams-empty"><h2>${escapeHtml(t('teams.empty'))}</h2><p>${escapeHtml(t('teams.empty_description'))}</p></section>`}
    </section>
    <div class="floating-create-action">
      ${state.showCreateTeamTooltip ? `<div class="floating-create-tooltip" role="status">${escapeHtml(t('teams.create_tooltip'))}</div>` : ''}
      <button type="button" class="floating-create-button" data-open-create-team aria-label="${escapeHtml(t('teams.create_tooltip'))}"><span aria-hidden="true">+</span></button>
    </div>
  `;
}

function renderTeamScreenHeader(title, actions = '') {
  return `<header class="team-screen-header"><h1>${escapeHtml(title)}</h1><div class="game-top-actions team-screen-header-actions">${actions}<button type="button" class="game-top-button" data-close-team-screen aria-label="${escapeHtml(t('common.buttons.close'))}">×</button></div></header>`;
}

function renderTeamPlayerPicker(draft) {
  const selectedIds = new Set(draft.playerIds ?? []);
  const query = String(state.teamPlayerSearch || '').trim().replace(/^@/, '').toLowerCase();
  const candidates = getAvailablePlayers().filter((player) => {
    if (selectedIds.has(player.id)) return false;
    return !query || `${player.displayName} ${player.username}`.toLowerCase().includes(query);
  }).slice(0, 30);
  const selected = (draft.playerIds ?? []).map(getPlayer).filter(Boolean);

  return `
    <section class="team-editor-island manual-player-panel">
      <div class="manual-section-title"><h2>${escapeHtml(t('teams.players'))}</h2><span>${selected.length}</span></div>
      <div class="manual-player-search-wrap">
        <input class="manual-player-search" type="search" data-team-player-search value="${escapeHtml(state.teamPlayerSearch)}" placeholder="${escapeHtml(t('teams.player_search'))}" aria-label="${escapeHtml(t('teams.player_search'))}">
        ${state.teamPlayerSearch ? `<div class="manual-player-picker">${candidates.length ? candidates.map((player) => `
          <button type="button" class="manual-player-card" data-team-add-player="${escapeHtml(player.id)}">
            ${renderMiniAvatar(player)}
            <span class="manual-player-card__identity"><strong>${escapeHtml(player.displayName)}</strong><small>@${escapeHtml(player.username || 'unknown')}</small></span>
            <span class="manual-player-card__add" aria-hidden="true">+</span>
          </button>`).join('') : `<p>${escapeHtml(t('teams.no_players_found'))}</p>`}</div>` : ''}
      </div>
      <div class="manual-selected-row">${selected.map((player) => `
        <span class="manual-selected-chip">${escapeHtml(player.displayName)}<button type="button" data-team-remove-player="${escapeHtml(player.id)}" aria-label="${escapeHtml(t('common.buttons.delete'))}">×</button></span>
      `).join('')}</div>
    </section>
  `;
}

function renderTeamFieldPreview(draft) {
  const participants = (draft.playerIds ?? [])
    .map(getPlayer)
    .filter(Boolean)
    .map((player) => ({ ...player, canRateTarget: false, currentGameStats: null }));

  return renderField({ participants }, {
    className: 'manual-field-panel team-field-preview',
    interactive: false,
    static: true,
    emptyMessage: t('match.field_empty')
  });
}

function renderTeamEditor() {
  const draft = state.teamDraft ?? {};
  const selectedPlayers = (draft.playerIds ?? []).map(getPlayer).filter(Boolean);
  return `
    <section class="team-fullscreen team-editor-screen">
      ${renderTeamScreenHeader(state.teamEditingId ? t('teams.edit_title') : t('teams.new_title'))}
      <form id="teamForm" class="team-editor-form">
        <section class="team-avatar-editor">
          ${renderTeamAvatar({ name: draft.name, imageUrl: draft.imageUrl })}
          <label class="team-avatar-upload"><input type="file" accept="image/png,image/jpeg,image/webp" data-team-avatar-input><span>${escapeHtml(t('teams.change_avatar'))}</span></label>
          ${draft.imageUrl ? `<button type="button" data-remove-team-avatar>${escapeHtml(t('teams.remove_avatar'))}</button>` : ''}
        </section>
        <section class="team-editor-island">
          <h2>${escapeHtml(t('teams.information'))}</h2>
          <label class="team-form-field"><span>${escapeHtml(t('teams.name'))}</span><input name="name" value="${escapeHtml(draft.name || '')}" required placeholder="${escapeHtml(t('teams.name_placeholder'))}"></label>
          <label class="team-form-field"><span>${escapeHtml(t('teams.city'))}</span><input name="city" value="${escapeHtml(draft.city || '')}" required placeholder="${escapeHtml(t('teams.city_placeholder'))}"></label>
          <div class="team-form-grid">
            <label class="team-form-field"><span>${escapeHtml(t('teams.format'))}</span><select name="format">${['5x5','6x6','7x7','8x8','11x11'].map((value) => `<option value="${value}" ${draft.format === value ? 'selected' : ''}>${escapeHtml(teamChoiceLabel('formats', value))}</option>`).join('')}</select></label>
            <label class="team-form-field"><span>${escapeHtml(t('teams.level'))}</span><select name="level">${['beginner','amateur','strong_amateur','semi_pro'].map((value) => `<option value="${value}" ${draft.level === value ? 'selected' : ''}>${escapeHtml(teamChoiceLabel('levels', value))}</option>`).join('')}</select></label>
          </div>
          <label class="team-form-field"><span>${escapeHtml(t('teams.captain'))}</span><select name="captainPlayerId">${selectedPlayers.map((player) => `<option value="${escapeHtml(player.id)}" ${draft.captainPlayerId === player.id ? 'selected' : ''}>${escapeHtml(player.displayName)}</option>`).join('')}</select></label>
          <label class="team-form-field"><span>${escapeHtml(t('teams.status'))}</span><select name="status">${['open','invite_only','inactive'].map((value) => `<option value="${value}" ${draft.status === value ? 'selected' : ''}>${escapeHtml(teamChoiceLabel('statuses', value))}</option>`).join('')}</select></label>
        </section>
        ${renderTeamPlayerPicker(draft)}
        ${renderTeamFieldPreview(draft)}
        <button type="submit" class="primary-button team-save-button">${escapeHtml(t(state.teamEditingId ? 'common.buttons.save' : 'common.buttons.create'))}</button>
      </form>
    </section>
  `;
}

function renderTeamPlayerRow(player, { captain = false } = {}) {
  const subtitle = captain
    ? `@${player.username || 'unknown'}`
    : getPositionLabel(player.position, 'short') || t('common.labels.position');
  const rating = hasVisibleRating(player) ? getPlayerOverallLabel(player) : '—';

  return `<button type="button" class="game-player-row team-player-row is-clickable" data-open-player="${escapeHtml(player.id)}">
    <span class="game-player-avatar">${renderMiniAvatar(player)}</span>
    <span class="game-player-main"><strong>${escapeHtml(player.displayName)}</strong><span>${escapeHtml(subtitle)}</span></span>
    ${renderRatingValue(rating, player.ratingDelta, 'game-player-rating')}
  </button>`;
}

function renderTeamRoster(team) {
  return `<section class="team-detail-island"><h2>${escapeHtml(t('teams.players'))}</h2><div class="team-roster">${(team.players ?? []).map((player) => renderTeamPlayerRow(player)).join('')}</div></section>`;
}

function challengeStatusLabel(status) {
  return t(`teams.challenge_statuses.${status}`);
}

function renderChallengeCard(challenge, compact = false) {
  const opponent = challenge.opponent || null;
  const title = opponent ? `${challenge.challenger?.name || '—'} → ${opponent.name}` : challenge.challenger?.name || '—';
  const managedTeams = getManagedTeams().filter((team) => team.id !== challenge.challengerTeamId);
  return `<article class="team-challenge-card ${compact ? 'team-challenge-card--compact' : ''}" data-open-team-challenge-detail="${escapeHtml(challenge.id)}" role="button" tabindex="0">
    <div class="team-challenge-head"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(challengeStatusLabel(challenge.status))}</span></div>
    <p>${escapeHtml(challenge.date)} · ${escapeHtml(challenge.time)} · ${escapeHtml(challenge.location)}</p>
    <div class="team-challenge-meta"><span>${escapeHtml(teamChoiceLabel('formats', challenge.format))}</span><span>${escapeHtml(teamChoiceLabel('modes', challenge.mode))}</span>${opponent ? `<span>${escapeHtml(t(`teams.compatibility.${challenge.compatibility}`))}</span>` : ''}</div>
    ${challenge.canAcceptOpen && managedTeams.length ? `<label class="team-inline-select"><select data-challenge-team-choice>${managedTeams.map((team) => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}</option>`).join('')}</select></label><button type="button" class="primary-button" data-team-challenge-action="accept" data-challenge-id="${escapeHtml(challenge.id)}">${escapeHtml(t('common.buttons.accept'))}</button>` : ''}
    ${challenge.canRespond ? `<div class="team-challenge-actions"><button type="button" class="primary-button" data-team-challenge-action="accept" data-challenge-id="${escapeHtml(challenge.id)}">${escapeHtml(t('common.buttons.accept'))}</button><button type="button" data-team-counter-challenge="${escapeHtml(challenge.id)}">${escapeHtml(t('teams.counter'))}</button><button type="button" data-team-challenge-action="decline" data-challenge-id="${escapeHtml(challenge.id)}">${escapeHtml(t('common.buttons.decline'))}</button></div>` : ''}
    ${challenge.canEdit ? `<div class="team-challenge-actions team-challenge-actions--manage"><button type="button" data-edit-team-challenge="${escapeHtml(challenge.id)}">${escapeHtml(t('common.buttons.edit'))}</button><button type="button" data-cancel-team-challenge="${escapeHtml(challenge.id)}">${escapeHtml(t('teams.cancel_challenge'))}</button></div>` : ''}
    ${challenge.gameId ? `<button type="button" data-open-game-id="${escapeHtml(challenge.gameId)}">${escapeHtml(t('common.buttons.open_game'))}</button>` : ''}
  </article>`;
}

function renderTeamDetail() {
  const team = getSelectedTeam();
  if (!team) return `<section class="empty-state"><h2>${escapeHtml(t('teams.not_found'))}</h2></section>`;
  const challenges = getTeamChallenges().filter((challenge) => [challenge.challengerTeamId, challenge.opponentTeamId].includes(team.id));
  const teamActions = team.canManage ? `<button type="button" class="game-top-button team-kebab-button" data-toggle-team-actions aria-label="${escapeHtml(t('teams.actions'))}" aria-expanded="${state.teamActionsOpen}">•••</button>` : '';
  return `<section class="team-fullscreen team-detail-screen">
    ${renderTeamScreenHeader('', teamActions)}
    <section class="team-detail-hero">
      <span class="team-detail-avatar-wrap">
        ${renderTeamAvatar(team)}
        ${team.canManage ? `<button type="button" class="team-avatar-edit-button" data-edit-team-avatar aria-label="${escapeHtml(t('teams.logo_actions'))}"><img src="/assets/icons/team-edit.png" alt=""></button>` : ''}
      </span>
      <strong>${team.rating || '—'}</strong><div><h2>${escapeHtml(team.name)}</h2><p>${escapeHtml(team.city)}</p></div>
    </section>
    <section class="team-detail-stats"><div><span>${escapeHtml(t('teams.format'))}</span><b>${escapeHtml(teamChoiceLabel('formats', team.format))}</b></div><div><span>${escapeHtml(t('teams.level'))}</span><b>${escapeHtml(teamChoiceLabel('levels', team.level))}</b></div><div><span>${escapeHtml(t('teams.games'))}</span><b>${team.gamesCount ?? 0}</b></div><div><span>${escapeHtml(t('teams.reputation'))}</span><b>${team.reputation ?? 100}</b></div></section>
    <section class="team-detail-island team-captain"><h2>${escapeHtml(t('teams.captain'))}</h2>${team.captain ? renderTeamPlayerRow(team.captain, { captain: true }) : ''}</section>
    ${renderTeamRoster(team)}
    <section class="team-detail-island team-challenges-block">
      <h2>${escapeHtml(t('teams.challenges'))}</h2>
      ${challenges.map((challenge) => renderChallengeCard(challenge)).join('')}
      ${team.canManage ? `<button type="button" class="primary-button team-create-challenge-button" data-open-open-challenge="${escapeHtml(team.id)}">${escapeHtml(t('common.buttons.create'))}</button>` : ''}
      ${team.canChallenge ? `<button type="button" class="primary-button team-create-challenge-button" data-open-team-challenge="${escapeHtml(team.id)}">${escapeHtml(t('teams.challenge'))}</button>` : ''}
    </section>
  </section>`;
}

function renderTeamChallengeDetail() {
  const challenge = getTeamChallenges().find((item) => item.id === state.selectedChallengeId);
  if (!challenge) return `<section class="empty-state"><h2>${escapeHtml(t('teams.challenge_not_found'))}</h2></section>`;
  const title = challenge.opponent
    ? `${challenge.challenger?.name || '—'} → ${challenge.opponent.name}`
    : challenge.challenger?.name || '—';
  return `<section class="team-fullscreen team-challenge-detail-screen">
    ${renderTeamScreenHeader(t('teams.challenge_details'))}
    <section class="team-detail-island team-challenge-detail">
      <div class="team-challenge-head"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(challengeStatusLabel(challenge.status))}</span></div>
      <dl><div><dt>${escapeHtml(t('common.labels.date'))}</dt><dd>${escapeHtml(challenge.date)}</dd></div><div><dt>${escapeHtml(t('common.labels.time'))}</dt><dd>${escapeHtml(challenge.time)}</dd></div><div><dt>${escapeHtml(t('common.labels.location'))}</dt><dd>${escapeHtml(challenge.location)}</dd></div><div><dt>${escapeHtml(t('teams.format'))}</dt><dd>${escapeHtml(teamChoiceLabel('formats', challenge.format))}</dd></div><div><dt>${escapeHtml(t('teams.mode'))}</dt><dd>${escapeHtml(teamChoiceLabel('modes', challenge.mode))}</dd></div></dl>
      ${challenge.comment ? `<p>${escapeHtml(challenge.comment)}</p>` : ''}
    </section>
    <div class="team-primary-actions">${challenge.gameId ? `<button type="button" class="primary-button" data-open-game-id="${escapeHtml(challenge.gameId)}">${escapeHtml(t('common.buttons.open_game'))}</button>` : ''}${challenge.canEdit ? `<button type="button" data-edit-team-challenge="${escapeHtml(challenge.id)}">${escapeHtml(t('common.buttons.edit'))}</button>` : ''}${challenge.canManage ? `<button type="button" class="danger-button" data-delete-team-challenge="${escapeHtml(challenge.id)}">${escapeHtml(t('common.buttons.delete'))}</button>` : ''}</div>
  </section>`;
}

function renderTeamChallengeEditor() {
  const draft = state.challengeDraft ?? {};
  const challenger = getTeams().find((team) => team.id === draft.challengerTeamId);
  const opponent = getTeams().find((team) => team.id === draft.opponentTeamId);
  return `<section class="team-fullscreen team-challenge-screen">
    ${renderTeamScreenHeader(draft.editChallengeId ? t('teams.edit_challenge_title') : draft.counterChallengeId ? t('teams.counter_title') : t('teams.challenge_title'))}
    <form id="teamChallengeForm" class="team-editor-form">
      <section class="team-editor-island">
        <div class="challenge-versus"><strong>${escapeHtml(challenger?.name || '')}</strong><span>→</span><strong>${escapeHtml(opponent?.name || t('teams.open_challenge'))}</strong></div>
        <div class="team-form-grid"><label class="team-form-field"><span>${escapeHtml(t('common.labels.date'))}</span><input type="date" name="date" value="${escapeHtml(draft.date || '')}" required></label><label class="team-form-field"><span>${escapeHtml(t('common.labels.time'))}</span><input type="time" name="time" value="${escapeHtml(draft.time || '')}" required></label></div>
        <label class="team-form-field"><span>${escapeHtml(t('common.labels.location'))}</span><input name="location" value="${escapeHtml(draft.location || '')}" required></label>
        <div class="team-form-grid"><label class="team-form-field"><span>${escapeHtml(t('teams.format'))}</span><select name="format">${['5x5','6x6','7x7','8x8','11x11'].map((value) => `<option value="${value}" ${draft.format === value ? 'selected' : ''}>${escapeHtml(teamChoiceLabel('formats', value))}</option>`).join('')}</select></label><label class="team-form-field"><span>${escapeHtml(t('teams.duration'))}</span><select name="duration"><option value="60" ${draft.duration === 60 ? 'selected' : ''}>60</option><option value="90" ${draft.duration !== 60 ? 'selected' : ''}>90</option></select></label></div>
        <label class="team-form-field"><span>${escapeHtml(t('teams.mode'))}</span><select name="mode">${['friendly','ranked','open'].map((value) => `<option value="${value}" ${draft.mode === value ? 'selected' : ''}>${escapeHtml(teamChoiceLabel('modes', value))}</option>`).join('')}</select></label>
        <label class="team-form-field"><span>${escapeHtml(t('teams.cost'))}</span><input name="costSplit" value="${escapeHtml(draft.costSplit || '')}" placeholder="${escapeHtml(t('teams.cost_placeholder'))}"></label>
        <label class="team-checkbox"><input type="checkbox" name="needsReferee" ${draft.needsReferee ? 'checked' : ''}><span>${escapeHtml(t('teams.referee'))}</span></label>
        <label class="team-form-field"><span>${escapeHtml(t('teams.comment'))}</span><textarea name="comment" rows="3">${escapeHtml(draft.comment || '')}</textarea></label>
      </section>
      <button type="submit" class="primary-button team-save-button">${escapeHtml(draft.editChallengeId ? t('teams.update_challenge') : draft.counterChallengeId ? t('teams.send_counter') : t('teams.send_challenge'))}</button>
    </form>
  </section>`;
}

function getDefaultTeamDraft(team = null) {
  const viewerPlayerId = getViewerPlayerId();
  const playerIds = team?.players?.map((player) => player.id) ?? (viewerPlayerId ? [viewerPlayerId] : []);

  return {
    name: team?.name || '',
    imageUrl: team?.imageUrl || '',
    city: team?.city || '',
    format: team?.format || '5x5',
    level: team?.level || 'amateur',
    captainPlayerId: team?.captain?.id || viewerPlayerId,
    playerIds,
    status: team?.status || 'open'
  };
}

function getDefaultChallengeDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function getDefaultChallengeDraft({ challengerTeamId = '', opponentTeamId = '', challenge = null, editorMode = 'create' } = {}) {
  return {
    challengerTeamId: challengerTeamId || challenge?.challengerTeamId || '',
    opponentTeamId: opponentTeamId || challenge?.opponentTeamId || '',
    date: challenge?.date || getDefaultChallengeDate(),
    time: challenge?.time || '19:00',
    location: challenge?.location || '',
    format: challenge?.format || getTeams().find((team) => team.id === challengerTeamId)?.format || '5x5',
    duration: challenge?.duration || 90,
    mode: challenge?.mode || (opponentTeamId ? 'friendly' : 'open'),
    costSplit: challenge?.costSplit || '50/50',
    needsReferee: Boolean(challenge?.needsReferee),
    comment: challenge?.comment || '',
    counterChallengeId: editorMode === 'counter' ? challenge?.id || '' : '',
    editChallengeId: editorMode === 'edit' ? challenge?.id || '' : ''
  };
}

function readTeamForm(form) {
  const formData = new FormData(form);
  return {
    ...(state.teamDraft ?? {}),
    name: String(formData.get('name') || ''),
    city: String(formData.get('city') || ''),
    format: String(formData.get('format') || '5x5'),
    level: String(formData.get('level') || 'amateur'),
    captainPlayerId: String(formData.get('captainPlayerId') || getViewerPlayerId()),
    status: String(formData.get('status') || 'open'),
    playerIds: [...new Set(state.teamDraft?.playerIds ?? [])]
  };
}

function saveTeamFormDraft(form) {
  if (form) state.teamDraft = readTeamForm(form);
}

async function readTeamAvatarFile(file) {
  if (!file?.type?.match(/^image\/(png|jpeg|webp)$/)) throw new Error(t('teams.avatar_invalid'));
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(t('teams.avatar_invalid')));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const node = new Image();
    node.onload = () => resolve(node);
    node.onerror = () => reject(new Error(t('teams.avatar_invalid')));
    node.src = source;
  });
  const size = Math.min(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  canvas.getContext('2d').drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, 512, 512);
  return canvas.toDataURL('image/jpeg', 0.82);
}

function readTeamChallengeForm(form) {
  const formData = new FormData(form);
  return {
    ...(state.challengeDraft ?? {}),
    date: String(formData.get('date') || ''),
    time: String(formData.get('time') || ''),
    location: String(formData.get('location') || ''),
    format: String(formData.get('format') || '5x5'),
    duration: Number(formData.get('duration') || 90),
    mode: String(formData.get('mode') || 'friendly'),
    costSplit: String(formData.get('costSplit') || ''),
    needsReferee: formData.get('needsReferee') === 'on',
    comment: String(formData.get('comment') || '')
  };
}

function saveTeamChallengeDraft(form) {
  if (form) state.challengeDraft = readTeamChallengeForm(form);
}

function openTeamEditor(team = null) {
  hideCreateTeamTooltip();
  state.teamActionsOpen = false;
  state.teamEditingId = team?.id || '';
  state.teamDraft = getDefaultTeamDraft(team);
  state.teamPlayerSearch = '';
  state.teamScreen = 'editor';
  render();
}

function openTeamChallengeEditor({ challengerTeamId, opponentTeamId = '', challenge = null, editorMode = 'create' } = {}) {
  state.challengeDraft = getDefaultChallengeDraft({ challengerTeamId, opponentTeamId, challenge, editorMode });
  state.teamScreen = 'challenge';
  render();
}

function closeTeamScreen() {
  if (['challenge', 'challenge-detail'].includes(state.teamScreen) && state.selectedTeamId) {
    state.teamScreen = 'detail';
  } else {
    state.teamScreen = 'list';
    state.selectedTeamId = '';
    showCreateTeamTooltip();
  }
  state.teamEditingId = '';
  state.teamDraft = null;
  state.challengeDraft = null;
  state.selectedChallengeId = '';
  state.teamActionsOpen = false;
  state.teamAvatarActionsOpen = false;
  state.teamPlayerSearch = '';
  render();
}

async function submitTeam(form) {
  if (!(await ensureAuthorizedForAction())) return;
  saveTeamFormDraft(form);
  const payload = state.teamDraft;

  if (!payload.name.trim() || !payload.city.trim()) {
    showToast(t('teams.validation_required'));
    return;
  }

  const path = state.teamEditingId ? `/api/teams/${encodeURIComponent(state.teamEditingId)}` : '/api/teams';
  const data = await api(path, { method: state.teamEditingId ? 'PUT' : 'POST', body: payload });
  state.snapshot = data.snapshot;
  state.selectedTeamId = data.team.id;
  state.teamEditingId = '';
  state.teamDraft = null;
  state.teamScreen = 'detail';
  render();
  showToast(t('teams.saved'));
}

async function updateTeamLogo(imageUrl) {
  if (!(await ensureAuthorizedForAction())) return;
  const team = getSelectedTeam();
  if (!team?.canManage) return;
  const data = await api(`/api/teams/${encodeURIComponent(team.id)}`, {
    method: 'PUT',
    body: { imageUrl }
  });
  state.snapshot = data.snapshot;
  state.teamAvatarActionsOpen = false;
  render();
  showToast(t(imageUrl ? 'teams.avatar_saved' : 'teams.avatar_removed'));
}

async function submitTeamChallenge(form) {
  if (!(await ensureAuthorizedForAction())) return;
  saveTeamChallengeDraft(form);
  const payload = state.challengeDraft;

  if (!payload.date || !payload.time || !payload.location.trim()) {
    showToast(t('teams.challenge_validation'));
    return;
  }

  const isEdit = Boolean(payload.editChallengeId);
  const isCounter = Boolean(payload.counterChallengeId);
  const challengeId = payload.editChallengeId || payload.counterChallengeId;
  const path = challengeId
    ? `/api/team-challenges/${encodeURIComponent(challengeId)}`
    : '/api/team-challenges';
  const data = await api(path, {
    method: challengeId ? 'PATCH' : 'POST',
    body: challengeId ? { ...payload, action: isEdit ? 'edit' : 'counter' } : payload
  });
  state.snapshot = data.snapshot;
  state.challengeDraft = null;
  state.teamScreen = state.selectedTeamId ? 'detail' : 'list';
  render();
  showToast(t(isEdit ? 'teams.challenge_updated' : isCounter ? 'teams.counter_sent' : 'teams.challenge_sent'));
}

async function cancelTeamChallenge(challengeId) {
  if (!(await ensureAuthorizedForAction())) return;
  if (!window.confirm(t('teams.cancel_challenge_confirm'))) return;
  const data = await api(`/api/team-challenges/${encodeURIComponent(challengeId)}`, {
    method: 'PATCH',
    body: { action: 'cancel' }
  });
  state.snapshot = data.snapshot;
  render();
  showToast(t('teams.challenge_cancelled'));
}

async function deleteTeam(teamId) {
  if (!(await ensureAuthorizedForAction())) return;
  if (!window.confirm(t('teams.delete_team_confirm'))) return;
  const data = await api(`/api/teams/${encodeURIComponent(teamId)}`, { method: 'DELETE' });
  state.snapshot = data.snapshot;
  state.selectedTeamId = '';
  state.teamScreen = 'list';
  state.teamActionsOpen = false;
  render();
  showToast(t('teams.team_deleted'));
}

async function deleteTeamChallenge(challengeId) {
  if (!(await ensureAuthorizedForAction())) return;
  if (!window.confirm(t('teams.delete_challenge_confirm'))) return;
  const data = await api(`/api/team-challenges/${encodeURIComponent(challengeId)}`, { method: 'DELETE' });
  state.snapshot = data.snapshot;
  state.selectedChallengeId = '';
  state.teamScreen = state.selectedTeamId ? 'detail' : 'list';
  render();
  showToast(t('teams.challenge_deleted'));
}

async function respondToTeamChallenge(challengeId, action, responderTeamId = '') {
  if (!(await ensureAuthorizedForAction())) return;
  const data = await api(`/api/team-challenges/${encodeURIComponent(challengeId)}`, {
    method: 'PATCH',
    body: { action, responderTeamId }
  });
  state.snapshot = data.snapshot;

  if (data.game?.id) {
    state.selectedGameId = data.game.id;
    state.activeTab = 'game';
    state.teamScreen = 'list';
  }

  render();
  showToast(t(action === 'accept' ? 'teams.challenge_accepted' : 'teams.challenge_declined'));
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

  if (state.activeTab === 'teams') {
    return renderTeamsTab();
  }

  return renderPlayersTab();
}

function renderLoginPanel() {
  if (!state.allowDevLogin || state.token || tg?.initData) {
    return '';
  }

  return `
    <section class="panel dev-panel">
      <h2>${escapeHtml(t('auth.dev_login'))}</h2>
      <p>${escapeHtml(t('auth.dev_login_description'))}</p>
      <form id="devLoginForm" class="dev-form">
        <input type="text" name="username" placeholder="${escapeHtml(t('common.labels.username'))}" required>
        <input type="text" name="displayName" placeholder="${escapeHtml(t('common.labels.display_name'))}">
        <button type="submit" class="primary-button">${escapeHtml(t('common.buttons.enter'))}</button>
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
  const teamActionsModal = renderTeamActionsModal();
  const teamAvatarActionsModal = renderTeamAvatarActionsModal();
  const profileActionsModal = renderProfileActionsModal();
  const mapChoiceModal = renderMapChoiceModal();
  const achievementAwardModal = renderAchievementAwardModal();
  const achievementDetailModal = achievementAwardModal ? '' : renderAchievementDetailModal();
  const selfProfilePromptModal = achievementAwardModal ? '' : renderSelfProfilePromptModal();

  if (!player) {
    modalRoot.innerHTML = [
      createGameModal,
      gameActionsModal,
      teamActionsModal,
      teamAvatarActionsModal,
      profileActionsModal,
      mapChoiceModal,
      achievementDetailModal,
      achievementAwardModal,
      selfProfilePromptModal
    ].join('');
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
    teamActionsModal,
    teamAvatarActionsModal,
    profileActionsModal,
    mapChoiceModal,
    achievementDetailModal,
    achievementAwardModal,
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
    const activeTab = state.manualGameOpen || state.activeTab === 'game' || state.activeTab === 'profile' ||
      (state.activeTab === 'teams' && state.teamScreen !== 'list')
      ? ''
      : state.activeTab;
    button.classList.toggle('active', button.dataset.tab === activeTab);
  });
}

function syncStaticLabels() {
  document.documentElement.lang = state.locale || 'ru';
  gameMenuButtonNode?.setAttribute('aria-label', t('match.actions'));
  gameShareButtonNode?.setAttribute('aria-label', t('common.buttons.share_game'));
  closeGameButtonNode?.setAttribute('aria-label', t('common.buttons.close'));
  document.querySelector('.tabbar')?.setAttribute('aria-label', t('common.labels.navigation'));
  document.getElementById('tab-games')?.setAttribute('aria-label', t('common.labels.games'));
  document.getElementById('tab-players')?.setAttribute('aria-label', t('common.labels.players_list'));
  document.getElementById('tab-teams')?.setAttribute('aria-label', t('common.labels.teams'));
}

function render() {
  syncAchievementAwards();
  syncStaticLabels();
  appShellNode?.classList.remove('app-shell--loading');

  const screenTitle = getScreenTitle();
  chatTitleNode.textContent = screenTitle;
  topbarNode?.classList.toggle('topbar--titleless', !screenTitle);
  topbarNode?.classList.toggle('topbar--game', state.activeTab === 'game');
  if (profileEntrySlotNode) {
    const canShowProfileEntry = Boolean(
      !state.manualGameOpen &&
      !['game', 'profile'].includes(state.activeTab) &&
      !(state.activeTab === 'teams' && state.teamScreen !== 'list') &&
      getViewerPlayer()
    );
    profileEntrySlotNode.hidden = !canShowProfileEntry;
    profileEntrySlotNode.innerHTML = canShowProfileEntry ? renderProfileEntryButton() : '';
  }
  const currentGame = getCurrentGame();
  if (gameTeamControlsNode) {
    const canShowTeamControls = Boolean(
      !state.manualGameOpen &&
      state.activeTab === 'game' &&
      (currentGame?.participants?.length ?? 0) >= 2
    );
    gameTeamControlsNode.hidden = !canShowTeamControls;
    gameTeamControlsNode.innerHTML = canShowTeamControls
      ? renderFieldTeamControl(getSelectedFieldTeam(currentGame).key, currentGame)
      : '';
  }
  if (gameTopActionsNode) {
    gameTopActionsNode.hidden = state.manualGameOpen || state.activeTab !== 'game';
  }
  if (gameMenuButtonNode) {
    gameMenuButtonNode.hidden = state.manualGameOpen || !(state.activeTab === 'game' && currentGame);
  }
  if (gameShareButtonNode) {
    gameShareButtonNode.hidden = true;
  }
  const canShowFloatingJoin = Boolean(
    !state.manualGameOpen &&
    state.activeTab === 'game' &&
    currentGame?.canViewerRequestJoin &&
    !['pending', 'invited'].includes(currentGame.viewerJoinStatus)
  );
  appShellNode?.classList.toggle('app-shell--profile', state.activeTab === 'profile');
  appShellNode?.classList.toggle('app-shell--profile-edit', state.activeTab === 'profile' && state.selfProfileEditing);
  appShellNode?.classList.toggle('app-shell--manual', state.manualGameOpen);
  appShellNode?.classList.toggle(
    'app-shell--team-subscreen',
    !state.manualGameOpen && state.activeTab === 'teams' && state.teamScreen !== 'list'
  );
  appShellNode?.classList.toggle('app-shell--game', !state.manualGameOpen && state.activeTab === 'game');
  appShellNode?.classList.toggle('app-shell--join-floating', canShowFloatingJoin);
  syncTabbar();

  if (!state.snapshot?.chat) {
    contentNode.innerHTML = `
      ${renderLoginPanel()}
      <section class="empty-state">
        <h2>${escapeHtml(t('errors.chat_not_initialized'))}</h2>
        <p>${escapeHtml(t('errors.chat_not_initialized_description'))}</p>
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
  resizeManualTextareas(contentNode);
  requestAnimationFrame(syncAppShellBounds);
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
  showToast(t('rating.saved'));
}

async function submitQuickRating(gameId) {
  const game = getGameDays().find((item) => item.id === gameId) ?? getCurrentGame();

  if (!game?.id) {
    throw new Error(t('match.unknown'));
  }

  const draft = getQuickRatingDraft(game);

  if (!isQuickRatingDraftChanged(game, draft)) {
    return;
  }

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
  showToast(t('rating.saved'));
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
  showToast(t('players.card_saved'));
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
  showToast(t('common.misc.updated'));
}

async function updateLocale(locale) {
  if (!(await ensureAuthorizedForAction())) {
    return;
  }

  const data = await api('/api/locale', {
    method: 'PATCH',
    body: { locale }
  });

  applyI18nPayload(data);
  state.snapshot = data.snapshot;
  render();
  showToast(t('settings.language.updated'));
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
  if (!isEditing) {
    trackAnalyticsEvent('create_game');
  }
  resetManualGameState();
  render();
  showToast(isEditing ? t('match.saved') : notifyPlayers ? t('match.created_invites') : t('match.created'));
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
  showCreateGameTooltip();
  render();
  showToast(t('match.deleted'));
}

async function ensureAuthorizedForAction() {
  if (state.token) {
    return true;
  }

  const authenticated = await authenticateTelegram().catch(() => false);

  if (!authenticated) {
    showToast(lastAuthError || t('auth.open_from_telegram'));
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
  showToast(t('match.join_requested'));
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
  showToast(t('match.join_cancelled'));
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
  showToast(t('match.player_added'));
}

async function toggleRosterLock(gameId, rosterLocked) {
  if (!(await ensureAuthorizedForAction())) {
    return;
  }

  const data = await api(`/api/games/${encodeURIComponent(gameId)}/roster-lock`, {
    method: 'PATCH',
    body: { rosterLocked }
  });
  state.snapshot = data.snapshot;
  render();
  showToast(rosterLocked ? t('match.lineup_closed') : t('match.lineup_open'));
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
  showToast(t('match.joined'));
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
  showToast(t('common.buttons.decline'));
}

async function shareFallback(fallback = {}) {
  const title = fallback.title || t('common.misc.share_title');
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
    showToast(t('common.misc.copied'));
    return;
  }

  window.open(telegramShareUrl, '_blank', 'noopener,noreferrer');
}

async function sharePreparedOrFallback(data) {
  if (data?.preparedMessageId && tg?.shareMessage) {
    try {
      tg.shareMessage(data.preparedMessageId, (success) => {
        if (!success) {
          showToast(t('common.misc.share_cancelled'));
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
    showToast(t('match.unknown'));
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
    document.getElementById('teamForm') ||
    document.getElementById('teamChallengeForm') ||
    (state.activeTab === 'teams' && ['editor', 'challenge'].includes(state.teamScreen)) ||
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
      showToast(t('common.misc.updated'));
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
    showProfileBenchmark(form, name, nextValue);
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
  if (state.activeTab === 'games') {
    showCreateGameTooltip();
  } else {
    hideCreateGameTooltip();
  }
  if (state.activeTab === 'teams') {
    state.teamScreen = 'list';
    state.selectedTeamId = '';
    state.teamDraft = null;
    state.challengeDraft = null;
    showCreateTeamTooltip();
  } else {
    hideCreateTeamTooltip();
  }
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
  const openProfileEntryButton = event.target.closest('[data-open-profile-entry]');

  if (openProfileEntryButton) {
    state.profileReturnTab = ['games', 'players', 'teams'].includes(state.activeTab) ? state.activeTab : 'games';
    state.activeTab = 'profile';
    state.selectedGameId = '';
    state.manualGameOpen = false;
    state.profileActionsOpen = false;
    render();
    return;
  }

  const closeProfileButton = event.target.closest('[data-close-profile]');

  if (closeProfileButton) {
    state.activeTab = state.profileReturnTab || 'games';
    state.selfProfileEditing = false;
    state.selfProfileDraft = null;
    state.profileActionsOpen = false;
    render();
    return;
  }

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

  const fieldTeamButton = event.target.closest('[data-field-team-filter]');

  if (fieldTeamButton) {
    state.fieldTeamFilter = fieldTeamButton.dataset.fieldTeamFilter || 'top';
    render();
    return;
  }

  const fieldTeamCountButton = event.target.closest('[data-field-team-count-action]');

  if (fieldTeamCountButton) {
    const game = getCurrentGame();
    if (!game?.canViewerEditTeamCount) return;

    const maximumTeamCount = getMaximumTeamCount(game.participants?.length ?? 0);
    state.fieldTeamCount = fieldTeamCountButton.dataset.fieldTeamCountAction === 'reset'
      ? 2
      : Math.min(maximumTeamCount, state.fieldTeamCount + 1);
    state.fieldTeamFilter = 'top';
    render();
    return;
  }

  const openCreateTeamButton = event.target.closest('[data-open-create-team]');

  if (openCreateTeamButton) {
    if (!(await ensureAuthorizedForAction())) return;
    openTeamEditor();
    return;
  }

  if (event.target.closest('[data-close-team-screen]')) {
    closeTeamScreen();
    return;
  }

  const openTeamButton = event.target.closest('[data-open-team]');

  if (openTeamButton) {
    hideCreateTeamTooltip();
    state.selectedTeamId = openTeamButton.dataset.openTeam || '';
    state.teamScreen = 'detail';
    render();
    return;
  }

  if (event.target.closest('[data-toggle-team-actions]')) {
    state.teamActionsOpen = !state.teamActionsOpen;
    render();
    return;
  }

  if (event.target.closest('[data-edit-team-avatar]')) {
    state.teamAvatarActionsOpen = true;
    renderModal();
    return;
  }

  if (event.target.closest('[data-delete-team-logo]')) {
    updateTeamLogo('').catch((error) => showToast(error.message));
    return;
  }

  const deleteTeamButton = event.target.closest('[data-delete-team]');

  if (deleteTeamButton) {
    deleteTeam(deleteTeamButton.dataset.deleteTeam).catch((error) => showToast(error.message));
    return;
  }

  const removeTeamAvatarButton = event.target.closest('[data-remove-team-avatar]');

  if (removeTeamAvatarButton) {
    saveTeamFormDraft(document.getElementById('teamForm'));
    state.teamDraft.imageUrl = '';
    render();
    return;
  }

  const editTeamButton = event.target.closest('[data-edit-team]');

  if (editTeamButton) {
    const team = getTeams().find((item) => item.id === editTeamButton.dataset.editTeam);
    if (team) openTeamEditor(team);
    return;
  }

  const addTeamPlayerButton = event.target.closest('[data-team-add-player]');

  if (addTeamPlayerButton) {
    saveTeamFormDraft(document.getElementById('teamForm'));
    const playerId = addTeamPlayerButton.dataset.teamAddPlayer;
    state.teamDraft.playerIds = [...new Set([...(state.teamDraft.playerIds ?? []), playerId])];
    state.teamDraft.captainPlayerId ||= playerId;
    state.teamPlayerSearch = '';
    render();
    return;
  }

  const removeTeamPlayerButton = event.target.closest('[data-team-remove-player]');

  if (removeTeamPlayerButton) {
    saveTeamFormDraft(document.getElementById('teamForm'));
    const playerId = removeTeamPlayerButton.dataset.teamRemovePlayer;
    state.teamDraft.playerIds = (state.teamDraft.playerIds ?? []).filter((id) => id !== playerId);
    if (state.teamDraft.captainPlayerId === playerId) {
      state.teamDraft.captainPlayerId = state.teamDraft.playerIds[0] || getViewerPlayerId();
    }
    render();
    return;
  }

  const openDirectChallengeButton = event.target.closest('[data-open-team-challenge]');

  if (openDirectChallengeButton) {
    const opponentTeamId = openDirectChallengeButton.dataset.openTeamChallenge;
    const challenger = getManagedTeams().find((team) => team.id !== opponentTeamId);
    if (!challenger) {
      showToast(t('teams.manage_team_required'));
      return;
    }
    state.selectedTeamId = opponentTeamId;
    openTeamChallengeEditor({ challengerTeamId: challenger.id, opponentTeamId });
    return;
  }

  const openChallengeButton = event.target.closest('[data-open-open-challenge]');

  if (openChallengeButton) {
    const challengerTeamId = openChallengeButton.dataset.openOpenChallenge;
    state.selectedTeamId = challengerTeamId;
    openTeamChallengeEditor({ challengerTeamId });
    return;
  }

  const counterChallengeButton = event.target.closest('[data-team-counter-challenge]');

  if (counterChallengeButton) {
    const challenge = getTeamChallenges().find((item) => item.id === counterChallengeButton.dataset.teamCounterChallenge);
    const challenger = getManagedTeams().find((team) => team.id === challenge?.awaitingTeamId) ||
      getManagedTeams().find((team) => [challenge?.challengerTeamId, challenge?.opponentTeamId].includes(team.id));
    if (challenge && challenger) {
      state.selectedTeamId = challenger.id;
      openTeamChallengeEditor({
        challengerTeamId: challenge.challengerTeamId,
        opponentTeamId: challenge.opponentTeamId,
        challenge,
        editorMode: 'counter'
      });
    }
    return;
  }

  const editChallengeButton = event.target.closest('[data-edit-team-challenge]');

  if (editChallengeButton) {
    const challenge = getTeamChallenges().find((item) => item.id === editChallengeButton.dataset.editTeamChallenge);
    if (challenge) {
      state.selectedTeamId = challenge.challengerTeamId;
      openTeamChallengeEditor({
        challengerTeamId: challenge.challengerTeamId,
        opponentTeamId: challenge.opponentTeamId,
        challenge,
        editorMode: 'edit'
      });
    }
    return;
  }

  const cancelChallengeButton = event.target.closest('[data-cancel-team-challenge]');

  if (cancelChallengeButton) {
    cancelTeamChallenge(cancelChallengeButton.dataset.cancelTeamChallenge)
      .catch((error) => showToast(error.message));
    return;
  }

  const deleteChallengeButton = event.target.closest('[data-delete-team-challenge]');

  if (deleteChallengeButton) {
    deleteTeamChallenge(deleteChallengeButton.dataset.deleteTeamChallenge)
      .catch((error) => showToast(error.message));
    return;
  }

  const challengeActionButton = event.target.closest('[data-team-challenge-action]');

  if (challengeActionButton) {
    const challengeCard = challengeActionButton.closest('.team-challenge-card');
    const responderTeamId = challengeCard?.querySelector('[data-challenge-team-choice]')?.value || '';
    respondToTeamChallenge(
      challengeActionButton.dataset.challengeId,
      challengeActionButton.dataset.teamChallengeAction,
      responderTeamId
    ).catch((error) => showToast(error.message));
    return;
  }

  const openChallengeGameButton = event.target.closest('[data-open-game-id]');

  if (openChallengeGameButton) {
    state.selectedGameId = openChallengeGameButton.dataset.openGameId;
    state.activeTab = 'game';
    state.teamScreen = 'list';
    render();
    return;
  }

  const openChallengeDetail = event.target.closest('[data-open-team-challenge-detail]');

  if (openChallengeDetail && !event.target.closest('button, select, label')) {
    state.selectedChallengeId = openChallengeDetail.dataset.openTeamChallengeDetail || '';
    state.teamScreen = 'challenge-detail';
    render();
    return;
  }

  const teamSortButton = event.target.closest('[data-team-sort]');

  if (teamSortButton) {
    state.teamSort = teamSortButton.dataset.teamSort === 'players' ? 'players' : 'rating';
    render();
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

  const localeButton = event.target.closest('[data-set-locale]');

  if (localeButton) {
    state.profileActionsOpen = false;
    updateLocale(localeButton.dataset.setLocale).catch((error) => {
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

  if (event.target.closest('[data-next-achievement-award]')) {
    state.achievementAwardIndex = Math.min(
      state.achievementAwardIndex + 1,
      Math.max(0, state.achievementAwardQueue.length - 1)
    );
    renderModal();
    return;
  }

  if (
    event.target.matches('[data-achievement-award-backdrop]') ||
    event.target.closest('[data-close-achievement-award]')
  ) {
    dismissAchievementAwards();
    renderModal();
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
        showToast(lastAuthError || t('auth.open_from_telegram_create'));
        return;
      }
    }

    if (!state.snapshot?.viewerCanCreateGames && !state.allowDevLogin) {
      showToast(t('auth.start_private_first'));
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

  if (event.target.matches('[data-team-actions-backdrop]')) {
    state.teamActionsOpen = false;
    renderModal();
    return;
  }

  if (event.target.matches('[data-team-avatar-actions-backdrop]')) {
    state.teamAvatarActionsOpen = false;
    renderModal();
    return;
  }

  const copyGameButton = event.target.closest('[data-copy-game]');

  if (copyGameButton) {
    if (!(await ensureAuthorizedForAction())) {
      return;
    }

    if (!state.snapshot?.viewerCanCreateGames && !state.allowDevLogin) {
      showToast(t('auth.start_private_first'));
      return;
    }

    const game = getGameById(copyGameButton.dataset.copyGame) || getCurrentGame();

    if (game) {
      openManualGameCopy(game);
    }
    return;
  }

  if (event.target.matches('[data-profile-actions-backdrop]')) {
    state.profileActionsOpen = false;
    renderModal();
    return;
  }

  if (event.target.matches('[data-map-choice-backdrop]')) {
    state.mapChoice = null;
    renderModal();
    return;
  }

  const mapOptionButton = event.target.closest('[data-open-map-option]');

  if (mapOptionButton) {
    const option = state.mapChoice?.options?.find((item) => item.key === mapOptionButton.dataset.openMapOption);
    state.mapChoice = null;
    renderModal();
    openExternalLink(option?.url);
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
    state.profileReturnTab = ['games', 'players', 'teams'].includes(state.activeTab) ? state.activeTab : 'games';
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

  const rosterLockButton = event.target.closest('[data-toggle-roster-lock]');

  if (rosterLockButton) {
    toggleRosterLock(
      rosterLockButton.dataset.toggleRosterLock,
      rosterLockButton.dataset.rosterLocked === 'true'
    ).catch((error) => {
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
      showToast(t('rating.max_points', { count: QUICK_RATING_POINTS }));
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
    state.achievementFilter = '';
    state.skillFilter = '';
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

  const externalLinkButton = event.target.closest('[data-open-external-link]');

  if (externalLinkButton) {
    openExternalLink(externalLinkButton.dataset.openExternalLink || '');
    return;
  }

  const mapButton = event.target.closest('[data-open-map-choice]');

  if (mapButton) {
    const game = getCurrentGame();
    const venue = getVenueInfo(game?.location);
    const options = getMapChoiceOptions(game, venue);

    state.mapChoice = options.length ? { options } : null;
    renderModal();
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
    state.skillFilter = '';
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

document.addEventListener('keydown', (event) => {
  const challengeCard = event.target.closest?.('[data-open-team-challenge-detail]');
  if (!challengeCard || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  state.selectedChallengeId = challengeCard.dataset.openTeamChallengeDetail || '';
  state.teamScreen = 'challenge-detail';
  render();
});

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-team-logo-input]')) {
    const file = event.target.files?.[0];
    if (!file) return;
    readTeamAvatarFile(file)
      .then(updateTeamLogo)
      .catch((error) => showToast(error.message));
    return;
  }

  if (event.target.matches('[data-team-avatar-input]')) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    saveTeamFormDraft(input.closest('#teamForm'));
    readTeamAvatarFile(file).then((imageUrl) => {
      state.teamDraft.imageUrl = imageUrl;
      render();
    }).catch((error) => showToast(error.message));
    return;
  }

  if (event.target.matches('[data-locale-select]')) {
    state.profileActionsOpen = false;
    updateLocale(event.target.value).catch((error) => {
      showToast(error.message);
    });
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
    if (event.target.matches('textarea[data-manual-autosize]')) {
      resizeManualTextarea(event.target);
    }
    return;
  }

  if (event.target.closest('#teamForm')) {
    saveTeamFormDraft(event.target.closest('#teamForm'));
    return;
  }

  if (event.target.closest('#teamChallengeForm')) {
    saveTeamChallengeDraft(event.target.closest('#teamChallengeForm'));
    return;
  }

  if (event.target.id === 'positionFilter') {
    state.positionFilter = event.target.value;
    render();
    return;
  }

  if (event.target.id === 'achievementFilter') {
    state.achievementFilter = event.target.value;
    render();
    return;
  }

  if (event.target.id === 'skillFilter') {
    state.skillFilter = event.target.value;
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

  if (event.target.matches('[data-team-search]')) {
    state.teamSearch = event.target.value;
    const cursor = event.target.selectionStart ?? state.teamSearch.length;
    render();
    requestAnimationFrame(() => {
      const input = document.querySelector('[data-team-search]');
      input?.focus();
      input?.setSelectionRange(cursor, cursor);
    });
    return;
  }

  if (event.target.matches('[data-team-player-search]')) {
    saveTeamFormDraft(event.target.closest('#teamForm'));
    state.teamPlayerSearch = event.target.value;
    const cursor = event.target.selectionStart ?? state.teamPlayerSearch.length;
    render();
    requestAnimationFrame(() => {
      const input = document.querySelector('[data-team-player-search]');
      input?.focus();
      input?.setSelectionRange(cursor, cursor);
    });
    return;
  }

  if (event.target.closest('#teamForm')) {
    saveTeamFormDraft(event.target.closest('#teamForm'));
    return;
  }

  if (event.target.closest('#teamChallengeForm')) {
    saveTeamChallengeDraft(event.target.closest('#teamChallengeForm'));
    return;
  }

  if (event.target.closest('#manualGameForm')) {
    saveManualGameDraft(event.target.closest('#manualGameForm'));
    if (event.target.matches('textarea[data-manual-autosize]')) {
      resizeManualTextarea(event.target);
    }
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
  if (event.target.id === 'teamForm') {
    event.preventDefault();
    try {
      await submitTeam(event.target);
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  if (event.target.id === 'teamChallengeForm') {
    event.preventDefault();
    try {
      await submitTeamChallenge(event.target);
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  if (event.target.id === 'manualGameForm') {
    event.preventDefault();
    saveManualGameDraft(event.target);
    const payload = readManualGameForm(event.target);

    if (!payload.date || !payload.time || !payload.location) {
      showToast(t('match.validation_required'));
      return;
    }

    if (state.manualGameMode !== 'edit' && payload.date < toDateInputValue(new Date())) {
      showToast(t('match.validation_past_date'));
      return;
    }

    if (new Set([state.snapshot?.viewerPlayerId, ...payload.playerIds].filter(Boolean)).size < 2) {
      showToast(t('match.validation_players_min'));
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
    contentNode.innerHTML = `<section class="empty-state"><h2>${escapeHtml(t('errors.generic'))}</h2><p>${escapeHtml(error.message)}</p></section>`;
    return;
  }

  if (state.activeTab === 'games') {
    showCreateGameTooltip();
  } else if (state.activeTab === 'teams') {
    showCreateTeamTooltip();
  }
  render();
  if (authError) {
    showToast(t('auth.telegram_failed', { reason: authError }));
  }
  setupAutoRefresh();
}

void init();
