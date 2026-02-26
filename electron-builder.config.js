/**
 * Electron Builder Configuration
 */
module.exports = {
  appId: 'com.ai-video-cataloger.app',
  productName: 'AI Video Cataloger',
  directories: {
    output: 'release',
    buildResources: 'electron/resources',
  },
  files: [
    'electron/dist/**/*',
    'dist/**/*',
    'package.json',
    // Include ffmpeg-static for bundled FFmpeg (macOS only)
    'node_modules/ffmpeg-static/**/*',
    '!node_modules/ffmpeg-static/ffmpeg-win32*',
    '!node_modules/ffmpeg-static/ffmpeg-linux*',
    // Include ffprobe-installer for bundled FFprobe (macOS only)
    'node_modules/@ffprobe-installer/ffprobe/**/*',
    'node_modules/@ffprobe-installer/darwin-arm64/**/*',
    'node_modules/@ffprobe-installer/darwin-x64/**/*',
    '!node_modules/@ffprobe-installer/win32*',
    '!node_modules/@ffprobe-installer/linux*',
  ],
  extraResources: [
    {
      from: 'electron/resources',
      to: 'resources',
      filter: ['**/*'],
    },
  ],
  mac: {
    category: 'public.app-category.video',
    target: [
      {
        target: 'dmg',
        arch: ['arm64'],
      },
      {
        target: 'dmg',
        arch: ['universal'],
      },
    ],
    icon: 'electron/resources/icon.icns',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'electron/resources/entitlements.mac.plist',
    entitlementsInherit: 'electron/resources/entitlements.mac.plist',
  },
  dmg: {
    contents: [
      {
        x: 130,
        y: 220,
      },
      {
        x: 410,
        y: 220,
        type: 'link',
        path: '/Applications',
      },
    ],
  },
  // Unpack native binaries from asar for execution
  asarUnpack: [
    'node_modules/ffmpeg-static/**/*',
    'node_modules/@ffprobe-installer/**/*',
    'electron/resources/bin/**/*',
  ],
};
