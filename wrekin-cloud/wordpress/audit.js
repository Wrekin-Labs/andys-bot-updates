function redact(event) {
  const clone = JSON.parse(JSON.stringify(event || {}));
  for (const key of ['password', 'secret', 'apiKey', 'token', 'authorization']) {
    if (Object.prototype.hasOwnProperty.call(clone, key)) clone[key] = '[redacted]';
  }
  return clone;
}

function createAuditSink({ endpoint, token, fetchImpl = fetch } = {}) {
  if (!endpoint) return async () => {};
  return async event => {
    const safe = { ...redact(event), createdAt: new Date().toISOString() };
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {})
      },
      body: JSON.stringify(safe)
    });
    if (!response.ok) throw new Error('audit_write_failed');
  };
}

module.exports = { createAuditSink, redact };
