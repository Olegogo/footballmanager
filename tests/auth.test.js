import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';

import { verifyTelegramLoginData } from '../src/lib/auth.js';

function signTelegramLoginData(params, botToken) {
  const searchParams = new URLSearchParams(params);
  const dataCheckString = [...searchParams.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHash('sha256').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  searchParams.set('hash', hash);
  return searchParams;
}

test('verifyTelegramLoginData accepts Telegram login_url payloads', () => {
  const botToken = '123456:test-token';
  const params = signTelegramLoginData({
    id: '42',
    first_name: 'Oleg',
    username: 'O_legacy',
    auth_date: String(Math.floor(Date.now() / 1000))
  }, botToken);

  params.set('chatId', '-1001');
  params.set('view', 'game');

  const result = verifyTelegramLoginData(params, botToken);

  assert.equal(result.ok, true);
  assert.equal(result.user.id, 42);
  assert.equal(result.user.username, 'O_legacy');
});
