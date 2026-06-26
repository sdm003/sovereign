type TenantIsolationInput = {
  crossTenantConversationRows: number;
  crossTenantMembershipRows: number;
  orphanedAuditEvents: number;
};

export type TenantIsolationCheck = {
  name: string;
  passed: boolean;
  observedRows: number;
};

type TenantIsolationReport = {
  status: 'ok' | 'degraded';
  checks: TenantIsolationCheck[];
};

export type OperationalAlert = {
  name: string;
  severity: 'critical' | 'high' | 'medium';
  signal: string;
  threshold: string;
};

export const buildTenantIsolationSql = `
-- Cross-tenant conversation participants should never exist.
select count(*) as cross_tenant_conversation_rows
from conversation_participant cp
join conversation c on c.id = cp.conversation_id
join membership m on m.user_id = cp.user_id
where c.tenant_id <> m.tenant_id;

-- Membership office and tenant links must stay aligned.
select count(*) as cross_tenant_membership_rows
from membership m
join office o on o.id = m.office_id
where m.tenant_id <> o.tenant_id;

-- Audit events must always reference a tenant and office pair that still exists.
select count(*) as orphaned_audit_events
from audit_event ae
left join office o on o.id = ae.office_id
where o.id is null or o.tenant_id <> ae.tenant_id;
`.trim();

export const backupRestoreRunbookMarkdown = `
# Backup and restore runbook

1. Run automated PostgreSQL backups on a fixed schedule with encrypted storage targets.
2. Export object-storage bucket version manifests alongside database backup identifiers.
3. Verify backup completion before closing the daily operations window.
4. Rehearse a point-in-time restore rehearsal on a non-production environment at least once per release cycle.
5. During restore validation, run tenant-isolation verification checks before allowing any recovered environment to serve traffic.
`.trim();

export const operationalRunbooksMarkdown = `
# Operational runbooks

## Tenant isolation incident

1. Freeze deploys and privileged support actions.
2. Run tenant-isolation verification queries immediately.
3. If any anomaly exists, block traffic to affected surfaces until verified containment is complete.

## Recovery escalation

1. Confirm the governed recovery workflow was used.
2. Verify dedicated recovery channel evidence before approving completion.
3. Confirm old device, session, and hardware-key artifacts were revoked after completion.

## Support access control

1. Support elevation remains explicit and time-bounded.
2. No default customer-content access is allowed outside the audited elevation workflow.
3. Any unexpected elevation signal is treated as a high-severity operational event.
`.trim();

export function buildTenantIsolationReport(
  input: TenantIsolationInput,
): TenantIsolationReport {
  const checks: TenantIsolationCheck[] = [
    {
      name: 'cross-tenant conversations',
      passed: input.crossTenantConversationRows === 0,
      observedRows: input.crossTenantConversationRows,
    },
    {
      name: 'membership office alignment',
      passed: input.crossTenantMembershipRows === 0,
      observedRows: input.crossTenantMembershipRows,
    },
    {
      name: 'orphaned audit events',
      passed: input.orphanedAuditEvents === 0,
      observedRows: input.orphanedAuditEvents,
    },
  ];

  return {
    status: checks.every((check) => check.passed) ? 'ok' : 'degraded',
    checks,
  };
}

export function buildOperationalAlerts(): OperationalAlert[] {
  return [
    {
      name: 'tenant-isolation-anomaly',
      severity: 'critical',
      signal: 'tenant_isolation_report.status',
      threshold: 'degraded once',
    },
    {
      name: 'runtime-health-degraded',
      severity: 'high',
      signal: 'runtime_health.status',
      threshold: 'degraded for 5 minutes',
    },
    {
      name: 'audit-write-failures',
      severity: 'high',
      signal: 'audit_write_failures_total',
      threshold: '>= 1 in 5 minutes',
    },
    {
      name: 'backup-job-failed',
      severity: 'critical',
      signal: 'backup_job_success',
      threshold: 'false for latest run',
    },
    {
      name: 'recovery-workflow-failures',
      severity: 'medium',
      signal: 'recovery_completion_failures_total',
      threshold: '>= 3 in 30 minutes',
    },
    {
      name: 'support-elevation-activation',
      severity: 'medium',
      signal: 'support_elevation_active',
      threshold: 'true unexpectedly',
    },
  ];
}
