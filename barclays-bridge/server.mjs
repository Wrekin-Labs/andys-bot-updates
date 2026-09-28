import http from 'node:http';
import crypto from 'node:crypto';
import { URL, URLSearchParams } from 'node:url';

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = requireEnv('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_KEY = requireEnv('SUPABASE_PUBLISHABLE_KEY');
const BRIDGE_DB_KEY = requireEnv('BRIDGE_DB_KEY');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error('Missing environment variable: ' + name);
  return value;
}

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(body));
}

function html(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; script-src 'self' https://cdn.plaid.com 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src https://cdn.plaid.com https://*.plaid.com https://*.barclays.co.uk https://*.barclays.com; connect-src 'self' https://*.plaid.com; base-uri 'none'; form-action 'self'"
  });
  res.end(body);
}

function text(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders });
  res.end(body);
}

async function bodyText(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function bodyJson(req) {
  const raw = await bodyText(req);
  return raw ? JSON.parse(raw) : {};
}

async function bodyForm(req) {
  return Object.fromEntries(new URLSearchParams(await bodyText(req)).entries());
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function baseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return proto + '://' + host;
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function timingSafeString(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function encKey() {
  return crypto.createHash('sha256').update(BRIDGE_DB_KEY + ':barclays-bridge:enc:v1').digest();
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decryptSecret(value) {
  const parts = String(value).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Invalid encrypted secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(parts[1], 'base64url'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
}

function makePasswordHash(secret) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(secret), salt, 32);
  return 'scrypt$' + salt.toString('base64url') + '$' + hash.toString('base64url');
}

function verifyPassword(secret, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64url');
  const expected = Buffer.from(parts[2], 'base64url');
  const actual = crypto.scryptSync(String(secret), salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function jwtKey() {
  return crypto.createHash('sha256').update(BRIDGE_DB_KEY + ':barclays-bridge:jwt:v1').digest();
}

function signJwt(payload, ttlSeconds = 2592000) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const sig = crypto.createHmac('sha256', jwtKey()).update(head + '.' + body).digest('base64url');
  return head + '.' + body + '.' + sig;
}

function verifyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const expected = crypto.createHmac('sha256', jwtKey()).update(parts[0] + '.' + parts[1]).digest();
  const actual = Buffer.from(parts[2], 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error('Invalid token');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}

async function dbRpc(op, payload = {}) {
  const response = await fetch(SUPABASE_URL + '/rest/v1/rpc/barclays_bridge_rpc', {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      authorization: 'Bearer ' + SUPABASE_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ op, payload, bridge_key: BRIDGE_DB_KEY })
  });
  const raw = await response.text();
  if (!response.ok) throw new Error('Storage request failed (' + response.status + '): ' + raw.slice(0, 300));
  return raw ? JSON.parse(raw) : null;
}

async function getConfig() {
  return await dbRpc('get_config') || null;
}

async function requireBridgeSecret(secret) {
  const config = await getConfig();
  if (!config) throw new Error('Bridge is not configured yet');
  if (!verifyPassword(secret, config.bridge_login_hash)) throw new Error('Invalid bridge passphrase');
  return config;
}

async function plaidPost(path, body) {
  const config = await getConfig();
  if (!config) throw new Error('Bridge is not configured yet');
  const host = config.plaid_env === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com';
  const response = await fetch(host + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: config.plaid_client_id,
      secret: decryptSecret(config.encrypted_plaid_secret),
      ...body
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_message || data.error_code || ('Plaid request failed (' + response.status + ')'));
  return data;
}

async function gcCreateTokenWithSecrets(secretId, secretKey) {
  const response = await fetch('https://bankaccountdata.gocardless.com/api/v2/token/new/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ secret_id: secretId, secret_key: secretKey })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || data.summary || ('GoCardless authentication failed (' + response.status + ')'));
  if (!data.access) throw new Error('GoCardless did not return an access token');
  return data;
}

async function gcAccessToken() {
  const config = await getConfig();
  if (!config || config.provider !== 'gocardless') throw new Error('GoCardless is not configured');
  const secretId = decryptSecret(config.encrypted_gc_secret_id);
  const secretKey = decryptSecret(config.encrypted_gc_secret_key);
  const tokens = await gcCreateTokenWithSecrets(secretId, secretKey);
  return tokens.access;
}

async function gcFetch(path, options = {}, accessToken = null) {
  const token = accessToken || await gcAccessToken();
  const response = await fetch('https://bankaccountdata.gocardless.com' + path, {
    method: options.method || 'GET',
    headers: {
      accept: 'application/json',
      authorization: 'Bearer ' + token,
      ...(options.body ? { 'content-type': 'application/json' } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  const raw = await response.text();
  const data = raw ? (() => { try { return JSON.parse(raw); } catch { return { detail: raw }; } })() : {};
  if (!response.ok) throw new Error(data.detail || data.summary || ('GoCardless request failed (' + response.status + ')'));
  return data;
}

function gcAccountIds(connection) {
  const data = connection && connection.provider_data && typeof connection.provider_data === 'object' ? connection.provider_data : {};
  return Array.isArray(data.accounts) ? data.accounts : [];
}

function maskIdentifier(value) {
  const v = String(value || '').replace(/\s+/g, '');
  if (!v) return null;
  return v.length <= 4 ? v : '••••' + v.slice(-4);
}

async function tlConfig() {
  const config = await getConfig();
  if (!config || config.provider !== 'truelayer') throw new Error('TrueLayer is not configured');
  return {
    ...config,
    client_id: decryptSecret(config.encrypted_tl_client_id),
    client_secret: decryptSecret(config.encrypted_tl_client_secret),
    env: config.tl_env === 'sandbox' ? 'sandbox' : 'production'
  };
}

function tlAuthBase(env) {
  return env === 'sandbox' ? 'https://auth.truelayer-sandbox.com' : 'https://auth.truelayer.com';
}

function tlApiBase(env) {
  return env === 'sandbox' ? 'https://api.truelayer-sandbox.com' : 'https://api.truelayer.com';
}

async function tlTokenRequest(params, config = null) {
  const c = config || await tlConfig();
  const response = await fetch(tlAuthBase(c.env) + '/connect/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: c.client_id,
      client_secret: c.client_secret,
      ...params
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || ('TrueLayer token request failed (' + response.status + ')'));
  return data;
}

async function tlAccess(connection) {
  const c = await tlConfig();
  if (!connection.encrypted_access_token) throw new Error('Barclays authorisation has not completed yet');
  let bundle = JSON.parse(decryptSecret(connection.encrypted_access_token));
  if (Number(bundle.expires_at || 0) > Date.now() + 60_000 && bundle.access_token) {
    return { config: c, bundle };
  }
  if (!bundle.refresh_token) throw new Error('TrueLayer access expired; reconnect Barclays');
  const fresh = await tlTokenRequest({
    grant_type: 'refresh_token',
    refresh_token: bundle.refresh_token
  }, c);
  bundle = {
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token || bundle.refresh_token,
    expires_at: Date.now() + Number(fresh.expires_in || 3600) * 1000
  };
  await dbRpc('put_connection', {
    provider: 'truelayer',
    institution_id: connection.institution_id || 'uk-ob-barclays',
    institution_name: connection.institution_name || 'Barclays',
    item_id: connection.item_id,
    encrypted_access_token: encryptSecret(JSON.stringify(bundle)),
    consent_expiration_time: connection.consent_expiration_time || '',
    provider_data: connection.provider_data || { status: 'connected' }
  });
  return { config: c, bundle };
}

async function tlGet(connection, path) {
  const { config, bundle } = await tlAccess(connection);
  const response = await fetch(tlApiBase(config.env) + path, {
    headers: { authorization: 'Bearer ' + bundle.access_token, accept: 'application/json' }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || data.message || ('TrueLayer request failed (' + response.status + ')'));
  return data;
}

async function getConnection() {
  const row = await dbRpc('get_connection');
  if (!row) return null;
  if (row.provider === 'plaid' && row.encrypted_access_token) {
    return { ...row, access_token: decryptSecret(row.encrypted_access_token) };
  }
  return row;
}

async function bankStatus() {
  const c = await getConnection();
  const gcAccounts = c && c.provider === 'gocardless' ? gcAccountIds(c) : [];
  const connected = Boolean(c && (
    c.provider === 'gocardless' ? gcAccounts.length :
    c.provider === 'truelayer' ? Boolean(c.encrypted_access_token) :
    true
  ));
  return {
    connected,
    provider: c ? c.provider : null,
    institution_id: c ? c.institution_id : null,
    institution_name: c ? c.institution_name : null,
    consent_expiration_time: c ? c.consent_expiration_time : null,
    accounts_connected: c && c.provider === 'gocardless' ? gcAccounts.length : undefined
  };
}

async function listAccounts() {
  const c = await getConnection();
  if (!c) throw new Error('No bank is connected yet');

  if (c.provider === 'truelayer') {
    const data = await tlGet(c, '/data/v1/accounts');
    return (data.results || []).map((a) => ({
      account_id: a.account_id,
      display_name: a.display_name || null,
      account_type: a.account_type || null,
      currency: a.currency || null,
      account_number: a.account_number ? {
        number_masked: maskIdentifier(a.account_number.number),
        sort_code_masked: maskIdentifier(a.account_number.sort_code),
        iban_masked: maskIdentifier(a.account_number.iban)
      } : null,
      provider: a.provider || null
    }));
  }

  if (c.provider === 'gocardless') {
    const ids = gcAccountIds(c);
    if (!ids.length) throw new Error('Barclays authorisation has not completed yet');
    const access = await gcAccessToken();
    const rows = [];
    for (const id of ids) {
      const a = await gcFetch('/api/v2/accounts/' + encodeURIComponent(id) + '/', {}, access);
      rows.push({
        account_id: a.id || id,
        name: a.name || a.owner_name || 'Barclays account',
        owner_name: a.owner_name || null,
        iban_masked: maskIdentifier(a.iban),
        status: a.status || null,
        institution_id: a.institution_id || c.institution_id
      });
    }
    return rows;
  }

  const data = await plaidPost('/accounts/get', { access_token: c.access_token });
  return (data.accounts || []).map((a) => ({
    account_id: a.account_id,
    name: a.name,
    official_name: a.official_name,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    balances: a.balances
  }));
}

async function getBalances() {
  const c = await getConnection();
  if (!c) throw new Error('No bank is connected yet');

  if (c.provider === 'truelayer') {
    const accounts = await listAccounts();
    const rows = [];
    for (const account of accounts) {
      const data = await tlGet(c, '/data/v1/accounts/' + encodeURIComponent(account.account_id) + '/balance');
      rows.push({ account_id: account.account_id, balances: data.results || [] });
    }
    return rows;
  }

  if (c.provider === 'gocardless') {
    const ids = gcAccountIds(c);
    if (!ids.length) throw new Error('Barclays authorisation has not completed yet');
    const access = await gcAccessToken();
    const rows = [];
    for (const id of ids) {
      const data = await gcFetch('/api/v2/accounts/' + encodeURIComponent(id) + '/balances/', {}, access);
      rows.push({ account_id: id, balances: data.balances || [] });
    }
    return rows;
  }

  const data = await plaidPost('/accounts/balance/get', { access_token: c.access_token });
  return (data.accounts || []).map((a) => ({
    account_id: a.account_id,
    name: a.name,
    official_name: a.official_name,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    balances: a.balances
  }));
}

function gcTransaction(row, accountId, pending) {
  const amountObj = row.transactionAmount || row.transaction_amount || {};
  const amount = Number(amountObj.amount ?? row.amount ?? 0);
  return {
    transaction_id: row.transactionId || row.entryReference || row.internalTransactionId || null,
    account_id: accountId,
    date: row.bookingDate || row.valueDate || row.transactionDate || null,
    name: row.remittanceInformationUnstructured || row.additionalInformation || row.creditorName || row.debtorName || row.bankTransactionCode || 'Transaction',
    counterparty: row.creditorName || row.debtorName || null,
    amount,
    iso_currency_code: amountObj.currency || null,
    direction: amount < 0 ? 'out' : amount > 0 ? 'in' : 'unknown',
    pending,
    bank_transaction_code: row.bankTransactionCode || null
  };
}

async function getTransactions(input) {
  const c = await getConnection();
  if (!c) throw new Error('No bank is connected yet');
  const wanted = Math.max(1, Math.min(Number(input.limit || 100), 500));

  if (c.provider === 'truelayer') {
    const accounts = await listAccounts();
    const selected = Array.isArray(input.account_ids) && input.account_ids.length
      ? accounts.filter((a) => input.account_ids.includes(a.account_id))
      : accounts;
    const result = [];
    for (const account of selected) {
      const qs = new URLSearchParams();
      if (input.start_date) qs.set('from', input.start_date);
      if (input.end_date) qs.set('to', input.end_date);
      const data = await tlGet(c, '/data/v1/accounts/' + encodeURIComponent(account.account_id) + '/transactions?' + qs.toString());
      for (const t of data.results || []) {
        result.push({
          transaction_id: t.normalised_provider_transaction_id || t.transaction_id || t.provider_transaction_id || null,
          account_id: account.account_id,
          date: t.timestamp ? String(t.timestamp).slice(0, 10) : null,
          timestamp: t.timestamp || null,
          name: t.merchant_name || t.description || 'Transaction',
          description: t.description || null,
          amount: Number(t.amount || 0),
          iso_currency_code: t.currency || null,
          direction: t.transaction_type === 'DEBIT' ? 'out' : t.transaction_type === 'CREDIT' ? 'in' : null,
          category: t.transaction_category || null,
          classification: t.transaction_classification || [],
          running_balance: t.running_balance || null,
          pending: false
        });
      }
    }
    result.sort((a, b) => String(b.timestamp || b.date || '').localeCompare(String(a.timestamp || a.date || '')));
    return result.slice(0, wanted);
  }

  if (c.provider === 'gocardless') {
    const ids = gcAccountIds(c);
    if (!ids.length) throw new Error('Barclays authorisation has not completed yet');
    const selected = Array.isArray(input.account_ids) && input.account_ids.length
      ? ids.filter((id) => input.account_ids.includes(id))
      : ids;
    const access = await gcAccessToken();
    const result = [];
    for (const id of selected) {
      const qs = new URLSearchParams();
      if (input.start_date) qs.set('date_from', input.start_date);
      if (input.end_date) qs.set('date_to', input.end_date);
      const data = await gcFetch('/api/v2/accounts/' + encodeURIComponent(id) + '/transactions/?' + qs.toString(), {}, access);
      const tx = data.transactions || {};
      for (const row of tx.booked || []) result.push(gcTransaction(row, id, false));
      for (const row of tx.pending || []) result.push(gcTransaction(row, id, true));
    }
    result.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    return result.slice(0, wanted);
  }

  const result = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (result.length < wanted && offset < total) {
    const count = Math.min(100, wanted - result.length);
    const data = await plaidPost('/transactions/get', {
      access_token: c.access_token,
      start_date: input.start_date,
      end_date: input.end_date,
      options: {
        count,
        offset,
        ...(Array.isArray(input.account_ids) && input.account_ids.length ? { account_ids: input.account_ids } : {})
      }
    });
    total = Number(data.total_transactions || 0);
    const rows = data.transactions || [];
    result.push(...rows);
    offset += rows.length;
    if (!rows.length) break;
  }
  return result.slice(0, wanted).map((t) => ({
    transaction_id: t.transaction_id,
    account_id: t.account_id,
    date: t.date,
    authorized_date: t.authorized_date,
    name: t.name,
    merchant_name: t.merchant_name,
    amount: t.amount,
    iso_currency_code: t.iso_currency_code,
    pending: t.pending,
    category: t.category,
    personal_finance_category: t.personal_finance_category,
    payment_channel: t.payment_channel
  }));
}

function pageShell(title, content) {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><style>' +
    'body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0c1118;color:#eaf0f7;margin:0;padding:24px}.card{max-width:720px;margin:30px auto;background:#151d27;border:1px solid #263447;border-radius:18px;padding:24px;box-shadow:0 12px 40px #0007}h1{font-size:28px;margin-top:0}p{line-height:1.55;color:#c8d2df}label{display:block;margin:16px 0 6px;font-weight:650}input,select{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #3b4b61;background:#0f1620;color:#fff;font-size:16px}button,a.btn{display:inline-block;margin-top:18px;padding:12px 16px;border:0;border-radius:10px;background:#2f7cf6;color:#fff;font-weight:700;text-decoration:none;cursor:pointer}.muted{color:#90a0b3;font-size:14px}.ok{padding:10px;border-radius:10px;background:#153d2b;color:#c9ffe4}.err{padding:10px;border-radius:10px;background:#4a1e24;color:#ffd4d9}code{word-break:break-all}.row{display:flex;gap:12px;flex-wrap:wrap}.row>*{flex:1;min-width:220px}' +
    '</style></head><body><div class="card">' + content + '</div></body></html>';
}

function setupPage(message = '') {
  return pageShell('Barclays Bridge setup',
    '<h1>Barclays Bridge</h1><p>Secure one-time setup. Your Barclays password, PIN and one-time codes are never entered here.</p>' +
    (message ? '<div class="err">' + esc(message) + '</div>' : '') +
    '<form method="post" action="/setup"><label>One-time setup code</label><input name="bootstrap_code" required autocomplete="one-time-code">' +
    '<label>Open Banking provider</label><select id="provider" name="provider"><option value="truelayer" selected>TrueLayer — current recommended Barclays route</option><option value="gocardless">GoCardless Bank Account Data — existing accounts only</option><option value="plaid">Plaid — fallback</option></select>' +
    '<div id="tl-fields"><label>TrueLayer Client ID</label><input id="tl-id" name="tl_client_id" autocomplete="off">' +
    '<label>TrueLayer Client Secret</label><input id="tl-key" name="tl_client_secret" type="password" autocomplete="new-password">' +
    '<label>TrueLayer environment</label><select name="tl_env"><option value="production">Live (real Barclays account)</option><option value="sandbox">Sandbox (test data only)</option></select>' +
    '<p class="muted">In TrueLayer Console add this redirect URI exactly: <code>https://barclays-bridge.onrender.com/truelayer/return</code>. Enter the Client ID/Secret here directly — never send the secret in chat.</p></div>' +
    '<div id="gc-fields" style="display:none"><label>GoCardless User Secret ID</label><input id="gc-id" name="gc_secret_id" autocomplete="off">' +
    '<label>GoCardless Secret Key</label><input id="gc-key" name="gc_secret_key" type="password" autocomplete="new-password"></div>' +
    '<div id="plaid-fields" style="display:none"><label>Plaid Client ID</label><input id="plaid-id" name="plaid_client_id" autocomplete="off">' +
    '<label>Plaid Secret</label><input id="plaid-key" name="plaid_secret" type="password" autocomplete="new-password">' +
    '<label>Plaid environment</label><select name="plaid_env"><option value="production">Production</option><option value="sandbox">Sandbox</option></select></div>' +
    '<label>Bridge passphrase</label><input name="bridge_secret" type="password" minlength="12" required autocomplete="new-password">' +
    '<p class="muted">Choose a new passphrase used only to approve ChatGPT read-only access. Do not reuse your Barclays password.</p>' +
    '<button type="submit">Save secure setup</button></form>' +
    '<script>const p=document.getElementById("provider"),tlf=document.getElementById("tl-fields"),g=document.getElementById("gc-fields"),q=document.getElementById("plaid-fields"),ti=document.getElementById("tl-id"),tk=document.getElementById("tl-key"),gi=document.getElementById("gc-id"),gk=document.getElementById("gc-key"),pi=document.getElementById("plaid-id"),pk=document.getElementById("plaid-key");function t(){const v=p.value;tlf.style.display=v==="truelayer"?"block":"none";g.style.display=v==="gocardless"?"block":"none";q.style.display=v==="plaid"?"block":"none";ti.required=tk.required=v==="truelayer";gi.required=gk.required=v==="gocardless";pi.required=pk.required=v==="plaid"}p.onchange=t;t();</script>');
}

function connectPage(config) {
  if (config && config.provider === 'truelayer') {
    return pageShell('Connect Barclays',
      '<h1>Connect Barclays</h1><p>This uses TrueLayer Open Banking. You will be sent to TrueLayer/Barclays to choose the account and approve read-only access.</p>' +
      '<label>Bridge passphrase</label><input id="secret" type="password" autocomplete="current-password"><button id="connect">Continue to Barclays</button>' +
      '<div id="status" class="muted" style="margin-top:14px"></div>' +
      '<script>const status=document.getElementById("status"),secret=document.getElementById("secret");document.getElementById("connect").onclick=async()=>{try{status.textContent="Preparing Barclays authorisation...";const r=await fetch("/truelayer/start",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({bridge_secret:secret.value})});const j=await r.json();if(!r.ok)throw new Error(j.error||"Could not start");location.href=j.link}catch(e){status.textContent=e.message}};</script>');
  }

  if (config && config.provider === 'gocardless') {
    return pageShell('Connect Barclays',
      '<h1>Connect Barclays</h1><p>This uses UK Open Banking through GoCardless. Barclays authentication happens on the bank connection flow; this bridge never receives your Barclays password or PIN.</p>' +
      '<label>Bridge passphrase</label><input id="secret" type="password" autocomplete="current-password"><button id="load">Find Barclays connections</button>' +
      '<div id="pick" style="display:none"><label>Barclays connection</label><select id="bank"></select><button id="connect">Continue to Barclays</button></div>' +
      '<div id="status" class="muted" style="margin-top:14px"></div>' +
      '<script>const status=document.getElementById("status"),secret=document.getElementById("secret"),pick=document.getElementById("pick"),bank=document.getElementById("bank");' +
      'document.getElementById("load").onclick=async()=>{try{status.textContent="Checking available Barclays connections...";const r=await fetch("/gocardless/banks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({bridge_secret:secret.value})});const j=await r.json();if(!r.ok)throw new Error(j.error||"Could not load banks");bank.innerHTML="";for(const x of j.banks){const o=document.createElement("option");o.value=x.id;o.textContent=x.name;bank.appendChild(o)}if(!j.banks.length)throw new Error("No Barclays connection is currently available");pick.style.display="block";status.textContent="Choose the Barclays connection that matches your account."; }catch(e){status.textContent=e.message}};' +
      'document.getElementById("connect").onclick=async()=>{try{const opt=bank.options[bank.selectedIndex];status.textContent="Creating secure Barclays authorisation...";const r=await fetch("/gocardless/start",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({bridge_secret:secret.value,institution_id:bank.value,institution_name:opt&&opt.textContent})});const j=await r.json();if(!r.ok)throw new Error(j.error||"Could not start");location.href=j.link}catch(e){status.textContent=e.message}};</script>');
  }

  return pageShell('Connect Barclays',
    '<h1>Connect Barclays</h1><p>This uses UK Open Banking through Plaid. You authenticate with Barclays on the bank connection screen.</p>' +
    '<label>Bridge passphrase</label><input id="secret" type="password" autocomplete="current-password"><button id="connect">Connect Barclays</button>' +
    '<div id="status" class="muted" style="margin-top:14px"></div>' +
    '<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script><script>' +
    'const status=document.getElementById("status");const secret=document.getElementById("secret");' +
    'async function exchange(public_token,metadata,s){const r=await fetch("/exchange",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({bridge_secret:s,public_token,institution_id:metadata.institution&&metadata.institution.institution_id,institution_name:metadata.institution&&metadata.institution.name})});const j=await r.json();if(!r.ok)throw new Error(j.error||"Exchange failed");sessionStorage.removeItem("bb_link_token");sessionStorage.removeItem("bb_secret");status.textContent="Connected to "+(j.institution_name||"Barclays")+".";}' +
    'function openLink(token,s,redirect){const h=Plaid.create({token,receivedRedirectUri:redirect||undefined,onSuccess:(pt,m)=>exchange(pt,m,s).catch(e=>status.textContent=e.message),onExit:(e)=>{if(e)status.textContent=e.error_message||"Connection closed";}});h.open();}' +
    'document.getElementById("connect").onclick=async()=>{try{status.textContent="Preparing secure connection...";const s=secret.value;const r=await fetch("/link-token",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({bridge_secret:s})});const j=await r.json();if(!r.ok)throw new Error(j.error||"Could not start");sessionStorage.setItem("bb_link_token",j.link_token);sessionStorage.setItem("bb_secret",s);openLink(j.link_token,s); }catch(e){status.textContent=e.message;}};' +
    'if(location.search.includes("oauth_state_id=")){const t=sessionStorage.getItem("bb_link_token");const s=sessionStorage.getItem("bb_secret");if(t&&s){status.textContent="Completing Barclays authorisation...";openLink(t,s,location.href);}}' +
    '</script>');
}

function oauthAuthorizePage(params, message = '') {
  const hidden = ['client_id','redirect_uri','state','scope','resource','response_type','code_challenge','code_challenge_method'].map((k) => '<input type="hidden" name="' + k + '" value="' + esc(params[k] || '') + '">').join('');
  return pageShell('Authorize ChatGPT',
    '<h1>Authorize read-only access</h1><p>ChatGPT is requesting permission to read your connected Barclays account data through Barclays Bridge.</p>' +
    '<p><strong>Allowed:</strong> account list, balances and transactions.<br><strong>Not allowed:</strong> payments, transfers, card controls or investing.</p>' +
    (message ? '<div class="err">' + esc(message) + '</div>' : '') +
    '<form method="post" action="/oauth/authorize">' + hidden + '<label>Bridge passphrase</label><input type="password" name="bridge_secret" required autocomplete="current-password"><button type="submit">Authorize read-only access</button></form>');
}

function oauthRedirect(res, redirectUri, params) {
  const u = new URL(redirectUri);
  Object.entries(params).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v)); });
  res.writeHead(302, { location: u.toString(), 'cache-control': 'no-store' });
  res.end();
}

function validateRedirect(uri) {
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:' && ['localhost','127.0.0.1','::1'].includes(u.hostname)) return true;
  } catch {}
  return false;
}

function rpcResponse(res, id, result) {
  json(res, 200, { jsonrpc: '2.0', id, result });
}

function rpcError(res, id, code, message, status = 200, headers = {}) {
  json(res, status, { jsonrpc: '2.0', id, error: { code, message } }, headers);
}

const mcpTools = [
  { name:'bank_status', title:'Barclays connection status', description:'Check whether the Barclays/Open Banking connection is active. Read-only.', inputSchema:{type:'object',properties:{},additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false} },
  { name:'list_accounts', title:'List Barclays accounts', description:'List connected account metadata and balances. Read-only.', inputSchema:{type:'object',properties:{},additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'get_balances', title:'Get Barclays balances', description:'Get current and available balances. Read-only.', inputSchema:{type:'object',properties:{},additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} },
  { name:'get_transactions', title:'Get Barclays transactions', description:'Read transactions for a date range. Plaid amounts are normally positive for money out and negative for money in. Read-only.', inputSchema:{type:'object',required:['start_date','end_date'],additionalProperties:false,properties:{start_date:{type:'string',description:'YYYY-MM-DD'},end_date:{type:'string',description:'YYYY-MM-DD'},account_ids:{type:'array',items:{type:'string'}},limit:{type:'integer',minimum:1,maximum:500,default:100}}}, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} }
];

async function handle(req, res) {
  const url = new URL(req.url || '/', baseUrl(req));
  const path = url.pathname;

  if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true, service: 'barclays-bridge', version: '0.5.0' });

  if (req.method === 'GET' && path === '/') {
    const config = await getConfig().catch(() => null);
    const status = await bankStatus().catch(() => ({ connected: false }));
    return html(res, 200, pageShell('Barclays Bridge',
      '<h1>Barclays Bridge</h1><p>Read-only UK Open Banking bridge for ChatGPT.</p>' +
      '<p>Configured: <strong>' + (config ? 'yes' : 'no') + '</strong><br>Bank connected: <strong>' + (status.connected ? 'yes' : 'no') + '</strong></p>' +
      '<div class="row"><a class="btn" href="/setup">Setup</a><a class="btn" href="/connect">Connect Barclays</a></div><p class="muted">This service contains no payment or transfer tools.</p>'));
  }

  if (req.method === 'GET' && path === '/setup') return html(res, 200, setupPage());

  if (req.method === 'POST' && path === '/setup') {
    const form = await bodyForm(req);
    const code = String(form.bootstrap_code || '').trim().toUpperCase();
    const bootstrap = await dbRpc('get_bootstrap', { code });
    if (!bootstrap || bootstrap.used || new Date(bootstrap.expires_at).getTime() <= Date.now()) return html(res, 403, setupPage('Setup code is invalid, expired or already used.'));

    const provider = ['truelayer','gocardless','plaid'].includes(form.provider) ? form.provider : 'truelayer';
    const bridgeSecret = String(form.bridge_secret || '');
    if (bridgeSecret.length < 12) return html(res, 400, setupPage('Use a bridge passphrase of at least 12 characters.'));

    const common = {
      bridge_login_hash: makePasswordHash(bridgeSecret),
      plaid_client_id: '',
      encrypted_plaid_secret: '',
      plaid_env: '',
      encrypted_gc_secret_id: '',
      encrypted_gc_secret_key: '',
      encrypted_tl_client_id: '',
      encrypted_tl_client_secret: '',
      tl_env: ''
    };

    if (provider === 'truelayer') {
      const clientId = String(form.tl_client_id || '').trim();
      const clientSecret = String(form.tl_client_secret || '').trim();
      const tlEnv = form.tl_env === 'sandbox' ? 'sandbox' : 'production';
      if (!clientId || !clientSecret) return html(res, 400, setupPage('Enter the TrueLayer Client ID and Client Secret.'));
      await dbRpc('put_config', {
        ...common,
        provider: 'truelayer',
        encrypted_tl_client_id: encryptSecret(clientId),
        encrypted_tl_client_secret: encryptSecret(clientSecret),
        tl_env: tlEnv
      });
    } else if (provider === 'gocardless') {
      const secretId = String(form.gc_secret_id || '').trim();
      const secretKey = String(form.gc_secret_key || '').trim();
      if (!secretId || !secretKey) return html(res, 400, setupPage('Enter both GoCardless User Secret values.'));
      try { await gcCreateTokenWithSecrets(secretId, secretKey); }
      catch (e) { return html(res, 400, setupPage('GoCardless credentials could not be verified: ' + e.message)); }
      await dbRpc('put_config', {
        ...common,
        provider: 'gocardless',
        encrypted_gc_secret_id: encryptSecret(secretId),
        encrypted_gc_secret_key: encryptSecret(secretKey)
      });
    } else {
      const clientId = String(form.plaid_client_id || '').trim();
      const plaidSecret = String(form.plaid_secret || '').trim();
      const plaidEnv = form.plaid_env === 'sandbox' ? 'sandbox' : 'production';
      if (!clientId || !plaidSecret) return html(res, 400, setupPage('Enter the Plaid Client ID and Secret.'));
      await dbRpc('put_config', {
        ...common,
        provider: 'plaid',
        plaid_client_id: clientId,
        encrypted_plaid_secret: encryptSecret(plaidSecret),
        plaid_env: plaidEnv
      });
    }

    const used = await dbRpc('use_bootstrap', { code });
    if (!used || !used.ok) throw new Error('Could not consume setup code');
    return html(res, 200, pageShell('Setup complete', '<h1>Setup complete</h1><div class="ok">Open Banking credentials were stored encrypted. The one-time setup code is now disabled.</div><p><a class="btn" href="/connect">Connect Barclays</a></p>'));
  }

  if (req.method === 'GET' && path === '/connect') {
    const config = await getConfig().catch(() => null);
    if (!config) return html(res, 400, pageShell('Setup required', '<h1>Setup required</h1><p>Complete the one-time setup first.</p><a class="btn" href="/setup">Open setup</a>'));
    return html(res, 200, connectPage(config));
  }

  if (req.method === 'POST' && path === '/truelayer/start') {
    const body = await bodyJson(req);
    const config = await requireBridgeSecret(body.bridge_secret || '');
    if (config.provider !== 'truelayer') return json(res, 400, { error: 'TrueLayer is not the configured provider' });
    const tc = await tlConfig();
    const state = crypto.randomBytes(24).toString('base64url');
    const redirectUri = baseUrl(req) + '/truelayer/return';
    await dbRpc('put_connection', {
      provider: 'truelayer',
      institution_id: tc.env === 'production' ? 'uk-ob-barclays' : 'sandbox',
      institution_name: tc.env === 'production' ? 'Barclays' : 'TrueLayer Sandbox',
      item_id: state,
      encrypted_access_token: '',
      consent_expiration_time: '',
      provider_data: { status: 'pending', redirect_uri: redirectUri }
    });
    const auth = new URL(tlAuthBase(tc.env) + '/');
    auth.searchParams.set('response_type', 'code');
    auth.searchParams.set('client_id', tc.client_id);
    auth.searchParams.set('scope', 'accounts balance transactions offline_access');
    auth.searchParams.set('redirect_uri', redirectUri);
    auth.searchParams.set('state', state);
    if (tc.env === 'production') auth.searchParams.set('providers', 'uk-ob-barclays');
    return json(res, 200, { link: auth.toString() });
  }

  if (req.method === 'GET' && path === '/truelayer/return') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const c = await getConnection();
    if (!code || !state || !c || c.provider !== 'truelayer' || !timingSafeString(state, c.item_id)) {
      return html(res, 400, pageShell('TrueLayer connection error', '<h1>Could not verify the Barclays return</h1><p>The authorisation state did not match. Start the connection again.</p><a class="btn" href="/connect">Try again</a>'));
    }
    try {
      const tc = await tlConfig();
      const redirectUri = baseUrl(req) + '/truelayer/return';
      const tokens = await tlTokenRequest({
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code
      }, tc);
      const bundle = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        expires_at: Date.now() + Number(tokens.expires_in || 3600) * 1000
      };
      let institutionId = tc.env === 'production' ? 'uk-ob-barclays' : 'sandbox';
      let institutionName = tc.env === 'production' ? 'Barclays' : 'TrueLayer Sandbox';
      let consentExpiration = '';
      try {
        const response = await fetch(tlApiBase(tc.env) + '/data/v1/me', {
          headers: { authorization: 'Bearer ' + bundle.access_token, accept: 'application/json' }
        });
        const meta = await response.json();
        const row = Array.isArray(meta.results) ? meta.results[0] : null;
        if (row && row.provider) {
          institutionId = row.provider.provider_id || institutionId;
          institutionName = row.provider.display_name || row.provider.logo_uri || institutionName;
        }
        consentExpiration = row && row.consent_expires_at ? row.consent_expires_at : '';
      } catch {}
      await dbRpc('put_connection', {
        provider: 'truelayer',
        institution_id: institutionId,
        institution_name: institutionName,
        item_id: state,
        encrypted_access_token: encryptSecret(JSON.stringify(bundle)),
        consent_expiration_time: consentExpiration,
        provider_data: { status: 'connected' }
      });
      return html(res, 200, pageShell('Barclays connected', '<h1>Barclays connected</h1><div class="ok">TrueLayer returned a read-only bank-data connection successfully.</div><p>You can close this page. The next step is connecting the MCP endpoint to ChatGPT.</p>'));
    } catch (e) {
      return html(res, 500, pageShell('TrueLayer connection error', '<h1>Could not finish the Barclays connection</h1><div class="err">' + esc(e.message) + '</div><p>Check that the redirect URI is registered in TrueLayer Console and that the app has live Data access.</p><a class="btn" href="/connect">Try again</a>'));
    }
  }

  if (req.method === 'POST' && path === '/gocardless/banks')

