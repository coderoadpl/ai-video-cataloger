/**
 * Renderer tests for the Local AI GUI surfaces:
 *  1. tier rows render with hardware badges from `models requirements --json`
 *     (including the unsupported-platform machine),
 *  2. Download drives a progress bar from `models pull --json` events and
 *     disables other actions while pulling,
 *  3. the Settings analyzer section warns when the selected model is missing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installElectronApiMock, type ElectronApiMock } from '../../test/electron-api-mock';
import { useCliCommand } from '@/hooks/use-cli-command';
import { LocalAiSection } from './local-ai-section';
import { SettingsAnalyzerSection } from '@/components/settings-analyzer-section';
import type { LocalAiTier } from '@/hooks/use-local-ai-models';

let mock: ElectronApiMock;

beforeEach(() => {
  mock = installElectronApiMock();
});

const TIERS: LocalAiTier[] = [
  { tag: 'gemma3:4b', label: 'Gemma 3 4B (compact)', downloadGB: 3.3, minTotalMemGB: 8, supportLevel: 'ok', installed: true, recommended: false },
  { tag: 'gemma3:12b', label: 'Gemma 3 12B (standard)', downloadGB: 8.1, minTotalMemGB: 16, supportLevel: 'ok', installed: false, recommended: true },
  { tag: 'gemma3:27b', label: 'Gemma 3 27B (max)', downloadGB: 17, minTotalMemGB: 32, supportLevel: 'insufficient-ram', installed: false, recommended: false },
];

const MACHINE = { platform: 'darwin', arch: 'arm64', totalMemGB: 16, appleSilicon: true };

/** Let runCli finish wiring (ownSpawnId assignment) before we emit events. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function Harness(): JSX.Element {
  const runCli = useCliCommand();
  return <LocalAiSection runCli={runCli} active={true} />;
}

async function answerRequirements(
  tiers: LocalAiTier[],
  machine: typeof MACHINE | { platform: string; arch: string; totalMemGB: number; appleSilicon: boolean } = MACHINE
): Promise<void> {
  const spawn = await mock.waitForSpawn();
  await flush();
  expect(spawn.args).toEqual(['models', 'requirements', '--json']);
  mock.emitJson(spawn.spawnId, {
    type: 'completed',
    timestamp: '',
    data: { machine, runtimeUp: true, tiers } as unknown as Record<string, unknown>,
  });
  mock.emitExit(spawn.spawnId, 0);
}

describe('LocalAiSection', () => {
  it('renders tiers with hardware badges, including unsupported machines', async () => {
    render(<Harness />);
    await answerRequirements(TIERS);

    await waitFor(() => {
      expect(screen.getAllByTestId('ai-model-row')).toHaveLength(3);
    });

    const rows = screen.getAllByTestId('ai-model-row');
    expect(rows[0]).toHaveAttribute('data-ai-model-installed', 'true');
    expect(rows[1].textContent).toContain('(recommended)');
    expect(rows[2].textContent).toContain('Needs 32 GB RAM');
    // machine line
    expect(screen.getByTestId('local-ai-machine').textContent).toContain('16 GB RAM');
    // oversized tier download is disabled
    const downloads = screen.getAllByTestId('ai-model-download');
    const bigDownload = downloads.find((el) => el.closest('[data-ai-model-tag="gemma3:27b"]'));
    expect(bigDownload).toBeDisabled();
  });

  it('drives the download progress bar from pull events and refreshes after', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await answerRequirements(TIERS);
    await waitFor(() => expect(screen.getAllByTestId('ai-model-row')).toHaveLength(3));

    // Click download on the recommended 12b tier
    const downloads = screen.getAllByTestId('ai-model-download');
    const target = downloads.find((el) => el.closest('[data-ai-model-tag="gemma3:12b"]'));
    expect(target).toBeDefined();
    await user.click(target!);

    const pullSpawn = await mock.waitForSpawn();
    await flush();
    expect(pullSpawn.args).toEqual(['models', 'pull', 'gemma3:12b', '--json']);

    mock.emitJson(pullSpawn.spawnId, { type: 'progress', timestamp: '', percentage: 42 } as unknown as JsonEvent);
    await waitFor(() => {
      expect(screen.getByTestId('ai-model-progress').textContent).toContain('42%');
    });

    // While pulling, the other download button is disabled
    const otherDownload = screen
      .getAllByTestId('ai-model-download')
      .find((el) => el.closest('[data-ai-model-tag="gemma3:27b"]'));
    expect(otherDownload).toBeDisabled();

    // Finish the pull; the section refreshes (new requirements spawn)
    mock.emitJson(pullSpawn.spawnId, { type: 'completed', timestamp: '' } as unknown as JsonEvent);
    mock.emitExit(pullSpawn.spawnId, 0);

    const refreshSpawn = await mock.waitForSpawn();
    await flush();
    expect(refreshSpawn.args).toEqual(['models', 'requirements', '--json']);
    mock.emitJson(refreshSpawn.spawnId, {
      type: 'completed',
      timestamp: '',
      data: {
        machine: MACHINE,
        runtimeUp: true,
        tiers: TIERS.map((tier) => (tier.tag === 'gemma3:12b' ? { ...tier, installed: true } : tier)),
      } as unknown as Record<string, unknown>,
    });
    mock.emitExit(refreshSpawn.spawnId, 0);

    await waitFor(() => {
      expect(screen.queryByTestId('ai-model-progress')).toBeNull();
      const row = screen
        .getAllByTestId('ai-model-row')
        .find((el) => el.getAttribute('data-ai-model-tag') === 'gemma3:12b');
      expect(row).toHaveAttribute('data-ai-model-installed', 'true');
    });
  });
});

describe('SettingsAnalyzerSection', () => {
  it('warns when the selected local model is not installed', () => {
    const { rerender } = render(
      <SettingsAnalyzerSection
        backend="local"
        localModel="gemma3:12b"
        tiers={TIERS}
        onBackendChange={() => {}}
        onLocalModelChange={() => {}}
      />
    );
    expect(screen.getByTestId('local-model-missing-hint').textContent).toContain('not downloaded');

    // and no warning when the model is installed
    rerender(
      <SettingsAnalyzerSection
        backend="local"
        localModel="gemma3:4b"
        tiers={TIERS}
        onBackendChange={() => {}}
        onLocalModelChange={() => {}}
      />
    );
    expect(screen.queryByTestId('local-model-missing-hint')).toBeNull();
  });
});
