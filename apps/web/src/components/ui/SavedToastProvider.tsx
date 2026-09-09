import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

const SavedMessageContext = createContext<string | null>(null);
const SavedActionContext = createContext<(message: string | null) => void>(() => undefined);

export const SavedToastProvider = ({ children }: { children: ReactNode }) => {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <SavedActionContext value={setMessage}>
      <SavedMessageContext value={message}>{children}</SavedMessageContext>
    </SavedActionContext>
  );
};

export const useSavedToast = () => useContext(SavedActionContext);
export const useSavedMessage = () => {
  const message = useContext(SavedMessageContext);
  const show = useSavedToast();
  const dismiss = useCallback(() => show(null), [show]);
  return { message, dismiss };
};
