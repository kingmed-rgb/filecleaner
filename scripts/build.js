const fs = require('node:fs');
const path = require('node:path');
const { publisherId } = require('../adsense.json');

function build(output = path.join(__dirname, '..', 'public'), env = process.env) {
  const root = path.join(__dirname, '..');
  const publisher = env.ADSENSE_PUBLISHER_ID ?? publisherId;
  const enabled = env.ADSENSE_ENABLED === 'true';
  if (publisher && !/^ca-pub-\d{16}$/.test(publisher)) throw new Error('Invalid ADSENSE_PUBLISHER_ID');
  if (enabled && !publisher) throw new Error('AdSense requires a publisher ID');
  fs.mkdirSync(output, { recursive: true });
  const tags = publisher ? `<meta name="google-adsense-account" content="${publisher}">\n` +
    (enabled ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisher}" crossorigin="anonymous"></script>\n` : '') : '';
  for (const file of fs.readdirSync(root).filter(name => /\.(html|xml|txt)$/.test(name))) {
    if (file === 'ads.txt') continue;
    let content = fs.readFileSync(path.join(root, file), 'utf8');
    if (file.endsWith('.html')) content = content.replace('</head>', tags + '</head>');
    if (enabled && file === 'privacy.html') content = content.replace('Ads are currently disabled while site approval and consent setup are completed.', 'Google AdSense advertising is enabled on this site.');
    fs.writeFileSync(path.join(output, file), content);
  }
  fs.writeFileSync(path.join(output, 'ads.txt'), publisher ? `google.com, ${publisher.slice(3)}, DIRECT, f08c47fec0942fa0\n` : '# Advertising is not configured.\n');
}
if (require.main === module) build();
module.exports = { build };
