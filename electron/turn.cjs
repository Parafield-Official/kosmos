const fs = require("node:fs");
const path = require("node:path");

const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

function loadTurnSecrets(extraPaths = []) {
  const fromEnv = {
    keyId: process.env.CLOUDFLARE_TURN_KEY_ID,
    token: process.env.CLOUDFLARE_TURN_API_TOKEN,
  };
  if (fromEnv.keyId && fromEnv.token) {
    return fromEnv;
  }
  const candidates = [
    ...extraPaths,
    path.join(__dirname, "..", ".local", "cloudflare-turn.json"),
  ];
  for (const file of candidates) {
    if (!file || !fs.existsSync(file)) {
      continue;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed.keyId && parsed.token) {
        return { keyId: parsed.keyId, token: parsed.token };
      }
    } catch {
      // Ignore a broken local file and try the next path.
    }
  }
  return null;
}

function sanitizeIceServers(iceServers) {
  if (!Array.isArray(iceServers)) {
    return [...STUN_SERVERS];
  }
  const cleaned = [];
  for (const row of iceServers) {
    const urls = (Array.isArray(row?.urls) ? row.urls : [row?.urls])
      .filter((url) => typeof url === "string" && url.length > 0 && !url.includes(":53"));
    if (urls.length === 0) {
      continue;
    }
    if (row.username && row.credential) {
      cleaned.push({ urls, username: row.username, credential: row.credential });
    } else {
      cleaned.push({ urls });
    }
  }
  const hasStun = cleaned.some((row) => {
    const urls = Array.isArray(row.urls) ? row.urls : [row.urls];
    return urls.some((url) => String(url).startsWith("stun:"));
  });
  return hasStun ? cleaned : [...STUN_SERVERS, ...cleaned];
}

async function mintIceServers({ secrets, fetchImpl = fetch, ttlSeconds = 86_400 } = {}) {
  if (!secrets?.keyId || !secrets?.token) {
    return { iceServers: [...STUN_SERVERS], turn: false };
  }
  const response = await fetchImpl(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${secrets.keyId}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secrets.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: ttlSeconds }),
    },
  );
  if (!response.ok) {
    throw new Error("The locker would not issue a short-lived login");
  }
  const body = await response.json();
  return { iceServers: sanitizeIceServers(body.iceServers), turn: true };
}

module.exports = {
  STUN_SERVERS,
  loadTurnSecrets,
  sanitizeIceServers,
  mintIceServers,
};
