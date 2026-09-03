import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const landingScript = await readFile(new URL('../web/landing.js', import.meta.url), 'utf8');

async function runLandingScript({ token = '', responseOk = false } = {}) {
  const links = [
    { href: '/telegram?mode=bot' },
    { href: '/telegram?mode=bot' },
    { href: '/telegram?mode=bot' }
  ];
  const requests = [];

  vm.runInNewContext(landingScript, {
    document: {
      querySelectorAll: () => links
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: responseOk };
    },
    localStorage: {
      getItem: () => token
    }
  });

  await new Promise((resolve) => setImmediate(resolve));
  return { links, requests };
}

test('landing keeps bot-first links for a new desktop visitor', async () => {
  const { links, requests } = await runLandingScript();

  assert.deepEqual(links.map((link) => link.href), [
    '/telegram?mode=bot',
    '/telegram?mode=bot',
    '/telegram?mode=bot'
  ]);
  assert.equal(requests.length, 0);
});

test('landing opens the mini app directly for a returning desktop visitor', async () => {
  const { links, requests } = await runLandingScript({
    token: 'valid-session-token',
    responseOk: true
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/bootstrap');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer valid-session-token');
  assert.deepEqual(links.map((link) => link.href), [
    '/telegram',
    '/telegram',
    '/telegram'
  ]);
});

test('landing falls back to the bot when the saved session is expired', async () => {
  const { links } = await runLandingScript({
    token: 'expired-session-token',
    responseOk: false
  });

  assert.deepEqual(links.map((link) => link.href), [
    '/telegram?mode=bot',
    '/telegram?mode=bot',
    '/telegram?mode=bot'
  ]);
});
