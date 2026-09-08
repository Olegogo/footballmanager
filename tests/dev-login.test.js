import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDevLoginEnabled, canUseDevLogin } from '../src/lib/dev-login.js';
import { AppStore } from '../src/lib/store.js';

test('dev login requires explicit opt-in and a local non-production listener', () => {
  const local = { ALLOW_DEV_LOGIN: 'true', HOST: '127.0.0.1' };
  assert.equal(isDevLoginEnabled(local), true);
  for (const env of [{}, { ...local, HOST: '0.0.0.0' }, { ...local, HOST: '::' },
    { ...local, NODE_ENV: 'production' }, { ...local, PUBLIC_BASE_URL: 'https://example.com' },
    { ...local, CANONICAL_BASE_URL: 'https://example.com' }, { ...local, ALLOW_DEV_LOGIN: 'false' }]) {
    assert.equal(isDevLoginEnabled(env), false, JSON.stringify(env));
  }
});

test('dev login rejects proxies, remote peers, public hosts and origins', () => {
  const req = { headers: { host: 'localhost:3099' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(canUseDevLogin(req, true), true);
  assert.equal(canUseDevLogin(req, false), false);
  for (const headers of [
    { host: 'example.com' }, { ...req.headers, 'x-forwarded-for': '127.0.0.1' },
    { ...req.headers, forwarded: 'for=127.0.0.1' }, { ...req.headers, origin: 'https://evil.example' },
    { host: 'bad host' }
  ]) assert.equal(canUseDevLogin({ ...req, headers }, true), false);
  assert.equal(canUseDevLogin({ ...req, socket: { remoteAddress: '10.0.0.1' } }, true), false);
});

test('restart revokes legacy and dev sessions, while verified Telegram sessions survive', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fifa-session-migration-'));
  try {
    const file = path.join(directory, 'db.json');
    const dev = new AppStore(file, { allowDevSessions: true });
    await dev.init();
    const { player, token: devToken } = await dev.loginDevUser('-1001', 'tester');
    const telegramToken = await dev.createSession(player.id, '-1001');
    assert.equal(dev.getSession(devToken).authMethod, 'dev');
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    raw.sessions.legacy = { ...raw.sessions[telegramToken], token: 'legacy' };
    delete raw.sessions.legacy.authMethod;
    await fs.writeFile(file, JSON.stringify(raw));
    const production = new AppStore(file);
    await production.init();
    assert.equal(production.getSession(devToken), null);
    assert.equal(production.getSession('legacy'), null);
    assert.equal(production.getSession(telegramToken).authMethod, 'telegram');
    assert.throws(() => production.loginDevUser('-1001', 'tester'), /disabled/);
    assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(file, 'utf8')).sessions), [telegramToken]);
    assert.equal(production.getSnapshot('-1001').viewerAnalyticsId, '');
    assert.equal(production.getSnapshot('-1001', player.id).viewerAnalyticsId, player.analyticsId);
    assert.equal(production.getSnapshot('-1001').players.some((p) => 'analyticsId' in p), false);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
