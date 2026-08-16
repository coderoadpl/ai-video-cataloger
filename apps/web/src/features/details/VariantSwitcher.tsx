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

import { CardHeader } from '../../components/ui/CardHeader.js';
import { StatusBadge } from '../../components/ui/StatusBadge.js';
import { VariantControl } from '../../components/ui/VariantControl.js';
import { CheckCircleIcon, ErrorIcon } from '../../components/ui/icons.js';
import { type Dictionary } from '../../i18n/dictionary.js';
import { useDictionary } from '../../i18n/use-dictionary.js';
import { variantLabelModel, type VariantData } from './core/variant-model.js';
import { type VariantsState } from './use-variants.js';
import { variantLabelText } from './variant-label.js';

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
    sx={{ borderRadius: 1, alignItems: 'center', gap: 1.5, px: 1.5, py: 1, minHeight: 40 }}
  >
    <Typography variant="body2" sx={{ flex: 1, minWidth: 0, lineHeight: 1.4 }}>
      {variantLabelText(variantLabelModel(variant), dictionary)}
    </Typography>
    {variant.selected ? (
      <Box sx={{ flexShrink: 0 }}>
        <StatusBadge
          icon={<CheckCircleIcon fontSize="inherit" />}
          label={dictionary.details.variants.selected}
          token="completed"
          testId="variant-selected-badge"
        />
      </Box>
    ) : null}
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
    return (
      <Paper
        variant="outlined"
        data-testid="variant-load-error"
        sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}
      >
        <CardHeader
          icon={<ErrorIcon fontSize="small" sx={{ color: 'status.error.main' }} />}
          title={dictionary.details.variants.loadError}
        />
        <Box>
          <Button variant="outlined" size="small" onClick={state.retryLoad}>
            {dictionary.details.variants.retry}
          </Button>
        </Box>
      </Paper>
    );
  }
  if (data === null || data.variants.length < 2) return null;

  return (
    <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="h2">{dictionary.details.variants.title}</Typography>
        <Chip size="small" variant="outlined" label={dictionary.details.variants.count(data.variants.length)} />
      </Box>
      <List disablePadding data-testid="variant-switcher" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
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
      <Button
        variant="outlined"
        size="small"
        onClick={state.showComparison}
        data-testid="compare-variants"
      >
        {dictionary.details.variants.compare}
      </Button>
      {state.previewVariant === null || state.previewVariant.selected ? null : (
        <VariantControl
          control={(
            <Button
              variant="contained"
              size="small"
              disabled={state.selectingConfigId === state.previewVariant.configId}
              onClick={state.usePreviewAsSelected}
              data-testid="use-preview-as-selected"
            >
              {state.selectingConfigId === state.previewVariant.configId
                ? <CircularProgress size={14} color="inherit" />
                : null}
              {dictionary.details.variants.useAsSelected}
            </Button>
          )}
          caption={dictionary.details.variants.selectionImpact}
        />
      )}
      {state.actionError === null ? null : (
        <Alert severity="error">{dictionary.details.variants.actionError}</Alert>
      )}
    </Paper>
  );
};
