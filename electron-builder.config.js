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
  asarUnpack: [
    'node_modules/ffmpeg-static/**/*',
    'electron/resources/bin/**/*',
  ],
};
