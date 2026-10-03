export const VERSION = '6.1.0-rc.1';
export const API_URL = 'https://dbhwjzznwhukoogjewfl.supabase.co';
export const PUBLIC_KEY = 'sb_publishable_7V8ety_rhgOhOEUc7_rsiw_lDWkB8YF';
export class ApiError extends Error { constructor(message, status = 0) { super(message); this.status = status; } }
export class DeskRouteAPI {
  constructor({ fetcher = globalThis.fetch.bind(globalThis), storage = globalThis.localStorage, onExpired = () => {} } = {}) {
    this.fetcher = fetcher; this.storage = storage; this.onExpired = onExpired; this.session = null; this.refreshPromise = null; this.epoch = 0; this.contextEpoch = 0;
    try { this.session = JSON.parse(storage.getItem('drs') || 'null'); } catch { storage.removeItem('drs'); }
  }
  save(session) { this.session = session; this.storage.setItem('drs', JSON.stringify(session)); }
  clear() { this.epoch++; this.session = null; this.storage.removeItem('drs'); }
  changeContext() { this.contextEpoch++; }
  async decode(response) {
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(data?.error_description || data?.error || data?.message || data?.msg || `Request failed (${response.status})`, response.status);
    return data;
  }
  async login(email, password) {
    const data = await this.decode(await this.fetcher(`${API_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: PUBLIC_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }));
    this.epoch++; this.save(data); return data;
  }
  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    const epoch = this.epoch;
    this.refreshPromise = (async () => {
      if (!this.session?.refresh_token) throw new ApiError('Please sign in again.', 401);
      const response = await this.fetcher(`${API_URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: PUBLIC_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: this.session.refresh_token }) });
      const data = await this.decode(response);
      if (epoch !== this.epoch) throw new ApiError('Session changed. Please sign in again.', 401);
      this.save(data);
    })().catch(error => { if ([400,401,403].includes(error.status) && epoch === this.epoch) { this.clear(); this.onExpired(); } throw error; }).finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }
  async request(path, { method = 'GET', body, headers = {}, signal, anonymous = false } = {}) {
    const epoch = this.epoch, contextEpoch = this.contextEpoch;
    const send = () => this.fetcher(`${API_URL}${path}`, { method, headers: { apikey: PUBLIC_KEY, 'Content-Type': 'application/json', ...headers, ...(!anonymous && this.session?.access_token ? { Authorization: `Bearer ${this.session.access_token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal });
    let response = await send();
    if (response.status === 401 && !anonymous && this.session?.refresh_token && epoch === this.epoch) { await this.refresh(); response = await send(); }
    if (response.status === 401 && !anonymous && epoch === this.epoch) { this.clear(); this.onExpired(); }
    const data = await this.decode(response);
    if (!anonymous && (epoch !== this.epoch || contextEpoch !== this.contextEpoch)) throw new ApiError('Workspace or session changed. Refresh the page.', 409);
    return data;
  }
  async logout() { const token = this.session?.access_token; this.clear(); if (token) await this.decode(await this.fetcher(`${API_URL}/auth/v1/logout?scope=local`, {method:'POST',headers:{apikey:PUBLIC_KEY,Authorization:`Bearer ${token}`}})); }
  table(name, filters = {}, options = {}) { const params = new URLSearchParams(filters).toString(); return this.request(`/rest/v1/${name}${params ? '?' + params : ''}`, options); }
  rpc(name, body) { return this.request(`/rest/v1/rpc/${name}`, { method: 'POST', body }); }
  edge(name, body) { return this.request(`/functions/v1/${name}`, { method: 'POST', body }); }
  onboard(action, organisationId, extra = {}) { return this.edge('cxroute-onboard', { action, organisationId, ...extra }); }
  async patch(name, org, id, body, extra = {}) {
    const rows = await this.table(name, { organisation_id: `eq.${org}`, ...(id ? { id: `eq.${id}` } : {}), ...extra }, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body });
    if (!rows?.length) throw new ApiError('Nothing was changed. Check your permissions and refresh the page.', 409);
    return rows;
  }
}
