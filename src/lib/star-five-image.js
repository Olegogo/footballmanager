import fs from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import { buildStarFiveFieldAssignments, getInitials } from './lineup.js';

const escape = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
let fieldPromise;

async function photoData(photoUrl) {
  if (!photoUrl) return '';
  try {
    const response = await fetch(photoUrl, { signal: AbortSignal.timeout(1200) });
    const mime = response.headers.get('content-type')?.split(';')[0];
    if (!response.ok || !['image/png', 'image/jpeg', 'image/webp'].includes(mime)) return '';
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch { return ''; }
}

export async function renderStarFivePng(five) {
  fieldPromise ??= fs.readFile(new URL('../../web/assets/field/star-five-field.png', import.meta.url));
  const field = (await fieldPromise).toString('base64');
  const assignments = buildStarFiveFieldAssignments((five.players ?? []).slice(0, 5));
  const players = assignments.map(({ player }) => player);
  const photos = await Promise.all(players.map((player) => photoData(player.photoUrl)));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="642" viewBox="0 0 1200 642">
    <rect width="1200" height="642" fill="#192e21"/>
    <image href="data:image/png;base64,${field}" x="0" y="0" width="1200" height="642" preserveAspectRatio="xMidYMid meet"/>
    ${players.map((player, index) => {
      const { x: px, y: py } = assignments[index].slot;
      const x = 72 + px * 10.56, y = 57.78 + py * 4.8792 - 18;
      const name = String(player.firstName || player.displayName || player.username || '').split(/\s+/)[0].slice(0, 16);
      return `<defs><clipPath id="p${index}"><circle cx="${x}" cy="${y}" r="51.5"/></clipPath></defs>
        <circle cx="${x}" cy="${y}" r="51.5" fill="#030a07"/>
        <text x="${x}" y="${y + 12}" text-anchor="middle" fill="#ffe7af" font-size="32" font-family="Trebuchet MS, Avenir Next, sans-serif" font-weight="900">${escape(getInitials(player))}</text>
        ${photos[index] ? `<image href="${photos[index]}" x="${x - 51.5}" y="${y - 51.5}" width="103" height="103" preserveAspectRatio="xMidYMid slice" clip-path="url(#p${index})"/>` : ''}
        ${player.ratedGames > 0 ? `<circle cx="${x + 49}" cy="${y - 48}" r="27.5" fill="#fff"/><text x="${x + 49}" y="${y - 37}" text-anchor="middle" font-size="30" font-family="Trebuchet MS, Avenir Next, sans-serif" font-weight="900" fill="#172018">${Math.round(player.overall)}</text>` : ''}
        <text x="${x}" y="${y + 84}" text-anchor="middle" fill="#fff" font-size="28" font-family="Trebuchet MS, Avenir Next, sans-serif" font-weight="900">${escape(name)}</text>`;
    }).join('')}
  </svg>`;
  return new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Trebuchet MS' } }).render().asPng();
}
