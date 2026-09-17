/**
 * Levels `tracer` exposes as logger methods, ordered from most to least
 * verbose. Kept in its own module so the configuration layer can validate a
 * level without importing the logger (which itself reads the configuration).
 */
export enum LogLevel {
  log = "log",
  trace = "trace",
  debug = "debug",
  info = "info",
  warn = "warn",
  error = "error",
  fatal = "fatal"
}
