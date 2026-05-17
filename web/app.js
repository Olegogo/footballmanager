const STAT_META = [
  ['pace', 'Скорость'],
  ['dribbling', 'Дриблинг'],
  ['shooting', 'Удар'],
  ['defense', 'Защита'],
  ['passing', 'Передачи'],
  ['physical', 'Физика']
];

const state = {
  chatId: new URLSearchParams(window.location.search).get('chatId') || '',
  token: '',
  snapshot: null,
  allowDevLogin: false,
  activeTab: 'game',
  activeSort: 'overall',
  selectedStat: '',
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

    if (state.activeSort === 'games') {
      if (right.games !== left.games) {
        return right.games - left.games;
      }
    } else if (state.activeSort === 'goals') {
      if (right.goals !== left.goals) {
        return right.goals - left.goals;
      }
    } else if (state.activeSort === 'assists') {
      if (right.assists !== left.assists) {
        return right.assists - left.assists;
      }
    } else if (state.activeSort === 'stat' && state.selectedStat) {
      if (right.stats[state.selectedStat] !== left.stats[state.selectedStat]) {
        return right.stats[state.selectedStat] - left.stats[state.selectedStat];
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

function renderAvatar(player) {
  if (player.photoUrl) {
    return `<div class="card-photo"><img src="${escapeHtml(player.photoUrl)}" alt="${escapeHtml(player.displayName)}"></div>`;
  }

  return `<div class="card-photo fallback">${escapeHtml(getInitials(player))}</div>`;
}

function renderFifaCard(player, options = {}) {
  const actionLabel = options.actionLabel || '';
  const showAction = Boolean(actionLabel);
  const currentStats = options.currentStats || null;

  return `
    <article class="fifa-card ${player.isMvp ? 'is-mvp' : ''}" data-player-card="${escapeHtml(player.id)}">
      ${player.isMvp ? '<span class="mvp-badge">MVP</span>' : ''}
      <div class="card-score">
        <strong>${player.overall}</strong>
        <span>${escapeHtml(currentStats?.position || player.position || 'N/A')}</span>
      </div>
      ${renderAvatar(player)}
      <div class="card-body">
        <div class="card-name">${escapeHtml(player.displayName)}</div>
        <div class="card-nick">@${escapeHtml(player.username || 'unknown')}</div>
        <div class="card-meta">
          <span>Игр ${player.games}</span>
          <span>Г ${player.goals}</span>
          <span>А ${player.assists}</span>
        </div>
        <div class="stat-grid">
          ${STAT_META.map(
            ([key, label]) => `
              <div class="stat-cell">
                <span>${escapeHtml(label.slice(0, 3).toUpperCase())}</span>
                <strong>${currentStats?.stats?.[key] ?? player.stats[key]}</strong>
              </div>
            `
          ).join('')}
        </div>
        ${
          showAction
            ? `<button type="button" class="primary-button small" data-open-player="${escapeHtml(player.id)}">${escapeHtml(actionLabel)}</button>`
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
          <p class="eyebrow">Текущая игра</p>
          <h2>${escapeHtml(game.dateLabel)}</h2>
        </div>
        <span class="status-pill ${escapeHtml(game.status)}">${escapeHtml(statusText)}</span>
      </div>
      <div class="game-facts">
        <div>
          <span>Время</span>
          <strong>${escapeHtml(game.time)}</strong>
        </div>
        <div>
          <span>Место</span>
          <strong>${escapeHtml(game.location || 'Не указано')}</strong>
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
      ${game.isFinished ? '<div class="ended-banner">Игра закончена</div>' : ''}
      ${
        !game.hasStarted
          ? '<p class="hint">Оценка откроется после времени начала игры.</p>'
          : game.canViewerRate
            ? '<p class="hint">Можно оценивать всех участников, кроме себя. Окно оценок закроется, когда в чате появится новая игра.</p>'
            : '<p class="hint">Оценивать могут только участники текущей игры, которые открыли miniapp.</p>'
      }
    </section>
  `;
}

function renderField(game) {
  const slots = fieldSlots(game.participants.length);

  return `
    <section class="panel">
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
    <section class="stack">
      ${game.participants
        .map((player) =>
          renderFifaCard(player, {
            actionLabel: player.canRateTarget ? 'Оценить' : 'Открыть',
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
      <button type="button" class="chip ${state.activeSort === 'overall' ? 'active' : ''}" data-sort="overall">По рейтингу</button>
      <button type="button" class="chip ${state.activeSort === 'games' ? 'active' : ''}" data-sort="games">Количество игр</button>
      <label class="chip select-chip ${state.activeSort === 'stat' ? 'active' : ''}">
        <select id="statSelect">
          <option value="">Не выбрано</option>
          ${STAT_META.map(([key, label]) => `<option value="${escapeHtml(key)}" ${state.selectedStat === key ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
        </select>
      </label>
      <button type="button" class="chip ${state.activeSort === 'goals' ? 'active' : ''}" data-sort="goals">Голы</button>
      <button type="button" class="chip ${state.activeSort === 'assists' ? 'active' : ''}" data-sort="assists">Голевые</button>
    </div>
  `;
}

function renderPlayersTab() {
  const players = sortPlayers(getPlayers());

  return `
    ${renderFilterBar()}
    <section class="stack">
      ${players.map((player) => renderFifaCard(player, { actionLabel: 'Открыть' })).join('')}
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
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(player.displayName)}" data-stop-close="true">
        <button class="modal-close" type="button" data-close-modal="true">×</button>
        ${renderFifaCard(player, { currentStats: gamePlayer?.currentGameStats ?? null })}
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
  const title = state.snapshot?.chat?.title || 'FIFA Cards';
  chatTitleNode.textContent = title;

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
  if (event.target.id === 'statSelect') {
    state.selectedStat = event.target.value;
    state.activeSort = state.selectedStat ? 'stat' : 'overall';
    render();
    return;
  }

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
