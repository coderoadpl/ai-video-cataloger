import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  List,
  ListItemButton,
  Paper,
  Typography,
} from '@mui/material';

import { type Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import {
  variantLabelModel,
  type VariantData,
  type VariantLabelCopy,
  type VariantLabelModel,
} from './index.web.js';
import { type VariantsState } from './use-variants.js';

const transcriptionLabel = (copy: VariantLabelCopy, dictionary: Dictionary): string => {
  switch (copy.key) {
    case 'legacySettingsUnknown':
      return dictionary.details.variants.legacySettingsUnknown;
    case 'nativeTranscription':
      return dictionary.details.variants.nativeTranscription(
        copy.providerId,
        copy.model ?? dictionary.details.unknown,
      );
    case 'localTranscription':
      return dictionary.details.variants.localTranscription(copy.model ?? dictionary.details.unknown);
    case 'apiTranscription':
      return dictionary.details.variants.apiTranscription(copy.model ?? dictionary.details.unknown);
    case 'transcriptionSkipped':
      return dictionary.details.variants.transcriptionSkipped;
  }
};

export const variantLabelText = (model: VariantLabelModel, dictionary: Dictionary): string => {
  if (model.transcription.key === 'legacySettingsUnknown') {
    return dictionary.details.variants.legacySettingsUnknown;
  }
  const analyzer = model.analyzer ?? dictionary.details.unknown;
  const frames = model.frames === null
    ? dictionary.details.variants.noFrames
    : dictionary.details.variants.frameCount(model.frames);
  return dictionary.details.variants.configuredLabel(
    analyzer,
    transcriptionLabel(model.transcription, dictionary),
    frames,
  );
};

const VariantRow = ({
  variant,
  previewed,
  onPreview,
  dictionary,
}: {
  variant: VariantData;
  previewed: boolean;
  onPreview: () => void;
  dictionary: Dictionary;
}) => (
  <ListItemButton
    selected={previewed}
    onClick={onPreview}
    data-testid={`variant-option-${variant.configId}`}
    sx={{ borderRadius: 1, alignItems: 'flex-start', gap: 1 }}
  >
    <Typography variant="body2" sx={{ flex: 1 }}>
      {variantLabelText(variantLabelModel(variant), dictionary)}
    </Typography>
    {variant.selected ? <Chip size="small" label={dictionary.details.variants.selected} /> : null}
  </ListItemButton>
);

export const VariantSwitcher = ({ state }: { state: VariantsState }) => {
  const dictionary = useDictionary();
  const data = state.data;
  if (state.loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <CircularProgress size={16} />
        <Typography variant="caption">{dictionary.details.variants.loading}</Typography>
      </Box>
    );
  }
  if (state.loadError !== null) {
    return <Alert severity="error">{dictionary.details.variants.loadError}</Alert>;
  }
  if (data === null) return null;
  const currentIsDefault = data.folderDefaultConfigId === data.currentConfig.configId;

  return (
    <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="h2">{dictionary.details.variants.title}</Typography>
        <Chip size="small" variant="outlined" label={dictionary.details.variants.count(data.variants.length)} />
      </Box>
      <List dense disablePadding data-testid="variant-switcher">
        {data.variants.map((variant) => (
          <VariantRow
            key={variant.configId}
            variant={variant}
            previewed={state.previewVariant?.configId === variant.configId}
            onPreview={() => state.previewConfig(variant.configId)}
            dictionary={dictionary}
          />
        ))}
      </List>
      {state.previewVariant === null || state.previewVariant.selected ? null : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Button
            variant="contained"
            size="small"
            disabled={state.selecting}
            onClick={state.usePreviewAsSelected}
            data-testid="use-preview-as-selected"
          >
            {dictionary.details.variants.useAsSelected}
          </Button>
          <Typography variant="caption">{dictionary.details.variants.selectionImpact}</Typography>
        </Box>
      )}
      <Button
        variant="outlined"
        size="small"
        disabled={currentIsDefault || state.settingFolderDefault}
        onClick={state.useCurrentAsFolderDefault}
        data-testid="set-folder-default-variant"
      >
        {currentIsDefault
          ? dictionary.details.variants.folderDefault
          : dictionary.details.variants.setFolderDefault}
      </Button>
      {state.actionError === null ? null : (
        <Alert severity="error">{dictionary.details.variants.actionError}</Alert>
      )}
    </Paper>
  );
};
