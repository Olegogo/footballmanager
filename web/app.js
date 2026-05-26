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
const GOALKEEPER_STAT_META = [
  ['pace', 'Игра на линии'],
  ['dribbling', 'Фиксация мяча'],
  ['shooting', 'Выносы'],
  ['defense', 'Рефлексы'],
  ['passing', 'Скорость'],
  ['physical', 'Выбор позиции']
];

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
  { key: 'current', label: 'Текущие' },
  { key: 'finished', label: 'Завершенные' }
];
function readChatIdFromStartParam() {
  const urlChatId = new URLSearchParams(window.location.search).get('chatId') || '';
  const startParam =
    new URLSearchParams(window.location.search).get('tgWebAppStartParam') ||
    window.Telegram?.WebApp?.initDataUnsafe?.start_param ||
    '';

  if (urlChatId) {
    return urlChatId;
  }

  const match = String(startParam).match(/^chat_(-?\d+)$/);
  return match ? match[1] : '';
}

const state = {
  chatId: readChatIdFromStartParam(),
  token: '',
  snapshot: null,
  allowDevLogin: false,
  activeTab: 'game',
  activeSort: 'overall',
  gamesFilter: 'all',
  positionFilter: '',
  selectedPlayerId: null,
  ratingDrafts: {}
};

const tg = window.Telegram?.WebApp;
const apiBaseUrl = String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
const contentNode = document.getElementById('content');
const chatTitleNode = document.getElementById('chatTitle');
const topbarNode = document.querySelector('.topbar');
const modalRoot = document.getElementById('modalRoot');
const toastNode = document.getElementById('toast');
let refreshTimer = null;

