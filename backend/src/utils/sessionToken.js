const ENCODER = new TextEncoder();

export const DEFAULT_TTL_SECONDS = 900;

const toHex = (buffer) =>
  Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

const sign = async (secret, payload) => {
  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, ENCODER.encode(payload));
  return toHex(signature);
};

const constantTimeEquals = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }

  let diff = 0;

  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
};

export const createSessionToken = async (
  secret,
  ttlSeconds = DEFAULT_TTL_SECONDS
) => {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = await sign(secret, String(expiresAt));

  return {
    token: `${expiresAt}.${signature}`,
    expiresAt,
    expiresIn: ttlSeconds
  };
};

export const verifySessionToken = async (
  secret,
  token,
  nowSeconds = Math.floor(Date.now() / 1000)
) => {
  if (typeof token !== 'string') {
    return false;
  }

  const separator = token.indexOf('.');

  if (separator <= 0) {
    return false;
  }

  const expiresAtText = token.slice(0, separator);

  if (!/^\d+$/.test(expiresAtText)) {
    return false;
  }

  const expiresAt = Number.parseInt(expiresAtText, 10);

  if (expiresAt <= nowSeconds) {
    return false;
  }

  const expected = await sign(secret, expiresAtText);
  return constantTimeEquals(expected, token.slice(separator + 1));
};
