import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';

// Dependency status matching CLI doctor.ts DependencyStatus
interface DependencyStatus {
  name: string;
  available: boolean;
  version: string | null;
  source: 'bundled' | 'system' | null;
  path: string | null;
  installHint: string;
}

// Doctor result matching CLI doctor.ts DoctorResult
interface DoctorResult {
  dependencies: DependencyStatus[];
  allAvailable: boolean;
}

interface PrerequisitesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogMessage?: (message: string, type?: 'info' | 'success' | 'error') => void;
}

// Display names for dependencies
const DEPENDENCY_DISPLAY_NAMES: Record<string, string> = {
  ffmpeg: 'FFmpeg',
  whisper: 'Whisper',
  claude: 'Claude CLI',
  ollama: 'Ollama',
};

// Get a display-friendly source label
function getSourceLabel(source: 'bundled' | 'system' | null): string | null {
  if (source === 'bundled') return 'bundled';
  if (source === 'system') return 'system';
  return null;
}

export function PrerequisitesModal({
  open,
  onOpenChange,
  onLogMessage,
}: PrerequisitesModalProps): JSX.Element {
  const [result, setResult] = useState<DoctorResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Log message helper
  const log = useCallback(
    (message: string, type: 'info' | 'success' | 'error' = 'info') => {
      onLogMessage?.(message, type);
    },
    [onLogMessage]
  );

  // Run doctor command to check prerequisites
  const checkPrerequisites = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);
    log('Checking system prerequisites...', 'info');

    return new Promise<void>((resolve) => {
      let doctorResult: DoctorResult | null = null;
      let hasError = false;

      const handleJson = (
        _spawnId: string,
        event: { type: string; data?: Record<string, unknown>; error?: string }
      ): void => {
        if (event.type === 'completed' && event.data) {
          const dependencies = event.data.dependencies as DependencyStatus[] | undefined;
          const allAvailable = event.data.allAvailable as boolean | undefined;
          if (dependencies) {
            doctorResult = {
              dependencies,
              allAvailable: allAvailable ?? false,
            };
          }
        } else if (event.type === 'error') {
          hasError = true;
          setError(event.error || 'Failed to check prerequisites');
          log(`Failed to check prerequisites: ${event.error}`, 'error');
        }
      };

      const handleExit = (_spawnId: string, code: number | null): void => {
        cleanupListeners();
        setIsLoading(false);

        if (!hasError && doctorResult) {
          setResult(doctorResult);
          const availableCount = doctorResult.dependencies.filter((d) => d.available).length;
          const totalCount = doctorResult.dependencies.length;
          if (doctorResult.allAvailable) {
            log(`All ${totalCount} prerequisites are available`, 'success');
          } else {
            log(`${availableCount} of ${totalCount} prerequisites available`, 'info');
          }
        } else if (!hasError && code !== 0) {
          setError('Failed to check prerequisites');
        }
        resolve();
      };

      const cleanupJson = window.electronAPI?.cli.onJson(handleJson);
      const cleanupExit = window.electronAPI?.cli.onExit(handleExit);

      const cleanupListeners = (): void => {
        cleanupJson?.();
        cleanupExit?.();
      };

      // Spawn doctor command
      window.electronAPI?.cli
        .spawn(['doctor', '--json'], { json: true })
        .catch(() => {
          cleanupListeners();
          setIsLoading(false);
          setError('Failed to run doctor command');
          log('Failed to run doctor command', 'error');
          resolve();
        });
    });
  }, [log]);

  // Check prerequisites when modal opens
  useEffect(() => {
    if (open) {
      checkPrerequisites();
    }
  }, [open, checkPrerequisites]);

  // Render a dependency item
  const renderDependency = (dep: DependencyStatus): JSX.Element => {
    const displayName = DEPENDENCY_DISPLAY_NAMES[dep.name] || dep.name;
    const sourceLabel = getSourceLabel(dep.source);

    return (
      <div
        key={dep.name}
        className="flex items-start justify-between p-3 rounded-lg border border-border bg-card"
      >
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Status indicator */}
          {dep.available ? (
            <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
          ) : (
            <XCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          )}

          {/* Dependency info */}
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{displayName}</span>
              {dep.available && sourceLabel && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    sourceLabel === 'bundled'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-amber-500/10 text-amber-600'
                  }`}
                >
                  {sourceLabel}
                </span>
              )}
            </div>

            {dep.available ? (
              <p className="text-sm text-muted-foreground">
                {dep.version && <span>Version: {dep.version}</span>}
                {!dep.version && <span className="text-green-600">Available</span>}
              </p>
            ) : (
              <div className="space-y-1">
                <p className="text-sm text-red-500">Not found</p>
                <p className="text-xs text-muted-foreground">{dep.installHint}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>System Prerequisites</DialogTitle>
          <DialogDescription>
            Check the status of required dependencies for video analysis.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Checking prerequisites...</span>
          </div>
        ) : error ? (
          <div className="py-6 text-center">
            <p className="text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={checkPrerequisites}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        ) : result ? (
          <div className="space-y-4 py-2">
            {/* Summary banner */}
            <div
              className={`flex items-center gap-2 text-sm px-3 py-2 rounded-md ${
                result.allAvailable
                  ? 'bg-green-500/10 text-green-600'
                  : 'bg-amber-500/10 text-amber-600'
              }`}
            >
              {result.allAvailable ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>All prerequisites are satisfied!</span>
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4" />
                  <span>
                    {result.dependencies.filter((d) => !d.available).length} prerequisite(s) missing
                  </span>
                </>
              )}
            </div>

            {/* Dependencies list */}
            <div className="space-y-2">
              {result.dependencies.map(renderDependency)}
            </div>

            {/* Check Again button */}
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={checkPrerequisites}
                className="w-full"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Check Again
              </Button>
            </div>

            {/* Help link */}
            {!result.allAvailable && (
              <div className="text-center pt-2">
                <a
                  href="https://github.com/anthropics/claude-code"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  View installation instructions
                </a>
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
