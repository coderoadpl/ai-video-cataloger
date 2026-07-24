import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const appPath = process.argv[2] ?? 'release/mac-arm64/AI Video Cataloger.app';

const walk = async (root) => {
  const out = [];
  const visit = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else {
        out.push(full);
      }
    }
  };
  await visit(root);
  return out;
};

const fail = (message) => {
  console.error(`verify-package: ${message}`);
  process.exitCode = 1;
};

const info = await stat(appPath).catch(() => null);
if (info === null || !info.isDirectory()) {
  fail(`app bundle not found at ${appPath}`);
  process.exit(process.exitCode ?? 1);
}

const files = await walk(appPath);

const onnxBindings = files.filter((file) => file.endsWith(path.join('onnxruntime-node', 'bin', 'napi-v6', 'darwin', 'arm64', 'onnxruntime_binding.node')));
if (onnxBindings.length !== 1) {
  fail(`expected exactly one onnxruntime-node darwin binding, found ${onnxBindings.length}:\n${onnxBindings.join('\n')}`);
} else {
  console.log(`verify-package: onnxruntime-node darwin binding count = 1 (${path.relative(appPath, onnxBindings[0])})`);
}

const nonDarwinArtifacts = files.filter((file) => {
  if (/\.so(\.\d+)*$/.test(file)) return true;
  if (/onnxruntime-node.*bin.*napi-v6.*(linux|win32)/.test(file)) return true;
  if (/onnxruntime-node.*\.dll$/.test(file)) return true;
  return false;
});
if (nonDarwinArtifacts.length > 0) {
  fail(`found ${nonDarwinArtifacts.length} non-darwin onnxruntime artifact(s):\n${nonDarwinArtifacts.map((file) => path.relative(appPath, file)).join('\n')}`);
} else {
  console.log('verify-package: zero non-darwin onnxruntime artifacts (.so / linux / win32 / .dll)');
}

try {
  await execFileAsync('codesign', ['--verify', '--deep', '--strict', appPath]);
  console.log('verify-package: codesign --verify --deep --strict exit 0');
} catch (error) {
  fail(`codesign --verify --deep --strict failed: ${error.stderr ?? error.message}`);
}

try {
  const { stderr } = await execFileAsync('codesign', ['-dvvv', appPath]);
  const identifier = /^Identifier=(.+)$/m.exec(stderr)?.[1];
  const sealed = /^Sealed Resources ?(.+)$/m.exec(stderr)?.[1];
  if (identifier === undefined || identifier === 'Electron') {
    fail(`bundle identifier is not the app identifier (got ${identifier ?? 'none'})`);
  } else {
    console.log(`verify-package: bundle Identifier=${identifier}`);
  }
  if (sealed === undefined || sealed.startsWith('=none')) {
    fail(`bundle resources are not sealed (Sealed Resources ${sealed ?? 'none'})`);
  } else {
    console.log(`verify-package: Sealed Resources ${sealed}`);
  }
} catch (error) {
  fail(`codesign -dvvv failed: ${error.stderr ?? error.message}`);
}

if (process.exitCode === 1) {
  console.error('verify-package: FAILED');
  process.exit(1);
}
console.log('verify-package: OK');
