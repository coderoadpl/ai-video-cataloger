const config = {
  appId: 'com.ai-video-cataloger.app',
  productName: 'AI Video Cataloger',
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  files: [
    'dist-electron/**/*',
    'dist/web/**/*',
    'package.json',
    'node_modules/ffmpeg-static/ffmpeg',
    'node_modules/ffmpeg-static/package.json',
    'node_modules/@ffprobe-installer/ffprobe/package.json',
    'node_modules/@ffprobe-installer/darwin-arm64/ffprobe',
    'node_modules/@ffprobe-installer/darwin-arm64/package.json',
    'node_modules/sql.js/dist/sql-wasm.wasm',
  ],
  asarUnpack: [
    'node_modules/ffmpeg-static/ffmpeg',
    'node_modules/@ffprobe-installer/darwin-arm64/ffprobe',
    'node_modules/sql.js/dist/sql-wasm.wasm',
  ],
  extraResources: [
    {
      from: 'dist/cli',
      to: 'cli',
      filter: ['**/*'],
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
