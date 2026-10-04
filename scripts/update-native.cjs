const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = require('../resources/native-manifest.json');
const platform = process.argv[2] || ({ win32: 'win', linux: 'linux', darwin: 'mac' })[process.platform];
const asset = manifest.assets[platform];
if (!asset) throw Error('Choose win, linux or mac.');
const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upscayl-native-'));
const hash = contents => crypto.createHash('sha256').update(contents).digest('hex');
(async () => {
  try {
    const response = await fetch(asset.url);
    if (!response.ok) throw Error('Download failed: ' + response.status);
    const contents = Buffer.from(await response.arrayBuffer());
    if (hash(contents) !== asset.sha256) throw Error('Native archive checksum mismatch');
    const archive = path.join(temporaryDir, 'native.zip');
    fs.writeFileSync(archive, contents);
    if (process.platform === 'win32') execFileSync('tar.exe', ['-xf', archive, '-C', temporaryDir]);
    else execFileSync('unzip', ['-q', archive, '-d', temporaryDir]);
    const files = Object.entries(manifest.files).filter(([file]) => file.startsWith('resources/' + platform + '/bin/'));
    for (const [file, expected] of files) {
      const source = path.join(temporaryDir, asset.directory, path.basename(file));
      if (hash(fs.readFileSync(source)) !== expected) throw Error('Native file checksum mismatch: ' + file);
    }
    for (const [file] of files) {
      fs.copyFileSync(path.join(temporaryDir, asset.directory, path.basename(file)), path.join(root, file));
      if (path.basename(file) === 'upscayl-bin') fs.chmodSync(path.join(root, file), 0o755);
    }
    console.log('Installed pinned native engine ' + manifest.tag + ' for ' + platform);
  } finally {
    if (path.dirname(path.resolve(temporaryDir)) !== path.resolve(os.tmpdir()) || !path.basename(temporaryDir).startsWith('upscayl-native-')) throw Error('Invalid temporary directory');
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
