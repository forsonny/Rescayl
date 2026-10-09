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

test('MoSR admits rectangular images within both its pixel budget and edge limit', () => {
  const { fitsMosrPreview } = require('../export/common/mosr-preview.js');
  for (const [width, height] of [[512, 512], [1024, 256], [256, 1024], [513, 511], [1024, 1]]) {
    assert.equal(fitsMosrPreview(width, height), true, `${width}x${height}`);
  }
  for (const [width, height] of [[1024, 257], [257, 1024], [513, 512], [512, 513], [768, 384], [1025, 1], [1, 1025], [0, 512], [null, null], [undefined, 512]]) {
    assert.equal(fitsMosrPreview(width, height), false, `${width}x${height}`);
  }
});

test('MoSR GPU discovery uses a fixed hidden query and reports unavailable discovery', async () => {
  const { promisify } = require('node:util');
  let captured, failure = false;
  const execute = () => {};
  execute[promisify.custom] = async (...args) => {
    captured = args;
    if (failure) throw Error('PowerShell unavailable');
    return { stdout: JSON.stringify([{ id: 7, name: 'Example GPU™', luid: '00000000:0001AA57' }]) };
  };
  const { getMosrGpus } = load('export/electron/utils/get-mosr-gpus.js', {
    'node:child_process': { execFile: execute },
  }, { process: { ...process, platform: 'win32' } });
  const gpus = await getMosrGpus();
  assert.equal(gpus[0].id, 7);
  assert.equal(gpus[0].name, 'Example GPU™');
  assert.equal(gpus[0].luid, '00000000:0001aa57');
  assert.equal(path.basename(captured[0]), 'powershell.exe');
  assert.equal(captured[2].windowsHide, true);
  assert.equal(captured[2].timeout, 15000);
  assert.match(Buffer.from(captured[1].at(-1), 'base64').toString('utf16le'), /CreateDXGIFactory1/);
  failure = true;
  await assert.rejects(getMosrGpus(), /Choose Default/);
});

test('a removed MoSR adapter fails before decoding or loading the model', async () => {
  const { upscale } = load('export/electron/mosr-worker.js', {
    sharp: () => ({ metadata: async () => ({ width: 128, height: 128, format: 'png' }) }),
    'onnxruntime-node': {},
    './utils/get-mosr-gpus': { getMosrGpus: async () => [{ id: 0, name: 'Replacement GPU', luid: '00000000:00000001' }] },
  }, { process: { ...process, platform: 'win32' } });
  await assert.rejects(upscale('input.png', 'output.png', 'cache', '00000000:00000002'), /no longer available/);
});

