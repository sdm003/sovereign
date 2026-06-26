type NodeEnv = 'development' | 'test' | 'production';

type RawEnv = Record<string, string | undefined>;

type RuntimeConfig = {
  nodeEnv: NodeEnv;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  storage: {
    bucket: string;
    region: string;
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
  sessionSigningSecret: string;
};

type HealthDependencies = {
  configLoaded: boolean;
  databaseReachable: boolean;
  redisReachable: boolean;
  migrationsCurrent: boolean;
};

type DependencyStatus = 'up' | 'down';

type HealthStatus = {
  status: 'ok' | 'degraded';
  dependencies: {
    database: DependencyStatus;
    redis: DependencyStatus;
  };
  migrations: 'current' | 'pending';
};

export const runtimeConfigTemplate = `
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://localhost:5432/sovereign
REDIS_URL=redis://localhost:6379
STORAGE_BUCKET=sovereign-bucket
STORAGE_REGION=eu-central-1
STORAGE_ENDPOINT=https://storage.example.com
STORAGE_ACCESS_KEY_ID=replace-me
STORAGE_SECRET_ACCESS_KEY=replace-me
SESSION_SIGNING_SECRET=replace-me
`.trim();

export const startupChecklistMarkdown = `
# Runtime startup checklist

1. Load and validate the managed SaaS environment contract before boot.
2. Verify database, Redis, and object-storage credentials are present.
3. Run pending migrations before serving traffic.
4. Expose health status only after config validation completes.
5. Never hardcode secrets in repository config or source files.
`.trim();

export class RuntimeConfigError extends Error {
  constructor(
    public readonly code: 'MISSING_ENV' | 'INVALID_ENV',
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeConfigError';
  }
}

export function loadRuntimeConfig(env: RawEnv): RuntimeConfig {
  const nodeEnv = readNodeEnv(env.NODE_ENV);
  const port = readPort(env.PORT);

  return {
    nodeEnv,
    port,
    databaseUrl: requireEnv(env, 'DATABASE_URL'),
    redisUrl: requireEnv(env, 'REDIS_URL'),
    storage: {
      bucket: requireEnv(env, 'STORAGE_BUCKET'),
      region: requireEnv(env, 'STORAGE_REGION'),
      endpoint: requireEnv(env, 'STORAGE_ENDPOINT'),
      accessKeyId: requireEnv(env, 'STORAGE_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv(env, 'STORAGE_SECRET_ACCESS_KEY'),
    },
    sessionSigningSecret: requireEnv(env, 'SESSION_SIGNING_SECRET'),
  };
}

export function getHealthStatus(input: HealthDependencies): HealthStatus {
  const database: DependencyStatus =
    input.configLoaded && input.databaseReachable ? 'up' : 'down';
  const redis: DependencyStatus =
    input.configLoaded && input.redisReachable ? 'up' : 'down';
  const migrations = input.migrationsCurrent ? 'current' : 'pending';

  return {
    status:
      database === 'up' && redis === 'up' && migrations === 'current'
        ? 'ok'
        : 'degraded',
    dependencies: {
      database,
      redis,
    },
    migrations,
  };
}

function requireEnv(env: RawEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new RuntimeConfigError(
      'MISSING_ENV',
      `Missing required environment variable: ${key}`,
    );
  }
  return value;
}

function readNodeEnv(value: string | undefined): NodeEnv {
  if (value === 'development' || value === 'test' || value === 'production') {
    return value;
  }
  throw new RuntimeConfigError(
    'INVALID_ENV',
    `NODE_ENV must be one of development, test, or production. Received: ${value ?? 'undefined'}`,
  );
}

function readPort(value: string | undefined): number {
  const port = Number(value);
  if (!value) {
    throw new RuntimeConfigError(
      'MISSING_ENV',
      'Missing required environment variable: PORT',
    );
  }

  if (!Number.isInteger(port) || port <= 0) {
    throw new RuntimeConfigError(
      'INVALID_ENV',
      `PORT must be a positive integer. Received: ${value}`,
    );
  }

  return port;
}
