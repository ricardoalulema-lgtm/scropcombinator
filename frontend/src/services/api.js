const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';
const TOKEN_REFRESH_MARGIN_MS = 60_000;

let cachedToken = null;
let tokenExpiresAt = 0;

const fetchSessionToken = async () => {
  const response = await fetch(`${API_BASE_URL}/api/session`, { method: 'POST' });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data?.error || `Session request failed with status ${response.status}`;
    throw new Error(message);
  }

  cachedToken = data.token;
  tokenExpiresAt = Date.now() + (data.expires_in ?? 0) * 1000 - TOKEN_REFRESH_MARGIN_MS;

  return cachedToken;
};

const getSessionToken = async () => {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  return fetchSessionToken();
};

const request = async (path, options = {}, isRetry = false) => {
  const token = await getSessionToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...options.headers
    }
  });

  const data = await response.json().catch(() => null);

  // Expired or invalidated token: drop it, get a fresh one and retry once.
  if (response.status === 401 && !isRetry) {
    cachedToken = null;
    tokenExpiresAt = 0;
    return request(path, options, true);
  }

  if (!response.ok) {
    const message = data?.error || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data;
};

export const fetchEntries = (filterId) =>
  request(`/api/entries?filter=${encodeURIComponent(filterId)}`);

export const scrapeNow = () => request('/api/scrape');

export const getSystemConfig = () => request('/api/config');

export const updateSystemConfig = (payload) =>
  request('/api/config', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });

export const saveUsageLog = (payload) =>
  request('/api/logs', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export { API_BASE_URL };
