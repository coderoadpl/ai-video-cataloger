import { useCallback, useState, type MouseEvent } from 'react';
import { Alert, Menu, MenuItem, Snackbar } from '@mui/material';

import { useDictionary } from '../../i18n/use-dictionary.js';

interface RevealAnchor {
  x: number;
  y: number;
  path: string;
}

export interface RevealContextMenuController {
  anchor: RevealAnchor | null;
  open: (event: MouseEvent, path: string) => void;
  close: () => void;
}

export const useRevealContextMenu = (): RevealContextMenuController => {
  const [anchor, setAnchor] = useState<RevealAnchor | null>(null);
  const open = useCallback((event: MouseEvent, path: string) => {
    event.preventDefault();
    setAnchor({ x: event.clientX, y: event.clientY, path });
  }, []);
  const close = useCallback(() => setAnchor(null), []);
  return { anchor, open, close };
};

export const RevealContextMenu = ({
  controller,
  onReveal,
}: {
  controller: RevealContextMenuController;
  onReveal: (path: string) => Promise<boolean>;
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
