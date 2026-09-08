const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

// A deployment flag alone must never enable impersonation on a public listener.
export function isDevLoginEnabled(env = process.env) {
  return ['1', 'true', 'yes'].includes(String(env.ALLOW_DEV_LOGIN || '').toLowerCase()) &&
    env.NODE_ENV !== 'production' &&
    LOOPBACK_HOSTS.has(env.HOST || '0.0.0.0') &&
    [env.PUBLIC_BASE_URL, env.CANONICAL_BASE_URL].every((value) => {
      if (!value) return true;
      try {
        return LOOPBACK_HOSTS.has(new URL(value).hostname.replace(/^\[|\]$/g, ''));
      } catch {
        return false;
      }
    });
}

export function canUseDevLogin(req, enabled) {
  if (!enabled || req.headers.forwarded || Object.keys(req.headers).some((key) => key.startsWith('x-forwarded-'))) return false;
  const address = req.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return false;
  try {
    const host = new URL(`http://${req.headers.host}`).hostname.replace(/^\[|\]$/g, '');
    const origin = req.headers.origin;
    return LOOPBACK_HOSTS.has(host) && (!origin || LOOPBACK_HOSTS.has(new URL(origin).hostname.replace(/^\[|\]$/g, '')));
  } catch {
    return false;
  }
}
