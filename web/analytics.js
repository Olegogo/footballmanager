const EVENTS = new Set([
  'app_open', 'auth_success', 'auth_required', 'screen_view', 'game_view',
  'games_empty', 'create_game', 'join_requested', 'join_cancelled',
  'join_approved', 'invite_accepted', 'invite_declined', 'rating_available',
  'rating_saved', 'rating_completed', 'profile_saved'
]);
const FIELDS = new Set([
  'locale', 'screen', 'source', 'authenticated', 'game_id', 'game_status', 'join_status',
  'method', 'mode', 'actor', 'filter', 'rating_mode'
]);

// A bounded, in-memory queue handles a slow tracker; analytics never blocks the app.
// No names, usernames, Telegram IDs, tokens, search text or form contents are accepted.
export function createProductAnalytics({ getTracker, isEnabled, getIdentity = () => '' }) {
  const queue = [];
  const seen = new Set();
  let flushing = false;
  let identified = '';

  async function flush() {
    if (flushing) return;
    if (!isEnabled()) { queue.length = 0; return; }
    const tracker = getTracker();
    if (typeof tracker?.track !== 'function') return;
    flushing = true;
    try {
      while (queue.length) {
        const event = queue.shift();
        try {
          if (event.identity && event.identity !== identified && typeof tracker.identify === 'function') {
            await tracker.identify(event.identity);
            identified = event.identity;
          }
          await tracker.track(event.name, event.data);
        } catch { /* A blocked or failing tracker must not affect a successful action. */ }
      }
    } finally { flushing = false; }
  }

  function track(name, data = {}, onceKey = '') {
    if (!EVENTS.has(name) || !isEnabled() || (onceKey && seen.has(onceKey))) return;
    if (onceKey) seen.add(onceKey);
    const safeData = Object.fromEntries(Object.entries(data).filter(([key, value]) =>
      FIELDS.has(key) && ['string', 'number', 'boolean'].includes(typeof value)
    ).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 80) : value]));
    if (queue.length >= 100) queue.shift();
    queue.push({ name, data: safeData, identity: getIdentity() });
    void flush().catch(() => {});
  }
  return { track, flush };
}
