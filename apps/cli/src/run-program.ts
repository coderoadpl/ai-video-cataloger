export const runProgram = async (
  parse: () => Promise<unknown>,
  dispose: () => Promise<void>,
  writeError: (message: string) => void,
): Promise<number | null> => {
  let failure: unknown = null;
  try {
    await parse();
  } catch (error) {
    failure = error;
  }
  try {
    await dispose();
  } catch (error) {
    if (failure === null) failure = error;
  }
  if (failure === null) return null;
  const message = failure instanceof Error ? failure.message : String(failure);
  writeError(`Fatal error: ${message}\n`);
  return 1;
};
