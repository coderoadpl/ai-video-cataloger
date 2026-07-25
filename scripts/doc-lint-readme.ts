const PNPM_RUN = /\bpnpm run ([A-Za-z][\w:-]*)/g;

export const documentedScripts = (markdown: string): string[] => {
  const names = new Set<string>();
  for (const match of markdown.matchAll(PNPM_RUN)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return [...names];
};

export const readmeScriptProblems = (
  rel: string,
  markdown: string,
  scripts: ReadonlySet<string>,
): string[] =>
  documentedScripts(markdown)
    .filter((name) => !scripts.has(name))
    .map(
      (name) =>
        `[readme->scripts] ${rel} documents "pnpm run ${name}", which is not a script in ` +
        'the package.json that owns it — add the script or fix the docs.',
    );
