const net = require('net');

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return false;
  const [a,b] = parts;
  return a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0;
}

function assertSafeWordPressUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('invalid_site_url'); }
  if (url.protocol !== 'https:') throw new Error('https_required');
  if (url.username || url.password) throw new Error('credentials_in_url_forbidden');
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local')) throw new Error('private_host_forbidden');
  if (net.isIP(host) && (isPrivateIpv4(host) || host === '::1')) throw new Error('private_host_forbidden');
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.origin;
}

module.exports = { assertSafeWordPressUrl, isPrivateIpv4 };
