import { Buffer } from 'node:buffer';

import { Resvg } from '@resvg/resvg-js';

import {
  buildTeamFieldAssignments,
  getEffectiveOverall,
  getEffectivePosition,
  getInitials,
  getPositionMeta,
  splitBalancedTeams
} from './lineup.js';

const WIDTH = 1200;
const HEIGHT = 1600;
const FIELD = {
  x: 70,
  y: 130,
  width: 1060,
  height: 1380
};
const PLAYER_CARD = {
  width: 210,
  height: 82
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
  return truncate(name.replace(/^@/, '').split(/\s+/).filter(Boolean)[0] || name, 12);
}

function toFieldX(percent) {
  return FIELD.x + (FIELD.width * percent) / 100;
}

function toFieldY(percent) {
  return FIELD.y + (FIELD.height * percent) / 100;
}

function getPlayerRatingLabel(player) {
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
        <circle cx="42" cy="41" r="28"></circle>
      </clipPath>
      <image href="${escapeXml(photoDataUrl)}" x="14" y="13" width="56" height="56" preserveAspectRatio="xMidYMid slice" clip-path="url(#${avatarId})"></image>
      <circle cx="42" cy="41" r="28" fill="none" stroke="#f1cf72" stroke-width="3"></circle>
    `;
  }

  return `
    <circle cx="42" cy="41" r="28" fill="#f1cf72"></circle>
    <text x="42" y="51" text-anchor="middle" font-size="24" font-weight="900" fill="#211706">${initials}</text>
  `;
}

function renderPlayerCard({ player, slot, teamKey, index, photoDataUrl }) {
  const x = Math.round(toFieldX(slot.x) - PLAYER_CARD.width / 2);
  const y = Math.round(toFieldY(slot.y) - PLAYER_CARD.height / 2);
  const avatarId = `avatar-${teamKey}-${index}`;
  const positionLabel = getPositionMeta(getEffectivePosition(player)).short;

  return `
    <g transform="translate(${x} ${y})">
      <rect x="0" y="0" width="${PLAYER_CARD.width}" height="${PLAYER_CARD.height}" rx="18" fill="#15120a" fill-opacity="0.88" stroke="#f1cf72" stroke-width="2"></rect>
      ${renderPlayerAvatar(player, photoDataUrl, avatarId)}
      <text x="86" y="34" font-size="30" font-weight="900" fill="#fffaf0">${escapeXml(getPlayerRatingLabel(player))}</text>
      <text x="140" y="33" font-size="17" font-weight="800" fill="#d7c28c">${escapeXml(positionLabel)}</text>
      <text x="86" y="62" font-size="23" font-weight="800" fill="#fffaf0">${escapeXml(getShortPlayerName(player))}</text>
    </g>
  `;
}

function renderTeamBadge(team, y, anchor) {
  const x = anchor === 'top' ? FIELD.x + 24 : FIELD.x + FIELD.width - 24;
  const textAnchor = anchor === 'top' ? 'start' : 'end';
  const label = anchor === 'top' ? 'Команда A' : 'Команда B';

  return `
    <text x="${x}" y="${y}" text-anchor="${textAnchor}" font-size="28" font-weight="900" fill="#f1cf72">${label}</text>
    <text x="${x}" y="${y + 34}" text-anchor="${textAnchor}" font-size="20" font-weight="700" fill="#fffaf0" opacity="0.76">рейтинг ${Math.round(team.total)}</text>
  `;
}

function renderFieldLines() {
  const centerY = FIELD.y + FIELD.height / 2;
  const centerX = FIELD.x + FIELD.width / 2;

  return `
    <clipPath id="pitchClip">
      <rect x="${FIELD.x}" y="${FIELD.y}" width="${FIELD.width}" height="${FIELD.height}"></rect>
    </clipPath>
    <rect x="${FIELD.x}" y="${FIELD.y}" width="${FIELD.width}" height="${FIELD.height}" fill="url(#pitchGradient)" stroke="#f1cf72" stroke-width="5"></rect>
    <g clip-path="url(#pitchClip)" opacity="0.17">
      ${Array.from({ length: 8 }, (_, index) => {
        const stripeX = FIELD.x + index * 170 - 120;
        return `<path d="M${stripeX} ${FIELD.y} L${stripeX + 430} ${FIELD.y} L${stripeX + 150} ${FIELD.y + FIELD.height} L${stripeX - 280} ${FIELD.y + FIELD.height} Z" fill="#ffffff"></path>`;
      }).join('')}
    </g>
    <line x1="${FIELD.x}" y1="${centerY}" x2="${FIELD.x + FIELD.width}" y2="${centerY}" stroke="#fff7d7" stroke-width="4" opacity="0.9"></line>
    <circle cx="${centerX}" cy="${centerY}" r="130" fill="none" stroke="#fff7d7" stroke-width="4" opacity="0.9"></circle>
    <circle cx="${centerX}" cy="${centerY}" r="8" fill="#fff7d7" opacity="0.9"></circle>
    <rect x="${FIELD.x + 315}" y="${FIELD.y}" width="430" height="150" fill="none" stroke="#fff7d7" stroke-width="4" opacity="0.9"></rect>
    <rect x="${FIELD.x + 420}" y="${FIELD.y}" width="220" height="66" fill="none" stroke="#fff7d7" stroke-width="4" opacity="0.9"></rect>
    <rect x="${FIELD.x + 315}" y="${FIELD.y + FIELD.height - 150}" width="430" height="150" fill="none" stroke="#fff7d7" stroke-width="4" opacity="0.9"></rect>
    <rect x="${FIELD.x + 420}" y="${FIELD.y + FIELD.height - 66}" width="220" height="66" fill="none" stroke="#fff7d7" stroke-width="4" opacity="0.9"></rect>
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

  const details = [game?.dateLabel, game?.location, game?.time].filter(Boolean).join(' · ');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
      <defs>
        <linearGradient id="bgGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#06110c"></stop>
          <stop offset="1" stop-color="#102319"></stop>
        </linearGradient>
        <linearGradient id="pitchGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#174b29"></stop>
          <stop offset="0.52" stop-color="#0f3f24"></stop>
          <stop offset="1" stop-color="#12351f"></stop>
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bgGradient)"></rect>
      <text x="70" y="70" font-size="42" font-weight="900" fill="#fffaf0">Игровой день</text>
      <text x="70" y="108" font-size="24" font-weight="700" fill="#fffaf0" opacity="0.72">${escapeXml(details)}</text>
      ${renderFieldLines()}
      ${renderTeamBadge(teams[0], FIELD.y + 50, 'top')}
      ${renderTeamBadge(teams[1], FIELD.y + FIELD.height - 82, 'bottom')}
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
