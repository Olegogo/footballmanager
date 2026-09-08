import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const app = await fs.readFile(new URL('../web/app.js', import.meta.url), 'utf8');
function functionSource(name) {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1);
  const rest = app.slice(start);
  const end = rest.indexOf('\n}\n') + 2;
  return rest.slice(0, end);
}

function setup({ fail = false, authorized = true, prior = {}, changed = true } = {}) {
  const events = [];
  const game = { id: 'game_1', viewerJoinStatus: 'none', viewerQuickRating: {}, participants: [], ...prior };
  const state = { snapshot: {}, ratingDrafts: {}, quickRatingDrafts: {}, manualGameConfirm: {}, manualGameMode: 'create' };
  const context = vm.createContext({
    state, events, encodeURIComponent, Boolean, Number, String,
    trackAnalyticsEvent: (name, data) => events.push({ name, data }),
    gameAnalyticsData: () => ({ game_id: game.id }),
    getGameById: () => game, getGameDays: () => [game], getCurrentGame: () => game,
    getViewerPlayerId: () => 'viewer',
    ensureAuthorizedForAction: async () => authorized,
    api: async (url) => {
      if (fail) throw new Error('API failed');
      if (url.endsWith('/join-request')) game.viewerJoinStatus = 'pending';
      return { snapshot: {}, game };
    },
    render() {}, showToast() {}, resetManualGameState() {}, t: (key) => key,
    getQuickRatingDraft: () => ({ mvpPlayerId: 'teammate', boosts: [], achievements: [] }),
    isQuickRatingDraftChanged: () => changed,
    normalizeQuickBoosts: (x) => x, normalizeQuickAchievements: (x) => x,
    getQuickRatingDraftKey: () => 'draft'
  });
  for (const name of ['hasViewerRatedGame', 'requestJoinGame', 'submitQuickRating', 'submitManualGame']) {
    vm.runInContext(functionSource(name), context);
  }
  return { context, events, state, game };
}

test('join funnel records successful requests only, not failed, unauthenticated or duplicate requests', async () => {
  const good = setup();
  await good.context.requestJoinGame('game_1');
  await good.context.requestJoinGame('game_1');
  assert.deepEqual(good.events.map((e) => e.name), ['join_requested']);
  const bad = setup({ fail: true });
  await assert.rejects(bad.context.requestJoinGame('game_1'));
  assert.equal(bad.events.length, 0);
  const guest = setup({ authorized: false });
  await guest.context.requestJoinGame('game_1');
  assert.equal(guest.events.length, 0);
});

test('rating milestone is separate from edits and no-op or failed submissions', async () => {
  const first = setup();
  await first.context.submitQuickRating('game_1');
  assert.deepEqual(first.events.map((e) => e.name), ['rating_saved', 'rating_completed']);
  for (const prior of [{ viewerQuickRating: { mvpPlayerId: 'other' } }, { participants: [{ viewerRating: { goals: 1 } }] }]) {
    const edit = setup({ prior });
    await edit.context.submitQuickRating('game_1');
    assert.deepEqual(edit.events.map((e) => e.name), ['rating_saved']);
  }
  const unchanged = setup({ changed: false });
  await unchanged.context.submitQuickRating('game_1');
  assert.equal(unchanged.events.length, 0);
  const failed = setup({ fail: true });
  await assert.rejects(failed.context.submitQuickRating('game_1'));
  assert.equal(failed.events.length, 0);
});

test('editing or failing to create a game never inflates create_game', async () => {
  const created = setup();
  await created.context.submitManualGame(false);
  assert.deepEqual(created.events.map((e) => e.name), ['create_game']);
  const edit = setup();
  edit.state.manualGameMode = 'edit';
  edit.state.manualGameGameId = 'game_1';
  await edit.context.submitManualGame(false);
  assert.equal(edit.events.length, 0);
  const failed = setup({ fail: true });
  await assert.rejects(failed.context.submitManualGame(false));
  assert.equal(failed.events.length, 0);
});

test('screen views include direct links but not background rerenders', () => {
  const events = [];
  const context = vm.createContext({
    state: { activeTab: 'game', selectedGameId: 'game_1' },
    getCurrentGame: () => ({ id: 'game_1', canViewerRate: false }),
    gameAnalyticsData: () => ({ game_id: 'game_1' }),
    trackAnalyticsEvent: (name) => events.push(name)
  });
  vm.runInContext(`let analyticsReady = true; let lastAnalyticsScreen = ''; ${functionSource('trackScreenView')}`, context);
  context.trackScreenView();
  context.trackScreenView();
  assert.deepEqual(events, ['screen_view', 'game_view']);
});
