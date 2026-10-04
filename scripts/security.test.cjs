const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');

function load(file, mocks = {}, globals = {}) {
  const filename = path.join(root, file);
  const requireFile = createRequire(filename);
  const source = fs.readFileSync(filename, 'utf8');
  const code = file.endsWith('.ts') ? ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText : source;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: id => Object.prototype.hasOwnProperty.call(mocks, id) ? mocks[id] : requireFile(id), console, process, Buffer, URL, Headers, Response, Error, ...globals }, { filename });
  return module.exports;
}

test('news is data only, including executable-language and YAML-tag fixtures', () => {
  const { parseNews } = load('renderer/lib/parse-news.ts');
  const benign = parseNews('---\ntitle: News\nversion: "2026.10.04"\ndontShow: false\n---\nHello');
  assert.equal(benign.data.version, '2026.10.04');
  assert.equal(benign.content, 'Hello');
  assert.equal(benign.data.dontShow, false);
  assert.throws(() => parseNews('---javascript\n(globalThis.executed=true,{version:"test"})\n---\nHello'));
  assert.throws(() => parseNews('---\nversion: test\n__proto__: injected\n---\nHello'));
  assert.equal(parseNews('---\nversion: !!js/function harmless literal\n---\nHello').data.version, '!!js/function harmless literal');
  assert.equal(parseNews('---\nversion: ["array"]\n---\nHello').data.version, '["array"]');
});

test('analytics initializes only with persisted consent and stops pending captures on opt-out', async () => {
  const calls = [];
  let consent = 'false';
  let optedOut = true;
  let releaseInfo;
  const client = {
    init: () => calls.push('init'), opt_in_capturing: () => { optedOut = false; }, opt_out_capturing: () => { optedOut = true; },
    has_opted_out_capturing: () => optedOut, register: () => calls.push('register'), capture: event => calls.push(event),
  };
  const window = { localStorage: { getItem: () => consent }, electron: { getSystemInfo: () => new Promise(resolve => { releaseInfo = resolve; }), getAppVersion: async () => 'test' } };
  const analytics = load('renderer/lib/analytics.ts', { 'posthog-js': client }, { window });
  analytics.configureAnalytics(false);
  analytics.captureAnalytics('model_selected', {});
  assert.equal(calls.length, 0);
  consent = 'true';
  const stop = analytics.configureAnalytics(true);
  assert.deepEqual(calls, ['init']);
  analytics.captureAnalytics('model_selected', {});
  assert.equal(calls.at(-1), 'model_selected');
  consent = 'false';
  stop();
  analytics.configureAnalytics(false);
  releaseInfo({ platform: 'win' });
  await new Promise(resolve => setImmediate(resolve));
  analytics.captureAnalytics('after_opt_out', {});
  assert.equal(calls.includes('app_launched'), false);
  assert.equal(calls.includes('register'), false);
  assert.equal(calls.includes('after_opt_out'), false);
});

test('bundled sandbox preload exposes specific operations and strips IPC events', () => {
  let api;
  const calls = [];
  const listeners = new Map();
  const nativeFile = {};
  load('export/electron/preload.js', { electron: {
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
    webUtils: { getPathForFile: file => { if (file !== nativeFile) throw Error('Not a native file'); return 'C:/input.png'; } },
    ipcRenderer: { send: (...args) => calls.push(args), invoke: (...args) => { calls.push(args); return Promise.resolve(); }, on: (event, listener) => listeners.set(event, listener), removeListener: (event, listener) => { assert.equal(listeners.get(event), listener); listeners.delete(event); } },
  } });
  assert.equal(api.send, undefined);
  assert.equal(api.invoke, undefined);
  assert.equal(api.on, undefined);
  api.pasteImage('encoded');
  assert.equal(calls[0][1].encodedBuffer, 'encoded');
  assert.deepEqual(Object.keys(calls[0][1]), ['encodedBuffer']);
  api.writeLog('diagnostic');
  assert.equal(calls.at(-1)[0], 'renderer-log');
  assert.equal(calls.at(-1)[1], 'diagnostic');
  assert.throws(() => api.loadDroppedFile('C:/arbitrary.exe'));
  api.loadDroppedFile(nativeFile);
  let received;
  const unsubscribe = api.onDone(data => { received = data; });
  listeners.get('Upscaling Done')({ secretEvent: true }, 'output.png');
  assert.equal(received, 'output.png');
  unsubscribe();
  assert.equal(listeners.size, 0);
});

