import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';

function createServiceAccountAssertion(rawJson) {
  let credentials;
  try {
    credentials = typeof rawJson === 'string' ? JSON.parse(rawJson.trim()) : rawJson;
  } catch {
    throw new Error('Invalid CWS_SERVICE_ACCOUNT_JSON. Check service-account configuration.');
  }
  if (!credentials?.client_email || !credentials?.private_key) {
    throw new Error('Service-account credentials in CWS_SERVICE_ACCOUNT_JSON are incomplete.');
  }
  const privateKey = String(credentials.private_key).replace(/\\n/g, '\n');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const jwt = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: String(credentials.client_email).trim(),
    scope: 'https://www.googleapis.com/auth/chromewebstore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  let signature;
  try {
    const signer = createSign('RSA-SHA256');
    signer.update(jwt);
    signer.end();
    signature = signer.sign(privateKey, 'base64url');
  } catch {
    throw new Error('Unable to sign JWT with CWS_SERVICE_ACCOUNT_JSON private_key.');
  }
  return `${jwt}.${signature}`;
}

// Chrome Web Store API v2. Keep credentials out of arguments, artifacts, and
// logs. HTTP success alone does not mean an upload or submission succeeded.
export async function publishStore({ env = process.env, version, archive, fetchImpl = fetch, sleep = setTimeout, log = console.log }) {
  const publisherId = env.CWS_PUBLISHER_ID?.trim();
  const extensionId = env.CWS_EXTENSION_ID?.trim();
  if (!publisherId) throw new Error('Missing CWS_PUBLISHER_ID. See RELEASING.md for one-time publishing setup.');
  if (!extensionId) throw new Error('Missing CWS_EXTENSION_ID. See RELEASING.md for one-time publishing setup.');
  const hasServiceAccount = Boolean(env.CWS_SERVICE_ACCOUNT_JSON?.trim());
  if (!hasServiceAccount) {
    for (const key of ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN']) {
      if (!env[key]?.trim()) throw new Error(`Missing ${key} (or CWS_SERVICE_ACCOUNT_JSON). See RELEASING.md for one-time publishing setup.`);
    }
  }
  if (!/^[a-p]{32}$/.test(extensionId) || !/^[a-zA-Z0-9_-]+$/.test(publisherId)) {
    throw new Error('Invalid Chrome Web Store publisher or extension ID');
  }
  if (env.GITHUB_REF_TYPE === 'tag' && env.GITHUB_REF_NAME !== `v${version}`) {
    throw new Error(`Release tag must be v${version}`);
  }
  async function request(label, url, options) {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(60000) });
    let data;
    try { data = await response.json(); } catch { throw new Error(`${label}: invalid JSON (HTTP ${response.status})`); }
    if (!response.ok || data.error) {
      const code = typeof data?.error?.code === 'number' ? data.error.code : response.status;
      const statusText = typeof data?.error?.status === 'string' ? ` (${data.error.status})` : '';
      throw new Error(`${label} failed (HTTP ${code}${statusText}); check the developer dashboard or OAuth configuration.`);
    }
    return data;
  }
  const authBody = hasServiceAccount
    ? new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: createServiceAccountAssertion(env.CWS_SERVICE_ACCOUNT_JSON),
      })
    : new URLSearchParams({
        client_id: env.CWS_CLIENT_ID.trim(),
        client_secret: env.CWS_CLIENT_SECRET.trim(),
        refresh_token: env.CWS_REFRESH_TOKEN.trim(),
        grant_type: 'refresh_token',
      });
  const token = await request('Authentication', 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: authBody,
  });
  if (!token.access_token) throw new Error('Authentication returned no access token');
  const resource = `publishers/${publisherId}/items/${extensionId}`;
  const base = `https://chromewebstore.googleapis.com/v2/${resource}`;
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const upload = await request('Upload', `https://chromewebstore.googleapis.com/upload/v2/${resource}:upload`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip' }, body: archive,
  });
  if (upload.crxVersion && upload.crxVersion !== version) throw new Error('Uploaded version does not match the release');
  let state = upload.uploadState;
  for (let i = 0; ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(state) && i < 30; i += 1) {
    await sleep(2000);
    const status = await request('Upload status', `${base}:fetchStatus`, { headers });
    state = status.lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED') throw new Error(`Upload did not succeed (state: ${state || 'unknown'}); publishing was not attempted. Check the developer dashboard.`);
  log(`Uploaded version ${version}. Submitting for Chrome Web Store review.`);
  const result = await request('Publish', `${base}:publish`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH', blockOnWarnings: true }),
  });
  if (!['PENDING_REVIEW', 'PUBLISHED'].includes(result.state)) {
    throw new Error(`Submission was not accepted for automatic publication (state: ${result.state || 'unknown'}); check the developer dashboard.`);
  }
  log(`Chrome Web Store version ${version}: ${result.state}.`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { version } = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
    const archive = await readFile(new URL(`../dist/youtube-comments-closed-${version}-webstore.zip`, import.meta.url));
    await publishStore({ version, archive });
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
