import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('Store ZIP contains all declared toolbar icons and popup assets with matching versions', async () => {
  execFileSync(process.execPath, ['scripts/package-extension.mjs'], { cwd: root });
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.homepage_url, pkg.homepage);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions, undefined);
  assert.equal(manifest.host_permissions, undefined);
  const archive = `dist/youtube-comments-closed-${manifest.version}-webstore.zip`;
  const entries = execFileSync('unzip', ['-Z1', archive], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(entries.filter(entry => !entry.endsWith('/')).sort(), [
    'LICENSE', 'content.css', 'content.js', 'manifest.json', 'popup.css', 'popup.html', 'popup.js',
    ...[16, 24, 32, 48, 128].map(size => `icons/icon-${size}.png`),
  ].sort());
  for (const group of [manifest.icons, manifest.action.default_icon]) {
    for (const [size, name] of Object.entries(group)) {
      assert.ok(entries.includes(name));
      const png = execFileSync('unzip', ['-p', archive, name], { cwd: root });
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      assert.equal(png.readUInt32BE(16), Number(size));
      assert.equal(png.readUInt32BE(20), Number(size));
    }
  }
  assert.ok(entries.includes(manifest.action.default_popup));
  const popup = execFileSync('unzip', ['-p', archive, manifest.action.default_popup], { cwd: root, encoding: 'utf8' });
  assert.ok(popup.includes(pkg.version));
  for (const name of ['manifest.json', 'content.js', 'content.css', 'popup.html', 'popup.css', 'popup.js']) {
    assert.deepEqual(execFileSync('unzip', ['-p', archive, name], { cwd: root }), await readFile(new URL(`../extension/${name}`, import.meta.url)));
  }
});
test('mismatched release tags cannot produce a release package', () => {
  assert.throws(() => execFileSync(process.execPath, ['scripts/package-extension.mjs'], {
    cwd: root, env: { ...process.env, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.0.0' }, stdio: 'pipe',
  }));
});
