import { actions } from '../../api.js';

import { createDetailsCore } from './core/index.js';

export type {
  AnalysisPlan,
  VariantData,
  VariantLabelCopy,
  VariantLabelModel,
  VariantPreview,
  VariantsData,
} from './core/index.js';

const core = createDetailsCore({
  descriptors: {
    variants: actions.variants,
    selectVariant: actions.selectVariant,
    setFolderDefaultVariant: actions.setFolderDefaultVariant,
  },
});

export const {
  analysisPlan,
  resolvedPreviewVariant,
  selectVariant,
  setFolderDefaultVariant,
  variantLabelModel,
  variantPreview,
  variants,
} = core;
