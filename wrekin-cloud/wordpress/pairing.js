class WordPressPairingStore {
  constructor({ supabaseUrl, supabaseAnonKey, registryToken, fetchImpl = fetch } = {}) {
    this.supabaseUrl = (supabaseUrl || process.env.SUPABASE_URL || '').replace(/\/$/, '');
    this.supabaseAnonKey = supabaseAnonKey || process.env.SUPABASE_ANON_KEY || '';
    this.registryToken = registryToken || process.env.WREKIN_WORDPRESS_REGISTRY_TOKEN || '';
    this.fetch = fetchImpl;
  }

  configured() {
    return Boolean(this.supabaseUrl && this.supabaseAnonKey && this.registryToken);
  }

  async call(action, payload = {}) {
    if (!this.configured()) throw new Error('pairing_store_not_configured');
    const response = await this.fetch(this.supabaseUrl + '/rest/v1/rpc/wrekin_wordpress_pair_api', {
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
        p_payload: payload
      })
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!response.ok) {
      const error = new Error('pairing_store_http_' + response.status);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  create({ baseUrl, name, relayDevice = null }) {
    return this.call('create', { baseUrl, name, relayDevice });
  }

  consume({ code, baseUrl }) {
    return this.call('consume', { code, baseUrl });
  }
}

module.exports = { WordPressPairingStore };
