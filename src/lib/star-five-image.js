import fs from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import { getInitials } from './lineup.js';

const escape = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const positions = [[68, 27], [68, 69], [35, 27], [35, 69], [15, 48]];
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
  const players = (five.players ?? []).slice(0, 5);
  const photos = await Promise.all(players.map((player) => photoData(player.photoUrl)));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="699" viewBox="0 0 1200 699">
    <rect width="1200" height="699" fill="#192e21"/>
    <image href="data:image/png;base64,${field}" x="-30" y="-60" width="1260" height="800" preserveAspectRatio="none"/>
    ${players.map((player, index) => {
      const [px, py] = positions[index];
      const x = px * 12, y = py * 6.99;
      const name = String(player.firstName || player.displayName || player.username || '').split(/\s+/)[0].slice(0, 16);
      return `<defs><clipPath id="p${index}"><circle cx="${x}" cy="${y}" r="45"/></clipPath></defs>
        <circle cx="${x}" cy="${y}" r="45" fill="#374a39"/>
        <text x="${x}" y="${y + 12}" text-anchor="middle" fill="#f6f1d5" font-size="32" font-family="Arial">${escape(getInitials(player))}</text>
        ${photos[index] ? `<image href="${photos[index]}" x="${x - 45}" y="${y - 45}" width="90" height="90" preserveAspectRatio="xMidYMid slice" clip-path="url(#p${index})"/>` : ''}
        ${player.ratedGames > 0 ? `<circle cx="${x + 48}" cy="${y - 36}" r="19" fill="#fff"/><text x="${x + 48}" y="${y - 29}" text-anchor="middle" font-size="21" font-weight="700" font-family="Arial" fill="#172018">${Math.round(player.overall)}</text>` : ''}
        <text x="${x}" y="${y + 79}" text-anchor="middle" fill="#fff" font-size="29" font-family="Arial">${escape(name)}</text>`;
    }).join('')}
  </svg>`;
  return new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Arial' } }).render().asPng();
}
