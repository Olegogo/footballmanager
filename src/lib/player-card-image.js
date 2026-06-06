import { Buffer } from 'node:buffer';

import { Resvg } from '@resvg/resvg-js';

import { getInitials, getPositionMeta } from './lineup.js';

const WIDTH = 680;
const HEIGHT = 1060;
const HERO_HEIGHT = 360;
const PHOTO_FETCH_TIMEOUT_MS = 1200;

const STAT_META = [
  ['pace', 'скорость'],
  ['dribbling', 'дриблинг'],
  ['shooting', 'удар'],
  ['defense', 'защита'],
  ['passing', 'передачи'],
  ['physical', 'физика']
];

const GOALKEEPER_STAT_META = [
  ['pace', 'игра на линии'],
  ['dribbling', 'фиксация мяча'],
  ['shooting', 'выносы'],
  ['defense', 'рефлексы'],
  ['passing', 'скорость'],
  ['physical', 'выбор позиции']
];

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function truncate(value, maxLength) {
  const normalized = String(value ?? '').trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function hasRating(player) {
  return player?.ratedGames > 0 && Number(player.overall) > 0;
}

function hasVisibleStats(player) {
  return hasRating(player) || Boolean(player?.hasSelfProfile);
}

async function fetchPhotoDataUrl(photoUrl) {
  if (!photoUrl) {
    return '';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PHOTO_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(photoUrl, {
      signal: controller.signal
    });

    if (!response.ok) {
      return '';
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';

    if (!contentType.startsWith('image/')) {
      return '';
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${bytes.toString('base64')}`;
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

function renderHero(player, photoDataUrl) {
  if (photoDataUrl) {
    return `
      <image href="${escapeXml(photoDataUrl)}" x="0" y="0" width="${WIDTH}" height="${HERO_HEIGHT}" preserveAspectRatio="xMidYMid slice"></image>
      <rect x="0" y="0" width="${WIDTH}" height="${HERO_HEIGHT}" fill="#000000" opacity="0.2"></rect>
    `;
  }

  return `
    <rect x="0" y="0" width="${WIDTH}" height="${HERO_HEIGHT}" fill="url(#heroFallback)"></rect>
    <circle cx="${WIDTH / 2}" cy="${HERO_HEIGHT / 2}" r="104" fill="#fff5d6" fill-opacity="0.1" stroke="#fff2c7" stroke-opacity="0.35" stroke-width="4"></circle>
    <text x="${WIDTH / 2}" y="${HERO_HEIGHT / 2 + 24}" text-anchor="middle" font-size="88" font-weight="900" fill="#fffaf0">${escapeXml(getInitials(player))}</text>
  `;
}

function renderHeroBadge(player) {
  if (!hasRating(player)) {
    return `
      <rect x="24" y="24" width="154" height="50" rx="14" fill="#fffaf0"></rect>
      <text x="101" y="57" text-anchor="middle" font-size="24" font-weight="900" fill="#1d160a">Не оценён</text>
    `;
  }

  const position = getPositionMeta(player.position || 'N/A').card;
  return `
    <text x="32" y="82" font-size="72" font-weight="900" fill="#fffaf0">${escapeXml(Math.round(Number(player.overall)))}</text>
    <text x="36" y="124" font-size="34" font-weight="900" fill="#fffaf0">${escapeXml(position)}</text>
  `;
}

function renderMetricCell({ x, y, width, label, value, emphasis = false }) {
  return `
    <g transform="translate(${x} ${y})">
      <rect width="${width}" height="78" rx="18" fill="${emphasis ? '#fff2c7' : '#fffaf0'}" fill-opacity="${emphasis ? '0.18' : '0.08'}" stroke="#fff2c7" stroke-opacity="${emphasis ? '0' : '0.2'}"></rect>
      <text x="18" y="30" fill="#d8c394" font-size="19" font-weight="900">${escapeXml(label)}</text>
      <text x="18" y="62" fill="#fffaf0" font-size="28" font-weight="900">${escapeXml(value)}</text>
    </g>
  `;
}

function renderMetrics(player) {
  const rated = hasRating(player);
  const showStats = hasVisibleStats(player);
  const isGoalkeeper = player?.position === 'GK';
  const stats = player?.stats ?? {};
  const summary = [
    { label: 'игр', value: player?.games ?? 0, emphasis: true },
    ...(
      isGoalkeeper
        ? []
        : [
            { label: 'голов', value: rated ? player?.goals ?? 0 : '-' },
            { label: 'голевых', value: rated ? player?.assists ?? 0 : '-' }
          ]
    )
  ];
  const statRows = (isGoalkeeper ? GOALKEEPER_STAT_META : STAT_META)
    .map(([key, label]) => ({
      label,
      value: showStats ? stats[key] ?? '-' : '-'
    }));
  const cells = [...summary, ...statRows];
  const gap = 14;
  const cellWidth = Math.floor((WIDTH - 48 * 2 - gap * 2) / 3);
  const startX = 48;
  const startY = 578;

  return cells
    .map((cell, index) => {
      const row = Math.floor(index / 3);
      const col = index % 3;
      return renderMetricCell({
        ...cell,
        x: startX + col * (cellWidth + gap),
        y: startY + row * 92,
        width: cellWidth
      });
    })
    .join('');
}

export async function renderPlayerShareCardPng(player) {
  const photoDataUrl = await fetchPhotoDataUrl(player?.photoUrl);
  const displayName = truncate(player?.displayName || (player?.username ? `@${player.username}` : 'Игрок'), 22);
  const username = player?.username ? `@${truncate(player.username, 24)}` : '@unknown';

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
      <defs>
        <linearGradient id="panelGradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#9a762c" stop-opacity="0.92"></stop>
          <stop offset="0.74" stop-color="#291e0b" stop-opacity="0.98"></stop>
        </linearGradient>
        <radialGradient id="heroFallback" cx="35%" cy="22%" r="82%">
          <stop offset="0" stop-color="#314a38"></stop>
          <stop offset="1" stop-color="#07100b"></stop>
        </radialGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" rx="42" fill="#06120c"></rect>
      <clipPath id="cardClip">
        <rect x="18" y="18" width="${WIDTH - 36}" height="${HEIGHT - 36}" rx="36"></rect>
      </clipPath>
      <g clip-path="url(#cardClip)">
        <rect x="18" y="18" width="${WIDTH - 36}" height="${HEIGHT - 36}" fill="#06120c"></rect>
        <g transform="translate(18 18)">
          ${renderHero(player, photoDataUrl)}
          ${renderHeroBadge(player)}
        </g>
        <rect x="18" y="${HERO_HEIGHT + 18}" width="${WIDTH - 36}" height="${HEIGHT - HERO_HEIGHT - 36}" fill="url(#panelGradient)"></rect>
        <text x="${WIDTH / 2}" y="438" text-anchor="middle" fill="#fffaf0" font-size="40" font-weight="900">${escapeXml(displayName)}</text>
        <text x="${WIDTH / 2}" y="482" text-anchor="middle" fill="#d8c394" font-size="24" font-weight="800">${escapeXml(username)}</text>
        ${renderMetrics(player)}
      </g>
      <rect x="18" y="18" width="${WIDTH - 36}" height="${HEIGHT - 36}" rx="36" fill="none" stroke="#e3c274" stroke-opacity="0.36" stroke-width="2"></rect>
    </svg>
  `;
  const renderer = new Resvg(svg, {
    fitTo: {
      mode: 'width',
      value: WIDTH
    },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'DejaVu Sans'
    }
  });

  return Buffer.from(renderer.render().asPng());
}
