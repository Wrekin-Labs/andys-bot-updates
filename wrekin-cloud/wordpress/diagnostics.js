const { assertSafeWordPressUrl } = require('./url-safety');

async function fetchJson(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    ...options,
    headers: { accept: 'application/json', ...(options.headers || {}) },
    redirect: 'error'
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: response.ok, status: response.status, data };
}

async function publicSiteDiagnostic(siteUrl, fetchImpl = fetch) {
  const origin = assertSafeWordPressUrl(siteUrl);
  const started = Date.now();
  const index = await fetchJson(origin + '/wp-json/', {}, fetchImpl);
  return {
    ok: index.ok,
    site: origin,
    wpRestReachable: index.ok,
    status: index.status,
    name: index.data && index.data.name ? index.data.name : null,
    namespaces: Array.isArray(index.data && index.data.namespaces) ? index.data.namespaces : [],
    elapsedMs: Date.now() - started
  };
}

async function probePath(siteUrl, path, fetchImpl = fetch) {
  const origin = assertSafeWordPressUrl(siteUrl);
  if (!path.startsWith('/')) throw new Error('path_must_be_absolute');
  const started = Date.now();
  const response = await fetchImpl(origin + path, {
    method: 'GET',
    redirect: 'manual',
    headers: { accept: 'text/html,application/json;q=0.9,*/*;q=0.8' }
  });
  return {
    ok: response.status >= 200 && response.status < 400,
    status: response.status,
    elapsedMs: Date.now() - started,
    path
  };
}

module.exports = { publicSiteDiagnostic, probePath, fetchJson };
