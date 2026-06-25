import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { useCliCommand } from '@/hooks/use-cli-command';

// Config types matching the CLI config service
type WhisperMode = 'local' | 'api' | 'skip';
type WhisperModel = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';

interface ConfigValues {
  whisper_model: WhisperModel;
  whisper_mode: WhisperMode;
  frames: number;
  timeout: number;
  skip_rename: boolean;
}

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentFolder: string | null;
  onConfigSaved?: () => void;
}

// Default values from the CLI config service
const DEFAULT_CONFIG: ConfigValues = {
  whisper_model: 'base',
  whisper_mode: 'local',
  frames: 3,
  timeout: 120,
  skip_rename: false,
};

// Whisper models with descriptions
const WHISPER_MODELS: { value: WhisperModel; label: string; description: string }[] = [
  { value: 'tiny', label: 'Tiny', description: 'Fastest, lowest accuracy' },
  { value: 'base', label: 'Base', description: 'Good balance of speed and accuracy' },
  { value: 'small', label: 'Small', description: 'Better accuracy, slower' },
  { value: 'medium', label: 'Medium', description: 'High accuracy, slow' },
  { value: 'large-v3', label: 'Large v3', description: 'Best accuracy, slowest' },
];

// Whisper modes with descriptions
const WHISPER_MODES: { value: WhisperMode; label: string; description: string }[] = [
  { value: 'local', label: 'Local (Whisper.cpp)', description: 'Uses local whisper.cpp binary' },
  { value: 'api', label: 'API (OpenAI)', description: 'Uses OpenAI Whisper API' },
  { value: 'skip', label: 'Skip Transcription', description: 'Do not transcribe audio' },
];

