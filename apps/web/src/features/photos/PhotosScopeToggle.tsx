import {
  AnalyzeScopeToggle,
  type AnalyzeScopeDisabledReason,
} from '../../components/ui/AnalyzeScopeToggle.js';
import type { PhotosAnalysisScope } from './use-photos-analysis.js';

interface PhotosScopeToggleProps {
  scope: PhotosAnalysisScope;
  onScopeChange: (scope: PhotosAnalysisScope) => void;
  disabled?: boolean;
  disabledReason?: AnalyzeScopeDisabledReason | undefined;
}

export const PhotosScopeToggle = ({ scope, onScopeChange, disabled = false, disabledReason }: PhotosScopeToggleProps) => (
  <AnalyzeScopeToggle
    scope={scope}
    onScopeChange={onScopeChange}
    disabled={disabled}
    disabledReason={disabledReason}
  />
);
