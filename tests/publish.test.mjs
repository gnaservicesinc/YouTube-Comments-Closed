import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { publishStore } from '../scripts/publish-store.mjs';

const env = {
  CWS_PUBLISHER_ID: 'publisher-id', CWS_EXTENSION_ID: 'ecmhkbgdoeeicpohpleinhgmdfliedak',
  CWS_CLIENT_ID: 'test-client', CWS_CLIENT_SECRET: 'test-secret', CWS_REFRESH_TOKEN: 'test-refresh',
  GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.1.0',
};
function run(responses, overrides = {}) {
  const calls = [];
  const promise = publishStore({
    env, version: '1.1.0', archive: Buffer.from('test-zip'), sleep: async () => {}, log: () => {},
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      assert.ok(responses.length, 'unexpected request');
      const next = responses.shift();
      return new Response(JSON.stringify(next.body ?? next), { status: next.status ?? 200 });
    },
    ...overrides,
  });
  return { promise, calls };
}
test('Store publishing waits for async upload and submits for automatic publication after review', async () => {
  const { promise, calls } = run([
    { access_token: 'test-access' }, { uploadState: 'UPLOAD_IN_PROGRESS' },
    { lastAsyncUploadState: 'IN_PROGRESS' }, { lastAsyncUploadState: 'SUCCEEDED' },
    { state: 'PENDING_REVIEW' },
  ]);
  assert.equal((await promise).state, 'PENDING_REVIEW');
  assert.equal(calls.length, 5);
  assert.equal(calls[1].body.toString(), 'test-zip');
  assert.equal(calls[4].url.endsWith(':publish'), true);
  assert.deepEqual(JSON.parse(calls[4].body), { publishType: 'DEFAULT_PUBLISH', blockOnWarnings: true });
});
test('Store failures never publish a previous or rejected package', async () => {
  for (const failure of [{ uploadState: 'FAILED' }, { uploadState: 'SUCCEEDED', crxVersion: '1.0.0' },
    { status: 400, body: { error: { message: 'test-secret' } } }]) {
    const { promise, calls } = run([{ access_token: 'test-access' }, failure]);
    await assert.rejects(promise, error => !error.message.includes('test-secret'));
    assert.equal(calls.length, 2);
  }
});
test('missing credentials and mismatched tags fail before any network requests', async () => {
  for (const invalid of [{ ...env, CWS_REFRESH_TOKEN: '' }, { ...env, GITHUB_REF_NAME: 'v1.0.0' }]) {
    const { promise, calls } = run([], { env: invalid });
    await assert.rejects(promise);
    assert.equal(calls.length, 0);
  }
});
test('stuck uploads time out without submitting and OAuth errors do not expose secrets', async () => {
  const { promise, calls } = run([
    { access_token: 'test-access' }, { uploadState: 'UPLOAD_IN_PROGRESS' },
    ...Array.from({ length: 30 }, () => ({ lastAsyncUploadState: 'UPLOAD_IN_PROGRESS' })),
  ]);
  await assert.rejects(promise, /Upload did not succeed/);
  assert.equal(calls.length, 32);
  await assert.rejects(run([{ error: 'test-secret' }]).promise, error => !error.message.includes('test-secret'));
});
test('HTTP 200 publish errors and unexpected review states fail the release', async () => {
  for (const result of [{ error: { message: 'validation failed' } }, { state: 'DRAFT' }, { state: 'STAGED' }]) {
    await assert.rejects(run([{ access_token: 'test-access' }, { uploadState: 'SUCCEEDED' }, result]).promise);
  }
});
test('Service account JSON (CWS_SERVICE_ACCOUNT_JSON) authenticates via signed JWT assertion', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const serviceAccountJson = JSON.stringify({
    client_email: 'publisher@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
  const saEnv = {
    CWS_PUBLISHER_ID: 'publisher-id',
    CWS_EXTENSION_ID: 'ecmhkbgdoeeicpohpleinhgmdfliedak',
    CWS_SERVICE_ACCOUNT_JSON: serviceAccountJson,
    GITHUB_REF_TYPE: 'tag',
    GITHUB_REF_NAME: 'v1.1.0',
  };
  const { promise, calls } = run([
    { access_token: 'sa-access' },
    { uploadState: 'SUCCEEDED' },
    { state: 'PENDING_REVIEW' },
  ], { env: saEnv });
  assert.equal((await promise).state, 'PENDING_REVIEW');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(calls[0].body.get('assertion').split('.').length, 3);
});
