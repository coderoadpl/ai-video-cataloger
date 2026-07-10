/**
 * Local AI models section (used in the Model Manager): machine summary,
 * tier rows with hardware badges, download-with-progress and delete - all
 * driven by CLI --json commands through useLocalAiModels.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Cpu, Download, Loader2, Trash2 } from 'lucide-react';
import type { RunCli } from '@/hooks/use-cli-command';
import { useLocalAiModels, type LocalAiTier } from '@/hooks/use-local-ai-models';

interface LocalAiSectionProps {
  runCli: RunCli;
  /** Reload trigger, e.g. the modal being (re)opened. */
  active: boolean;
  onLogMessage?: (message: string, type?: 'info' | 'success' | 'error') => void;
}

function supportBadge(tier: LocalAiTier): { text: string; className: string } {
  switch (tier.supportLevel) {
    case 'ok':
      return { text: 'Compatible', className: 'bg-green-100 text-green-700' };
    case 'insufficient-ram':
      return { text: `Needs ${tier.minTotalMemGB} GB RAM`, className: 'bg-red-100 text-red-700' };
    case 'unsupported-platform':
      return { text: 'Apple Silicon required', className: 'bg-red-100 text-red-700' };
  }
}

export function LocalAiSection({ runCli, active, onLogMessage }: LocalAiSectionProps): JSX.Element {
  const localAi = useLocalAiModels(runCli);
  const { refresh } = localAi;
  const [pullingTag, setPullingTag] = useState<string | null>(null);
  const [pullPercent, setPullPercent] = useState(0);
  const [busyTag, setBusyTag] = useState<string | null>(null);

  useEffect(() => {
    if (active) {
      void refresh();
    }
  }, [active, refresh]);

  const handleDownload = useCallback(async (tier: LocalAiTier) => {
    setPullingTag(tier.tag);
    setPullPercent(0);
    onLogMessage?.(`Downloading local AI model ${tier.tag} (${tier.downloadGB} GB)...`, 'info');
    const ok = await localAi.pull(tier.tag, setPullPercent);
    setPullingTag(null);
    onLogMessage?.(
      ok ? `Model ${tier.tag} is ready` : `Failed to download ${tier.tag}`,
      ok ? 'success' : 'error'
    );
    await refresh();
  }, [localAi, onLogMessage, refresh]);

  const handleDelete = useCallback(async (tier: LocalAiTier) => {
    setBusyTag(tier.tag);
    const ok = await localAi.remove(tier.tag);
    setBusyTag(null);
    onLogMessage?.(
      ok ? `Removed ${tier.tag}` : `Failed to remove ${tier.tag}`,
      ok ? 'success' : 'error'
    );
    await refresh();
  }, [localAi, onLogMessage, refresh]);

  return (
    <div className="space-y-3" data-testid="local-ai-section">
      <div>
        <h3 className="text-sm font-semibold">Local AI models (Ollama)</h3>
        <p className="text-xs text-muted-foreground">
          Used by the Local analyzer. The runtime installs and starts automatically.
        </p>
      </div>

      {localAi.machine && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="local-ai-machine">
          <Cpu className="h-3.5 w-3.5" />
          <span>
            Your Mac: {localAi.machine.appleSilicon ? 'Apple Silicon' : `${localAi.machine.platform}/${localAi.machine.arch}`},{' '}
            {localAi.machine.totalMemGB} GB RAM
            {localAi.tiers?.some((tier) => tier.recommended) && (
              <> — recommended: <span className="font-medium text-foreground">
                {localAi.tiers.find((tier) => tier.recommended)?.tag}
              </span></>
            )}
          </span>
        </div>
      )}

      {localAi.isLoading && (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading local AI models...
        </div>
      )}
      {localAi.error && (
        <div className="rounded-md bg-destructive/15 p-2 text-xs text-destructive">{localAi.error}</div>
      )}

      {localAi.tiers && (
        <div className="space-y-2">
          {localAi.tiers.map((tier) => {
            const badge = supportBadge(tier);
            const isPulling = pullingTag === tier.tag;
            const canDownload = tier.supportLevel === 'ok' && !tier.installed && pullingTag === null;
            return (
              <div
                key={tier.tag}
                data-testid="ai-model-row"
                data-ai-model-tag={tier.tag}
                data-ai-model-installed={tier.installed ? 'true' : 'false'}
                className="rounded-md border p-2 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {tier.tag}
                      {tier.recommended && (
                        <span className="ml-2 text-xs text-green-600">(recommended)</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {tier.label} · {tier.downloadGB} GB download
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${badge.className}`}>
                      {badge.text}
                    </span>
                    {tier.installed ? (
                      <Button
                        data-testid="ai-model-delete"
                        variant="ghost"
                        size="sm"
                        disabled={busyTag === tier.tag || pullingTag !== null}
                        onClick={() => void handleDelete(tier)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button
                        data-testid="ai-model-download"
                        size="sm"
                        disabled={!canDownload}
                        title={
                          tier.supportLevel !== 'ok'
                            ? 'This model exceeds what this machine supports'
                            : undefined
                        }
                        onClick={() => void handleDownload(tier)}
                      >
                        {isPulling ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        <span className="ml-1">{isPulling ? 'Downloading' : 'Download'}</span>
                      </Button>
                    )}
                  </div>
                </div>
                {isPulling && (
                  <div className="space-y-0.5" data-testid="ai-model-progress">
                    <Progress value={pullPercent} className="h-1.5" />
                    <div className="text-xs text-muted-foreground">{pullPercent}%</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