function storageKey() {
  return `fifa-miniapp-token:${state.chatId || 'default'}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeUsername(value = '') {
  return String(value ?? '').trim().replace(/^@/, '').toLowerCase();
}

function getScreenTitle() {
  if (state.activeTab === 'game') {
    return 'Игровой день';
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
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

async function authenticateTelegram() {
  if (!tg?.initData) {
    return false;
  }

  const data = await api('/api/auth/telegram', {
    method: 'POST',
    body: {
      chatId: state.chatId,
      initData: tg.initData
    }
  });

  state.token = data.token;
  state.snapshot = data.snapshot;
  state.chatId = state.chatId || data.snapshot?.chat?.id || '';
  localStorage.setItem(storageKey(), state.token);
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
  const query = state.chatId ? `?chatId=${encodeURIComponent(state.chatId)}` : '';
  const data = await api(`/api/bootstrap${query}`);
  state.snapshot = data.snapshot;
  state.allowDevLogin = data.allowDevLogin;
  state.chatId = state.chatId || data.snapshot?.chat?.id || '';
}

function getCurrentGame() {
  return state.snapshot?.currentGame ?? null;
}

function getGames() {
  return state.snapshot?.games ?? [];
}

function getPlayers() {
  return state.snapshot?.players ?? [];
}

function getPlayer(playerId) {
  return getPlayers().find((player) => player.id === playerId) ?? null;
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

function getRatingDraftKey(gameId, playerId) {
  return `${gameId}:${playerId}`;
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
      <strong>${escapeHtml(value)}</strong>
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
  const isUnrated = !hasCurrentRatings && !hasCareerRatings;
  const isRatingCard = variant === 'game-rating';
  const viewerHasRatedTarget = Boolean(player.viewerHasRatedTarget);
  const hideMatchDetailsUntilViewerRates = isRatingCard && !viewerHasRatedTarget;
  const hasVisibleRating = hasCurrentRatings || hasCareerRatings;
  const showKnownStats = !hideMatchDetailsUntilViewerRates && hasVisibleRating;
  const overall = hasCurrentRatings ? currentStats.overall : hasCareerRatings ? player.overall : null;
  const effectivePosition = hasCurrentRatings ? (currentStats?.position || player.position || 'N/A') : (player.position || 'N/A');
  const position = hasVisibleRating ? effectivePosition : null;
  const statValues = hasCurrentRatings ? currentStats?.stats : player.stats;
  const statusLabel = isUnrated ? 'Не оценён' : '';
  const statPlaceholder = '-';
  const statMeta = getStatMetaForPosition(effectivePosition);
  const isGoalkeeper = isGoalkeeperPosition(effectivePosition);
  const overviewCells = [
    { label: 'игр', value: hideMatchDetailsUntilViewerRates ? statPlaceholder : player.games, emphasis: true },
    ...(
      isGoalkeeper
        ? []
        : [
            { label: 'голов', value: !hideMatchDetailsUntilViewerRates && showKnownStats ? (hasCurrentRatings ? currentStats.goals : player.goals) : statPlaceholder, outlined: isRatingCard },
            { label: 'голевых', value: !hideMatchDetailsUntilViewerRates && showKnownStats ? (hasCurrentRatings ? currentStats.assists : player.assists) : statPlaceholder, outlined: isRatingCard }
          ]
    )
  ];
  const statCells = statMeta.map(([key, label]) => [
    label.toLowerCase(),
    !hideMatchDetailsUntilViewerRates && showKnownStats ? statValues[key] : statPlaceholder
  ]);
  const openAttribute = clickable ? ` data-open-player="${escapeHtml(player.id)}"` : '';
  const actionNote = isRatingCard && ratingsCount > 0 ? `${ratingsCount} уже оценили` : '';

  return `
    <article class="fifa-card fifa-card--${escapeHtml(variant)} ${player.isMvp ? 'is-mvp' : ''} ${clickable ? 'is-clickable' : ''}"${openAttribute}>
      ${player.isMvp ? '<span class="mvp-badge">MVP</span>' : ''}
      <div class="fifa-card-hero">
        ${renderCardHero(player)}
        ${
          statusLabel
            ? `<div class="status-badge">${escapeHtml(statusLabel)}</div>`
            : `
              <div class="hero-score">
                <strong>${escapeHtml(overall)}</strong>
                <span>${escapeHtml(getPositionMeta(position).card)}</span>
              </div>
            `
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

function renderEditorScreen(player, gamePlayer, editable, defaults, game) {
  const currentStats = gamePlayer?.currentGameStats ?? null;
  const hasRatings = Boolean(currentStats?.hasRatings);
  const statMeta = getStatMetaForPosition(defaults.position);
  const isGoalkeeper = isGoalkeeperPosition(defaults.position);
  const statusLabel = gamePlayer
    ? (hasRatings ? `Оценок: ${currentStats?.ratingsCount ?? 0}` : (player.ratedGames > 0 ? 'Оценка матча' : 'Не оценён'))
    : 'Карточка игрока';

  return `
    <div class="editor-overlay" data-modal-backdrop="true">
      <section class="editor-screen" role="dialog" aria-modal="true" aria-label="${escapeHtml(player.displayName)}">
        <div class="editor-hero">
          ${renderCardHero(player)}
          <span class="editor-status">${escapeHtml(statusLabel)}</span>
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
                <form id="ratingForm" class="editor-form" data-game-id="${escapeHtml(game.id)}" data-player-id="${escapeHtml(player.id)}" data-draft-key="${escapeHtml(getRatingDraftKey(game.id, player.id))}">
                  <label class="editor-select">
                    <span>Позиция</span>
                    <select name="position">
                      ${POSITION_CHOICES
                        .map((position) => `
                          <option value="${position}" ${defaults.position === position ? 'selected' : ''}>
                            ${escapeHtml(getPositionMeta(position).title)}
                          </option>
                        `)
                        .join('')}
                    </select>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6.7 8.8a1 1 0 0 1 1.4 0L12 12.7l3.9-3.9a1 1 0 1 1 1.4 1.4l-4.6 4.6a1 1 0 0 1-1.4 0L6.7 10.2a1 1 0 0 1 0-1.4z"></path>
                    </svg>
                  </label>
                  <div class="editor-stat-block editor-stat-block--filled">
                    <span>игр</span>
                    <strong>${escapeHtml(player.games)}</strong>
                  </div>
                  ${
                    isGoalkeeper
                      ? ''
                      : `
                        ${renderEditorStepper('goals', 'голов', defaults.goals)}
                        ${renderEditorStepper('assists', 'голевых передач', defaults.assists)}
                      `
                  }
                  ${statMeta.map(([key, label]) => renderEditorRange(key, label.toLowerCase(), defaults[key])).join('')}
                  <button type="submit" class="primary-button card-action editor-submit">Сохранить</button>
                </form>
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
    <section class="panel">
      <div class="game-summary">
        <div>
          <h2>${escapeHtml(game.dateLabel)}</h2>
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
  let message = 'Оцените игроков после начала игры до следующего игрового дня';

  if (game.canViewerRate && game.isFinished) {
    message = 'Игра завершена. Оценить игроков можно до следующего игрового дня.';
  } else if (game.hasStarted && !game.viewerIsParticipant) {
    message = 'Оценивать могут только участники текущего матча.';
  }

  return `
    <section class="notice-banner">
      <p>${escapeHtml(message)}</p>
    </section>
  `;
}

function renderField(game) {
  const teams = splitBalancedTeams(game.participants);

  return `
    <section class="panel field-panel">
      <div class="field">
        <div class="field-line mid"></div>
        <div class="field-circle"></div>
        <div class="field-box top"></div>
        <div class="field-box bottom"></div>
        ${teams
          .map((team) => {
            const assignments = buildTeamFieldAssignments(team.players, team.key);
            return `
              <div class="field-team field-team--${escapeHtml(team.key)}">
                ${assignments
                  .map(({ player, slot }) => {
                    const isInteractive = Boolean(player.canRateTarget);
                    const openAttribute = isInteractive ? `data-open-player="${escapeHtml(player.id)}"` : '';
                    return `
                      <button
                        type="button"
                        class="field-player-card ${isInteractive ? '' : 'field-player-card--static'}"
                        ${openAttribute}
                        style="left:${slot.x}%; top:${slot.y}%"
                      >
                        <div class="field-player-photo">${renderMiniAvatar(player)}</div>
                        <div class="field-player-info">
                          <strong>${escapeHtml(getEffectiveOverall(player))}</strong>
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

  return `
    ${renderGameHeader(game)}
    ${renderField(game)}
    ${renderRatingBanner(game)}
    <section class="stack cards-stack">
      ${game.participants
        .map((player) =>
          renderFifaCard(player, {
            variant: player.canRateTarget ? 'game-rating' : 'game-summary',
            actionLabel: player.canRateTarget ? 'Оценить' : '',
            currentStats: player.currentGameStats,
            clickable: Boolean(player.canRateTarget)
          })
        )
        .join('')}
    </section>
  `;
}

function getGameStatusLabel(status) {
  if (status === 'upcoming') {
    return 'Скоро игра';
  }

  return status === 'live' ? 'Игра идет' : 'Игра закончена';
}

function getFilteredGames() {
  return getGames().filter((game) => {
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
  const isOpenable = game.status === 'upcoming' || game.status === 'live';
  const openAttribute = isOpenable ? ` data-open-game="${escapeHtml(game.id)}"` : '';
  const mvpLabel = game.mvp
    ? `${game.mvp.displayName}${game.mvp.ratingIncrease ? ` +${game.mvp.ratingIncrease}` : ''}`
    : 'Пока нет';

  return `
    <article class="game-card ${isOpenable ? 'game-card--openable' : ''}"${openAttribute}>
      <div class="game-card-head">
        <div>
          <h2>${escapeHtml(game.dateLabel)}</h2>
          <p>${escapeHtml(game.time)}</p>
        </div>
        <span class="status-pill ${escapeHtml(game.status)}">${escapeHtml(getGameStatusLabel(game.status))}</span>
      </div>
      <p class="game-card-location">${escapeHtml(game.location || 'Не указано')}</p>
      <div class="game-card-stats">
        <div>
          <span>MVP</span>
          <strong>${escapeHtml(mvpLabel)}</strong>
        </div>
        <div>
          <span>Голов</span>
          <strong>${escapeHtml(game.totalGoals)}</strong>
        </div>
        <div>
          <span>Игроков</span>
          <strong>${escapeHtml(game.playersCount)}</strong>
        </div>
      </div>
    </article>
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

function renderPlayersTab() {
  const filteredPlayers = state.positionFilter
    ? getPlayers().filter((player) => player.position === state.positionFilter)
    : getPlayers();
  const players = sortPlayers(filteredPlayers);

  return `
    ${renderFilterBar()}
    <section class="stack cards-stack cards-stack--players">
      ${players.map((player) => renderFifaCard(player, { variant: 'player-list', clickable: false })).join('')}
    </section>
  `;
}

function renderProfileTab() {
  const player = getViewerPlayer();

  if (!player) {
    return `
      <section class="empty-state">
        <h2>Профиль пока недоступен</h2>
        <p>Откройте miniapp из Telegram или войдите через dev-вход, чтобы увидеть свою карточку игрока.</p>
      </section>
    `;
  }

  const hasCareerRatings = player.ratedGames > 0;
  const effectivePosition = player.position || 'N/A';
  const statMeta = getStatMetaForPosition(effectivePosition);
  const isGoalkeeper = isGoalkeeperPosition(effectivePosition);
  const overviewCells = [
    { label: 'игр', value: player.games, emphasis: true },
    ...(
      isGoalkeeper
        ? []
        : [
            { label: 'голов', value: hasCareerRatings ? player.goals : '-' },
            { label: 'голевых', value: hasCareerRatings ? player.assists : '-' }
          ]
    )
  ];
  const statCells = statMeta.map(([key, label]) => [
    label.toLowerCase(),
    hasCareerRatings ? player.stats[key] : '-'
  ]);

  return `
    <section class="editor-screen profile-screen" aria-label="Профиль игрока">
      <div class="editor-hero profile-hero">
        ${renderCardHero(player)}
        ${
          hasCareerRatings
            ? `
              <div class="hero-score">
                <strong>${escapeHtml(player.overall)}</strong>
                <span>${escapeHtml(getPositionMeta(effectivePosition).card)}</span>
              </div>
            `
            : '<span class="editor-status">Не оценён</span>'
        }
      </div>
      <div class="editor-body profile-body">
        <div class="editor-nameblock">
          <div class="editor-name">${escapeHtml(player.displayName)}</div>
          <div class="editor-nick">@${escapeHtml(player.username || 'unknown')}</div>
        </div>
        <div class="profile-card-metrics">
          <div class="metric-grid metric-grid--summary ${overviewCells.length === 1 ? 'metric-grid--single' : ''}">
            ${overviewCells.map((cell) => renderMetricCell(cell.label, cell.value, cell)).join('')}
          </div>
          <div class="metric-grid metric-grid--stats">
            ${statCells.map(([label, value]) => renderMetricCell(label, value)).join('')}
          </div>
        </div>
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
    assists: Number(formData.get('assists') || 0)
  };

  for (const [key] of STAT_META) {
    draft[key] = Number(formData.get(key) || 50);
  }

  return draft;
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

  if (!player) {
    modalRoot.innerHTML = '';
    return;
  }

  const editable = Boolean(gamePlayer?.canRateTarget && game);
  const viewerRating = gamePlayer?.viewerRating ?? null;
  const serverDefaults = {
    position: viewerRating?.position || player.position || 'N/A',
    goals: viewerRating?.goals ?? 0,
    assists: viewerRating?.assists ?? 0,
    ...Object.fromEntries(
      STAT_META.map(([key]) => [key, viewerRating?.stats?.[key] ?? 50])
    )
  };
  const draftKey = game ? getRatingDraftKey(game.id, player.id) : '';
  const defaults = editable && draftKey && state.ratingDrafts[draftKey]
    ? { ...serverDefaults, ...state.ratingDrafts[draftKey] }
    : serverDefaults;

  modalRoot.innerHTML = renderEditorScreen(player, gamePlayer, editable, defaults, game);
}

function syncTabbar() {
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === state.activeTab);
  });
}

function render() {
  const screenTitle = getScreenTitle();
  chatTitleNode.textContent = screenTitle;
  topbarNode?.classList.toggle('topbar--titleless', !screenTitle);
  syncTabbar();

  if (!state.chatId) {
    contentNode.innerHTML = `
      <section class="empty-state">
        <h2>Нужен chatId</h2>
        <p>Откройте miniapp из сообщения бота в групповом чате или добавьте <code>?chatId=-100...</code> в URL.</p>
      </section>
    `;
    renderModal();
    return;
  }

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
    ${renderActiveTab()}
  `;

  renderModal();
}

async function submitRating(form) {
  saveRatingFormDraft(form);
  const gameId = form.dataset.gameId;
  const targetPlayerId = form.dataset.playerId;
  const formData = new FormData(form);
  const payload = {
    targetPlayerId,
    position: formData.get('position'),
    goals: Number(formData.get('goals') || 0),
    assists: Number(formData.get('assists') || 0)
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

async function refreshSnapshot({ silent = false } = {}) {
  if (!state.chatId) {
    return;
  }

  try {
    const activeRatingForm = document.getElementById('ratingForm');
    if (activeRatingForm) {
      saveRatingFormDraft(activeRatingForm);
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

  refreshTimer = setInterval(() => {
    void refreshSnapshot({ silent: true });
  }, 30000);
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

  saveRatingFormDraft(form);
}

document.getElementById('refreshButton').addEventListener('click', async () => {
  await refreshSnapshot();
});

document.querySelector('.tabbar').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]');

  if (!button) {
    return;
  }

  state.activeTab = button.dataset.tab;
  render();
});

document.addEventListener('click', (event) => {
  const stepperButton = event.target.closest('[data-stepper-action]');

  if (stepperButton) {
    const form = stepperButton.closest('form');

    if (!form) {
      return;
    }

    updateStepper(
      form,
      stepperButton.dataset.stepperName,
      stepperButton.dataset.stepperAction === 'increment' ? 1 : -1
    );
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
    state.activeTab = 'game';
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
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'positionFilter') {
    state.positionFilter = event.target.value;
    render();
    return;
  }

  if (event.target.matches('#ratingForm select[name="position"]')) {
    const form = event.target.closest('form');
    saveRatingFormDraft(form);
    renderModal();
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
  }
});

document.addEventListener('input', (event) => {
  if (event.target.matches('input[type="range"]')) {
    const valueNode =
      event.target.closest('.editor-range')?.querySelector('.editor-range-value') ||
      event.target.parentElement.querySelector('.range-value');
    if (valueNode) {
      valueNode.textContent = event.target.value;
    }
    saveRatingFormDraft(event.target.closest('form'));
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

  try {
    const authenticated = await authenticateTelegram().catch(() => false);
    if (!authenticated) {
      await loadSnapshot();
    }
  } catch (error) {
    contentNode.innerHTML = `<section class="empty-state"><h2>Ошибка</h2><p>${escapeHtml(error.message)}</p></section>`;
    return;
  }

  render();
  setupAutoRefresh();
}

void init();
