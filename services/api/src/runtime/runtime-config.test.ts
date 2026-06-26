import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getHealthStatus,
  loadRuntimeConfig,
  RuntimeConfigError,
  runtimeConfigTemplate,
  runtimeMigrationSql,
  startupChecklistMarkdown,
} from './index';

test('loads a valid managed SaaS runtime configuration', () => {
  const config = loadRuntimeConfig({
    NODE_ENV: 'production',
    PORT: '4100',
    DATABASE_URL: 'postgres://localhost:5432/sovereign',
    REDIS_URL: 'redis://localhost:6379',
    STORAGE_BUCKET: 'sovereign-bucket',
    STORAGE_REGION: 'eu-central-1',
    STORAGE_ENDPOINT: 'https://storage.example.com',
    STORAGE_ACCESS_KEY_ID: 'access-key',
    STORAGE_SECRET_ACCESS_KEY: 'secret-key',
    SESSION_SIGNING_SECRET: 'session-secret',
  });

  assert.equal(config.nodeEnv, 'production');
  assert.equal(config.port, 4100);
  assert.equal(config.storage.bucket, 'sovereign-bucket');
});

test('rejects missing required runtime secrets and URLs', () => {
  assert.throws(
    () =>
      loadRuntimeConfig({
        NODE_ENV: 'development',
        PORT: '3000',
      }),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeConfigError);
        if (!(error instanceof RuntimeConfigError)) {
          return false;
        }
        return error.code === 'MISSING_ENV';
      },
  );
});

test('rejects invalid runtime values such as non-numeric ports', () => {
  assert.throws(
    () =>
      loadRuntimeConfig({
        NODE_ENV: 'test',
        PORT: 'not-a-port',
        DATABASE_URL: 'postgres://localhost:5432/sovereign',
        REDIS_URL: 'redis://localhost:6379',
        STORAGE_BUCKET: 'sovereign-bucket',
        STORAGE_REGION: 'eu-central-1',
        STORAGE_ENDPOINT: 'https://storage.example.com',
        STORAGE_ACCESS_KEY_ID: 'access-key',
        STORAGE_SECRET_ACCESS_KEY: 'secret-key',
        SESSION_SIGNING_SECRET: 'session-secret',
      }),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeConfigError);
        if (!(error instanceof RuntimeConfigError)) {
          return false;
        }
        return error.code === 'INVALID_ENV';
      },
  );
});

test('exposes a health response that reports dependency readiness', () => {
  const health = getHealthStatus({
    configLoaded: true,
    databaseReachable: true,
    redisReachable: false,
    migrationsCurrent: true,
  });

  assert.equal(health.status, 'degraded');
  assert.equal(health.dependencies.redis, 'down');
  assert.equal(health.migrations, 'current');
});

test('documents the migration bootstrap SQL and startup checklist', () => {
  assert.match(runtimeMigrationSql, /create table if not exists schema_migration_log/i);
  assert.match(runtimeMigrationSql, /version text not null unique/i);
  assert.match(runtimeConfigTemplate, /DATABASE_URL=/);
  assert.match(startupChecklistMarkdown, /Run pending migrations before serving traffic/i);
});
