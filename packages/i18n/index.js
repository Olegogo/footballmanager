import ru from './locales/ru.json' with { type: 'json' };
import en from './locales/en.json' with { type: 'json' };

export const DEFAULT_LOCALE = 'ru';
export const SUPPORTED_LOCALES = ['ru', 'en'];
export const LOCALE_LABELS = {
  ru: 'Русский',
  en: 'English'
};

export const dictionaries = {
  ru,
  en
};

export function normalizeLocale(input = '') {
  const value = String(input || '').trim().toLowerCase();

  if (value.startsWith('ru')) {
    return 'ru';
  }

  if (value.startsWith('en')) {
    return 'en';
  }

  return DEFAULT_LOCALE;
}

function getValue(dictionary, key) {
  return String(key || '')
    .split('.')
    .reduce((value, part) => (value && typeof value === 'object' ? value[part] : undefined), dictionary);
}

export function interpolate(template, params = {}) {
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
    const value = params[name];
    return value === undefined || value === null ? '' : String(value);
  });
}

export function getDictionary(locale = DEFAULT_LOCALE) {
  return dictionaries[normalizeLocale(locale)] ?? dictionaries[DEFAULT_LOCALE];
}

export function translate(locale, key, params = {}) {
  const normalizedLocale = normalizeLocale(locale);
  const value = getValue(getDictionary(normalizedLocale), key) ?? getValue(getDictionary(DEFAULT_LOCALE), key);

  if (typeof value === 'string') {
    return interpolate(value, params);
  }

  return key;
}

export function createTranslator(locale = DEFAULT_LOCALE) {
  const normalizedLocale = normalizeLocale(locale);
  return (key, params = {}) => translate(normalizedLocale, key, params);
}

export function resolveLocale({ manualLocale, telegramLocale, chatLocale, fallback = DEFAULT_LOCALE } = {}) {
  if (manualLocale) {
    return {
      locale: normalizeLocale(manualLocale),
      localeSource: 'manual'
    };
  }

  if (telegramLocale) {
    return {
      locale: normalizeLocale(telegramLocale),
      localeSource: 'telegram'
    };
  }

  if (chatLocale) {
    return {
      locale: normalizeLocale(chatLocale),
      localeSource: 'chat'
    };
  }

  return {
    locale: normalizeLocale(fallback),
    localeSource: 'fallback'
  };
}

export function getPluralCategory(locale, count) {
  const normalizedLocale = normalizeLocale(locale);
  const value = Math.abs(Number(count));

  if (normalizedLocale === 'en') {
    return value === 1 ? 'one' : 'other';
  }

  const integer = Math.trunc(value);
  const mod10 = integer % 10;
  const mod100 = integer % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return 'one';
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'few';
  }

  return 'many';
}

export function pluralize(locale, count, forms) {
  const category = getPluralCategory(locale, count);
  return forms?.[category] ?? forms?.other ?? forms?.many ?? '';
}
