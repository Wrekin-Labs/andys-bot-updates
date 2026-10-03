import {API_URL, PUBLIC_KEY, ApiError} from './api.js';

export const RECOVERY_SENT = 'If this email belongs to an existing DeskRoute account, a recovery link will arrive shortly. Check your inbox and spam folder.';
export const LINK_ERROR = 'This recovery link is incomplete or has expired. Request a new link below.';

export function recoveryToken(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.size) return null;
  if (params.has('error') || params.has('error_code') || params.get('type') !== 'recovery' || !params.get('access_token')) throw new ApiError(LINK_ERROR, 401);
  return params.get('access_token');
}

// Recovery credentials live only in memory. They are never saved or logged.
export class RecoveryAPI {
  constructor({fetcher = globalThis.fetch.bind(globalThis)} = {}) { this.fetcher = fetcher; this.token = null; this.epoch = 0; }
  clear() { this.epoch++; this.token = null; }
  async call(path, {method = 'GET', body, token} = {}) {
    let response;
    try {
      response = await this.fetcher(`${API_URL}/auth/v1${path}`, {method, headers:{apikey:PUBLIC_KEY, 'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {})}, ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(15000)});
    } catch { throw new ApiError('We could not reach the sign-in service. Check your connection and try again.'); }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status === 429 ? 'Too many requests. Please wait before trying again.' : data?.msg || data?.message || data?.error_description || 'The request could not be completed. Please try again.', response.status);
    return data;
  }
  async requestReset(email, redirectTo) {
    const target = new URL(redirectTo);
    if (target.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(target.hostname)) throw new ApiError('Recovery requires a secure workspace address.');
    await this.call(`/recover?redirect_to=${encodeURIComponent(target.href)}`, {method:'POST', body:{email:email.trim()}});
    return RECOVERY_SENT;
  }
  async acceptToken(token) {
    this.clear(); const epoch = this.epoch;
    const user = await this.call('/user', {token});
    if (epoch !== this.epoch) throw new ApiError(LINK_ERROR, 401);
    if (!user?.id || !user?.email) throw new ApiError(LINK_ERROR, 401);
    this.token = token;
    return user.email;
  }
  async setPassword(password) {
    const token = this.token;
    if (!token) throw new ApiError(LINK_ERROR, 401);
    if (password.length < 12) throw new ApiError('Use at least 12 characters for your password.');
    await this.call('/user', {method:'PUT', token, body:{password}});
    this.clear();
    // End this recovery session. Other device sessions follow the provider policy.
    let signedOut = true;
    try { await this.call('/logout?scope=local', {method:'POST',token}); } catch { signedOut = false; }
    return {signedOut};
  }
}
