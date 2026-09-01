const POSITION_GROUPS = {
  GK: 'goalkeeper',
  CB: 'defense',
  LB: 'defense',
  RB: 'defense',
  CDM: 'midfield',
  CM: 'midfield',
  CAM: 'midfield',
  LM: 'midfield',
  RM: 'midfield',
  LW: 'attack',
  RW: 'attack',
  ST: 'attack'
};

const MINIMUM_PEER_COUNT = 3;

export function getPositionBenchmarkGroup(position) {
  return POSITION_GROUPS[position] || '';
}

function hasMeaningfulStats(player) {
  return Boolean(player?.hasSelfProfile || Number(player?.ratedGames) > 0);
}

export function getComparableStatValues(players, options = {}) {
  const group = getPositionBenchmarkGroup(options.position);

  if (!group || !options.statKey) {
    return [];
  }

  return (players || [])
    .filter((player) =>
      player?.id !== options.viewerPlayerId &&
      getPositionBenchmarkGroup(player?.position) === group &&
      hasMeaningfulStats(player)
    )
    .map((player) => Number(player?.stats?.[options.statKey]))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= 99);
}

export function getProfileStatBenchmark(players, options = {}) {
  const value = Number(options.value);
  const peerValues = getComparableStatValues(players, options);

  if (!Number.isFinite(value) || peerValues.length < MINIMUM_PEER_COUNT) {
    return { kind: 'insufficient_data', peerCount: peerValues.length };
  }

  const average = peerValues.reduce((sum, peerValue) => sum + peerValue, 0) / peerValues.length;
  const rank = peerValues.filter((peerValue) => peerValue > value).length + 1;
  const topPercent = Math.min(100, Math.max(5, Math.ceil((rank / (peerValues.length + 1)) * 20) * 5));

  if (value < average) {
    return { kind: 'below_average', peerCount: peerValues.length, topPercent };
  }

  if (value === average) {
    return { kind: 'average', peerCount: peerValues.length, topPercent };
  }

  if (topPercent <= 50) {
    return { kind: 'top', peerCount: peerValues.length, topPercent };
  }

  return { kind: 'above_average', peerCount: peerValues.length, topPercent };
}
