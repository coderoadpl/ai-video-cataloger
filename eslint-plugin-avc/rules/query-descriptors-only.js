import path from 'node:path';

const QUERY_HOOKS = new Set(['useQuery', 'useQueries', 'useMutation']);

const CORE_CLIENT_PREFIX = '@core/client/';
const WEB_API_BINDING = 'apps/web/src/api';
const ISLAND_CORE_INDEX = /^apps\/web\/src\/features\/[^/]+\/core\/index$/;
const ISLAND_WEB_BINDING = /^apps\/web\/src\/features\/[^/]+\/index\.web$/;

const stripExt = (repoRel) => repoRel.replace(/\.[cm]?[jt]sx?$/, '');

// Origin is decided by the specifier's RESOLVED repo-relative path, never by a
// filename suffix: a look-alike local module ending in `/api.js` must not pass,
// only the one true web binding, an island `core/index.ts` and its `index.web.ts`.
const resolveDescriptorSource = (specifier, importerFile, cwd) => {
  if (typeof specifier !== 'string') return null;
  if (specifier.startsWith(CORE_CLIENT_PREFIX)) return CORE_CLIENT_PREFIX;
  if (!specifier.startsWith('.')) return null;
  const absolute = path.resolve(path.dirname(importerFile), specifier);
  const repoRel = stripExt(path.relative(cwd, absolute).split(path.sep).join('/'));
  if (
    repoRel === WEB_API_BINDING ||
    ISLAND_CORE_INDEX.test(repoRel) ||
    ISLAND_WEB_BINDING.test(repoRel)
  ) {
    return repoRel;
  }
  return null;
};

const isDescriptorModule = (specifier, importerFile, cwd) =>
  resolveDescriptorSource(specifier, importerFile, cwd) !== null;

const keyName = (key) => {
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal') return String(key.value);
  return null;
};

const rootIdentifier = (node) => {
  switch (node.type) {
    case 'Identifier':
      return node;
    case 'MemberExpression':
      return rootIdentifier(node.object);
    case 'CallExpression':
      return rootIdentifier(node.callee);
    case 'ChainExpression':
      return rootIdentifier(node.expression);
    case 'TSNonNullExpression':
      return rootIdentifier(node.expression);
    default:
      return null;
  }
};

const findVariable = (scope, name) => {
  let current = scope;
  while (current) {
    const found = current.variables.find((variable) => variable.name === name);
    if (found) return found;
    current = current.upper;
  }
  return null;
};

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'useQuery/useQueries/useMutation arguments must originate from an imported action descriptor, never an inline object literal.',
    },
    schema: [],
    messages: {
      inlineObject:
        'The {{hook}} argument must originate from an imported action descriptor (e.g. actions.scan or actions.scan(...)), never an inline object literal. Spread a descriptor to add options: {{hook}}({ ...actions.foo, enabled }).',
      notImported:
        'The {{hook}} argument must originate from an imported action descriptor, not `{{name}}`.',
      foreignModule:
        'The {{hook}} argument must come from a canonical descriptor module (@core/client, the web api.ts binding, an island core/index.ts, or an island index.web.ts), not `{{name}}` imported from "{{module}}".',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const importerFile = context.filename;
    const cwd = context.cwd;
    const descriptorNames = new Set();

    const importSourceOf = (identifierNode) => {
      const variable = findVariable(sourceCode.getScope(identifierNode), identifierNode.name);
      if (!variable) return null;
      for (const def of variable.defs) {
        if (def.type === 'ImportBinding' && def.parent?.type === 'ImportDeclaration') {
          return def.parent.source.value;
        }
      }
      return null;
    };

    const isFromImport = (node) => {
      const root = rootIdentifier(node);
      if (!root) return false;
      if (descriptorNames.has(root.name)) return true;
      const variable = findVariable(sourceCode.getScope(root), root.name);
      if (!variable) return false;
      for (const def of variable.defs) {
        if (def.type === 'ImportBinding') {
          const decl = def.parent;
          return (
            decl?.type === 'ImportDeclaration' &&
            isDescriptorModule(decl.source.value, importerFile, cwd)
          );
        }
        if (def.type === 'Variable' && def.node.type === 'VariableDeclarator' && def.node.init) {
          const initRoot = rootIdentifier(def.node.init);
          if (initRoot && descriptorNames.has(initRoot.name)) return true;
        }
      }
      return false;
    };

    const checkOrigin = (node, hook) => {
      if (isFromImport(node)) return;
      const root = rootIdentifier(node);
      const module = root ? importSourceOf(root) : null;
      if (root && module !== null) {
        context.report({ node, messageId: 'foreignModule', data: { hook, name: root.name, module } });
        return;
      }
      context.report({
        node,
        messageId: 'notImported',
        data: { hook, name: root ? root.name : 'expression' },
      });
    };

    const validate = (node, hook) => {
      if (node.type === 'SpreadElement') {
        checkOrigin(node.argument, hook);
        return;
      }
      if (node.type === 'ObjectExpression') {
        const spreadsDescriptor = node.properties.some(
          (property) => property.type === 'SpreadElement' && isFromImport(property.argument),
        );
        if (!spreadsDescriptor) {
          context.report({ node, messageId: 'inlineObject', data: { hook } });
        }
        return;
      }
      checkOrigin(node, hook);
    };

    return {
      ImportDeclaration(node) {
        if (!isDescriptorModule(node.source.value, importerFile, cwd)) return;
        for (const specifier of node.specifiers) descriptorNames.add(specifier.local.name);
      },
      CallExpression(node) {
        if (node.callee.type !== 'Identifier') return;
        const hook = node.callee.name;
        if (!QUERY_HOOKS.has(hook)) return;
        const arg = node.arguments[0];
        if (!arg) return;
        if (hook === 'useQueries' && arg.type === 'ObjectExpression') {
          const queries = arg.properties.find(
            (property) =>
              property.type === 'Property' && !property.computed && keyName(property.key) === 'queries',
          );
          if (queries && queries.value.type === 'ArrayExpression') {
            for (const element of queries.value.elements) {
              if (element) validate(element, hook);
            }
            return;
          }
        }
        validate(arg, hook);
      },
    };
  },
};
