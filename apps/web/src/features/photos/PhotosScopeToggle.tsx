import { AnalyzeScopeToggle } from '../../components/ui/AnalyzeScopeToggle.js';
import type { PhotosAnalysisScope } from './use-photos-analysis.js';

interface PhotosScopeToggleProps {
  scope: PhotosAnalysisScope;
  onScopeChange: (scope: PhotosAnalysisScope) => void;
  disabled?: boolean;
}

export const PhotosScopeToggle = ({ scope, onScopeChange, disabled = false }: PhotosScopeToggleProps) => (
  <AnalyzeScopeToggle scope={scope} onScopeChange={onScopeChange} disabled={disabled} />
);
