const STAT_META = [
  ['pace', 'Скорость'],
  ['dribbling', 'Дриблинг'],
  ['shooting', 'Удар'],
  ['defense', 'Защита'],
  ['passing', 'Передачи'],
  ['physical', 'Физика']
];

const POSITION_ORDER = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'N/A'];
const POSITION_META = {
  GK: { short: 'ВРТ', card: 'врт', title: 'Вратарь' },
  CB: { short: 'ЦЗ', card: 'цз', title: 'Центральный защитник' },
  LB: { short: 'ЛЗ', card: 'лз', title: 'Левый защитник' },
  RB: { short: 'ПЗ', card: 'пз', title: 'Правый защитник' },
  CDM: { short: 'ЦОП', card: 'цоп', title: 'Опорный полузащитник' },
  CM: { short: 'ЦП', card: 'цп', title: 'Центральный полузащитник' },
  CAM: { short: 'ЦАП', card: 'цап', title: 'Атакующий полузащитник' },
  LM: { short: 'ЛП', card: 'лп', title: 'Левый полузащитник' },
  RM: { short: 'ПП', card: 'пп', title: 'Правый полузащитник' },
  LW: { short: 'ЛВ', card: 'лв', title: 'Левый вингер' },
  RW: { short: 'ПВ', card: 'пв', title: 'Правый вингер' },
  ST: { short: 'НП', card: 'нап', title: 'Нападающий' },
  'N/A': { short: '—', card: '—', title: 'Не выбрана' }
};
const FIELD_POSITION_LAYOUT_TOP = {
  GK: { x: 50, y: 20 },
  CB: { x: 50, y: 29 },
  LB: { x: 24, y: 33 },
  RB: { x: 76, y: 33 },
  CDM: { x: 50, y: 39 },
  CM: { x: 50, y: 44 },
  CAM: { x: 50, y: 48 },
  LM: { x: 26, y: 45 },
  RM: { x: 74, y: 45 },
  LW: { x: 24, y: 50 },
  RW: { x: 76, y: 50 },
  ST: { x: 50, y: 52 },
  'N/A': { x: 50, y: 35 }
};

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
const POSITION_CHOICES = ['N/A', 'GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST'];

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
  positionFilter: '',
  selectedPlayerId: null
};

const tg = window.Telegram?.WebApp;
const apiBaseUrl = String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
const contentNode = document.getElementById('content');
const chatTitleNode = document.getElementById('chatTitle');
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

function getInitials(player) {
  const name = player.displayName || player.username || 'Игрок';
  const parts = name.replace('@', '').split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'FC';
}

function getScreenTitle() {
  return state.activeTab === 'game' ? 'Игровой день' : 'Игроки';
}

function getPositionMeta(position) {
  return POSITION_META[position] || POSITION_META['N/A'];
}

function getSortPosition(position) {
  const index = POSITION_ORDER.indexOf(position || 'N/A');
  return index === -1 ? POSITION_ORDER.length : index;
}

function getEffectiveOverall(player) {
  return player.currentGameStats?.hasRatings ? player.currentGameStats.overall : player.overall;
}

