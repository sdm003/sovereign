import test from 'node:test';
import assert from 'node:assert/strict';

import {
  type OperationalAlert,
  type TenantIsolationCheck,
  buildOperationalAlerts,
  buildTenantIsolationReport,
  buildTenantIsolationSql,
  operationalRunbooksMarkdown,
  backupRestoreRunbookMarkdown,
} from './index';

test('builds tenant isolation verification output with executable checks', () => {
  const report = buildTenantIsolationReport({
    crossTenantConversationRows: 0,
    crossTenantMembershipRows: 0,
    orphanedAuditEvents: 0,
  });

  assert.equal(report.status, 'ok');
  assert.equal(report.checks.length, 3);
  assert.equal(
    report.checks.every((check: TenantIsolationCheck) => check.passed),
    true,
  );
  assert.match(buildTenantIsolationSql, /conversation/);
  assert.match(buildTenantIsolationSql, /membership/);
  assert.match(buildTenantIsolationSql, /audit_event/);
});

test('surfaces tenant isolation anomalies as degraded findings', () => {
  const report = buildTenantIsolationReport({
    crossTenantConversationRows: 2,
    crossTenantMembershipRows: 0,
    orphanedAuditEvents: 1,
  });

  assert.equal(report.status, 'degraded');
  assert.deepEqual(
    report.checks.map((check: TenantIsolationCheck) => check.passed),
    [false, true, false],
  );
});

test('defines monitoring alerts for health, audit, backup, and tenant safety failures', () => {
  const alerts = buildOperationalAlerts();

  assert.deepEqual(
    alerts.map((alert: OperationalAlert) => alert.name),
    [
      'tenant-isolation-anomaly',
      'runtime-health-degraded',
      'audit-write-failures',
      'backup-job-failed',
      'recovery-workflow-failures',
      'support-elevation-activation',
    ],
  );
  assert.equal(
    alerts.every((alert: OperationalAlert) => alert.severity.length > 0),
    true,
  );
});

test('documents backup restore and operational runbooks', () => {
  assert.match(backupRestoreRunbookMarkdown, /Backup and restore runbook/i);
  assert.match(backupRestoreRunbookMarkdown, /point-in-time restore rehearsal/i);
  assert.match(operationalRunbooksMarkdown, /tenant isolation incident/i);
  assert.match(operationalRunbooksMarkdown, /recovery escalation/i);
  assert.match(operationalRunbooksMarkdown, /support elevation remains explicit/i);
});
