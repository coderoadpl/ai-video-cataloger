import {
  analysisPlan,
  resolvedPreviewVariant,
  variantLabelModel,
  variantPreview,
} from './variant-model.js';

export type {
  AnalysisPlan,
  VariantData,
  VariantLabelCopy,
  VariantLabelModel,
  VariantPreview,
  VariantsData,
} from './variant-model.js';

export interface DetailsCoreDeps<TVariants, TSelectVariant, TSetFolderDefaultVariant> {
  readonly descriptors: {
    readonly variants: TVariants;
    readonly selectVariant: TSelectVariant;
    readonly setFolderDefaultVariant: TSetFolderDefaultVariant;
  };
}

export const createDetailsCore = <TVariants, TSelectVariant, TSetFolderDefaultVariant>(
  deps: DetailsCoreDeps<TVariants, TSelectVariant, TSetFolderDefaultVariant>,
) => ({
  variants: deps.descriptors.variants,
  selectVariant: deps.descriptors.selectVariant,
  setFolderDefaultVariant: deps.descriptors.setFolderDefaultVariant,
  analysisPlan,
  resolvedPreviewVariant,
  variantLabelModel,
  variantPreview,
});
