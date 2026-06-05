import { Buffer } from 'node:buffer';

import { Resvg } from '@resvg/resvg-js';

import { getInitials, getPositionMeta } from './lineup.js';

const WIDTH = 900;
const HEIGHT = 520;
const PHOTO_FETCH_TIMEOUT_MS = 1200;

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function getRatingLabel(player) {
  if (!(player?.ratedGames > 0)) {
    return '';
  }

  return String(Math.round(Number(player.overall || 0)));
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

function renderAvatar(player, photoDataUrl) {
  if (photoDataUrl) {
    return `
      <clipPath id="avatarClip">
        <circle cx="155" cy="166" r="104"></circle>
      </clipPath>
      <image href="${escapeXml(photoDataUrl)}" x="51" y="62" width="208" height="208" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"></image>
      <circle cx="155" cy="166" r="104" fill="none" stroke="#fff2c7" stroke-opacity="0.72" stroke-width="6"></circle>
    `;
  }

  return `
    <circle cx="155" cy="166" r="104" fill="url(#avatarGradient)" stroke="#fff2c7" stroke-opacity="0.72" stroke-width="6"></circle>
    <text x="155" y="184" text-anchor="middle" font-size="68" font-weight="900" fill="#fffaf0">${escapeXml(getInitials(player))}</text>
  `;
}

function renderStats(player) {
  const stats = player?.stats ?? {};
  const cells = [
    ['Скорость', stats.pace],
    ['Дриблинг', stats.dribbling],
    ['Удар', stats.shooting],
    ['Защита', stats.defense],
    ['Передачи', stats.passing],
    ['Физика', stats.physical]
  ];

  return cells
    .map(([label, value], index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = 372 + col * 150;
      const y = 284 + row * 90;
      return `
        <g transform="translate(${x} ${y})">
          <rect width="126" height="68" rx="20" fill="#fff6d8" fill-opacity="0.08" stroke="#fff2c7" stroke-opacity="0.14"></rect>
          <text x="18" y="26" fill="#d8c394" font-size="18" font-weight="800">${escapeXml(label)}</text>
          <text x="18" y="55" fill="#fffaf0" font-size="28" font-weight="900">${escapeXml(player?.ratedGames > 0 ? value ?? '-' : '-')}</text>
        </g>
      `;
    })
    .join('');
}

export async function renderPlayerShareCardPng(player) {
  const photoDataUrl = await fetchPhotoDataUrl(player?.photoUrl);
  const ratingLabel = getRatingLabel(player);
  const positionLabel = ratingLabel ? getPositionMeta(player?.position || 'N/A').short : 'Не оценён';
  const displayName = player?.displayName || (player?.username ? `@${player.username}` : 'Игрок');
  const username = player?.username ? `@${player.username}` : '@unknown';

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
      <defs>
        <linearGradient id="cardGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#123f28"></stop>
          <stop offset="0.46" stop-color="#78581f"></stop>
          <stop offset="1" stop-color="#120d05"></stop>
        </linearGradient>
        <radialGradient id="avatarGradient" cx="35%" cy="25%" r="75%">
          <stop offset="0" stop-color="#ffcc70"></stop>
          <stop offset="1" stop-color="#d88db7"></stop>
        </radialGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" rx="42" fill="#06120c"></rect>
      <rect x="18" y="18" width="${WIDTH - 36}" height="${HEIGHT - 36}" rx="36" fill="url(#cardGradient)" opacity="0.96"></rect>
      <circle cx="742" cy="94" r="180" fill="#f1cf72" opacity="0.11"></circle>
      ${renderAvatar(player, photoDataUrl)}
      <text x="320" y="138" fill="#fffaf0" font-size="54" font-weight="900">${escapeXml(displayName)}</text>
      <text x="322" y="184" fill="#d8c394" font-size="28" font-weight="800">${escapeXml(username)}</text>
      ${
        ratingLabel
          ? `<text x="320" y="252" fill="#ffe28b" font-size="74" font-weight="900">${escapeXml(ratingLabel)}</text>`
          : `<rect x="318" y="214" width="188" height="54" rx="18" fill="#fffaf0"></rect><text x="342" y="250" fill="#1d160a" font-size="28" font-weight="900">Не оценён</text>`
      }
      <text x="${ratingLabel ? 426 : 536}" y="250" fill="#fffaf0" font-size="36" font-weight="900">${escapeXml(positionLabel)}</text>
      ${renderStats(player)}
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
