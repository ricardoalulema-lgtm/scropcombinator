import { describe, it, expect } from 'vitest';
import {
  createSessionToken,
  verifySessionToken,
  DEFAULT_TTL_SECONDS
} from '../src/utils/sessionToken.js';

const SECRET = 'test-session-secret';

describe('sessionToken utils', () => {
  it('creates a token shaped as <expiry>.<hmac-sha256-hex>', async () => {
    const { token, expiresAt, expiresIn } = await createSessionToken(SECRET);

    expect(token).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(token.slice(0, token.indexOf('.'))).toBe(String(expiresAt));
    expect(expiresIn).toBe(DEFAULT_TTL_SECONDS);
    expect(expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('defaults the TTL to 15 minutes', () => {
    expect(DEFAULT_TTL_SECONDS).toBe(900);
  });

  it('verifies a freshly created token', async () => {
    const { token } = await createSessionToken(SECRET);

    await expect(verifySessionToken(SECRET, token)).resolves.toBe(true);
  });

  it('rejects an expired token', async () => {
    const { token, expiresAt } = await createSessionToken(SECRET, -10);

    await expect(
      verifySessionToken(SECRET, token, expiresAt + 1)
    ).resolves.toBe(false);
  });

  it('rejects a token whose expiry was moved forward', async () => {
    const { token, expiresAt } = await createSessionToken(SECRET);
    const forged = `${expiresAt + 3600}${token.slice(token.indexOf('.'))}`;

    await expect(verifySessionToken(SECRET, forged)).resolves.toBe(false);
  });

  it('rejects a token with a tampered signature', async () => {
    const { token } = await createSessionToken(SECRET);
    const lastChar = token.at(-1);
    const tampered = `${token.slice(0, -1)}${lastChar === 'a' ? 'b' : 'a'}`;

    await expect(verifySessionToken(SECRET, tampered)).resolves.toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const { token } = await createSessionToken('another-secret');

    await expect(verifySessionToken(SECRET, token)).resolves.toBe(false);
  });

  it('rejects malformed credentials', async () => {
    const invalid = ['', 'garbage', '.abc', '123.', '12x34.abc', null, 42];

    for (const value of invalid) {
      await expect(verifySessionToken(SECRET, value)).resolves.toBe(false);
    }
  });
});
