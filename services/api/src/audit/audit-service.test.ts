import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AuditEventConstraintError,
  AuditEventService,
  InMemoryAuditEventRepository,
  auditEventSchemaSql,
} from './index';
import { auditEventTypes } from '@sovereign/contracts';

test('covers the required governance domains in the audit taxonomy', () => {
  assert.deepEqual(auditEventTypes, [
    'auth.invitation_issued',
    'auth.session_issued',
    'device.enrolled',
    'device.approved',
    'device.revoked',
    'restricted.hardware_key_registered',
    'restricted.hardware_key_revoked',
    'restricted.session_activated',
    'restricted.session_activation_denied',
    'membership.created',
    'membership.status_changed',
    'guest.identity_created',
    'guest.scope_granted',
    'guest.scope_revoked',
    'file.upload_intent_created',
    'file.download_authorized',
    'tier.conversation_tier_changed',
    'dissolution.requested',
    'dissolution.resolved',
    'recovery.requested',
    'recovery.admin_approved',
    'recovery.sim_verified',
    'recovery.completed',
    'support.elevation_requested',
    'support.elevation_revoked',
  ]);
});

test('writes immutable audit events without leaking caller-side mutations', async () => {
  const repository = new InMemoryAuditEventRepository();
  const service = new AuditEventService(repository, {
    now: () => new Date('2026-06-26T10:55:00.000Z'),
  });

  const metadata = {
    invitationId: 'invite-1',
    scopes: ['tenant.bootstrap'],
    nested: {
      sessionKind: 'passwordless',
    },
  };

  const event = await service.writeEvent({
    tenantId: 'tenant-1',
    officeId: 'office-1',
    actorId: 'admin-1',
    type: 'auth.invitation_issued',
    metadata,
  });

  metadata.scopes.push('mutated-after-write');
  metadata.nested.sessionKind = 'tampered';

  const listed = await service.listTenantEvents('tenant-1');

  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0], event);
  assert.deepEqual(Object.keys(event), [
    'id',
    'tenantId',
    'officeId',
    'actorId',
    'type',
    'metadata',
    'occurredAt',
  ]);
  assert.equal(event.occurredAt, '2026-06-26T10:55:00.000Z');
  assert.equal(event.metadata.invitationId, 'invite-1');
  assert.deepEqual(event.metadata.scopes, ['tenant.bootstrap']);
  assert.deepEqual(event.metadata.nested, {
    sessionKind: 'passwordless',
  });
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.metadata), true);
  assert.equal(Object.isFrozen(event.metadata.nested), true);
});

test('rejects unsupported event types and duplicate append attempts', async () => {
  const repository = new InMemoryAuditEventRepository();
  const service = new AuditEventService(repository);

  await assert.rejects(
    service.writeEvent({
      tenantId: 'tenant-1',
      officeId: 'office-1',
      type: 'audit.unsupported',
      metadata: {},
    }),
    (error: unknown) => {
      if (!(error instanceof AuditEventConstraintError)) {
        return false;
      }

      return error.code === 'UNSUPPORTED_AUDIT_EVENT_TYPE';
    },
  );

  const event = await service.writeEvent({
    tenantId: 'tenant-1',
    officeId: 'office-1',
    type: 'support.elevation_requested',
    metadata: {
      requestedBy: 'principal-1',
    },
  });

  await assert.rejects(
    repository.append(event),
    (error: unknown) => {
      if (!(error instanceof AuditEventConstraintError)) {
        return false;
      }

      return error.code === 'DUPLICATE_AUDIT_EVENT';
    },
  );
});

test('exposes append-only SQL for audit-event persistence', () => {
  assert.match(auditEventSchemaSql, /create table if not exists audit_event/i);
  assert.match(auditEventSchemaSql, /metadata jsonb not null/i);
  assert.match(
    auditEventSchemaSql,
    /create index if not exists audit_event_tenant_time_idx/i,
  );
  assert.match(
    auditEventSchemaSql,
    /create index if not exists audit_event_tenant_actor_time_idx/i,
  );
  assert.match(
    auditEventSchemaSql,
    /create index if not exists audit_event_tenant_type_time_idx/i,
  );
  assert.match(
    auditEventSchemaSql,
    /create index if not exists audit_event_conversation_idx/i,
  );
  assert.match(auditEventSchemaSql, /trigger audit_event_no_update/i);
  assert.match(auditEventSchemaSql, /trigger audit_event_no_delete/i);
});