if (req.method === 'POST' && path === '/gocardless/banks') {
    const body = await bodyJson(req);
    const config = await requireBridgeSecret(body.bridge_secret || '');
    if (config.provider !== 'gocardless') return json(res, 400, { error: 'GoCardless is not the configured provider' });
    const access = await gcAccessToken();
    const institutions = await gcFetch('/api/v2/institutions/?country=gb', {}, access);
    const banks = (Array.isArray(institutions) ? institutions : [])
      .filter((b) => /barclays/i.test(String(b.name || '')) && !/barclaycard/i.test(String(b.name || '')))
      .map((b) => ({ id: b.id, name: b.name }))
      .sort((a,b) => a.name.localeCompare(b.name));
    return json(res, 200, { banks });
  }

  if (req.method === 'POST' && path === '/gocardless/start') {
    const body = await bodyJson(req);
    const config = await requireBridgeSecret(body.bridge_secret || '');
    if (config.provider !== 'gocardless') return json(res, 400, { error: 'GoCardless is not the configured provider' });
    const access = await gcAccessToken();
    const institutions = await gcFetch('/api/v2/institutions/?country=gb', {}, access);
    const selected = (Array.isArray(institutions) ? institutions : []).find((b) =>
      b.id === body.institution_id &&
      /barclays/i.test(String(b.name || '')) &&
      !/barclaycard/i.test(String(b.name || ''))
    );
    if (!selected) return json(res, 400, { error: 'Choose a valid Barclays connection' });
    const requisition = await gcFetch('/api/v2/requisitions/', {
      method: 'POST',
      body: {
        redirect: baseUrl(req) + '/gocardless/return',
        institution_id: selected.id,
        reference: 'barclays-bridge-' + crypto.randomUUID(),
        user_language: 'EN'
      }
    }, access);
    await dbRpc('put_connection', {
      provider: 'gocardless',
      institution_id: selected.id,
      institution_name: selected.name,
      item_id: requisition.id,
      encrypted_access_token: '',
      consent_expiration_time: '',
      provider_data: { status: 'pending', accounts: [] }
    });
    return json(res, 200, { link: requisition.link });
  }

  if (req.method === 'GET' && path === '/gocardless/return') {
    const c = await getConnection();
    if (!c || c.provider !== 'gocardless') return html(res, 400, pageShell('No connection', '<h1>No pending Barclays connection</h1>'));
    try {
      const access = await gcAccessToken();
      const requisition = await gcFetch('/api/v2/requisitions/' + encodeURIComponent(c.item_id) + '/', {}, access);
      const accounts = Array.isArray(requisition.accounts) ? requisition.accounts : [];
      const status = typeof requisition.status === 'string' ? requisition.status : (requisition.status && (requisition.status.short || requisition.status.code)) || '';
      if (!accounts.length) {
        return html(res, 409, pageShell('Barclays connection', '<h1>Authorisation not complete</h1><p>The bank connection returned, but no accounts are linked yet. Status: <strong>' + esc(status || 'unknown') + '</strong>.</p><a class="btn" href="/connect">Try again</a>'));
      }
      await dbRpc('put_connection', {
        provider: 'gocardless',
        institution_id: c.institution_id,
        institution_name: c.institution_name,
        item_id: c.item_id,
        encrypted_access_token: '',
        consent_expiration_time: '',
        provider_data: { status: status || 'LN', accounts }
      });
      return html(res, 200, pageShell('Barclays connected', '<h1>Barclays connected</h1><div class="ok">Read-only Open Banking access is active for ' + accounts.length + ' account' + (accounts.length === 1 ? '' : 's') + '.</div><p>You can close this page. Next, connect the MCP endpoint to ChatGPT.</p>'));
    } catch (e) {
      return html(res, 500, pageShell('Barclays connection error', '<h1>Could not finish connection</h1><div class="err">' + esc(e.message) + '</div><a class="btn" href="/connect">Try again</a>'));
    }
  }

  if (req.method === 'POST' && path === '/link-token') {
    const body = await bodyJson(req);
    await requireBridgeSecret(body.bridge_secret || '');
    const data = await plaidPost('/link/token/create', {
      user: { client_user_id: 'barclays-bridge-owner' },
      client_name: 'Barclays Bridge',
      products: ['transactions'],
      country_codes: ['GB'],
      language: 'en',
      redirect_uri: baseUrl(req) + '/connect',
      transactions: { days_requested: 365 }
    });
    return json(res, 200, { link_token: data.link_token, expiration: data.expiration });
  }

  if (req.method === 'POST' && path === '/exchange') {
    const body = await bodyJson(req);
    await requireBridgeSecret(body.bridge_secret || '');
    if (!body.public_token) return json(res, 400, { error: 'Missing public_token' });
    const exchanged = await plaidPost('/item/public_token/exchange', { public_token: body.public_token });
    let consentExpiration = null;
    try {
      const item = await plaidPost('/item/get', { access_token: exchanged.access_token });
      consentExpiration = item && item.item ? item.item.consent_expiration_time : null;
    } catch {}
    await dbRpc('put_connection', {
      institution_id: body.institution_id || null,
      institution_name: body.institution_name || null,
      item_id: exchanged.item_id,
      encrypted_access_token: encryptSecret(exchanged.access_token),
      consent_expiration_time: consentExpiration || ''
    });
    return json(res, 200, { ok: true, institution_name: body.institution_name || null });
  }

  if (req.method === 'POST' && path === '/disconnect') {
    const body = await bodyJson(req);
    await requireBridgeSecret(body.bridge_secret || '');
    const c = await getConnection();
    if (c) {
      if (c.provider === 'plaid' && c.access_token) {
        try { await plaidPost('/item/remove', { access_token: c.access_token }); } catch {}
      } else if (c.provider === 'gocardless') {
        try {
          const access = await gcAccessToken();
          await gcFetch('/api/v2/requisitions/' + encodeURIComponent(c.item_id) + '/', { method: 'DELETE' }, access);
        } catch {}
      }
      await dbRpc('delete_connection');
    }
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && path === '/.well-known/oauth-protected-resource') {
    const base = baseUrl(req);
    return json(res, 200, { resource: base + '/mcp', authorization_servers: [base], scopes_supported: ['bank.read'], bearer_methods_supported: ['header'] });
  }

  if (req.method === 'GET' && path === '/.well-known/oauth-authorization-server') {
    const base = baseUrl(req);
    return json(res, 200, {
      issuer: base,
      authorization_endpoint: base + '/oauth/authorize',
      token_endpoint: base + '/oauth/token',
      registration_endpoint: base + '/oauth/register',
      scopes_supported: ['bank.read'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none']
    });
  }

  if (req.method === 'POST' && path === '/oauth/register') {
    const body = await bodyJson(req);
    const redirects = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter(validateRedirect) : [];
    if (!redirects.length || redirects.length > 10) return json(res, 400, { error: 'invalid_redirect_uris' });
    const clientId = crypto.randomUUID();
    await dbRpc('register_oauth_client', {
      client_id: clientId,
      client_name: String(body.client_name || 'MCP client').slice(0, 120),
      redirect_uris: redirects,
      token_endpoint_auth_method: 'none'
    });
    return json(res, 201, { client_id: clientId, client_name: body.client_name || 'MCP client', redirect_uris: redirects, token_endpoint_auth_method: 'none' });
  }

  if (req.method === 'GET' && path === '/oauth/authorize') {
    const params = Object.fromEntries(url.searchParams.entries());
    if (params.response_type !== 'code' || !params.client_id || !params.redirect_uri || !params.code_challenge || params.code_challenge_method !== 'S256') return text(res, 400, 'Invalid OAuth request');
    const client = await dbRpc('get_oauth_client', { client_id: params.client_id });
    if (!client || !Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(params.redirect_uri)) return text(res, 400, 'Invalid OAuth client or redirect URI');
    return html(res, 200, oauthAuthorizePage(params));
  }

  if (req.method === 'POST' && path === '/oauth/authorize') {
    const form = await bodyForm(req);
    const client = await dbRpc('get_oauth_client', { client_id: form.client_id });
    if (!client || !Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(form.redirect_uri)) return text(res, 400, 'Invalid OAuth client or redirect URI');
    try { await requireBridgeSecret(form.bridge_secret || ''); }
    catch (e) { return html(res, 403, oauthAuthorizePage(form, e.message)); }
    const code = crypto.randomBytes(32).toString('base64url');
    await dbRpc('save_oauth_code', {
      code,
      client_id: form.client_id,
      redirect_uri: form.redirect_uri,
      code_challenge: form.code_challenge,
      scope: 'bank.read',
      resource: form.resource || (baseUrl(req) + '/mcp'),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    });
    return oauthRedirect(res, form.redirect_uri, { code, state: form.state || '' });
  }

  if (req.method === 'POST' && path === '/oauth/token') {
    const form = await bodyForm(req);
    if (form.grant_type !== 'authorization_code' || !form.code || !form.code_verifier || !form.client_id) return json(res, 400, { error: 'invalid_request' });
    const row = await dbRpc('get_oauth_code', { code: form.code });
    if (!row || row.used || row.client_id !== form.client_id || row.redirect_uri !== form.redirect_uri || new Date(row.expires_at).getTime() <= Date.now()) return json(res, 400, { error: 'invalid_grant' });
    const challenge = crypto.createHash('sha256').update(String(form.code_verifier)).digest('base64url');
    if (!timingSafeString(challenge, row.code_challenge)) return json(res, 400, { error: 'invalid_grant' });
    const marked = await dbRpc('mark_oauth_code_used', { code: form.code });
    if (!marked || !marked.ok) return json(res, 400, { error: 'invalid_grant' });
    const token = signJwt({ sub: 'barclays-bridge-owner', scope: 'bank.read', aud: row.resource || (baseUrl(req) + '/mcp') });
    return json(res, 200, { access_token: token, token_type: 'Bearer', expires_in: 2592000, scope: 'bank.read' });
  }

  if (path === '/mcp' && req.method === 'GET') return text(res, 405, 'Use MCP Streamable HTTP POST requests.', { allow: 'POST' });

  if (path === '/mcp' && req.method === 'POST') {
    let body;
    try { body = await bodyJson(req); } catch { return rpcError(res, null, -32700, 'Parse error', 400); }
    if (body && body.method === 'initialize') return rpcResponse(res, body.id, { protocolVersion: (body.params && body.params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'barclays-bridge', version: '0.5.0' }, instructions: 'Read-only Barclays bridge. No payment or transfer tools exist.' });
    if (body && body.method === 'notifications/initialized') { res.writeHead(204); return res.end(); }
    const auth = String(req.headers.authorization || '');
    try {
      if (!auth.startsWith('Bearer ')) throw new Error('missing');
      const payload = verifyJwt(auth.slice(7));
      if (!String(payload.scope || '').split(/\s+/).includes('bank.read')) throw new Error('scope');
      if (payload.aud && payload.aud !== baseUrl(req) + '/mcp') throw new Error('audience');
    } catch {
      return rpcError(res, body ? body.id : null, -32001, 'Authentication required', 401, { 'www-authenticate': 'Bearer resource_metadata="' + baseUrl(req) + '/.well-known/oauth-protected-resource"' });
    }
    try {
      if (body.method === 'tools/list') return rpcResponse(res, body.id, { tools: mcpTools });
      if (body.method === 'ping') return rpcResponse(res, body.id, {});
      if (body.method === 'tools/call') {
        const name = body.params && body.params.name;
        const args = (body.params && body.params.arguments) || {};
        let data;
        if (name === 'bank_status') data = await bankStatus();
        else if (name === 'list_accounts') data = await listAccounts();
        else if (name === 'get_balances') data = await getBalances();
        else if (name === 'get_transactions') {
          if (!args.start_date || !args.end_date) throw new Error('start_date and end_date are required');
          data = await getTransactions(args);
        } else throw new Error('Unknown tool: ' + name);
        return rpcResponse(res, body.id, { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: { data }, isError: false });
      }
      return rpcError(res, body.id ?? null, -32601, 'Method not found');
    } catch (e) {
      return rpcResponse(res, body.id ?? null, { content: [{ type: 'text', text: e.message || 'Tool failed' }], isError: true });
    }
  }

  return json(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: 'Internal server error' });
    else res.end();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Barclays Bridge listening on port ' + PORT);
});
