import { Buffer } from 'node:buffer';

import { Resvg } from '@resvg/resvg-js';

import {
  buildTeamFieldAssignments,
  getEffectiveOverall,
  getInitials,
  splitBalancedTeams
} from './lineup.js';

const WIDTH = 1200;
const HEIGHT = 1240;
const LINE_INSET = 48;
const SNAPSHOT_X_SOURCE_MIN = 5;
const SNAPSHOT_X_SOURCE_MAX = 95;
const SNAPSHOT_X_TARGET_MIN = 10;
const SNAPSHOT_X_TARGET_MAX = 90;
const PLAYER_CARD = {
  width: 150,
  height: 132
};
const PHOTO_FETCH_TIMEOUT_MS = 1200;

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

function getShortPlayerName(player) {
  const name = player.displayName || player.username || 'Игрок';
  return truncate(name.replace(/^@/, '').split(/\s+/).filter(Boolean)[0] || name, 10);
}

function toFieldX(percent) {
  const normalized = Math.max(
    0,
    Math.min(1, (percent - SNAPSHOT_X_SOURCE_MIN) / (SNAPSHOT_X_SOURCE_MAX - SNAPSHOT_X_SOURCE_MIN))
  );
  const insetPercent =
    SNAPSHOT_X_TARGET_MIN + normalized * (SNAPSHOT_X_TARGET_MAX - SNAPSHOT_X_TARGET_MIN);

  return (WIDTH * insetPercent) / 100;
}

function toFieldY(percent) {
  return (HEIGHT * percent) / 100;
}

function getPlayerRatingLabel(player) {
  if (!player.currentGameStats?.hasRatings && !(player.ratedGames > 0)) {
    return '';
  }

  return String(Math.round(Number(getEffectiveOverall(player) || 50)));
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

async function buildPhotoIndex(players) {
  const entries = await Promise.all(
    players.map(async (player) => [player.id, await fetchPhotoDataUrl(player.photoUrl)])
  );

  return new Map(entries);
}

function renderPlayerAvatar(player, photoDataUrl, avatarId) {
  const initials = escapeXml(getInitials(player));

  if (photoDataUrl) {
    return `
      <clipPath id="${avatarId}">
        <circle cx="75" cy="38" r="36"></circle>
      </clipPath>
      <image href="${escapeXml(photoDataUrl)}" x="39" y="2" width="72" height="72" preserveAspectRatio="xMidYMid slice" clip-path="url(#${avatarId})"></image>
      <circle cx="75" cy="38" r="36" fill="none" stroke="#fff2c7" stroke-opacity="0.78" stroke-width="4"></circle>
    `;
  }

  return `
    <circle cx="75" cy="38" r="36" fill="#07130d" fill-opacity="0.9" stroke="#fff2c7" stroke-opacity="0.78" stroke-width="4"></circle>
    <text x="75" y="48" text-anchor="middle" font-size="26" font-weight="900" fill="#ffe28b">${initials}</text>
  `;
}

function renderPlayerCard({ player, slot, teamKey, index, photoDataUrl }) {
  const x = Math.round(toFieldX(slot.x) - PLAYER_CARD.width / 2);
  const y = Math.round(toFieldY(slot.y) - PLAYER_CARD.height / 2);
  const avatarId = `avatar-${teamKey}-${index}`;
  const ratingLabel = getPlayerRatingLabel(player);
  const nameLabel = ratingLabel
    ? `${ratingLabel}. ${getShortPlayerName(player)}`
    : getShortPlayerName(player);

  return `
    <g transform="translate(${x} ${y})">
      ${renderPlayerAvatar(player, photoDataUrl, avatarId)}
      <text x="75" y="104" text-anchor="middle" font-size="24" font-weight="900" fill="#fffaf0" paint-order="stroke" stroke="#07130d" stroke-width="8" stroke-linejoin="round">${escapeXml(nameLabel)}</text>
    </g>
  `;
}

function renderFieldLines() {
  const centerY = HEIGHT / 2;
  const centerX = WIDTH / 2;
  const boxWidth = 552;
  const boxHeight = 252;

  return `
    <rect x="${LINE_INSET}" y="${LINE_INSET}" width="${WIDTH - LINE_INSET * 2}" height="${HEIGHT - LINE_INSET * 2}" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="4"></rect>
    <line x1="${LINE_INSET}" y1="${centerY}" x2="${WIDTH - LINE_INSET}" y2="${centerY}" stroke="#ffffff" stroke-opacity="0.55" stroke-width="4"></line>
    <circle cx="${centerX}" cy="${centerY}" r="174" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="4"></circle>
    <rect x="${centerX - boxWidth / 2}" y="${LINE_INSET}" width="${boxWidth}" height="${boxHeight}" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="4"></rect>
    <line x1="${centerX - boxWidth / 2}" y1="${LINE_INSET}" x2="${centerX + boxWidth / 2}" y2="${LINE_INSET}" stroke="#1f6d39" stroke-width="7"></line>
    <rect x="${centerX - boxWidth / 2}" y="${HEIGHT - LINE_INSET - boxHeight}" width="${boxWidth}" height="${boxHeight}" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="4"></rect>
    <line x1="${centerX - boxWidth / 2}" y1="${HEIGHT - LINE_INSET}" x2="${centerX + boxWidth / 2}" y2="${HEIGHT - LINE_INSET}" stroke="#0d3b21" stroke-width="7"></line>
  `;
}

export async function renderLineupSvg(game) {
  const participants = game?.participants ?? [];
  const photoIndex = await buildPhotoIndex(participants);
  const teams = splitBalancedTeams(participants);
  const teamCards = teams
    .map((team) => {
      const assignments = buildTeamFieldAssignments(team.players, team.key);

      return assignments
        .map((assignment, index) =>
          renderPlayerCard({
            ...assignment,
            teamKey: team.key,
            index,
            photoDataUrl: photoIndex.get(assignment.player.id)
          })
        )
        .join('');
    })
    .join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
      <defs>
        <pattern id="fieldDots" width="52" height="52" patternUnits="userSpaceOnUse">
          <circle cx="28" cy="28" r="2.4" fill="#ffffff" opacity="0.12"></circle>
        </pattern>
        <linearGradient id="fieldGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#28743f" stop-opacity="0.95"></stop>
          <stop offset="1" stop-color="#0c361c" stop-opacity="0.98"></stop>
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#fieldGradient)"></rect>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#fieldDots)"></rect>
      ${renderFieldLines()}
      ${teamCards}
    </svg>
  `;
}

export async function renderLineupPng(game) {
  const svg = await renderLineupSvg(game);
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