export function SettingsModal({
  open,
  onOpenChange,
  currentFolder,
  onConfigSaved,
}: SettingsModalProps): JSX.Element {
  const runCli = useCliCommand();
  const [config, setConfig] = useState<ConfigValues>(DEFAULT_CONFIG);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalConfig, setOriginalConfig] = useState<ConfigValues>(DEFAULT_CONFIG);

  // Track changes
  useEffect(() => {
    const changed =
      config.whisper_model !== originalConfig.whisper_model ||
      config.whisper_mode !== originalConfig.whisper_mode ||
      config.frames !== originalConfig.frames ||
      config.timeout !== originalConfig.timeout ||
      config.skip_rename !== originalConfig.skip_rename;
    setHasChanges(changed);
  }, [config, originalConfig]);

  // Load config from CLI
  const loadConfig = useCallback(async (): Promise<void> => {
    if (!currentFolder) return;

    setIsLoading(true);
    setError(null);

    try {
      // Run config get command with cwd set to current folder
      const { code, events } = await runCli(
        ['config', 'get', '--json'],
        {
          onJson: (event) => {
            if (event.type === 'error') {
              setError(event.error || 'Failed to load config');
            }
          },
        },
        { cwd: currentFolder }
      );

      const hasError = events.some((event) => event.type === 'error');
      const completed = events.find((event) => event.type === 'completed' && event.data);

      let configData: Partial<ConfigValues> = {};
      if (completed?.data) {
        const rawConfig = completed.data.config as Record<string, string | null> | undefined;
        const defaults = completed.data.defaults as Record<string, string> | undefined;

        if (rawConfig && defaults) {
          // Parse values, using defaults if not set
          configData = {
            whisper_model: (rawConfig.whisper_model || defaults.whisper_model) as WhisperModel,
            whisper_mode: (rawConfig.whisper_mode || defaults.whisper_mode) as WhisperMode,
            frames: parseInt(rawConfig.frames || defaults.frames, 10),
            timeout: parseInt(rawConfig.timeout || defaults.timeout, 10),
            skip_rename: (rawConfig.skip_rename || defaults.skip_rename) === 'true',
          };
        }
      }

      if (!hasError && code === 0 && Object.keys(configData).length > 0) {
        const loadedConfig = { ...DEFAULT_CONFIG, ...configData };
        setConfig(loadedConfig);
        setOriginalConfig(loadedConfig);
      } else if (!hasError) {
        // No config file exists, use defaults
        setConfig(DEFAULT_CONFIG);
        setOriginalConfig(DEFAULT_CONFIG);
      }
    } catch {
      // If no folder is set up yet, use defaults silently
      setConfig(DEFAULT_CONFIG);
      setOriginalConfig(DEFAULT_CONFIG);
    } finally {
      setIsLoading(false);
    }
  }, [currentFolder, runCli]);

  // Load config when modal opens
  useEffect(() => {
    if (open && currentFolder) {
      loadConfig();
    }
  }, [open, currentFolder, loadConfig]);

  // Save a single config value
  const saveConfigValue = useCallback(
    async (key: keyof ConfigValues, value: string): Promise<boolean> => {
      if (!currentFolder) return false;

      try {
        const { code, events } = await runCli(
          ['config', 'set', key, value, '--json'],
          {
            onJson: (event) => {
              if (event.type === 'error') {
                setError(event.error || `Failed to save ${key}`);
              }
            },
          },
          { cwd: currentFolder }
        );

        const success = events.some((event) => event.type === 'completed');
        return code === 0 && success;
      } catch {
        return false;
      }
    },
    [currentFolder, runCli]
  );

  // Save all changed settings
  const handleSave = useCallback(async () => {
    if (!currentFolder) return;

    setIsSaving(true);
    setError(null);

    let allSuccess = true;

    // Save each changed value
    if (config.whisper_model !== originalConfig.whisper_model) {
      const success = await saveConfigValue('whisper_model', config.whisper_model);
      if (!success) allSuccess = false;
    }

    if (config.whisper_mode !== originalConfig.whisper_mode) {
      const success = await saveConfigValue('whisper_mode', config.whisper_mode);
      if (!success) allSuccess = false;
    }

    if (config.frames !== originalConfig.frames) {
      const success = await saveConfigValue('frames', String(config.frames));
      if (!success) allSuccess = false;
    }

    if (config.timeout !== originalConfig.timeout) {
      const success = await saveConfigValue('timeout', String(config.timeout));
      if (!success) allSuccess = false;
    }

    if (config.skip_rename !== originalConfig.skip_rename) {
      const success = await saveConfigValue('skip_rename', String(config.skip_rename));
      if (!success) allSuccess = false;
    }

    setIsSaving(false);

    if (allSuccess) {
      setOriginalConfig(config);
      setHasChanges(false);
      onConfigSaved?.();
      onOpenChange(false);
    }
  }, [config, originalConfig, currentFolder, saveConfigValue, onConfigSaved, onOpenChange]);

  // Reset to original values
  const handleReset = useCallback(() => {
    setConfig(originalConfig);
    setError(null);
  }, [originalConfig]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure video processing options for the current folder.
          </DialogDescription>
        </DialogHeader>

        {!currentFolder ? (
          <div className="py-6 text-center text-muted-foreground">
            Please select a folder first to configure settings.
          </div>
        ) : isLoading ? (
          <div className="py-6 flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading settings...</span>
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {error && (
              <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* Frame Count */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="frames">Frame Count</Label>
                <span className="text-sm text-muted-foreground">{config.frames} frames</span>
              </div>
              <Slider
                id="frames"
                min={1}
                max={10}
                step={1}
                value={[config.frames]}
                onValueChange={(value) => setConfig((prev) => ({ ...prev, frames: value[0] }))}
              />
              <p className="text-xs text-muted-foreground">
                Number of frames to extract from each video for analysis.
              </p>
            </div>

            {/* Whisper Mode */}
            <div className="space-y-2">
              <Label htmlFor="whisper-mode">Transcription Mode</Label>
              <Select
                value={config.whisper_mode}
                onValueChange={(value) =>
                  setConfig((prev) => ({ ...prev, whisper_mode: value as WhisperMode }))
                }
              >
                <SelectTrigger id="whisper-mode">
                  <SelectValue placeholder="Select transcription mode" />
                </SelectTrigger>
                <SelectContent>
                  {WHISPER_MODES.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      <div className="flex flex-col">
                        <span>{mode.label}</span>
                        <span className="text-xs text-muted-foreground">{mode.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Whisper Model (only shown when mode is 'local') */}
            {config.whisper_mode === 'local' && (
              <div className="space-y-2">
                <Label htmlFor="whisper-model">Whisper Model</Label>
                <Select
                  value={config.whisper_model}
                  onValueChange={(value) =>
                    setConfig((prev) => ({ ...prev, whisper_model: value as WhisperModel }))
                  }
                >
                  <SelectTrigger id="whisper-model">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {WHISPER_MODELS.map((model) => (
                      <SelectItem key={model.value} value={model.value}>
                        <div className="flex flex-col">
                          <span>{model.label}</span>
                          <span className="text-xs text-muted-foreground">{model.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Larger models are more accurate but slower and require more memory.
                </p>
              </div>
            )}

            {/* Auto-rename Toggle */}
            <div className="flex items-center justify-between space-x-4">
              <div className="space-y-0.5">
                <Label htmlFor="skip-rename">Skip Auto-Rename</Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, videos will not be automatically renamed after analysis.
                </p>
              </div>
              <Switch
                id="skip-rename"
                checked={config.skip_rename}
                onCheckedChange={(checked) =>
                  setConfig((prev) => ({ ...prev, skip_rename: checked }))
                }
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {hasChanges && (
            <Button variant="ghost" onClick={handleReset} disabled={isSaving}>
              Reset
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || isSaving || !currentFolder}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
