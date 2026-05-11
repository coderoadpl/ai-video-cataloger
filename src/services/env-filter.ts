/**
 * Environment variable filter for subprocess execution.
 * Removes debugger-related variables that can cause SIGTRAP in child processes.
 */

/**
 * Get filtered environment variables for subprocess execution.
 * Removes debugger-related variables that can cause SIGTRAP in child processes
 * (especially when running from VSCode or Electron with debugging enabled).
 */
export function getFilteredEnv(): NodeJS.ProcessEnv {
  const envKeysToExclude = [
    'ELECTRON_RUN_AS_NODE',
    'ELECTRON_NO_ASAR',
    'NODE_OPTIONS',
    'NODE_DEBUG',
    'DEBUG',
    'VSCODE_INSPECTOR_OPTIONS',
    'VSCODE_CLI',
    'VSCODE_PID',
    'VSCODE_CWD',
    'VSCODE_NLS_CONFIG',
    'VSCODE_CODE_CACHE_PATH',
    'VSCODE_HANDLES_UNCAUGHT_ERRORS',
    // Claude Code nesting detection - must be unset to allow spawning claude from within claude
    'CLAUDECODE',
  ];

  const filteredEnv: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (!envKeysToExclude.includes(key) && !key.startsWith('VSCODE_')) {
      filteredEnv[key] = value;
    }
  }

  return filteredEnv;
}
