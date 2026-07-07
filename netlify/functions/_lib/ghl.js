const GHL_BASE_URL = 'https://services.leadconnectorhq.com';

function getConfig() {
  return {
    token: process.env.GHL_PRIVATE_TOKEN || '',
    locationId: process.env.GHL_LOCATION_ID || 'OlquyHCRhKfTPGjTYZSW',
    version: process.env.GHL_API_VERSION || '2021-07-28',
    calendarId: process.env.GHL_CALENDAR_ID || '',
    pipelineId: process.env.GHL_PIPELINE_ID || '',
    assignedUserId: process.env.GHL_DEFAULT_ASSIGNED_USER_ID || '',
    timezone: process.env.DASHBOARD_TIMEZONE || 'America/New_York',
    companyName: process.env.DASHBOARD_COMPANY_NAME || 'Summit Roofing & Contracting',
    divisionName: process.env.DASHBOARD_DIVISION_NAME || 'Plumbing Division CRM'
  };
}

function json(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    },
    body: JSON.stringify(payload)
  };
}

function cleanQuery(query = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) value.forEach(v => params.append(key, String(v)));
    else params.set(key, String(value));
  });
  return params.toString();
}

async function ghlFetch(path, { method = 'GET', query, body, token, version } = {}) {
  const cfg = getConfig();
  const privateToken = token || cfg.token;
  if (!privateToken) {
    const err = new Error('Missing GHL_PRIVATE_TOKEN environment variable.');
    err.status = 500;
    throw err;
  }

  const qs = cleanQuery(query);
  const url = `${GHL_BASE_URL}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${privateToken}`,
      'Version': version || cfg.version
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = { raw: text }; }

  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `GHL request failed: ${res.status}`);
    err.status = res.status;
    err.url = url.replace(privateToken, '[redacted]');
    err.data = data;
    throw err;
  }
  return data;
}

async function tryGhl(label, attempts) {
  const errors = [];
  for (const attempt of attempts) {
    try {
      const data = await ghlFetch(attempt.path, attempt);
      return { ok: true, label, data, endpoint: attempt.path };
    } catch (err) {
      errors.push({
        endpoint: attempt.path,
        status: err.status || 0,
        message: err.message,
        details: err.data || null
      });
    }
  }
  return { ok: false, label, data: null, errors };
}

function extractArray(data, preferredKeys = []) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const key of preferredKeys) {
    if (Array.isArray(data[key])) return data[key];
    if (data.data && Array.isArray(data.data[key])) return data.data[key];
  }
  for (const key of ['items', 'results', 'data', 'records']) {
    if (Array.isArray(data[key])) return data[key];
  }
  return [];
}

function asNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function parseDate(value) {
  if (!value) return null;
  if (typeof value === 'number') return new Date(value);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfToday(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function fmtMoney(value) {
  const n = Math.round(asNumber(value));
  return `$${n.toLocaleString('en-US')}`;
}

function monthKey(date) {
  return date.toLocaleString('en-US', { month: 'short' });
}

function safeText(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function splitName(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ')
  };
}

module.exports = {
  getConfig,
  json,
  ghlFetch,
  tryGhl,
  extractArray,
  asNumber,
  parseDate,
  startOfMonth,
  startOfToday,
  fmtMoney,
  monthKey,
  safeText,
  splitName
};
