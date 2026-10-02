const { assertSafeWordPressUrl } = require('./url-safety');

class WordPressClient {
  constructor({ baseUrl, token, fetchImpl = fetch }) {
    this.baseUrl = assertSafeWordPressUrl(baseUrl);
    this.token = token || '';
    this.fetch = fetchImpl;
  }

  async request(path, options = {}) {
    const method = options.method || 'GET';
    const headers = { accept: 'application/json', ...(options.headers || {}) };
    if (this.token) headers.authorization = 'Bearer ' + this.token;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const response = await this.fetch(this.baseUrl + path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'error'
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!response.ok) {
      const error = new Error('HTTP_' + response.status);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  apiIndex() { return this.request('/wp-json/'); }
  pages() { return this.request('/wp-json/wp/v2/pages?per_page=100&status=publish'); }
  page(id) { return this.request('/wp-json/wp/v2/pages/' + encodeURIComponent(id)); }
  updatePage(id, patch) { return this.request('/wp-json/wp/v2/pages/' + encodeURIComponent(id), { method: 'POST', body: patch }); }
  plugins() { return this.request('/wp-json/wp/v2/plugins'); }
}

module.exports = { WordPressClient };
