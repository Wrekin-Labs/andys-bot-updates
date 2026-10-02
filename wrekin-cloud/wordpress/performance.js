const { assertSafeWordPressUrl } = require('./url-safety');

async function timedFetch(url, fetchImpl = fetch) {
  const started = Date.now();
  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'manual',
    headers: { accept: 'text/html,application/xhtml+xml' }
  });
  const text = await response.text();
  return {
    status: response.status,
    ok: response.status >= 200 && response.status < 400,
    elapsedMs: Date.now() - started,
    bytes: Buffer.byteLength(text),
    text
  };
}

async function simplePerformanceAudit(siteUrl, path = '/', fetchImpl = fetch) {
  const origin = assertSafeWordPressUrl(siteUrl);
  if (!path.startsWith('/')) throw new Error('path_must_be_absolute');
  const result = await timedFetch(origin + path, fetchImpl);
  const html = result.text || '';
  const scripts = (html.match(/<script\b/gi) || []).length;
  const stylesheets = (html.match(/<link\b[^>]*rel=["']?stylesheet/gi) || []).length;
  const images = (html.match(/<img\b/gi) || []).length;
  const inlineStyles = (html.match(/style=/gi) || []).length;
  const score = Math.max(0, 100
    - Math.min(30, Math.floor(result.elapsedMs / 150))
    - Math.min(25, Math.floor(result.bytes / 100000))
    - Math.min(15, Math.max(0, scripts - 10))
    - Math.min(10, Math.max(0, stylesheets - 8)));

  return {
    ok: result.ok,
    site: origin,
    path,
    status: result.status,
    elapsedMs: result.elapsedMs,
    htmlBytes: result.bytes,
    counts: { scripts, stylesheets, images, inlineStyles },
    heuristicScore: score,
    notes: [
      'Heuristic score is for Wrekin trend monitoring, not a Lighthouse score.',
      'Use PageSpeed/Lighthouse integration for Core Web Vitals when configured.'
    ]
  };
}

async function pageSpeedAudit(siteUrl, path = '/', {
  apiKey = process.env.PAGESPEED_API_KEY || '',
  strategy = 'mobile',
  fetchImpl = fetch
} = {}) {
  const origin = assertSafeWordPressUrl(siteUrl);
  if (!path.startsWith('/')) throw new Error('path_must_be_absolute');
  if (!apiKey) return { configured: false, reason: 'pagespeed_api_key_missing' };
  const target = origin + path;
  const qs = new URLSearchParams({
    url: target,
    strategy,
    category: 'performance',
    key: apiKey
  });
  const response = await fetchImpl('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?' + qs.toString());
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { throw new Error('pagespeed_invalid_response'); }
  if (!response.ok) throw new Error('pagespeed_http_' + response.status);
  const lh = data.lighthouseResult || {};
  const audits = lh.audits || {};
  return {
    configured: true,
    url: target,
    strategy,
    score: lh.categories && lh.categories.performance ? Math.round((lh.categories.performance.score || 0) * 100) : null,
    lcpMs: audits['largest-contentful-paint'] && audits['largest-contentful-paint'].numericValue,
    fcpMs: audits['first-contentful-paint'] && audits['first-contentful-paint'].numericValue,
    cls: audits['cumulative-layout-shift'] && audits['cumulative-layout-shift'].numericValue,
    tbtMs: audits['total-blocking-time'] && audits['total-blocking-time'].numericValue
  };
}

module.exports = { simplePerformanceAudit, pageSpeedAudit, timedFetch };
