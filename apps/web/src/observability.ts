import { context, trace } from '@opentelemetry/api';


export const activeTraceId = (): string | undefined =>
  trace.getSpanContext(context.active())?.traceId;

export const initWebObservability = (): void => {};

export const reportError = (error: unknown): void => {
  trace
    .getActiveSpan()
    ?.recordException(error instanceof Error ? error : new Error(String(error)));
};
