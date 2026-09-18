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

const FIELD_POSITION_LAYOUT_FULL = {
  GK: { x: 8, y: 50 },
  CB: { x: 28, y: 50 },
  LB: { x: 28, y: 15 },
  RB: { x: 28, y: 85 },
  CDM: { x: 43, y: 50 },
  CM: { x: 51, y: 50 },
  CAM: { x: 61, y: 50 },
  LM: { x: 51, y: 12 },
  RM: { x: 51, y: 88 },
  LW: { x: 72, y: 9 },
  RW: { x: 72, y: 91 },
  ST: { x: 79, y: 50 },
  'N/A': { x: 50, y: 50 }
};

const FIELD_POSITION_LAYOUT_TOP = {
  GK: { x: 50, y: 12 },
  CB: { x: 50, y: 23 },
  LB: { x: 90, y: 30 },
  RB: { x: 10, y: 30 },
  CDM: { x: 50, y: 36 },
  CM: { x: 50, y: 42 },
  CAM: { x: 50, y: 45 },
  LM: { x: 93, y: 41 },
  RM: { x: 7, y: 41 },
  LW: { x: 95, y: 47 },
  RW: { x: 5, y: 47 },
  ST: { x: 50, y: 49 },
  'N/A': { x: 50, y: 34 }
};

const FIELD_POSITION_LAYOUT_BOTTOM = {
  GK: { x: 50, y: 88 },
  CB: { x: 50, y: 77 },
  LB: { x: 10, y: 70 },
  RB: { x: 90, y: 70 },
  CDM: { x: 50, y: 64 },
  CM: { x: 50, y: 58 },
  CAM: { x: 50, y: 55 },
  LM: { x: 7, y: 59 },
  RM: { x: 93, y: 59 },
  LW: { x: 5, y: 53 },
  RW: { x: 95, y: 53 },
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
    ? { xMin: 5, xMax: 95, yMin: 10, yMax: 49 }
    : { xMin: 5, xMax: 95, yMin: 51, yMax: 90 };
}

function getFieldBaseSlot(position, zone) {
  const layout = zone === 'top' ? FIELD_POSITION_LAYOUT_TOP : FIELD_POSITION_LAYOUT_BOTTOM;
  return layout[position] || layout['N/A'];
}

function buildClusterOffsets(count, position) {
  if (count <= 1) {
    return [{ x: 0, y: 0 }];
  }

  if (['GK', 'CB', 'CDM', 'CM', 'CAM', 'ST'].includes(position)) {
    if (count === 2) {
      return [{ x: 0, y: -9 }, { x: 0, y: 9 }];
    }

    if (count === 3) {
      return [{ x: 0, y: -12 }, { x: 0, y: 0 }, { x: 0, y: 12 }];
    }
  }

  const columns = count <= 2 ? count : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / columns);
  const xGap = position === 'N/A' ? 16 : ['LB', 'RB', 'LM', 'RM', 'LW', 'RW'].includes(position) ? 11 : 13;
  const yGap = position === 'N/A' ? 15 : 10;
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

// Outfield places for 1–2–2, 1–2–2–1, 1–2–3–1 and 1–2–3–2.
const MATCH_FORMATIONS = {
  4: [[34, 24], [34, 76], [68, 24], [68, 76]],
  5: [[31, 24], [31, 76], [59, 24], [59, 76], [80, 50]],
  6: [[27, 24], [27, 76], [51, 15], [51, 50], [51, 85], [78, 50]],
  7: [[27, 24], [27, 76], [51, 15], [51, 50], [51, 85], [76, 24], [76, 76]]
};

function matchFormationSlots(count) {
  if (count <= 4) return MATCH_FORMATIONS[4].map(([x, y]) => ({ x, y }));
  if (MATCH_FORMATIONS[count]) return MATCH_FORMATIONS[count].map(([x, y]) => ({ x, y }));
  // Larger squads still get distinct outfield places; never use the goal as overflow.
  const columns = Math.ceil(count / 3);
  return Array.from({ length: count }, (_, index) => ({
    x: 27 + Math.floor(index / 3) * 54 / Math.max(1, columns - 1),
    y: [17, 50, 83][index % 3]
  }));
}

// Minimum-cost matching, O(n³), so duplicate positions cannot share a place.
// Unknown positions have no preference and take whichever places remain.
function assignFormationSlots(players, slots) {
  const n = players.length, m = slots.length;
  const u = Array(n + 1).fill(0), v = Array(m + 1).fill(0);
  const occupied = Array(m + 1).fill(0), previous = Array(m + 1).fill(0);
  const cost = (i, j) => {
    const position = getEffectivePosition(players[i]);
    if (position === 'N/A') return 0;
    const target = FIELD_POSITION_LAYOUT_FULL[position];
    return (slots[j].x - target.x) ** 2 + ((slots[j].y - target.y) * .6) ** 2;
  };
  for (let i = 1; i <= n; i++) {
    occupied[0] = i;
    let j0 = 0;
    const min = Array(m + 1).fill(Infinity), used = Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = occupied[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const current = cost(i0 - 1, j - 1) - u[i0] - v[j];
        if (current < min[j]) { min[j] = current; previous[j] = j0; }
        if (min[j] < delta) { delta = min[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[occupied[j]] += delta; v[j] -= delta; }
        else min[j] -= delta;
      }
      j0 = j1;
    } while (occupied[j0] !== 0);
    do {
      const j1 = previous[j0];
      occupied[j0] = occupied[j1];
      j0 = j1;
    } while (j0);
  }
  const result = Array(n);
  for (let j = 1; j <= m; j++) if (occupied[j]) result[occupied[j] - 1] = slots[j - 1];
  return result;
}

