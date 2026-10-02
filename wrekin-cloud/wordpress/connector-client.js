const crypto = require('crypto');
const { assertSafeWordPressUrl } = require('./url-safety');

class WrekinConnectorClient {
  constructor({ baseUrl, secret, fetchImpl = fetch, now = () => Math.floor(Date.now()/1000) }) {
    this.baseUrl = assertSafeWordPressUrl(baseUrl);
    if (!secret) throw new Error('connector_secret_required');
    this.secret = secret;
    this.fetch = fetchImpl;
    this.now = now;
  }

  sign(method, route, bodyText, timestamp) {
    const bodyHash = crypto.createHash('sha256').update(bodyText || '').digest('hex');
    const canonical = [String(timestamp), method.toUpperCase(), route, bodyHash].join('\n');
    return crypto.createHmac('sha256', this.secret).update(canonical).digest('hex');
  }

  async request(route, { method = 'GET', body } = {}) {
    if (!route.startsWith('/wp-json/wrekin/v1/')) throw new Error('connector_route_forbidden');
    const timestamp = this.now();
    const bodyText = body === undefined ? '' : JSON.stringify(body);
    const signature = this.sign(method, route.replace('/wp-json', ''), bodyText, timestamp);
    const response = await this.fetch(this.baseUrl + route, {
      method,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-wrekin-timestamp': String(timestamp),
        'x-wrekin-signature': signature
      },
      body: body === undefined ? undefined : bodyText,
      redirect: 'error'
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!response.ok) {
      const error = new Error('connector_http_' + response.status);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  status() { return this.request('/wp-json/wrekin/v1/status'); }
  plugins() { return this.request('/wp-json/wrekin/v1/plugins'); }
  themes() { return this.request('/wp-json/wrekin/v1/themes'); }
  cron() { return this.request('/wp-json/wrekin/v1/cron'); }
  forms() { return this.request('/wp-json/wrekin/v1/forms'); }
  cachePurge(approved) { return this.request('/wp-json/wrekin/v1/cache/purge', { method: 'POST', body: { approved: approved === true } }); }
  pluginUpdatePlan(file) { return this.request('/wp-json/wrekin/v1/plugin/update-plan', { method: 'POST', body: { file } }); }
  pluginUpdate(file, approved) { return this.request('/wp-json/wrekin/v1/plugin/update', { method: 'POST', body: { file, approved: approved === true } }); }
  themeUpdatePlan(slug) { return this.request('/wp-json/wrekin/v1/theme/update-plan', { method: 'POST', body: { slug } }); }
  themeUpdate(slug, approved) { return this.request('/wp-json/wrekin/v1/theme/update', { method: 'POST', body: { slug, approved: approved === true } }); }
}

module.exports = { WrekinConnectorClient };
