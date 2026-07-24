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
      name: 'web-features-are-islands',
      severity: 'error',
      comment:
        'A feature imports only itself; cross-feature sharing extracts downward (components/ui, lib, core/client) or goes through server-state invalidation, never sideways.',
      from: { path: '^apps/web/src/features/([^/]+)/' },
      to: {
        path: '^apps/web/src/features/([^/]+)/',
        pathNot: '^apps/web/src/features/$1/',
      },
    },
    {
      name: 'web-ui-presentational',
      severity: 'error',
      comment: 'components/ui is presentational: only lib, theme and its own siblings — never core, features, routes or api.',
      from: { path: '^apps/web/src/components/ui/' },
      to: {
        path: '^(core/|apps/web/src/(features|routes|api))',
      },
    },
    {
      name: 'web-ui-no-server-state',
      severity: 'error',
      comment: 'components/ui holds no TanStack Query/Router: server state stays in features.',
      from: { path: '^apps/web/src/components/ui/' },
      to: { path: 'node_modules/@tanstack/(react-query|react-router)(/|$)' },
    },
    {
      name: 'web-lib-is-pure-ts',
      severity: 'error',
      comment: 'lib is pure TypeScript: no react and nothing app-internal beyond itself.',
      from: { path: '^apps/web/src/lib/' },
      to: { path: '^(core/|apps/web/src/(features|routes|components|api|theme))' },
    },
    {
      name: 'web-lib-no-react',
      severity: 'error',
      from: { path: '^apps/web/src/lib/' },
      to: { path: 'node_modules/(react|react-dom)(/|$)' },
    },
    {
      name: 'web-routes-are-thin',
      severity: 'error',
      comment: 'Routes wire features/ui/lib only: no core, api or bound clients.',
      from: { path: '^apps/web/src/routes/' },
      to: { path: '^(core/|apps/web/src/api)' },
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
      name: 'island-core-is-portable',
      severity: 'error',
      comment:
        'Island cores (apps/web/src/features/*/core) import no web composition: not api.ts, not i18n, not a sibling feature, not any apps/web path outside their own core — bound descriptors are injected in features/<name>/index.web.ts. A depcruise mirror of the ESLint parent-import ban, so the core typechecks without DOM and runs in plain node (ADR-0005 §Pure-TS cores).',
      from: { path: '^apps/web/src/features/([^/]+)/core/' },
      to: { path: '^apps/web/src/', pathNot: '^apps/web/src/features/$1/core/' },
    },
    {
      name: 'island-core-no-frameworks',
      severity: 'error',
      comment:
        'Island cores are pure TypeScript: no React, MUI or TanStack. Framework bindings live in the web binding (ADR-0005 §Pure-TS cores).',
      from: { path: '^apps/web/src/features/([^/]+)/core/' },
      to: { path: 'node_modules/(react|react-dom|@mui/[^/]+|@tanstack/react-query|@tanstack/react-router)(/|$)' },
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