export function buildFullFieldAssignments(players) {
  const ordered = [...players].sort((a, b) =>
    getSortPosition(getEffectivePosition(a)) - getSortPosition(getEffectivePosition(b)) ||
    getEffectiveOverall(b) - getEffectiveOverall(a) ||
    String(a.id || a.displayName).localeCompare(String(b.id || b.displayName))
  );
  const keepers = ordered.filter((player) => getEffectivePosition(player) === 'GK');
  const outfield = ordered.filter((player) => getEffectivePosition(player) !== 'GK');
  const slots = assignFormationSlots(outfield, matchFormationSlots(outfield.length));
  return [
    ...keepers.map((player, index) => ({
      player, position: 'GK',
      slot: { x: FIELD_POSITION_LAYOUT_FULL.GK.x, y: keepers.length === 1 ? 50 : 38 + 24 * index / (keepers.length - 1) }
    })),
    ...outfield.map((player, index) => ({ player, position: getEffectivePosition(player), slot: slots[index] }))
  ];
}

// Fixed 1–2–2 formation from the Star Five reference. Assign outfield players
// to the closest of the four places without moving those places.
export function buildStarFiveFieldAssignments(players) {
  const keeper = players.find((player) => getEffectivePosition(player) === 'GK');
  const outfield = players.filter((player) => getEffectivePosition(player) !== 'GK').slice(0, keeper ? 4 : 5);
  const slots = [
    { x: 34, y: 24 }, { x: 34, y: 76 },
    { x: 68, y: 24 }, { x: 68, y: 76 },
    // Until a goalkeeper wins MVP, keep a fifth outfielder away from the goal.
    ...(!keeper && outfield.length === 5 ? [{ x: 51, y: 50 }] : [])
  ];
  let bestCost = Infinity;
  let best = [];
  const visit = (index, used, chosen, cost) => {
    if (cost >= bestCost) return;
    if (index === outfield.length) { bestCost = cost; best = [...chosen]; return; }
    const target = FIELD_POSITION_LAYOUT_FULL[getEffectivePosition(outfield[index])];
    slots.forEach((slot, slotIndex) => {
      if (used & (1 << slotIndex)) return;
      const distance = (slot.x - target.x) ** 2 + ((slot.y - target.y) * .6) ** 2;
      chosen.push(slot);
      visit(index + 1, used | (1 << slotIndex), chosen, cost + distance);
      chosen.pop();
    });
  };
  visit(0, 0, [], 0);
  return [
    ...(keeper ? [{ player: keeper, position: 'GK', slot: { ...FIELD_POSITION_LAYOUT_FULL.GK } }] : []),
    ...outfield.map((player, index) => ({ player, position: getEffectivePosition(player), slot: best[index] }))
  ];
}

export function getMaximumTeamCount(playerCount) {
  return clamp(Math.floor((Number(playerCount) || 0) / 5), 2, 4);
}

export function splitBalancedTeams(players, requestedTeamCount = 2) {
  const teamCount = Math.min(
    clamp(Math.trunc(Number(requestedTeamCount)) || 2, 2, 4),
    getMaximumTeamCount(players.length)
  );
  const sorted = [...players].sort(
    (left, right) => getEffectiveOverall(right) - getEffectiveOverall(left)
  );
  const keys = ['top', 'bottom', 'green', 'blue'].slice(0, teamCount);
  const teams = keys.map((key, index) => ({
    key,
    players: [],
    total: 0,
    capacity: Math.floor(sorted.length / teamCount) + (index < sorted.length % teamCount ? 1 : 0)
  }));

  const assignToTeam = (player, preferredIndex = -1) => {
    const rating = getEffectiveOverall(player);
    const preferredTeam = teams[preferredIndex];
    const availableTeams = teams.filter((team) => team.players.length < team.capacity);
    const team = preferredTeam?.players.length < preferredTeam?.capacity
      ? preferredTeam
      : availableTeams.sort((left, right) => left.total - right.total || left.players.length - right.players.length)[0];

    if (!team) return;
    team.players.push(player);
    team.total += rating;
  };

  const goalkeepers = sorted.filter((player) => getEffectivePosition(player) === 'GK');
  const rest = sorted.filter((player) => getEffectivePosition(player) !== 'GK');

  goalkeepers.forEach((player, index) => {
    assignToTeam(player, index % teamCount);
  });

  for (const player of rest) {
    assignToTeam(player);
  }

  return teams.map(({ key, players: teamPlayers, total }) => ({ key, players: teamPlayers, total }));
}
