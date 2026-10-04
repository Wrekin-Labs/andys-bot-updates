
export function parseStripeSignature(header) {
  const parts = String(header || '').split(',').map(x => x.trim()).filter(Boolean);
  const out = { timestamp: 0, signatures: [] };
  for (const part of parts) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const key = part.slice(0, i), value = part.slice(i + 1);
    if (key === 't') out.timestamp = Number(value || 0);
    if (key === 'v1' && /^[0-9a-f]{64}$/i.test(value)) out.signatures.push(value.toLowerCase());
  }
  return out;
}

export function constantTimeHexEqual(a, b) {
  a = String(a || '').toLowerCase();
  b = String(b || '').toLowerCase();
  if (a.length !== b.length || !/^[0-9a-f]+$/i.test(a + b)) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(String(message || '')));
  return [...new Uint8Array(signature)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function verifyStripeSignature(rawBody, header, secret, nowSeconds = Math.floor(Date.now()/1000), toleranceSeconds = 300) {
  const parsed = parseStripeSignature(header);
  if (!parsed.timestamp || !parsed.signatures.length || !secret) return false;
  if (Math.abs(Number(nowSeconds) - parsed.timestamp) > toleranceSeconds) return false;
  const expected = await hmacSha256Hex(secret, parsed.timestamp + '.' + String(rawBody || ''));
  return parsed.signatures.some(sig => constantTimeHexEqual(sig, expected));
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

export function stripeTimestamp(value) {
  const n = Number(value || 0);
  return n > 0 ? new Date(n * 1000).toISOString() : null;
}

export function invoiceSubscriptionId(invoice) {
  if (typeof invoice?.subscription === 'string') return invoice.subscription;
  const parent = invoice?.parent?.subscription_details?.subscription;
  return typeof parent === 'string' ? parent : null;
}

export function mapStripeSubscriptionStatus(value) {
  switch (String(value || '')) {
    case 'active': return 'active';
    case 'trialing': return 'trialing';
    case 'paused': return 'paused';
    case 'canceled': return 'cancelled';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
    case 'incomplete_expired':
      return 'past_due';
    default:
      return 'past_due';
  }
}
