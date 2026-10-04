const ALLOWED_PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /^web\.push\.apple\.com$/,
  /(^|\.)push\.apple\.com$/
];

export function isAllowedPushEndpoint(endpoint) {
  try {
    const url = new URL(String(endpoint || ""));
    return url.protocol === "https:" && ALLOWED_PUSH_HOSTS.some(rx => rx.test(url.hostname.toLowerCase()));
  } catch {
    return false;
  }
}

export function buildPushPayload(row) {
  const notificationId = String(row?.notification_id || "");
  const conversationId = row?.conversation_id ? String(row.conversation_id) : null;
  const rawTitle = String(row?.title || "");
  const title = rawTitle.startsWith("Urgent:")
    ? "Urgent: DeskRoute needs you"
    : String(row?.kind || "") === "assigned"
      ? "DeskRoute assignment"
      : "DeskRoute needs you";

  return JSON.stringify({
    title,
    body: "Open DeskRoute to view the customer message.",
    tag: "conv-" + String(conversationId || notificationId),
    url: conversationId
      ? "./?deskroute_notification=" + encodeURIComponent(notificationId) + "#inbox/" + encodeURIComponent(conversationId)
      : "./?deskroute_notification=" + encodeURIComponent(notificationId) + "#alerts",
    notification_id: notificationId,
    conversation_id: conversationId,
    renotify: rawTitle.startsWith("Urgent:")
  });
}

export function classifyPushResult(status, attempts = 1) {
  const code = Number(status || 0);
  const tries = Math.max(1, Number(attempts || 1));
  if (code >= 200 && code < 300) return { state: "delivered", terminal: true };
  if (code === 404 || code === 410) return { state: "failed", terminal: true, disableDevice: true };
  if (tries >= 3) return { state: "failed", terminal: true };
  if (code === 413) return { state: "pending", terminal: false, stripPreview: true };
  if (code === 429 || code >= 500 || code === 0) return { state: "pending", terminal: false };
  return { state: "failed", terminal: true };
}

export function retryDelayMs(attempts = 1) {
  const values = [60000, 300000, 900000];
  const index = Math.max(0, Math.min(values.length - 1, Number(attempts || 1) - 1));
  return values[index];
}
