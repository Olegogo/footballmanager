import { readFileSync } from 'node:fs';
import copy from '../../packages/i18n/landing.json' with { type: 'json' };
import { normalizeLocale } from '../../packages/i18n/index.js';

const template = readFileSync(new URL('../../web/landing.html', import.meta.url), 'utf8');
const assets = [["hero-game.png", "en-hero-game.png"], ["player-card-figma.png", "en-player-card.png"], ["find-game-figma.png", "en-find-game.png"], ["build-lineup-figma.png", "en-build-lineup.png"], ["achievement-clean.png", "en-achievement.png"], ["parsing-figma.png", "en-parsing.png"], ["team-main-figma.png", "en-team-main.png"], ["team-side-figma.png", "en-team-side.png"], ["organizer-figma.png", "en-organizer.png"], ["field-figma.png", "en-field.png"]];
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function renderLanding(locale, baseUrl = '') {
  locale = normalizeLocale(locale);
  const values = {
    locale, localeUpper: locale.toUpperCase(), baseUrl: escape(baseUrl),
    canonical: escape(`${baseUrl}/${locale}`),
    languageLabel: locale === 'ru' ? 'Выбрать язык' : 'Choose language',
    ruCurrent: locale === 'ru' ? 'aria-current="true"' : '',
    enCurrent: locale === 'en' ? 'aria-current="true"' : ''
  };
  for (const [key, value] of Object.entries(copy[locale])) {
    // Only these authored formatting tags are allowed; no user content enters the template.
    values[`landing.${key}`] = escape(value).replaceAll('&lt;br&gt;', '<br>').replaceAll('&lt;strong&gt;', '<strong>').replaceAll('&lt;/strong&gt;', '</strong>');
  }
  assets.forEach((pair, index) => { values[`asset.${index}`] = `/assets/landing/${pair[locale === 'en' ? 1 : 0]}`; });
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, key) => values[key] ?? '');
}
