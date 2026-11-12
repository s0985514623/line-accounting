/**
 * 結構化日誌（pino）。機敏欄位一律遮蔽（deployment-runbook §5.1）。
 */
import { pino, type DestinationStream, type Logger } from 'pino';

/** 遮蔽路徑：ID token、webhook 簽章、reply/pick token、access token。 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-line-signature"]',
  '*.token',
  '*.accessToken',
  '*.channelSecret',
];

export const REDACT_CENSOR = '[REDACTED]';

export interface CreateLoggerOptions {
  /** pino level（含 silent）；預設 info */
  level?: string;
  /** 輸出目的地；預設 stdout */
  destination?: DestinationStream | NodeJS.WritableStream;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const config = {
    level: options.level ?? 'info',
    redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
  };
  return options.destination
    ? pino(config, options.destination as DestinationStream)
    : pino(config);
}