test('selected paths, job options, protocol assets and clipboard destinations stay constrained', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'upscayl-security-'));
  assert.equal(path.dirname(fixture), os.tmpdir());
  const selected = path.join(fixture, 'selected');
  const outside = path.join(fixture, 'outside');
  const appRoot = path.join(fixture, 'app');
  const assets = path.join(appRoot, 'renderer', 'out');
  for (const dir of [selected, outside, assets]) fs.mkdirSync(dir, { recursive: true });
  const input = path.join(selected, '100% photo.png');
  const other = path.join(outside, 'other.png');
  fs.writeFileSync(input, 'image'); fs.writeFileSync(other, 'outside');
  fs.writeFileSync(path.join(assets, 'index.html'), '<h1>Fixture</h1>');
  let saved;
  const access = load('export/electron/path-access.js', { 'electron-settings': { getSync: () => saved, setSync: (_key, value) => { saved = value; } } });
  const config = { savedCustomModelsPath: undefined };
  const security = load('export/electron/security.js', { './path-access': access, './utils/config-variables': config });
  try {
    assert.equal(access.hasImageAccess(input), false);
    access.allowFile(input);
    assert.equal(access.hasImageAccess(input), true);
    assert.equal(access.hasImageAccess(other), false);
    assert.equal(access.hasDirectoryAccess(selected), true);
    assert.equal(access.hasDirectoryAccess(outside), false);
    const payload = { imagePath: input, outputPath: selected, model: 'upscayl-standard-4x', scale: '4', gpuId: null, compression: '0', tileSize: null, saveImageAs: 'png', ttaMode: false, copyMetadata: false, noImageProcessing: false, useCustomWidth: false, overwrite: false };
    security.validateJobPayload(payload);
    security.validateJobPayload({ ...payload, batchFolderPath: selected }, true);
    for (const invalid of [{ imagePath: other }, { outputPath: outside }, { model: '../other' }, { saveImageAs: 'exe' }, { scale: '4 --other' }, { gpuId: '--other' }, { compression: '101' }, { tileSize: 16 }, { copyMetadata: 'true' }]) assert.throws(() => security.validateJobPayload({ ...payload, ...invalid }));
    assert.equal(security.isTrustedRendererURL('upscayl://app/index.html', false), true);
    assert.equal(security.isTrustedRendererURL('https://evil.test', false), false);
    assert.equal(security.isTrustedRendererURL('http://localhost:8000.evil.test/', true), false);
    assert.equal(security.isSafeExternalURL('https://example.com/'), true);
    for (const url of ['file:///C:/run.exe', 'javascript:alert(1)', 'https://user:pass@example.com/']) assert.equal(security.isSafeExternalURL(url), false);
    const contents = { getURL: () => 'upscayl://app/index.html' };
    const clipboardDetails = { isMainFrame: true, requestingUrl: 'upscayl://app/index.html' };
    assert.equal(security.canWriteClipboard(contents, contents, 'clipboard-sanitized-write', clipboardDetails, false), true);
    assert.equal(security.canWriteClipboard(contents, {}, 'clipboard-sanitized-write', clipboardDetails, false), false);
    assert.equal(security.canWriteClipboard(contents, contents, 'clipboard-sanitized-write', { ...clipboardDetails, isMainFrame: false }, false), false);
    assert.equal(security.canWriteClipboard(contents, contents, 'clipboard-sanitized-write', { ...clipboardDetails, requestingUrl: 'https://evil.test/' }, false), false);
    for (const permission of ['clipboard-read', 'media', 'fileSystem', 'notifications']) assert.equal(security.canWriteClipboard(contents, contents, permission, clipboardDetails, false), false);
    assert.equal(security.resolveAssetPath(assets, '/index.html'), path.join(assets, 'index.html'));
    assert.throws(() => security.resolveAssetPath(assets, '/../../outside/other.png'));
    const link = path.join(selected, 'linked');
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(access.hasImageAccess(path.join(link, 'other.png')), false);
    assert.throws(() => access.assertOutputAccess(path.join(selected, 'linked')));
    const models = path.join(selected, 'models'); fs.mkdirSync(models);
    access.allowModelDirectory(models); config.savedCustomModelsPath = models;
    fs.writeFileSync(path.join(models, 'custom.bin'), 'bin');
    assert.throws(() => security.validateJobPayload({ ...payload, model: 'custom' }));
    fs.writeFileSync(path.join(models, 'custom.param'), 'param');
    security.validateJobPayload({ ...payload, model: 'custom' });
    let protocolHandler;
    const electron = { app: { getAppPath: () => appRoot, getPath: () => fixture, once() {} }, protocol: { registerSchemesAsPrivileged() {}, handle: (_name, handler) => { protocolHandler = handler; } }, net: { fetch: async () => new Response('fixture', { headers: { 'Content-Type': 'text/html' } }) }, nativeImage: { createFromBuffer: buffer => ({ isEmpty: () => buffer.toString() !== 'image', toPNG: () => Buffer.from('normalized PNG') }) } };
    load('export/electron/protocols.js', { electron, 'electron-is-dev': false, './path-access': access, './security': security }).registerProtocols();
    assert.equal((await protocolHandler({ url: 'upscayl://app/index.html', initiatorOrigin: 'upscayl://app' })).status, 200);
    assert.equal((await protocolHandler({ url: 'upscayl://app/index.html', initiatorOrigin: 'https://evil.test' })).status, 403);
    const encode = file => 'upscayl://image/' + encodeURIComponent(file);
    assert.equal((await protocolHandler({ url: encode(input), initiatorOrigin: 'upscayl://app' })).status, 200);
    assert.equal((await protocolHandler({ url: encode(other), initiatorOrigin: 'upscayl://app' })).status, 403);
    const clipboard = load('export/electron/commands/paste-image.js', { electron, '../path-access': access, '../main-window': {}, '../utils/logit': () => {} });
    const destination = await clipboard.createTempFileFromClipboard({ encodedBuffer: Buffer.from('image').toString('base64'), path: outside, name: 'unwanted.exe' });
    assert.equal(path.dirname(path.dirname(destination)), fixture);
    assert.match(path.basename(destination), /^upscayl-clipboard-[A-Za-z0-9]+\.png$/);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'normalized PNG');
    assert.equal(fs.existsSync(path.join(outside, 'unwanted.exe')), false);
    await assert.rejects(clipboard.createTempFileFromClipboard({ encodedBuffer: 'not-an-image' }));
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    assert.equal(path.basename(fixture).startsWith('upscayl-security-'), true);
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('IPC rejects other windows and child frames while preserving valid main-frame operations', async () => {
  const frame = { url: 'upscayl://app/index.html' };
  const errors = [];
  const contents = { mainFrame: frame, send: (...args) => errors.push(args) };
  const handlers = new Map();
  const ipc = load('export/electron/ipc.js', { electron: { ipcMain: { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => handlers.set(name, fn) } }, 'electron-is-dev': false, './main-window': { getMainWindow: () => ({ webContents: contents }) }, './security': { isTrustedRendererURL: url => url === frame.url && url.startsWith('upscayl://app/') } });
  const valid = { sender: contents, senderFrame: frame };
  const foreign = { sender: { mainFrame: frame }, senderFrame: frame };
  const child = { sender: contents, senderFrame: { url: frame.url } };
  assert.equal(ipc.isTrustedSender(valid), true);
  assert.equal(ipc.isTrustedSender(foreign), false);
  assert.equal(ipc.isTrustedSender(child), false);
  ipc.handleIPC('fixture-invoke', () => 'accepted');
  assert.equal(handlers.get('fixture-invoke')(valid), 'accepted');
  assert.throws(() => handlers.get('fixture-invoke')(foreign));
  let calls = 0;
  ipc.onIPC('fixture-event', () => { calls++; throw Error('invalid payload'); });
  await handlers.get('fixture-event')(child);
  assert.equal(calls, 0);
  await handlers.get('fixture-event')(valid);
  assert.equal(calls, 1);
  assert.equal(errors[0][1], 'invalid payload');
});

