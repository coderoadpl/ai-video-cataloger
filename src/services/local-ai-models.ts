/**
 * Local AI model management surfaces (CLI command bodies): list, pull, rm,
 * requirements, daemon-stop. Human and --json output, consistent with the
 * existing whisper model commands. Read-only commands never start downloads
 * or the runtime; pull is the only entry point that boots/installs it.
 */

import chalk from 'chalk';
import ora from 'ora';
import {
  emitCompleted, emitError, emitProgress, emitStarted, isJsonMode, logHuman,
} from './json-output.js';
import {
  describeMachine, getMachine, MODEL_TIERS, recommendTier, supportLevel,
  type MachineInfo, type SupportLevel,
} from './hw-requirements.js';
import {
  ensureLocalRuntime, findRunningRuntime, stopManagedDaemon, OLLAMA_PINNED_VERSION,
} from './ollama-setup.js';
import { deleteModel, listModels, pullModel } from './ollama-client.js';
import { CodedError } from './json-output.js';

interface TierView {
  tag: string;
  label: string;
  downloadGB: number;
  minTotalMemGB: number;
  supportLevel: SupportLevel;
  installed: boolean;
  recommended: boolean;
}

function badge(level: SupportLevel): string {
  switch (level) {
    case 'ok': return chalk.green('✓ compatible');
    case 'insufficient-ram': return chalk.red('✗ not enough RAM');
    case 'unsupported-platform': return chalk.red('✗ Apple Silicon required');
  }
}

async function collectTierViews(machine: MachineInfo): Promise<{ views: TierView[]; runtimeUp: boolean }> {
  const runtime = await findRunningRuntime();
  let installedNames: string[] = [];
  if (runtime) {
    try {
      installedNames = (await listModels(runtime.baseUrl)).map((m) => m.name);
    } catch {
      // runtime vanished between probe and list - treat as not running
    }
  }
  const recommended = recommendTier(machine);
  const views = MODEL_TIERS.map((tier) => ({
    tag: tier.tag,
    label: tier.label,
    downloadGB: tier.downloadGB,
    minTotalMemGB: tier.minTotalMemGB,
    supportLevel: supportLevel(tier, machine),
    installed: installedNames.some((name) => name === tier.tag || name === `${tier.tag}:latest`),
    recommended: recommended?.tag === tier.tag,
  }));
  return { views, runtimeUp: runtime !== null };
}

/** models requirements [--json] */
export async function displayLocalAiRequirements(): Promise<void> {
  const machine = getMachine();
  const { views, runtimeUp } = await collectTierViews(machine);

  if (isJsonMode()) {
    emitStarted('models_requirements', {});
    emitCompleted({ machine, runtimeUp, runtimeVersion: OLLAMA_PINNED_VERSION, tiers: views });
    return;
  }

  console.log(chalk.bold('\nLocal AI - hardware requirements\n'));
  console.log(`Your machine: ${chalk.cyan(describeMachine(machine))}`);
  const recommended = views.find((view) => view.recommended);
  if (recommended) {
    console.log(`Recommended model: ${chalk.green(recommended.tag)}\n`);
  } else {
    console.log(chalk.red('Local AI is not supported on this machine (Apple Silicon required).\n'));
  }

  for (const view of views) {
    const marker = view.recommended ? chalk.green(' (recommended)') : '';
    const installed = view.installed ? chalk.green(' [installed]') : '';
    console.log(`  ${chalk.bold(view.tag)}${marker}${installed}`);
    console.log(`    ${view.label} - download ${view.downloadGB} GB, requires ${view.minTotalMemGB} GB RAM`);
    console.log(`    ${badge(view.supportLevel)}`);
  }
  console.log('');
  if (!runtimeUp) {
    console.log(chalk.gray('Local AI runtime is not running - it starts automatically when needed.\n'));
  }
}

