type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info') as Level;
  return LEVELS[raw] ?? LEVELS.info;
}

function fmt(prefix: string, level: Level, msg: string, meta?: Record<string, unknown>): string {
  const base = `[${prefix}] ${level.toUpperCase()} ${msg}`;
  if (!meta) return base;
  return `${base} ${JSON.stringify(meta)}`;
}

export function logger(prefix: string) {
  return {
    debug(msg: string, meta?: Record<string, unknown>) {
      if (LEVELS.debug >= currentLevel()) console.log(fmt(prefix, 'debug', msg, meta));
    },
    info(msg: string, meta?: Record<string, unknown>) {
      if (LEVELS.info >= currentLevel()) console.log(fmt(prefix, 'info', msg, meta));
    },
    warn(msg: string, meta?: Record<string, unknown>) {
      if (LEVELS.warn >= currentLevel()) console.warn(fmt(prefix, 'warn', msg, meta));
    },
    error(msg: string, meta?: Record<string, unknown>) {
      if (LEVELS.error >= currentLevel()) console.error(fmt(prefix, 'error', msg, meta));
    },
  };
}
