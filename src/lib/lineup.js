export const POSITION_ORDER = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'N/A'];

export const POSITION_META = {
  GK: { short: 'ВР', card: 'вр', title: 'Вратарь' },
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
  ST: { short: 'ЦН', card: 'цн', title: 'Центральный нападающий' },
  'N/A': { short: '—', card: '—', title: 'Не выбрана' }
};

export const POSITION_CHOICES = ['N/A', 'GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST'];

const FIELD_POSITION_LAYOUT_TOP = {
  GK: { x: 50, y: 20 },
  CB: { x: 50, y: 28 },
  LB: { x: 75, y: 33 },
  RB: { x: 25, y: 33 },
  CDM: { x: 50, y: 38 },
  CM: { x: 50, y: 43 },
  CAM: { x: 50, y: 45 },
  LM: { x: 75, y: 42 },
  RM: { x: 25, y: 42 },
  LW: { x: 75, y: 46 },
  RW: { x: 25, y: 46 },
  ST: { x: 50, y: 49 },
  'N/A': { x: 50, y: 34 }
};

const FIELD_POSITION_LAYOUT_BOTTOM = {
  GK: { x: 50, y: 80 },
  CB: { x: 50, y: 72 },
  LB: { x: 25, y: 67 },
  RB: { x: 75, y: 67 },
  CDM: { x: 50, y: 62 },
  CM: { x: 50, y: 57 },
  CAM: { x: 50, y: 55 },
  LM: { x: 25, y: 58 },
  RM: { x: 75, y: 58 },
  LW: { x: 25, y: 54 },
  RW: { x: 75, y: 54 },
  ST: { x: 50, y: 51 },
  'N/A': { x: 50, y: 66 }
};

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getInitials(player) {
  const name = player.displayName || player.username || 'Игрок';
  const parts = name.replace('@', '').split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'FC';
}

export function getPositionMeta(position) {
  return POSITION_META[position] || POSITION_META['N/A'];
}

export function getSortPosition(position) {
  const index = POSITION_ORDER.indexOf(position || 'N/A');
  return index === -1 ? POSITION_ORDER.length : index;
}

export function getEffectiveOverall(player) {
  return player.currentGameStats?.hasRatings ? player.currentGameStats.overall : player.overall;
}

export function getEffectivePosition(player) {
  if (player.currentGameStats?.hasRatings && player.currentGameStats.position) {
    return POSITION_META[player.currentGameStats.position] ? player.currentGameStats.position : 'N/A';
  }

  return POSITION_META[player.position] ? player.position : 'N/A';
}

function getFieldZoneBounds(zone) {
  return zone === 'top'
    ? { xMin: 12, xMax: 88, yMin: 18, yMax: 48 }
    : { xMin: 12, xMax: 88, yMin: 52, yMax: 82 };
}

function getFieldBaseSlot(position, zone) {
  const layout = zone === 'top' ? FIELD_POSITION_LAYOUT_TOP : FIELD_POSITION_LAYOUT_BOTTOM;
  return layout[position] || layout['N/A'];
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

export function buildTeamFieldAssignments(players, zone) {
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
      position,
      slot: {
        x: clamp(base.x + offsets[index].x, bounds.xMin, bounds.xMax),
        y: clamp(base.y + offsets[index].y, bounds.yMin, bounds.yMax)
      }
    }));
  });
}

export function splitBalancedTeams(players) {
  const sorted = [...players].sort(
    (left, right) => getEffectiveOverall(right) - getEffectiveOverall(left)
  );
  const maxTopCount = Math.ceil(sorted.length / 2);
  const maxBottomCount = Math.floor(sorted.length / 2);
  const top = [];
  const bottom = [];
  let topScore = 0;
  let bottomScore = 0;

  const assignToTeam = (player, preferred = '') => {
    const rating = getEffectiveOverall(player);

    if (preferred === 'top' && top.length < maxTopCount) {
      top.push(player);
      topScore += rating;
      return true;
    }

    if (preferred === 'bottom' && bottom.length < maxBottomCount) {
      bottom.push(player);
      bottomScore += rating;
      return true;
    }

    const shouldGoTop = (topScore <= bottomScore && top.length < maxTopCount) || bottom.length >= maxBottomCount;

    if (shouldGoTop) {
      top.push(player);
      topScore += rating;
    } else {
      bottom.push(player);
      bottomScore += rating;
    }

    return true;
  };

  const goalkeepers = sorted.filter((player) => getEffectivePosition(player) === 'GK');
  const rest = sorted.filter((player) => getEffectivePosition(player) !== 'GK');

  goalkeepers.forEach((player, index) => {
    assignToTeam(player, index % 2 === 0 ? 'top' : 'bottom');
  });

  for (const player of rest) {
    assignToTeam(player);
  }

  return [
    { key: 'top', players: top, total: topScore },
    { key: 'bottom', players: bottom, total: bottomScore }
  ];
}