test('MoSR publishes only completed, uncancelled output and preserves existing files on failure', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'rescayl-mosr-'));
  const output = path.join(fixture, 'output.png');
  try {
    for (const outcome of ['success', 'cancel', 'exit-failure', 'worker-error', 'missing-output']) {
      fs.writeFileSync(output, 'previous image');
      const child = new EventEmitter();
      let kills = 0, spawnArgs;
      child.kill = () => { kills++; return true; };
      const errors = [];
      const { spawnMosr } = load('export/electron/utils/spawn-mosr.js', {
        child_process: { spawn: (...args) => { spawnArgs = args; return child; } },
        electron: { app: { getAppPath: () => root, getPath: () => fixture } },
        '../path-access': { assertOutputAccess: file => assert.equal(path.dirname(file), fixture) },
      });
      const gpu = outcome === 'success' ? '00000000:0001aa57' : '';
      const job = spawnMosr(['-i', path.join(fixture, 'input.png'), '-o', output, ...(gpu ? ['-g', gpu] : [])]);
      child.on('error', error => errors.push(error.message));
      const staged = spawnArgs[1][2];
      assert.equal(spawnArgs[0], process.execPath);
      assert.equal(spawnArgs[2].env.ELECTRON_RUN_AS_NODE, '1');
      assert.equal(spawnArgs[2].windowsHide, true);
      assert.equal(spawnArgs[1][4], gpu);
      assert.notEqual(staged, output);
      if (outcome !== 'missing-output') fs.writeFileSync(staged, 'new image');
      if (outcome === 'cancel') job.cancel();
      if (outcome === 'worker-error') child.emit('error', Error('worker failed'));
      child.emit('close', outcome === 'exit-failure' ? 1 : 0, null);
      assert.equal(fs.readFileSync(output, 'utf8'), outcome === 'success' ? 'new image' : 'previous image');
      assert.equal(fs.existsSync(staged), false);
      assert.equal(job.isCancelled(), outcome === 'cancel');
      assert.equal(kills, outcome === 'cancel' ? 1 : 0);
      assert.equal(errors.length, ['worker-error', 'missing-output'].includes(outcome) ? 1 : 0);
    }
  } finally {
    for (const file of fs.readdirSync(fixture)) fs.unlinkSync(path.join(fixture, file));
    fs.rmdirSync(fixture);
  }
});

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
  api.getMosrGpus();
  assert.equal(calls.pop()[0], 'get-mosr-gpus');
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
    const preview = { ...payload, model: 'mosr-clean-preview-4x' };
    if (process.platform === 'win32') {
      security.validateJobPayload(preview);
      security.validateJobPayload({ ...preview, mosrGpu: '00000000:0001aa57' });
    }
    else assert.throws(() => security.validateJobPayload(preview));
    assert.throws(() => security.validateJobPayload({ ...preview, batchFolderPath: selected }, true));
    for (const mosrGpu of ['1', '', '../gpu', '00000000:0001aa57; command', 1, {}]) assert.throws(() => security.validateJobPayload({ ...preview, mosrGpu }));
    for (const invalid of [{ scale: '2' }, { saveImageAs: 'jpg' }, { gpuId: '1' }, { ttaMode: true }, { tileSize: 32 }, { useCustomWidth: true }, { noImageProcessing: true }, { compression: '10' }]) assert.throws(() => security.validateJobPayload({ ...preview, ...invalid }));
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
  const config = { savedCustomModelsPath: undefined, childProcesses: [], setChildProcesses() {}, removeChildProcess() {} };
  const security = load('export/electron/security.js', { './path-access': access, './utils/config-variables': config });
  const captured = [];
  const spawn = args => {
    captured.push(args);
    const process = new EventEmitter(); process.stderr = new EventEmitter(); process.stdout = new EventEmitter();
    return { process, kill() {}, isCancelled: () => false };
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
  const config = { savedCustomModelsPath: undefined, setChildProcesses() {}, removeChildProcess() {} };
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

test('job completion, two-pass outputs, converted metadata, and cancellation use production handlers', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'upscayl-workflow-test-'));
  const input = path.join(fixture, 'input'); const output = path.join(fixture, 'output');
  fs.mkdirSync(input); fs.mkdirSync(output);
  const imagePath = path.join(input, 'photo.png'); fs.writeFileSync(imagePath, 'input');
  const messages = []; const jobs = []; const metadata = [];
  const config = { savedCustomModelsPath: undefined, childProcesses: [],
    setChildProcesses(child) { config.childProcesses.push(child); },
    removeChildProcess(child) { config.childProcesses = config.childProcesses.filter(value => value !== child); },
    clearChildProcesses() { config.childProcesses = []; },
  };
  const mocks = {
    '../main-window': { getMainWindow: () => ({ setProgressBar() {}, webContents: { send: (...args) => messages.push(args) } }) },
    '../utils/config-variables': config, '../utils/get-resource-paths': { modelsPath: fixture },
    '../utils/logit': () => {}, '../utils/show-notification': () => {}, '../path-access': { assertOutputAccess() {} },
    '../utils/copy-metadata': { copyMetadata: async (...args) => metadata.push(args) },
    '../utils/spawn-upscayl': { spawnUpscayl: args => {
      const process = new EventEmitter(); process.stderr = new EventEmitter();
      let cancelled = false;
      const child = { args, process, kill() {}, cancel() { cancelled = true; }, isCancelled: () => cancelled };
      jobs.push(child); return child;
    } },
  };
  const single = load('export/electron/commands/image-upscayl.js', mocks).default;
  const double = load('export/electron/commands/double-upscayl.js', mocks).default;
  const batch = load('export/electron/commands/batch-upscayl.js', mocks).default;
  const stop = load('export/electron/commands/stop.js', mocks).default;
  const commands = load('export/common/electron-commands.js').ELECTRON_COMMANDS;
  const options = { imagePath, outputPath: output, batchFolderPath: input, model: 'upscayl-standard-4x', scale: '4', gpuId: '', compression: '0', tileSize: null, saveImageAs: 'jpg', ttaMode: false, copyMetadata: false, useCustomWidth: false, overwrite: true };
  const destination = child => child.args[child.args.indexOf('-o') + 1];
  const close = async (child, code = 0, signal = null) => { for (const listener of child.process.listeners('close')) await listener(code, signal); };
  const done = () => messages.some(([channel]) => [commands.UPSCAYL_DONE, commands.DOUBLE_UPSCAYL_DONE, commands.FOLDER_UPSCAYL_DONE].includes(channel));
  try {
    for (const handler of [single, double, batch]) {
      for (const [code, signal, contents] of [[1, null, 'output'], [null, 'SIGTERM', 'output'], [0, null, null], [0, null, '']]) {
        messages.length = 0;
        await handler({}, options); const child = jobs.at(-1);
        const target = handler === batch ? path.join(destination(child), 'photo.jpg') : destination(child);
        if (fs.existsSync(target)) fs.unlinkSync(target);
        if (contents !== null) fs.writeFileSync(target, contents);
        const count = jobs.length;
        await close(child, code, signal);
        assert.equal(done(), false); assert.equal(jobs.length, count);
        assert.ok(messages.some(([channel]) => channel === commands.UPSCAYL_ERROR));
      }
    }
    messages.length = 0;
    await single({}, options); const singleJob = jobs.at(-1);
    fs.writeFileSync(destination(singleJob), 'single');
    await close(singleJob); assert.equal(done(), true);
    const singleFile = destination(singleJob);
    fs.writeFileSync(singleFile, '');
    messages.length = 0;
    await single({}, { ...options, overwrite: false }); const retrySingle = jobs.at(-1);
    assert.notEqual(retrySingle, singleJob); assert.equal(done(), false);
    fs.writeFileSync(destination(retrySingle), 'single'); await close(retrySingle);
    assert.equal(done(), true);
    messages.length = 0;
    await double({}, { ...options, overwrite: false }); const first = jobs.at(-1);
    fs.writeFileSync(destination(first), 'first');
    await close(first); const second = jobs.at(-1);
    assert.notEqual(first, second);
    assert.equal(second.args[second.args.indexOf('-i') + 1], destination(first));
    assert.notEqual(destination(second), destination(first));
    fs.writeFileSync(destination(second), 'double');
    await close(second);
    const doubleFile = messages.find(([channel]) => channel === commands.DOUBLE_UPSCAYL_DONE)[1];
    assert.notEqual(doubleFile, singleFile); assert.equal(fs.readFileSync(singleFile, 'utf8'), 'single');
    assert.equal(fs.readFileSync(doubleFile, 'utf8'), 'double');
    messages.length = 0; const count = jobs.length;
    await double({}, { ...options, overwrite: false }); assert.equal(jobs.length, count); assert.equal(done(), true);
    fs.writeFileSync(doubleFile, ''); messages.length = 0;
    await double({}, { ...options, overwrite: false }); const retryFirst = jobs.at(-1);
    assert.equal(jobs.length, count + 1); assert.equal(done(), false);
    fs.writeFileSync(destination(retryFirst), 'first'); await close(retryFirst);
    const retrySecond = jobs.at(-1); fs.writeFileSync(destination(retrySecond), 'double'); await close(retrySecond);
    assert.equal(fs.readFileSync(doubleFile, 'utf8'), 'double'); assert.equal(done(), true);
    await double({}, options); const failedFirst = jobs.at(-1);
    fs.writeFileSync(destination(failedFirst), 'first'); await close(failedFirst);
    const failedSecond = jobs.at(-1); fs.writeFileSync(destination(failedSecond), 'partial');
    messages.length = 0; await close(failedSecond, 2);
    assert.equal(done(), false); assert.equal(fs.readFileSync(doubleFile, 'utf8'), 'double');
    messages.length = 0;
    await batch({}, { ...options, copyMetadata: true }); const batchJob = jobs.at(-1);
    const batchFile = path.join(destination(batchJob), 'photo.jpg'); fs.writeFileSync(batchFile, 'batch');
    await close(batchJob); assert.equal(done(), true);
    assert.deepEqual(metadata.at(-1), [imagePath, batchFile]);
    for (const handler of [single, double, batch]) {
      messages.length = 0; await handler({}, options); const cancelledJob = jobs.at(-1);
      await stop({}, {}); assert.ok(cancelledJob.isCancelled());
      assert.ok(messages.some(([channel]) => channel === commands.CANCELLED));
      await single({}, options); const newerJob = jobs.at(-1);
      const count = jobs.length;
      const target = handler === batch ? path.join(destination(cancelledJob), 'photo.jpg') : destination(cancelledJob);
      fs.writeFileSync(target, 'late output');
      await close(cancelledJob); assert.equal(done(), false); assert.equal(jobs.length, count);
      assert.ok(config.childProcesses.includes(newerJob));
      await stop({}, {}); await close(newerJob);
    }
    assert.equal(config.childProcesses.length, 0);
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(fixture).startsWith('upscayl-workflow-test-'));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('legacy GPU storage and custom model pairs load correctly', async () => {
  for (const saved of ['0', '0,1', '"0,1"']) {
    const values = new Map([['gpuId', saved]]);
    const window = { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } };
    const atoms = load('renderer/atoms/user-settings-atom.ts', { jotai: { atom() {} }, 'jotai/utils': { atomWithStorage: (key, fallback) => JSON.parse(values.get(key) ?? JSON.stringify(fallback)) } }, { window });
    assert.equal(atoms.gpuIdAtom, saved === '0' ? '0' : '0,1');
  }
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'upscayl-model-pairs-'));
  try {
    for (const name of ['complete.param', 'complete.bin', 'incomplete.param', 'orphan.bin']) fs.writeFileSync(path.join(fixture, name), 'model');
    const getModels = load('export/electron/utils/get-models.js', { electron: { app: {}, dialog: { showMessageBoxSync() {} } }, 'electron-settings': { get: async () => null }, './logit': () => {} }).default;
    assert.deepEqual(Array.from(await getModels(fixture)), ['complete']);
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(fixture).startsWith('upscayl-model-pairs-'));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('invalid locale schema sets a failing exit code', () => {
  const taskProcess = { exitCode: 0 };
  load('scripts/validate-schema.js', { fs: { readFileSync: () => '{}', readdirSync: () => ['en.json', 'invalid.json'] }, ajv: class { compile() { const validate = () => false; validate.errors = []; return validate; } }, './generate-schema': { generateSchema: () => ({}) } }, { process: taskProcess, console: { log() {}, error() {} }, __dirname: path.join(root, 'scripts') });
  assert.equal(taskProcess.exitCode, 1);
});

test('fork version uses the desktop API with a renamed application user agent', async () => {
  const effects = [];
  let displayed;
  let calls = 0;
  const useVersion = load('renderer/components/hooks/use-upscayl-version.ts', {
    react: { useState: initial => [initial, value => { displayed = value; }], useEffect: effect => effects.push(effect) },
  }, {
    navigator: { userAgent: 'Rescayl/2.16.0-preview.2' },
    window: { electron: { getAppVersion: async () => { calls++; return '2.16.0-preview.2 FOSS'; } } },
  }).default;
  assert.equal(useVersion(), null);
  effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(displayed, '2.16.0-preview.2 FOSS');
});
