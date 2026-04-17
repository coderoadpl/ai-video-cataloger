/**
 * @type {import('electron-builder').Configuration}
 */
const config = {
  appId: 'com.ai-video-cataloger.app',
  productName: 'AI Video Cataloger',
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  files: [
    'dist-electron/**/*',
  ],
  mac: {
    target: [
      {
        target: 'dmg',
        arch: ['arm64', 'x64'],
      },
    ],
    category: 'public.app-category.utilities',
    darkModeSupport: true,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
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
};

export default config;
