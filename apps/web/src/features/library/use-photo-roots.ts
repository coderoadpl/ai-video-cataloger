import { useQuery } from '@tanstack/react-query';

import { actions } from '../../api.js';
import type { LibraryPhotoRoot } from './core/index.js';

export const usePhotoRoots = (input: { active: boolean }): LibraryPhotoRoot[] => {
  const query = useQuery({ ...actions.photosTree, enabled: input.active });
  return query.data?.roots ?? [];
};
