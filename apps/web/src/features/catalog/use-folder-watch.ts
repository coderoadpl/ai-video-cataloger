import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { bridge } from '../../api.js';

export const useFolderWatch = (folder: string | null): void => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (folder === null) return;
    return bridge.folder.onChanged(({ folderPath }) => {
      if (folderPath !== folder) return;
      void queryClient.invalidateQueries();
    });
  }, [folder, queryClient]);
};
