/**
 * JSON Output Service
 * Provides newline-delimited JSON (NDJSON) output for CLI commands
 * Used when --json flag is passed to emit structured events
 */

/**
 * Event types for JSON output
 */
export type JsonEventType = 'started' | 'progress' | 'completed' | 'error';

/**
 * Base interface for all JSON events
 */
export interface JsonEventBase {
  type: JsonEventType;
  timestamp: string;
}

/**
 * Started event - emitted when a command or process begins
 */
export interface JsonStartedEvent extends JsonEventBase {
  type: 'started';
  command: string;
  data?: Record<string, unknown>;
}

/**
 * Progress event - emitted during processing
 */
export interface JsonProgressEvent extends JsonEventBase {
  type: 'progress';
  step: string;
  percentage?: number;
  current?: number;
  total?: number;
  data?: Record<string, unknown>;
}

/**
 * Completed event - emitted when a command finishes successfully
 */
export interface JsonCompletedEvent extends JsonEventBase {
  type: 'completed';
  data?: Record<string, unknown>;
}

/**
 * Error event - emitted when an error occurs
 */
export interface JsonErrorEvent extends JsonEventBase {
  type: 'error';
  message: string;
  code?: string;
  data?: Record<string, unknown>;
}

/**
 * Union type for all JSON events
 */
export type JsonEvent = JsonStartedEvent | JsonProgressEvent | JsonCompletedEvent | JsonErrorEvent;

/**
 * Error that carries a machine-readable code.
 * The code flows to emitError so JSON consumers can react to specific failures
 * (same codes as emitted directly, e.g. FILE_NOT_FOUND).
 */
export class CodedError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'CodedError';
    this.code = code;
  }
}

/**
 * Input types (without timestamp) for emitting events
 */
export type JsonStartedEventInput = Omit<JsonStartedEvent, 'timestamp'>;
export type JsonProgressEventInput = Omit<JsonProgressEvent, 'timestamp'>;
export type JsonCompletedEventInput = Omit<JsonCompletedEvent, 'timestamp'>;
export type JsonErrorEventInput = Omit<JsonErrorEvent, 'timestamp'>;
export type JsonEventInput = JsonStartedEventInput | JsonProgressEventInput | JsonCompletedEventInput | JsonErrorEventInput;

/**
 * Global flag to control JSON output mode
 */
let jsonMode = false;

/**
 * Enable or disable JSON output mode
 */
export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

/**
 * Check if JSON output mode is enabled
 */
export function isJsonMode(): boolean {
  return jsonMode;
}

/**
 * Get current timestamp in ISO format
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Emit a JSON event to stdout (newline-delimited)
 * Only emits if JSON mode is enabled
 */
export function emitJsonEvent(event: JsonEventInput): void {
  if (!jsonMode) {
    return;
  }

  const fullEvent = {
    ...event,
    timestamp: getTimestamp(),
  };

  console.log(JSON.stringify(fullEvent));
}

/**
 * Emit a started event
 */
export function emitStarted(command: string, data?: Record<string, unknown>): void {
  emitJsonEvent({
    type: 'started',
    command,
    data,
  });
}

/**
 * Emit a progress event
 */
export function emitProgress(
  step: string,
  options?: {
    percentage?: number;
    current?: number;
    total?: number;
    data?: Record<string, unknown>;
  }
): void {
  emitJsonEvent({
    type: 'progress',
    step,
    ...options,
  });
}

/**
 * Emit a completed event
 */
export function emitCompleted(data?: Record<string, unknown>): void {
  emitJsonEvent({
    type: 'completed',
    data,
  });
}

/**
 * Emit an error event
 */
export function emitError(message: string, options?: { code?: string; data?: Record<string, unknown> }): void {
  emitJsonEvent({
    type: 'error',
    message,
    ...options,
  });
}

/**
 * Output raw JSON data (for commands that return data directly)
 * Only outputs if JSON mode is enabled
 */
export function outputJson(data: unknown): void {
  if (!jsonMode) {
    return;
  }

  console.log(JSON.stringify(data));
}

/**
 * Conditional log - only logs if JSON mode is disabled
 * Use this to replace console.log calls in human-readable output
 */
export function logHuman(message: string): void {
  if (!jsonMode) {
    console.log(message);
  }
}

/**
 * Conditional error log - only logs if JSON mode is disabled
 * In JSON mode, use emitError instead
 */
export function logHumanError(message: string): void {
  if (!jsonMode) {
    console.error(message);
  }
}
