import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPluralCategory,
  normalizeLocale,
  resolveLocale,
  translate
} from '../packages/i18n/index.js';

test('normalizeLocale supports Telegram language codes and falls back to ru', () => {
  assert.equal(normalizeLocale('ru'), 'ru');
  assert.equal(normalizeLocale('ru-RU'), 'ru');
  assert.equal(normalizeLocale('en'), 'en');
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('en-GB'), 'en');
  assert.equal(normalizeLocale('de-DE'), 'ru');
  assert.equal(normalizeLocale(''), 'ru');
});

test('resolveLocale respects manual, Telegram, chat and fallback priority', () => {
  assert.deepEqual(
    resolveLocale({ manualLocale: 'en-US', telegramLocale: 'ru', chatLocale: 'ru' }),
    { locale: 'en', localeSource: 'manual' }
  );

  assert.deepEqual(
    resolveLocale({ telegramLocale: 'en-GB', chatLocale: 'ru' }),
    { locale: 'en', localeSource: 'telegram' }
  );

  assert.deepEqual(
    resolveLocale({ chatLocale: 'en' }),
    { locale: 'en', localeSource: 'chat' }
  );

  assert.deepEqual(
    resolveLocale({ fallback: 'en' }),
    { locale: 'en', localeSource: 'fallback' }
  );
});

test('getPluralCategory handles ru and en plural forms', () => {
  assert.equal(getPluralCategory('ru', 1), 'one');
  assert.equal(getPluralCategory('ru', 2), 'few');
  assert.equal(getPluralCategory('ru', 5), 'many');
  assert.equal(getPluralCategory('ru', 11), 'many');
  assert.equal(getPluralCategory('ru', 22), 'few');

  assert.equal(getPluralCategory('en', 1), 'one');
  assert.equal(getPluralCategory('en', 2), 'other');
});

test('translate interpolates values and falls back to ru for unknown locale', () => {
  assert.equal(translate('en-US', 'common.buttons.save'), 'Save');
  assert.equal(translate('ru', 'common.buttons.save'), 'Сохранить');
  assert.equal(translate('fr', 'common.buttons.save'), 'Сохранить');
  assert.equal(translate('en', 'rating.already_rated', { count: 3 }), '3 rated');
});
