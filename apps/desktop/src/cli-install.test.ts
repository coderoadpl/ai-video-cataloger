import { describe, expect, it } from 'vitest';

import {
  buildCliWrapperScript,
  buildDevCliWrapperScript,
  buildOsascriptExpression,
  buildPrivilegedInstallShellCommand,
  commandNameForRuntime,
  installPathForRuntime,
} from './cli-install.js';

describe('CLI installer', () => {
  it('builds an Electron wrapper for app and CLI paths containing spaces', () => {
    const script = buildCliWrapperScript({
      appBinaryPath: '/Applications/AI Video Cataloger.app/Contents/MacOS/AI Video Cataloger',
      cliEntryPath: '/Applications/AI Video Cataloger.app/Contents/Resources/cli/index.js',
    });

    expect(script).toBe(
      [
        '#!/bin/sh',
        "ELECTRON_RUN_AS_NODE=1 exec '/Applications/AI Video Cataloger.app/Contents/MacOS/AI Video Cataloger' '/Applications/AI Video Cataloger.app/Contents/Resources/cli/index.js' \"$@\"",
        '',
      ].join('\n'),
    );
  });

  it('builds a development wrapper that runs dist CLI with the current node executable', () => {
    const script = buildDevCliWrapperScript({
      nodePath: '/Users/dev Tools/node',
      repoRoot: "/Users/dev Projects/owner's app",
      cliEntryPath: "/Users/dev Projects/owner's app/dist/cli/index.js",
    });

    expect(script).toBe(
      [
        '#!/bin/sh',
        "cd '/Users/dev Projects/owner'\\''s app'",
        "exec '/Users/dev Tools/node' '/Users/dev Projects/owner'\\''s app/dist/cli/index.js' \"$@\"",
        '',
      ].join('\n'),
    );
  });

  it('single-quotes privileged shell paths before embedding them in osascript', () => {
    const command = buildPrivilegedInstallShellCommand(
      "/private/tmp/avc cli/owner's script",
      "/usr/local/bin/ai video cataloger's cli",
    );

    expect(command).toBe(
      "mkdir -p '/usr/local/bin' && cp '/private/tmp/avc cli/owner'\\''s script' '/usr/local/bin/ai video cataloger'\\''s cli' && chmod 755 '/usr/local/bin/ai video cataloger'\\''s cli'",
    );
    expect(buildOsascriptExpression(command)).toBe(
      'do shell script "mkdir -p \'/usr/local/bin\' && cp \'/private/tmp/avc cli/owner\'\\\\\'\'s script\' \'/usr/local/bin/ai video cataloger\'\\\\\'\'s cli\' && chmod 755 \'/usr/local/bin/ai video cataloger\'\\\\\'\'s cli\'" with administrator privileges',
    );
  });

  it('uses the production command name for packaged runtime installs', () => {
    expect(commandNameForRuntime(true)).toBe('ai-video-cataloger');
    expect(installPathForRuntime(true)).toBe('/usr/local/bin/ai-video-cataloger');
  });

  it('uses the development command name for unpackaged runtime installs', () => {
    expect(commandNameForRuntime(false)).toBe('ai-video-cataloger-dev');
    expect(installPathForRuntime(false)).toBe('/usr/local/bin/ai-video-cataloger-dev');
  });
});
