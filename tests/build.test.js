const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../scripts/build');

test('AdSense script is included by default and can be disabled for verification-only mode', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filecleaner-build-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  build(dir, { ADSENSE_PUBLISHER_ID: '', ADSENSE_ENABLED: 'false' });
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), /adsbygoogle\.js|google-adsense-account/);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'ads.txt'), 'utf8'), /pub-/);
  build(dir, {});
  assert.match(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), /content="ca-pub-8412484885269791"/);
  assert.equal(fs.readFileSync(path.join(dir, 'ads.txt'), 'utf8'), 'google.com, pub-8412484885269791, DIRECT, f08c47fec0942fa0\n');
  for (const name of ['index.html', 'about.html', 'privacy.html', 'contact.html', 'disclaimer.html']) {
    const page = fs.readFileSync(path.join(dir, name), 'utf8');
    const tag = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8412484885269791" crossorigin="anonymous"></script>';
    assert.ok(page.includes(tag));
    assert.ok(page.indexOf(tag) < page.indexOf('</head>'));
    assert.equal((page.match(/adsbygoogle\.js/g) || []).length, 1);
  }
  const env = { ADSENSE_PUBLISHER_ID: 'ca-pub-1234567890123456', ADSENSE_ENABLED: 'false' };
  build(dir, env);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(html, /google-adsense-account/); assert.doesNotMatch(html, /adsbygoogle\.js/);
  assert.equal(fs.readFileSync(path.join(dir, 'ads.txt'), 'utf8'), 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
  build(dir, { ...env, ADSENSE_ENABLED: 'true' });
  for (const name of ['index.html', 'about.html', 'privacy.html', 'contact.html', 'disclaimer.html']) {
    const page = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.equal((page.match(/adsbygoogle\.js/g) || []).length, 1);
  }
  assert.match(fs.readFileSync(path.join(dir, 'privacy.html'), 'utf8'), /AdSense script is enabled/);
  build(dir, { ADSENSE_PUBLISHER_ID: '', ADSENSE_ENABLED: 'false' });
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), /adsbygoogle\.js/);
});
test('invalid or missing publisher ID cannot enable ads', () => {
  assert.throws(() => build('/unused', { ADSENSE_ENABLED: 'true', ADSENSE_PUBLISHER_ID: '' }), /requires a publisher/);
  assert.throws(() => build('/unused', { ADSENSE_PUBLISHER_ID: '"><script>' }), /Invalid/);
});
