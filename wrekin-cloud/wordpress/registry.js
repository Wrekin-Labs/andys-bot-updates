class WordPressRegistry {
  constructor({ supabaseUrl, serviceKey, fetchImpl = fetch } = {}) {
    this.supabaseUrl = (supabaseUrl || process.env.SUPABASE_URL || '').replace(/\/$/, '');
    this.serviceKey = serviceKey || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    this.fetch = fetchImpl;
  }

  configured() {
    return Boolean(this.supabaseUrl && this.serviceKey);
  }

  async request(path, options = {}) {
    if (!this.configured()) throw new Error('registry_not_configured');
    const response = await this.fetch(this.supabaseUrl + '/rest/v1/' + path, {
      method: options.method || 'GET',
      headers: {
        apikey: this.serviceKey,
        authorization: 'Bearer ' + this.serviceKey,
        'content-type': 'application/json',
        prefer: options.prefer || 'return=representation',
        ...(options.headers || {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!response.ok) throw new Error('registry_http_' + response.status);
    return data;
  }

  listSites() {
    return this.request('wrekin_wordpress_sites?select=id,name,base_url,relay_device,status,metadata,created_at,updated_at&order=name.asc');
  }

  addSite({ name, baseUrl, credentialRef = null, relayDevice = null, metadata = {} }) {
    return this.request('wrekin_wordpress_sites', {
      method: 'POST',
      body: {
        name,
        base_url: baseUrl,
        credential_ref: credentialRef,
        relay_device: relayDevice,
        status: 'connected',
        metadata
      }
    });
  }

  audit(event) {
    return this.request('wrekin_wordpress_audit', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        site_id: event.siteId || null,
        action: event.action,
        risk: event.risk || 'read',
        status: event.status || 'ok',
        checkpoint_id: event.checkpointId || null,
        details: event.details || {}
      }
    });
  }
}

module.exports = { WordPressRegistry };
