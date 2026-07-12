/** Second, independent enforcement of docs/architecture.md — including vendor lock bans. */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'core-domain-depends-on-nothing',
      severity: 'error',
      from: { path: '^core/domain' },
      to: { path: '^(core/(contract|server|client)|adapters|apps)' },
    },
    {
      name: 'core-contract-only-domain',
      severity: 'error',
      from: { path: '^core/contract' },
      to: { path: '^(core/(server|client)|adapters|apps)' },
    },
    {
      name: 'core-server-pure',
      severity: 'error',
      from: { path: '^core/server' },
      to: { path: '^(core/(contract|client)|adapters|apps)' },
    },
    {
      name: 'core-client-never-server-side',
      severity: 'error',
      from: { path: '^core/client' },
      to: { path: '^(core/server|adapters|apps)' },
    },
    {
      name: 'adapters-never-import-apps',
      severity: 'error',
      from: { path: '^adapters' },
      to: { path: '^apps' },
    },
    {
      name: 'web-never-server-side',
      severity: 'error',
      comment: 'The renderer is a pure contract client: no core/server, adapters or other apps.',
      from: { path: '^apps/web' },
      to: { path: '^(core/server|adapters|apps/(server|cli|desktop))' },
    },
    {
      name: 'cli-only-composes-server',
      severity: 'error',
      comment: 'CLI is a composition root over createApp: no core/server, adapters, web or desktop.',
      from: { path: '^apps/cli' },
      to: { path: '^(core/server|adapters|apps/(web|desktop))' },
    },
    {
      name: 'desktop-only-composes',
      severity: 'error',
      comment: 'Electron main is a composition root over createApp: no core/server, web or cli.',
      from: { path: '^apps/desktop' },
      to: { path: '^(core/server|apps/(web|cli))' },
    },
    {
      name: 'no-frameworks-in-core',
      severity: 'error',
      from: { path: '^core' },
      to: { path: 'node_modules/(hono|react|react-dom|drizzle-orm|commander|electron)(/|$)' },
    },
    {
      name: 'electron-only-in-desktop',
      severity: 'error',
      comment: 'Only apps/desktop (composition root + preload) may import electron.',
      from: { path: '^(core|adapters|apps/(server|web|cli))' },
      to: { path: 'node_modules/electron(/|$)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