test('all job modes pass the approved literal filesystem paths to native processing', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'upscayl-path-boundary-'));
  const selected = path.join(fixture, 'selected');
  const output = path.join(fixture, 'output%20literal');
  const nested = path.join(selected, '%2e%2e');
  for (const directory of [selected, output, nested]) fs.mkdirSync(directory, { recursive: true });
  const access = load('export/electron/path-access.js', { 'electron-settings': { getSync: () => undefined, setSync() {} } });
  const config = { savedCustomModelsPath: undefined, childProcesses: [], stopped: false, setChildProcesses() {}, setStopped() {} };
  const security = load('export/electron/security.js', { './path-access': access, './utils/config-variables': config });
  const captured = [];
  const spawn = args => {
    captured.push(args);
    const process = new EventEmitter(); process.stderr = new EventEmitter(); process.stdout = new EventEmitter();
    return { process, kill() {} };
  };
  const mocks = {
    '../main-window': { getMainWindow: () => ({ webContents: { send() {} } }) },
    '../utils/config-variables': config, '../utils/get-resource-paths': { modelsPath: path.join(fixture, 'models') },
    '../utils/spawn-upscayl': { spawnUpscayl: spawn }, '../utils/logit': () => {},
    '../utils/show-notification': () => {}, '../utils/copy-metadata': { copyMetadata() {} }, '../path-access': access,
  };
  const single = load('export/electron/commands/image-upscayl.js', mocks).default;
  const double = load('export/electron/commands/double-upscayl.js', mocks).default;
  const batch = load('export/electron/commands/batch-upscayl.js', mocks).default;
  const options = { outputPath: output, model: 'upscayl-standard-4x', scale: '4', gpuId: null, compression: '0', tileSize: null, saveImageAs: 'png', ttaMode: false, copyMetadata: false, noImageProcessing: false, useCustomWidth: false, overwrite: false };
  try {
    access.allowDirectory(output);
    for (const input of [path.join(selected, '100% photo.png'), path.join(selected, '%252e%252e%255coutside%255csecret.png'), path.join(nested, 'image.png')]) {
      fs.writeFileSync(input, 'image'); access.allowFile(input);
      const payload = { ...options, imagePath: input };
      for (const handler of [single, double]) {
        security.validateJobPayload(payload); await handler({}, payload);
        const args = captured.at(-1);
        const actual = args[args.indexOf('-i') + 1];
        assert.equal(path.resolve(actual), path.resolve(input));
        assert.equal(access.hasImageAccess(actual), true);
        assert.equal(access.isWithin(output, args[args.indexOf('-o') + 1]), true);
      }
    }
    access.allowDirectory(nested);
    const payload = { ...options, batchFolderPath: nested };
    security.validateJobPayload(payload, true); await batch({}, payload);
    const args = captured.at(-1);
    assert.equal(path.resolve(args[args.indexOf('-i') + 1]), path.resolve(nested));
    assert.equal(access.hasDirectoryAccess(args[args.indexOf('-i') + 1]), true);
    assert.equal(access.isWithin(output, args[args.indexOf('-o') + 1]), true);
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    assert.equal(path.basename(fixture).startsWith('upscayl-path-boundary-'), true);
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('consecutive clipboard images produce separate native outputs with overwrite disabled', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'upscayl-clipboard-test-'));
  const output = path.join(fixture, 'output'); fs.mkdirSync(output);
  const access = load('export/electron/path-access.js', { 'electron-settings': { getSync: () => undefined, setSync() {} } });
  access.allowDirectory(output);
  const config = { savedCustomModelsPath: undefined, stopped: false, setChildProcesses() {}, setStopped() {} };
  const jobs = [];
  const electron = { app: { getPath: () => fixture, once() {} }, nativeImage: { createFromBuffer: buffer => ({ isEmpty: () => false, toPNG: () => buffer }) } };
  const clipboard = load('export/electron/commands/paste-image.js', { electron, '../path-access': access, '../main-window': {}, '../utils/logit': () => {} });
  const handler = load('export/electron/commands/image-upscayl.js', {
    '../main-window': { getMainWindow: () => ({ webContents: { send() {} } }) }, '../path-access': access,
    '../utils/config-variables': config, '../utils/get-resource-paths': { modelsPath: fixture }, '../utils/logit': () => {},
    '../utils/copy-metadata': { copyMetadata() {} }, '../utils/show-notification': () => {},
    '../utils/spawn-upscayl': { spawnUpscayl: args => {
      const destination = args[args.indexOf('-o') + 1]; jobs.push(destination); fs.writeFileSync(destination, 'completed output');
      const process = new EventEmitter(); process.stderr = new EventEmitter(); process.stdout = new EventEmitter();
      return { process, kill() {} };
    } },
  }).default;
  try {
    for (const contents of ['first image', 'different second image']) {
      const imagePath = await clipboard.createTempFileFromClipboard({ encodedBuffer: Buffer.from(contents).toString('base64') });
      await handler({}, { imagePath, outputPath: output, model: 'upscayl-standard-4x', scale: '4', gpuId: null, compression: '0', tileSize: null, saveImageAs: 'png', ttaMode: false, copyMetadata: false, noImageProcessing: false, useCustomWidth: false, overwrite: false });
    }
    assert.equal(jobs.length, 2);
    assert.notEqual(jobs[0], jobs[1]);
    assert.equal(fs.existsSync(jobs[0]), true);
    assert.equal(fs.existsSync(jobs[1]), true);
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    assert.equal(path.basename(fixture).startsWith('upscayl-clipboard-test-'), true);
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
