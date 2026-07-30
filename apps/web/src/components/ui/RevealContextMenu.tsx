import { useCallback, useState, type MouseEvent } from 'react';
import { Alert, Menu, MenuItem, Snackbar } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';

interface RevealAnchor {
  x: number;
  y: number;
  path: string;
  fingerprint: string | null;
}

export interface RevealContextMenuController {
  anchor: RevealAnchor | null;
  open: (event: MouseEvent, path: string, fingerprint?: string | null) => void;
  close: () => void;
}

export const useRevealContextMenu = (): RevealContextMenuController => {
  const [anchor, setAnchor] = useState<RevealAnchor | null>(null);
  const open = useCallback((event: MouseEvent, path: string, fingerprint: string | null = null) => {
    event.preventDefault();
    setAnchor({ x: event.clientX, y: event.clientY, path, fingerprint });
  }, []);
  const close = useCallback(() => setAnchor(null), []);
  return { anchor, open, close };
};

export const RevealContextMenu = ({
  controller,
  onReveal,
  onShowInLibrary,
}: {
  controller: RevealContextMenuController;
  onReveal: (path: string) => Promise<boolean>;
  onShowInLibrary?: ((path: string, fingerprint: string | null) => void) | undefined;
}) => {
  const dictionary = useDictionary();
  const { anchor, close } = controller;
  const [failed, setFailed] = useState(false);
  const dismiss = useCallback(() => setFailed(false), []);
  return (
    <>
      <Menu
        open={anchor !== null}
        onClose={close}
        anchorReference="anchorPosition"
        anchorPosition={anchor === null ? undefined : { top: anchor.y, left: anchor.x }}
        data-testid="reveal-context-menu"
      >
        <MenuItem
          data-testid="reveal-in-finder-item"
          onClick={() => {
            const path = anchor?.path ?? null;
            close();
            if (path === null) return;
            void (async () => {
              const revealed = await onReveal(path);
              if (!revealed) setFailed(true);
            })();
          }}
        >
          {dictionary.common.revealInFinder}
        </MenuItem>
        {onShowInLibrary === undefined ? null : (
          <MenuItem
            data-testid="show-in-library-item"
            onClick={() => {
              const path = anchor?.path ?? null;
              const fingerprint = anchor?.fingerprint ?? null;
              close();
              if (path !== null) onShowInLibrary(path, fingerprint);
            }}
          >
            {dictionary.common.showInLibrary}
          </MenuItem>
        )}
      </Menu>
      <Snackbar
        open={failed}
        autoHideDuration={6000}
        onClose={dismiss}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={dismiss} data-testid="reveal-failed-toast">
          {dictionary.common.revealFailed}
        </Alert>
      </Snackbar>
    </>
  );
};
