class WordPressSecretStore {
  constructor({ supabaseUrl, supabaseAnonKey, registryToken, fetchImpl = fetch } = {}) {
    this.supabaseUrl = (supabaseUrl || process.env.SUPABASE_URL || '').replace(/\/$/, '');
    this.supabaseAnonKey = supabaseAnonKey || process.env.SUPABASE_ANON_KEY || '';
    this.registryToken = registryToken || process.env.WREKIN_WORDPRESS_REGISTRY_TOKEN || '';
    this.fetch = fetchImpl;
  }

  configured() {
    return Boolean(this.supabaseUrl && this.supabaseAnonKey && this.registryToken);
  }

  async call(action, name, secret = null) {
    if (!this.configured()) throw new Error('secret_store_not_configured');
    const response = await this.fetch(this.supabaseUrl + '/rest/v1/rpc/wrekin_wordpress_secret_api', {
      method: 'POST',
      headers: {
        apikey: this.supabaseAnonKey,
        authorization: 'Bearer ' + this.supabaseAnonKey,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        p_token: this.registryToken,
        p_action: action,
        p_name: name,
        p_secret: secret
      })
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!response.ok) {
      const error = new Error('secret_store_http_' + response.status);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async set(name, secret) {
    return this.call('set_secret', name, secret);
  }

  async get(name) {
    const result = await this.call('get_secret', name, null);
    if (!result || !result.secret) throw new Error('secret_not_found');
    return result.secret;
  }
}

module.exports = { WordPressSecretStore };
