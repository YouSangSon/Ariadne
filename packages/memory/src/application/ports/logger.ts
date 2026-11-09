export interface Logger {
  child(bindings: Record<string, unknown>): Logger;
  trace(bindings: unknown, message?: string): void;
  debug(bindings: unknown, message?: string): void;
  info(bindings: unknown, message?: string): void;
  warn(bindings: unknown, message?: string): void;
  error(bindings: unknown, message?: string): void;
  fatal(bindings: unknown, message?: string): void;
}
