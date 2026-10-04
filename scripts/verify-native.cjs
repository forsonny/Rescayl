const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const manifest = require('../resources/native-manifest.json');
for (const [file, expected] of Object.entries({ ...manifest.files, ...manifest.inherited.files, ...manifest.models.files })) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
  if (actual !== expected) throw Error('Native resource checksum mismatch: ' + file);
}
console.log('Native engine and model checksums verified.');
