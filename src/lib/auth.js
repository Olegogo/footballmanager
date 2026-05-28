import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function createSessionToken() {
  return randomBytes(32).toString('hex');
}

export function verifyTelegramInitData(initData, botToken, maxAgeSeconds = 86400) {
  if (!initData || !botToken) {
    return { ok: false, reason: 'Missing initData or bot token' };
  }

  const params = new URLSearchParams(initData);
  const providedHash = params.get('hash');

  if (!providedHash) {
    return { ok: false, reason: 'Missing hash' };
  }

  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const left = Buffer.from(providedHash, 'hex');
  const right = Buffer.from(computedHash, 'hex');

  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, reason: 'Invalid signature' };
  }

  const authDate = Number(params.get('auth_date') ?? 0);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (!authDate || nowSeconds - authDate > maxAgeSeconds) {
    return { ok: false, reason: 'Auth data expired' };
  }

  let user = null;

  try {
    user = JSON.parse(params.get('user') ?? 'null');
  } catch {
    user = null;
  }

  if (!user?.id) {
    return { ok: false, reason: 'Missing user' };
  }

  return {
    ok: true,
    authDate,
    user,
    queryId: params.get('query_id') ?? null
  };
}

export function verifyTelegramLoginData(paramsInput, botToken, maxAgeSeconds = 86400) {
  if (!paramsInput || !botToken) {
    return { ok: false, reason: 'Missing login data or bot token' };
  }

  const params = paramsInput instanceof URLSearchParams
    ? paramsInput
    : new URLSearchParams(paramsInput);
  const providedHash = params.get('hash');

  if (!providedHash) {
    return { ok: false, reason: 'Missing hash' };
  }

  const signedKeys = ['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date'];
  const dataCheckString = signedKeys
    .filter((key) => params.has(key))
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${key}=${params.get(key)}`)
    .join('\n');
  const secretKey = createHash('sha256').update(botToken).digest();
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const left = Buffer.from(providedHash, 'hex');
  const right = Buffer.from(computedHash, 'hex');

  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, reason: 'Invalid signature' };
  }

  const authDate = Number(params.get('auth_date') ?? 0);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (!authDate || nowSeconds - authDate > maxAgeSeconds) {
    return { ok: false, reason: 'Auth data expired' };
  }

  const id = Number(params.get('id') ?? 0);

  if (!id) {
    return { ok: false, reason: 'Missing user' };
  }

  return {
    ok: true,
    authDate,
    user: {
      id,
      first_name: params.get('first_name') ?? '',
      last_name: params.get('last_name') ?? '',
      username: params.get('username') ?? '',
      photo_url: params.get('photo_url') ?? ''
    }
  };
}
