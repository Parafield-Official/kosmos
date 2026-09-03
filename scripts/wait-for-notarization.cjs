const crypto = require("node:crypto");
const fs = require("node:fs/promises");

const API_ORIGIN = "https://appstoreconnect.apple.com";
const POLL_INTERVAL_MS = 2 * 60 * 1_000;
const POLL_TIMEOUT_MS = 330 * 60 * 1_000;
const ACCEPTED = "Accepted";
const INVALID = new Set(["Invalid", "Rejected"]);

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function createToken({ keyId, issuerId, privateKey, now = Date.now }) {
  if (!keyId || !issuerId || !privateKey) {
    throw new Error("Apple notarization status checking is missing API credentials.");
  }
  const issuedAt = Math.floor(now() / 1_000) - 5;
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: issuerId,
    iat: issuedAt,
    exp: issuedAt + 10 * 60,
    aud: "appstoreconnect-v1",
  }));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${base64Url(signature)}`;
}

function credentialsFromEnv(env) {
  const required = ["APPLE_API_KEY_B64", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];
  for (const name of required) {
    if (!env[name]) {
      throw new Error(`Apple notarization status checking is missing ${name}.`);
    }
  }
  const privateKey = Buffer.from(env.APPLE_API_KEY_B64, "base64").toString("utf8");
  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error("APPLE_API_KEY_B64 did not decode to an App Store Connect private key.");
  }
  return {
    keyId: env.APPLE_API_KEY_ID,
    issuerId: env.APPLE_API_ISSUER,
    privateKey,
  };
}

async function responseBody(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 1_000) };
  }
}

async function getSubmission({ submissionId, credentials, fetchImpl = fetch, now = Date.now }) {
  const token = createToken({ ...credentials, now });
  const response = await fetchImpl(`${API_ORIGIN}/notary/v2/submissions/${encodeURIComponent(submissionId)}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
  });
  const body = await responseBody(response);
  if (!response.ok) {
    const error = new Error(`Apple Notary API status request failed with HTTP ${response.status}.`);
    error.statusCode = response.status;
    error.responseBody = body;
    throw error;
  }
  const data = body?.data;
  const status = data?.attributes?.status;
  if (data?.id !== submissionId || typeof status !== "string") {
    throw new Error("Apple Notary API returned an unexpected submission response.");
  }
  return {
    id: data.id,
    status,
    createdDate: data.attributes.createdDate,
    name: data.attributes.name,
  };
}

function isRetryable(error) {
  const statusCode = Number(error?.statusCode ?? 0);
  if (statusCode === 429 || statusCode >= 500) {
    return true;
  }
  return /fetch failed|network|socket|ECONNRESET|ETIMEDOUT|timed? out|temporary/i.test(String(error?.message ?? ""));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function pollUntilComplete({
  submissionId,
  credentials,
  logger = console.log,
  fetchImpl = fetch,
  now = Date.now,
  sleepFor = sleep,
  pollIntervalMs = POLL_INTERVAL_MS,
  timeoutMs = POLL_TIMEOUT_MS,
}) {
  const deadline = now() + timeoutMs;
  while (true) {
    let submission;
    try {
      submission = await getSubmission({ submissionId, credentials, fetchImpl, now });
    } catch (error) {
      if (!isRetryable(error) || now() >= deadline) {
        throw error;
      }
      logger(`[notarization] Apple status request had a temporary error; retrying submission ${submissionId}.`);
      await sleepFor(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
      continue;
    }

    logger(`[notarization] submission ${submissionId}: ${submission.status}`);
    if (submission.status === ACCEPTED) {
      return submission;
    }
    if (INVALID.has(submission.status)) {
      throw new Error(`Apple rejected notarization submission ${submissionId}. Retrieve its Apple diagnostic log before publishing.`);
    }
    if (now() >= deadline) {
      throw new Error(
        `Apple did not finish submission ${submissionId} within ${Math.round(timeoutMs / 60_000)} minutes. ` +
        "Re-run failed jobs to continue checking this same submission without rebuilding or resubmitting.",
      );
    }
    await sleepFor(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
  }
}

async function appendOutput(env, values) {
  if (!env.GITHUB_OUTPUT) {
    return;
  }
  const lines = Object.entries(values).map(([name, value]) => `${name}=${value}`);
  await fs.appendFile(env.GITHUB_OUTPUT, `${lines.join("\n")}\n`, "utf8");
}

async function main({ argv = process.argv, env = process.env } = {}) {
  const statePath = argv[2];
  if (!statePath) {
    throw new Error("Usage: node scripts/wait-for-notarization.cjs <submission.json>");
  }
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  if (!state.submissionId || state.schemaVersion !== 1) {
    throw new Error("The notarization staging artifact contains invalid submission state.");
  }
  if (env.GITHUB_SHA && state.sourceSha && state.sourceSha !== env.GITHUB_SHA) {
    throw new Error("The notarization staging artifact belongs to a different source commit.");
  }
  if (env.GITHUB_RUN_ID && state.sourceRunId && state.sourceRunId !== env.GITHUB_RUN_ID) {
    throw new Error("The notarization staging artifact belongs to a different workflow run.");
  }

  const pollIntervalMs = Number(env.NOTARIZATION_POLL_INTERVAL_SECONDS ?? 120) * 1_000;
  const timeoutMs = Number(env.NOTARIZATION_POLL_TIMEOUT_MINUTES ?? 330) * 60_000;
  const result = await pollUntilComplete({
    submissionId: state.submissionId,
    credentials: credentialsFromEnv(env),
    pollIntervalMs,
    timeoutMs,
  });
  await appendOutput(env, {
    submission_id: result.id,
    status: result.status,
  });
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  API_ORIGIN,
  createToken,
  credentialsFromEnv,
  getSubmission,
  isRetryable,
  main,
  pollUntilComplete,
};
