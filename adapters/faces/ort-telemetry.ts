const ORT_DISABLE_TELEMETRY = 'ORT_DISABLE_TELEMETRY';

export const disableOrtTelemetry = (env: NodeJS.ProcessEnv = process.env): boolean => {
  if (env[ORT_DISABLE_TELEMETRY] === '1') {
    return false;
  }
  env[ORT_DISABLE_TELEMETRY] = '1';
  return true;
};