function getEffectivePosition(player) {
  if (player.currentGameStats?.hasRatings && player.currentGameStats.position) {
    return POSITION_META[player.currentGameStats.position] ? player.currentGameStats.position : 'N/A';
  }

  return POSITION_META[player.position] ? player.position : 'N/A';
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

function getPlayers() {
  return state.snapshot?.players ?? [];
}

function getPlayer(playerId) {
  return getPlayers().find((player) => player.id === playerId) ?? null;
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

function getFieldZoneBounds(zone) {
  return zone === 'top'
    ? { xMin: 12, xMax: 88, yMin: 18, yMax: 48 }
    : { xMin: 12, xMax: 88, yMin: 52, yMax: 82 };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getFieldBaseSlot(position, zone) {
  const topSlot = FIELD_POSITION_LAYOUT_TOP[position] || FIELD_POSITION_LAYOUT_TOP['N/A'];

  if (zone === 'top') {
    return topSlot;
  }

  return {
    x: topSlot.x,
    y: 100 - topSlot.y
  };
}

function buildClusterOffsets(count, position) {
  if (count <= 1) {
    return [{ x: 0, y: 0 }];
  }

  const columns = count <= 2 ? count : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / columns);
  const xGap = position === 'N/A' ? 13 : ['LB', 'RB', 'LM', 'RM', 'LW', 'RW'].includes(position) ? 9 : 11;
  const yGap = position === 'N/A' ? 10 : 8;
  const offsets = [];

  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const rowWidth = Math.min(columns, count - row * columns);
    const x = (column - (rowWidth - 1) / 2) * xGap;
    const y = rows === 1 ? 0 : (row - (rows - 1) / 2) * yGap;
    offsets.push({ x, y });
  }

  return offsets;
}

function buildTeamFieldAssignments(players, zone) {
  const bounds = getFieldZoneBounds(zone);
  const groups = new Map();

  for (const player of [...players].sort((left, right) => {
    const leftPosition = getSortPosition(getEffectivePosition(left));
    const rightPosition = getSortPosition(getEffectivePosition(right));

    if (leftPosition !== rightPosition) {
      return leftPosition - rightPosition;
    }

    if (getEffectiveOverall(right) !== getEffectiveOverall(left)) {
      return getEffectiveOverall(right) - getEffectiveOverall(left);
    }

    return left.displayName.localeCompare(right.displayName, 'ru');
  })) {
    const position = getEffectivePosition(player);
    const list = groups.get(position) || [];
    list.push(player);
    groups.set(position, list);
  }

  return [...groups.entries()].flatMap(([position, groupedPlayers]) => {
    const base = getFieldBaseSlot(position, zone);
    const offsets = buildClusterOffsets(groupedPlayers.length, position);

    return groupedPlayers.map((player, index) => ({
      player,
      slot: {
        x: clamp(base.x + offsets[index].x, bounds.xMin, bounds.xMax),
        y: clamp(base.y + offsets[index].y, bounds.yMin, bounds.yMax)
      }
    }));
  });
}

function splitBalancedTeams(players) {
  const sorted = [...players].sort(
    (left, right) => getEffectiveOverall(right) - getEffectiveOverall(left)
  );
  const maxTopCount = Math.ceil(sorted.length / 2);
  const maxBottomCount = Math.floor(sorted.length / 2);
  const top = [];
  const bottom = [];
  let topScore = 0;
  let bottomScore = 0;

  for (const player of sorted) {
    const rating = getEffectiveOverall(player);
    const shouldGoTop = (topScore <= bottomScore && top.length < maxTopCount) || bottom.length >= maxBottomCount;

    if (shouldGoTop) {
      top.push(player);
      topScore += rating;
    } else {
      bottom.push(player);
      bottomScore += rating;
    }
  }

  return [
    { key: 'top', title: 'Состав A', players: top, total: topScore },
    { key: 'bottom', title: 'Состав B', players: bottom, total: bottomScore }
  ];
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
  const showKnownStats = variant === 'player-list' || hasCurrentRatings || hasCareerRatings;
  const overall = hasCurrentRatings ? currentStats.overall : showKnownStats ? player.overall : null;
  const position = hasCurrentRatings ? (currentStats?.position || player.position || 'N/A') : (showKnownStats ? (player.position || 'N/A') : null);
  const statValues = hasCurrentRatings ? currentStats?.stats : player.stats;
  const isRatingCard = variant === 'game-rating';
  const isGameCard = variant !== 'player-list';
  const statusLabel = isGameCard && !hasCurrentRatings && !hasCareerRatings ? 'Не оценён' : '';
  const statPlaceholder = '-';
  const overviewCells = [
    { label: 'игр', value: player.games, emphasis: true },
    { label: 'голов', value: showKnownStats ? (hasCurrentRatings ? currentStats.goals : player.goals) : statPlaceholder, outlined: isRatingCard },
    { label: 'голевых', value: showKnownStats ? (hasCurrentRatings ? currentStats.assists : player.assists) : statPlaceholder, outlined: isRatingCard }
  ];
  const statCells = [
    ['скорость', showKnownStats ? statValues.pace : statPlaceholder],
    ['дриблинг', showKnownStats ? statValues.dribbling : statPlaceholder],
    ['удар', showKnownStats ? statValues.shooting : statPlaceholder],
    ['защита', showKnownStats ? statValues.defense : statPlaceholder],
    ['передачи', showKnownStats ? statValues.passing : statPlaceholder],
    ['физика', showKnownStats ? statValues.physical : statPlaceholder]
  ];
  const openAttribute = clickable ? ` data-open-player="${escapeHtml(player.id)}"` : '';
  const actionNote =
    isRatingCard && ratingsCount > 0
      ? `${ratingsCount} уже оценили`
      : '';

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
            ? renderPositionSelector('Позиция', showKnownStats ? getPositionMeta(position).title : 'Не выбрана')
            : ''
        }
        <div class="metric-grid metric-grid--summary">
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
                <form id="ratingForm" class="editor-form" data-game-id="${escapeHtml(game.id)}" data-player-id="${escapeHtml(player.id)}">
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
                  ${renderEditorStepper('goals', 'голов', defaults.goals)}
                  ${renderEditorStepper('assists', 'голевых передач', defaults.assists)}
                  ${STAT_META.map(([key, label]) => renderEditorRange(key, label.toLowerCase(), defaults[key])).join('')}
                  <button type="submit" class="primary-button editor-submit">Сохранить</button>
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
      ${
        game.priceLine || game.paymentLines?.length
          ? `
            <div class="game-payment">
              ${game.priceLine ? `<div>${escapeHtml(game.priceLine)}</div>` : ''}
              ${game.paymentLines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
            </div>
          `
          : ''
      }
    </section>
  `;
}

function renderRatingBanner(game) {
  let message = 'Оцените игроков после начала игры в течение суток';

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
                <div class="field-team-badge field-team-badge--${escapeHtml(team.key)}">
                  <span>${escapeHtml(team.title)}</span>
                  <strong>${escapeHtml(team.total)}</strong>
                </div>
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

function renderModal() {
  const player = getPlayer(state.selectedPlayerId);
  const game = getCurrentGame();
  const gamePlayer = game?.participants?.find((item) => item.id === state.selectedPlayerId) ?? null;

  if (!player) {
    modalRoot.innerHTML = '';
    return;
  }

  const editable = Boolean(gamePlayer?.canRateTarget && game);
  const defaults = {
    position: gamePlayer?.currentGameStats?.position || player.position || 'N/A',
    goals: gamePlayer?.currentGameStats?.goals ?? 0,
    assists: gamePlayer?.currentGameStats?.assists ?? 0,
    ...Object.fromEntries(
      STAT_META.map(([key]) => [key, gamePlayer?.currentGameStats?.stats?.[key] ?? player.stats[key] ?? 50])
    )
  };

  modalRoot.innerHTML = renderEditorScreen(player, gamePlayer, editable, defaults, game);
}

function render() {
  chatTitleNode.textContent = getScreenTitle();

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
    ${state.activeTab === 'game' ? renderGameTab() : renderPlayersTab()}
  `;

  document.querySelectorAll('.tab-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === state.activeTab);
  });

  renderModal();
}

async function submitRating(form) {
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
  state.selectedPlayerId = null;
  render();
  showToast('Оценка сохранена');
}

async function refreshSnapshot({ silent = false } = {}) {
  if (!state.chatId) {
    return;
  }

  try {
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

  if (event.target.closest('[data-close-modal]') || event.target.matches('[data-modal-backdrop]')) {
    state.selectedPlayerId = null;
    renderModal();
  }

  const sortButton = event.target.closest('[data-sort]');

  if (sortButton) {
    state.activeSort = sortButton.dataset.sort;
    render();
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'positionFilter') {
    state.positionFilter = event.target.value;
    render();
    return;
  }

  if (event.target.matches('input[type="range"]')) {
    const valueNode =
      event.target.closest('.editor-range')?.querySelector('.editor-range-value') ||
      event.target.parentElement.querySelector('.range-value');
    if (valueNode) {
      valueNode.textContent = event.target.value;
    }
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
