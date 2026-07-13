import { context, trace } from '@opentelemetry/api';

/**
 * Browser observability over the `@opentelemetry/api` facade only. This is a
 * privacy-sensitive local app: telemetry is opt-in and OFF by default, so no
 * exporter is registered and the facade no-ops — zero network. `reportError`
 * and `activeTraceId` still work as pure facade reads, ready for the day a user
 * explicitly opts in and the composition root wires a real exporter.
 */

export const activeTraceId = (): string | undefined =>
  trace.getSpanContext(context.active())?.traceId;

export const initWebObservability = (): void => {};

export const reportError = (error: unknown): void => {
  trace
    .getActiveSpan()
    ?.recordException(error instanceof Error ? error : new Error(String(error)));
};
