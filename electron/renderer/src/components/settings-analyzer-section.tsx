/**
 * "AI Analyzer" section of the Settings modal: backend picker (Claude vs
 * Local/Ollama) and, for local, the model picker over the hardware tiers.
 * These keys are real - the processing pipeline reads them per folder.
 */

import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { LocalAiTier } from '@/hooks/use-local-ai-models';

export type AnalyzerBackend = 'claude' | 'local';

interface SettingsAnalyzerSectionProps {
  backend: AnalyzerBackend;
  localModel: string;
  tiers: LocalAiTier[] | null;
  onBackendChange: (backend: AnalyzerBackend) => void;
  onLocalModelChange: (tag: string) => void;
}

export function SettingsAnalyzerSection({
  backend,
  localModel,
  tiers,
  onBackendChange,
  onLocalModelChange,
}: SettingsAnalyzerSectionProps): JSX.Element {
  const selectedTier = tiers?.find((tier) => tier.tag === localModel) ?? null;
  const showNotInstalledHint =
    backend === 'local' && selectedTier !== null && !selectedTier.installed;
  const showUnsupportedHint =
    backend === 'local' && selectedTier !== null && selectedTier.supportLevel !== 'ok';

  return (
    <div className="space-y-4" data-testid="settings-analyzer-section">
      <div className="space-y-2">
        <Label htmlFor="analyzer-backend">AI Analyzer</Label>
        <Select
          value={backend}
          onValueChange={(value) => onBackendChange(value as AnalyzerBackend)}
        >
          <SelectTrigger id="analyzer-backend" data-testid="analyzer-backend-select">
            <SelectValue placeholder="Select analyzer" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="claude">
              <div className="flex flex-col">
                <span>Claude (CLI)</span>
                <span className="text-xs text-muted-foreground">
                  Uses your Claude Code login - best quality
                </span>
              </div>
            </SelectItem>
            <SelectItem value="local">
              <div className="flex flex-col">
                <span>Local (Ollama)</span>
                <span className="text-xs text-muted-foreground">
                  Fully on-device - nothing leaves this Mac
                </span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {backend === 'local' && (
        <div className="space-y-2">
          <Label htmlFor="local-model">Local model</Label>
          <Select value={localModel} onValueChange={onLocalModelChange}>
            <SelectTrigger id="local-model" data-testid="local-model-select">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {(tiers ?? []).map((tier) => (
                <SelectItem key={tier.tag} value={tier.tag} disabled={tier.supportLevel !== 'ok'}>
                  <div className="flex flex-col">
                    <span>
                      {tier.tag}
                      {tier.recommended ? ' (recommended)' : ''}
                      {tier.installed ? ' — installed' : ''}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {tier.label} · {tier.downloadGB} GB · needs {tier.minTotalMemGB} GB RAM
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {showUnsupportedHint ? (
            <p className="text-xs text-destructive" data-testid="local-model-unsupported-hint">
              This model exceeds what this machine supports.
            </p>
          ) : showNotInstalledHint ? (
            <p className="text-xs text-amber-600" data-testid="local-model-missing-hint">
              This model is not downloaded yet — open the Models manager to download it.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
