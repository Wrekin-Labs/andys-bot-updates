class WordPressRegistry {
  constructor({
    registryUrl,
    registryToken,
    supabaseUrl,
    supabaseAnonKey,
    serviceKey,
    fetchImpl = fetch
  } = {}) {
    this.registryUrl = (registryUrl || process.env.WREKIN_WORDPRESS_REGISTRY_URL || '').replace(/\/$/, '');
    this.registryToken = registryToken || process.env.WREKIN_WORDPRESS_REGISTRY_TOKEN || '';
    this.supabaseUrl = (supabaseUrl || process.env.SUPABASE_URL || '').replace(/\/$/, '');
    this.supabaseAnonKey = supabaseAnonKey || process.env.SUPABASE_ANON_KEY || '';
    this.serviceKey = serviceKey || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    this.fetch = fetchImpl;
  }

  mode() {
    if (this.registryUrl && this.registryToken) return 'gateway';
    if (this.supabaseUrl && this.supabaseAnonKey && this.registryToken) return 'rpc';
    if (this.supabaseUrl && this.serviceKey) return 'direct';
    return 'none';
  }

  configured() {
    return this.mode() !== 'none';
  }

  async requestGateway(action, payload = {}) {
    const response = await this.fetch(this.registryUrl, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + this.registryToken,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({ action, ...payload })
    });
    return this.readResponse(response, 'registry_gateway_http_');
  }

  async requestRpc(action, payload = {}) {
    const response = await this.fetch(this.supabaseUrl + '/rest/v1/rpc/wrekin_wordpress_registry_api', {
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
    return this.readResponse(response, 'registry_rpc_http_');
  }

  async requestDirect(path, options = {}) {
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
    return this.readResponse(response, 'registry_http_');
  }

  async readResponse(response, prefix) {
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!response.ok) {
      const error = new Error(prefix + response.status);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async call(action, payload = {}) {
    if (this.mode() === 'gateway') return this.requestGateway(action, payload);
    if (this.mode() === 'rpc') return this.requestRpc(action, payload);
    throw new Error('registry_not_configured');
  }

  async listSites() {
    if (this.mode() === 'gateway' || this.mode() === 'rpc') return this.call('list_sites');
    if (this.mode() === 'direct') {
      return this.requestDirect('wrekin_wordpress_sites?select=id,name,base_url,relay_device,status,metadata,credential_ref,created_at,updated_at&order=name.asc');
    }
    throw new Error('registry_not_configured');
  }

  async addSite({ name, baseUrl, credentialRef = null, relayDevice = null, metadata = {} }) {
    if (this.mode() === 'gateway' || this.mode() === 'rpc') {
      return this.call('add_site', { name, baseUrl, credentialRef, relayDevice, metadata });
    }
    if (this.mode() === 'direct') {
      return this.requestDirect('wrekin_wordpress_sites', {
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
    throw new Error('registry_not_configured');
  }

  async createPairing(baseUrl, codeHash) {
    if (this.mode() === 'gateway' || this.mode() === 'rpc') {
      return this.call('create_pairing', { baseUrl, codeHash });
    }
    throw new Error('pairing_requires_rpc_registry');
  }

  async consumePairing(baseUrl, codeHash) {
    if (this.mode() === 'gateway' || this.mode() === 'rpc') {
      return this.call('consume_pairing', { baseUrl, codeHash });
    }
    throw new Error('pairing_requires_rpc_registry');
  }

  async listAudit({ siteId = null, limit = 50 } = {}) {
    if (this.mode() === 'gateway' || this.mode() === 'rpc') {
      return this.call('list_audit', { siteId, limit });
    }
    if (this.mode() === 'direct') {
      const filter = siteId ? ('&site_id=eq.' + encodeURIComponent(siteId)) : '';
      return this.requestDirect(
        'wrekin_wordpress_audit?select=id,site_id,action,risk,status,checkpoint_id,details,created_at&order=created_at.desc&limit=' +
        Math.min(Math.max(Number(limit) || 50, 1), 200) +
        filter
      );
    }
    throw new Error('registry_not_configured');
  }

  async audit(event) {
    if (this.mode() === 'gateway' || this.mode() === 'rpc') return this.call('audit', { event });
    if (this.mode() === 'direct') {
      return this.requestDirect('wrekin_wordpress_audit', {
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
    throw new Error('registry_not_configured');
  }
}

module.exports = { WordPressRegistry };