/** models list - the Local AI section (whisper section is printed separately) */
export async function displayLocalAiModelList(): Promise<void> {
  const machine = getMachine();
  const { views, runtimeUp } = await collectTierViews(machine);

  if (isJsonMode()) {
    emitCompleted({ section: 'local-ai', machine, runtimeUp, tiers: views });
    return;
  }

  console.log(chalk.bold('\nLocal AI models (Ollama)\n'));
  for (const view of views) {
    const status = view.installed ? chalk.green('✓ installed') : chalk.gray('not installed');
    const marker = view.recommended ? chalk.green(' (recommended)') : '';
    console.log(`  ${chalk.bold(view.tag)}${marker} - ${status} - ${view.downloadGB} GB, needs ${view.minTotalMemGB} GB RAM - ${badge(view.supportLevel)}`);
  }
  console.log('');
  if (!runtimeUp) {
    console.log(chalk.gray('Runtime not running (starts automatically when needed).\n'));
  }
}

/** models pull <tag> [--json] */
export async function pullLocalAiModel(tag: string): Promise<boolean> {
  const machine = getMachine();
  const tier = MODEL_TIERS.find((t) => t.tag === tag);

  // Warn/block only on hopeless configurations; unknown tags are allowed
  if (tier && supportLevel(tier, machine) !== 'ok') {
    const level = supportLevel(tier, machine);
    const message =
      level === 'unsupported-platform'
        ? 'Local AI requires an Apple Silicon Mac.'
        : `${tag} needs at least ${tier.minTotalMemGB} GB RAM (this machine has ${machine.totalMemGB} GB).`;
    if (isJsonMode()) {
      emitError(message, { code: 'HW_REQUIREMENTS_NOT_MET', data: { tag, machine } });
    } else {
      console.error(chalk.red(`\n✗ ${message}`));
    }
    return false;
  }

  if (isJsonMode()) emitStarted('models_pull', { tag });

  const spinner = isJsonMode() ? null : ora({ text: `Preparing local AI runtime...`, color: 'blue' }).start();

  try {
    const runtime = await ensureLocalRuntime((event) => {
      if (spinner) spinner.text = event.status;
      else emitProgress('runtime_setup', { data: { status: event.status } });
    });

    let lastPercent = -1;
    await pullModel(runtime.baseUrl, tag, (progress) => {
      if (spinner) {
        spinner.text = progress.percent !== null
          ? `Downloading ${tag}: ${progress.percent}% (${progress.status})`
          : `Downloading ${tag}: ${progress.status}`;
      } else if (progress.percent !== null && progress.percent !== lastPercent) {
        lastPercent = progress.percent;
        emitProgress('model_download', { percentage: progress.percent, data: { tag, status: progress.status } });
      }
    });

    spinner?.succeed(`Model ${chalk.cyan(tag)} is ready`);
    if (isJsonMode()) emitCompleted({ tag, status: 'installed' });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof CodedError ? error.code : 'MODEL_PULL_FAILED';
    spinner?.fail(`Failed to pull ${tag}: ${message}`);
    if (isJsonMode()) emitError(message, { code, data: { tag } });
    return false;
  }
}

/** models rm <tag> [--json] */
export async function removeLocalAiModel(tag: string): Promise<boolean> {
  if (isJsonMode()) emitStarted('models_rm', { tag });
  try {
    const runtime = await findRunningRuntime();
    if (!runtime) {
      throw new CodedError(
        'Local AI runtime is not running - nothing to remove from',
        'OLLAMA_UNAVAILABLE'
      );
    }
    await deleteModel(runtime.baseUrl, tag);
    if (isJsonMode()) emitCompleted({ tag, status: 'removed' });
    else console.log(chalk.green(`\n✓ Removed ${tag}`));
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof CodedError ? error.code : 'MODEL_RM_FAILED';
    if (isJsonMode()) emitError(message, { code, data: { tag } });
    else console.error(chalk.red(`\n✗ ${message}`));
    return false;
  }
}

/** models daemon-stop */
export function stopLocalAiDaemon(): void {
  const stopped = stopManagedDaemon();
  if (isJsonMode()) {
    emitCompleted({ stopped });
    return;
  }
  logHuman(
    stopped
      ? chalk.green('\n✓ Managed local AI runtime stopped')
      : chalk.gray('\nNo managed local AI runtime was running (user-owned daemons are never touched).')
  );
}
