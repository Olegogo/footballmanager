import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductAnalytics } from '../web/analytics.js';

test('late tracker preserves order, identifies anonymously and deduplicates milestones', async () => {
  let tracker;
  const calls = [];
  const analytics = createProductAnalytics({ getTracker: () => tracker, isEnabled: () => true, getIdentity: () => 'opaque-random-id' });
  analytics.track('app_open', { source: 'telegram', username: 'private', token: 'secret' }, 'open');
  analytics.track('app_open', {}, 'open');
  analytics.track('join_requested', { game_id: 'game_1' });
  tracker = { identify: async (id) => calls.push(['identify', id]), track: async (...args) => calls.push(args) };
  await analytics.flush();
  assert.deepEqual(calls, [
    ['identify', 'opaque-random-id'], ['app_open', { source: 'telegram' }], ['join_requested', { game_id: 'game_1' }]
  ]);
});

test('tracking failures and disabled dev analytics cannot break actions', async () => {
  const analytics = createProductAnalytics({
    getTracker: () => ({ track: () => { throw new Error('blocked'); } }), isEnabled: () => true
  });
  assert.doesNotThrow(() => analytics.track('rating_saved'));
  await analytics.flush();
  const disabled = createProductAnalytics({ getTracker: () => { throw new Error('must not access tracker'); }, isEnabled: () => false });
  disabled.track('app_open');
  await disabled.flush();
});

test('unknown events are ignored and late-tracker queue is bounded', async () => {
  let tracker;
  const calls = [];
  const analytics = createProductAnalytics({ getTracker: () => tracker, isEnabled: () => true });
  analytics.track('accidental_secret');
  for (let i = 0; i < 150; i++) analytics.track('game_view', { game_id: `game_${i}` });
  tracker = { track: async (...args) => calls.push(args) };
  await analytics.flush();
  assert.equal(calls.length, 100);
  assert.equal(calls[0][1].game_id, 'game_50');
});
