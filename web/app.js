const STAT_META = [
  ['pace', 'Скорость'],
  ['dribbling', 'Дриблинг'],
  ['shooting', 'Удар'],
  ['defense', 'Защита'],
  ['passing', 'Передачи'],
  ['physical', 'Физика']
];

const POSITION_ORDER = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'N/A'];

const FILTER_CHIPS = [
  { key: 'overall', label: 'Рейтинг' },
  { key: 'position', label: 'Позиция' },
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
  selectedPlayerId: null
};

const tg = window.Telegram?.WebApp;
const apiBaseUrl = String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
const contentNode = document.getElementById('content');
const chatTitleNode = document.getElementById('chatTitle');
const modalRoot = document.getElementById('modalRoot');
const toastNode = document.getElementById('toast');

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

function getSortPosition(position) {
  const index = POSITION_ORDER.indexOf(position || 'N/A');
  return index === -1 ? POSITION_ORDER.length : index;
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

function fieldSlots(count) {
  const layouts = {
    1: [1],
    2: [1, 1],
    3: [1, 2],
    4: [1, 3],
    5: [1, 2, 2],
    6: [1, 2, 3],
    7: [1, 3, 3],
    8: [1, 3, 4],
    9: [1, 3, 2, 3],
    10: [1, 3, 3, 3],
    11: [1, 4, 3, 3],
    12: [1, 4, 3, 4]
  };
  const rows = layouts[count] || [1, 4, 3, 4];
  const totalRows = rows.length;
  const slots = [];

  rows.forEach((rowCount, rowIndex) => {
    const y = 84 - (totalRows === 1 ? 0 : rowIndex * (58 / (totalRows - 1)));
    for (let index = 0; index < rowCount; index += 1) {
      slots.push({
        x: ((index + 1) / (rowCount + 1)) * 100,
        y
      });
    }
  });

  return slots.slice(0, count);
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
  const overall = currentStats?.overall ?? player.overall;
  const position = currentStats?.position || player.position || 'N/A';
  const variant = options.variant || 'summary';
  const clickable = options.clickable !== false;
  const actionLabel = options.actionLabel || '';
  const statValues = currentStats?.stats || player.stats;
  const isRatingCard = variant === 'rating';
  const overviewCells = [
    { label: 'игр', value: player.games, emphasis: true },
    { label: 'голов', value: player.goals, outlined: isRatingCard },
    { label: 'голевых', value: player.assists, outlined: isRatingCard }
  ];
  const statCells = [
    ['скорость', statValues.pace],
    ['дриблинг', statValues.dribbling],
    ['удар', statValues.shooting],
    ['защита', statValues.defense],
    ['передачи', statValues.passing],
    ['физика', statValues.physical]
  ];
  const openAttribute = clickable ? ` data-open-player="${escapeHtml(player.id)}"` : '';

  return `
    <article class="fifa-card fifa-card--${escapeHtml(variant)} ${player.isMvp ? 'is-mvp' : ''} ${clickable ? 'is-clickable' : ''}"${openAttribute}>
      ${player.isMvp ? '<span class="mvp-badge">MVP</span>' : ''}
      <div class="fifa-card-hero">
        ${renderCardHero(player)}
        <div class="hero-score">
          <strong>${escapeHtml(overall)}</strong>
          <span>${escapeHtml(position)}</span>
        </div>
      </div>
      <div class="fifa-card-panel">
        <div class="fifa-card-nameblock">
          <div class="card-name">${escapeHtml(player.displayName)}</div>
          <div class="card-nick">@${escapeHtml(player.username || 'unknown')}</div>
        </div>
        <div class="metric-grid metric-grid--summary">
          ${overviewCells.map((cell) => renderMetricCell(cell.label, cell.value, cell)).join('')}
        </div>
        <div class="metric-grid metric-grid--stats">
          ${statCells.map(([label, value]) => renderMetricCell(label, value, { outlined: isRatingCard })).join('')}
        </div>
        ${
          actionLabel
            ? `<button type="button" class="primary-button card-action" data-open-player="${escapeHtml(player.id)}">${escapeHtml(actionLabel)}</button>`
            : ''
        }
      </div>
    </article>
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
        <div>
          <span>Чат</span>
          <strong>${escapeHtml(state.snapshot?.chat?.title || 'Чат')}</strong>
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
      ${game.isFinished ? '<div class="ended-banner">Игра закончена</div>' : ''}
    </section>
  `;
}

function renderRatingBanner(game) {
  let message = 'Оценка игроков откроется после времени начала игры.';

  if (game.canViewerRate) {
    message = 'Можно оценивать игроков текущего матча. Выбирайте карточку ниже.';
  } else if (game.hasStarted && !game.viewerIsParticipant) {
    message = 'Оценивать могут только участники текущего матча.';
  } else if (game.isFinished) {
    message = 'Игра завершена. Статистика обновится, когда появятся новые оценки.';
  }

  return `
    <section class="notice-banner">
      <p>${escapeHtml(message)}</p>
    </section>
  `;
}

function renderField(game) {
  const slots = fieldSlots(game.participants.length);

  return `
    <section class="panel field-panel">
      <div class="field">
        <div class="field-line mid"></div>
        <div class="field-circle"></div>
        <div class="field-box top"></div>
        <div class="field-box bottom"></div>
        ${game.participants
          .map((player, index) => {
            const slot = slots[index] || { x: 50, y: 50 };
            return `
              <button
                type="button"
                class="field-player"
                data-open-player="${escapeHtml(player.id)}"
                style="left:${slot.x}%; top:${slot.y}%"
              >
                <span class="field-player-overall">${player.currentGameStats?.overall ?? player.overall}</span>
                <span class="field-player-name">${escapeHtml(player.displayName.split(' ')[0])}</span>
              </button>
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
            variant: player.canRateTarget ? 'rating' : 'summary',
            actionLabel: player.canRateTarget ? 'Оценить' : '',
            currentStats: player.currentGameStats
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
    </div>
  `;
}

function renderPlayersTab() {
  const players = sortPlayers(getPlayers());

  return `
    ${renderFilterBar()}
    <section class="stack cards-stack">
      ${players.map((player) => renderFifaCard(player, { variant: 'summary' })).join('')}
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
    position: gamePlayer?.currentGameStats?.position || player.position || 'CM',
    goals: gamePlayer?.currentGameStats?.goals ?? 0,
    assists: gamePlayer?.currentGameStats?.assists ?? 0,
    ...Object.fromEntries(
      STAT_META.map(([key]) => [key, gamePlayer?.currentGameStats?.stats?.[key] ?? player.stats[key] ?? 50])
    )
  };

  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop="true">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(player.displayName)}">
        <button class="modal-close" type="button" data-close-modal="true">×</button>
        ${renderFifaCard(player, {
          currentStats: gamePlayer?.currentGameStats ?? null,
          variant: editable ? 'rating' : 'summary',
          clickable: false
        })}
        ${
          editable
            ? `
              <form id="ratingForm" class="rating-form" data-game-id="${escapeHtml(game.id)}" data-player-id="${escapeHtml(player.id)}">
                <label>
                  <span>Позиция</span>
                  <select name="position">
                    ${['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST']
                      .map((position) => `<option value="${position}" ${defaults.position === position ? 'selected' : ''}>${position}</option>`)
                      .join('')}
                  </select>
                </label>
                ${STAT_META.map(
                  ([key, label]) => `
                    <label class="range-row">
                      <span>${escapeHtml(label)}</span>
                      <div>
                        <input type="range" min="1" max="99" name="${escapeHtml(key)}" value="${defaults[key]}">
                        <strong class="range-value">${defaults[key]}</strong>
                      </div>
                    </label>
                  `
                ).join('')}
                <div class="two-columns">
                  <label>
                    <span>Голы</span>
                    <input type="number" name="goals" min="0" max="20" value="${defaults.goals}">
                  </label>
                  <label>
                    <span>Голевые</span>
                    <input type="number" name="assists" min="0" max="20" value="${defaults.assists}">
                  </label>
                </div>
                <button type="submit" class="primary-button">Сохранить оценку</button>
              </form>
            `
            : `
              <div class="panel subtle-panel">
                <p>Этого игрока можно только посмотреть. Оценка доступна после старта матча и только для других участников текущей игры.</p>
              </div>
            `
        }
      </div>
    </div>
  `;
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

document.getElementById('refreshButton').addEventListener('click', async () => {
  await loadSnapshot();
  render();
  showToast('Обновлено');
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
  if (event.target.matches('input[type="range"]')) {
    const valueNode = event.target.parentElement.querySelector('.range-value');
    if (valueNode) {
      valueNode.textContent = event.target.value;
    }
  }
});

document.addEventListener('input', (event) => {
  if (event.target.matches('input[type="range"]')) {
    const valueNode = event.target.parentElement.querySelector('.range-value');
    if (valueNode) {
      valueNode.textContent = event.target.value;
    }
  }
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
}

void init();
