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
  extraResources: [
    {
      from: '.cli-stage',
      to: 'cli',
      filter: ['**/*', '!package-lock.json'],
    },
  ],
  mac: {
    target: [
      { target: 'dir', arch: ['arm64'] },
      { target: 'dmg', arch: ['arm64'] },
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
