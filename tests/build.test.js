const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../scripts/build');

test('AdSense disabled by default, verification-only when configured, enabled explicitly', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filecleaner-build-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  build(dir, {});
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), /adsbygoogle\.js|google-adsense-account/);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'ads.txt'), 'utf8'), /pub-/);
  const env = { ADSENSE_PUBLISHER_ID: 'ca-pub-1234567890123456' };
  build(dir, env);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(html, /google-adsense-account/); assert.doesNotMatch(html, /adsbygoogle\.js/);
  assert.equal(fs.readFileSync(path.join(dir, 'ads.txt'), 'utf8'), 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
  build(dir, { ...env, ADSENSE_ENABLED: 'true' });
  for (const name of ['index.html', 'about.html', 'privacy.html', 'contact.html', 'disclaimer.html']) {
    const page = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.equal((page.match(/adsbygoogle\.js/g) || []).length, 1);
  }
  assert.match(fs.readFileSync(path.join(dir, 'privacy.html'), 'utf8'), /advertising is enabled/);
  build(dir, {});
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), /adsbygoogle\.js/);
});
test('invalid or missing publisher ID cannot enable ads', () => {
  assert.throws(() => build('/unused', { ADSENSE_ENABLED: 'true' }), /requires a publisher/);
  assert.throws(() => build('/unused', { ADSENSE_PUBLISHER_ID: '"><script>' }), /Invalid/);
});
