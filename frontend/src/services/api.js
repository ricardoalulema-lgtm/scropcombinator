const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';
const API_KEY = import.meta.env.VITE_API_KEY || 'hn-scraper-7f3a9c2e1b8d4f6a-static';

const request = async (path, options = {}) => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      ...options.headers
    }
  });

  const data = await response.json().catch(() => null);

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
