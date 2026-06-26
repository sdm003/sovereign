import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryTenancyRepository, TenancyService } from '../tenancy';
import {
  ConversationPolicyError,
  ConversationService,
  InMemoryConversationRepository,
  conversationSchemaSql,
} from './index';

async function seedMembers() {
  const tenancyRepository = new InMemoryTenancyRepository();
  const tenancyService = new TenancyService(tenancyRepository);
  const tenant = await tenancyService.createTenant({ name: 'Conversation Tenant' });
  const office = await tenancyService.createOffice({
    tenantId: tenant.id,
    name: 'Conversation Office',
  });

  await tenancyService.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'principal-1',
    role: 'principal',
    status: 'active',
  });
  await tenancyService.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'member-1',
    role: 'member',
    status: 'active',
  });
  await tenancyService.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'restricted-1',
    role: 'restricted_member',
    status: 'active',
  });
  await tenancyService.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'guest-1',
    role: 'guest',
    status: 'active',
  });
  await tenancyService.createMembership({
    tenantId: tenant.id,
    officeId: office.id,
    userId: 'suspended-1',
    role: 'member',
    status: 'suspended',
  });

  return { tenancyRepository, tenant, office };
}

test('creates a confidential conversation and manages participant lifecycle', async () => {
  const { tenancyRepository, tenant, office } = await seedMembers();
  const repository = new InMemoryConversationRepository();
  const service = new ConversationService(repository, tenancyRepository);

  const created = await service.createConversation({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    tier: 'confidential',
    participantIds: ['member-1'],
  });

  assert.equal(created.tier, 'confidential');
  assert.deepEqual(created.participantIds.sort(), ['member-1', 'principal-1']);

  const listed = await service.listConversations({
    tenantId: tenant.id,
    userId: 'member-1',
  });
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, created.id);

  const detailed = await service.getConversation({
    tenantId: tenant.id,
    userId: 'member-1',
    conversationId: created.id,
  });
  assert.equal(detailed.id, created.id);

  const afterAdd = await service.addParticipant({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    conversationId: created.id,
    participantUserId: 'guest-1',
  });
  assert.deepEqual(
    afterAdd.participantIds.sort(),
    ['guest-1', 'member-1', 'principal-1'],
  );

  const afterRemove = await service.removeParticipant({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    conversationId: created.id,
    participantUserId: 'guest-1',
  });
  assert.deepEqual(afterRemove.participantIds.sort(), ['member-1', 'principal-1']);
});

test('enforces Personal single-owner semantics', async () => {
  const { tenancyRepository, tenant } = await seedMembers();
  const repository = new InMemoryConversationRepository();
  const service = new ConversationService(repository, tenancyRepository);

  await assert.rejects(
    service.createConversation({
      tenantId: tenant.id,
      actorUserId: 'member-1',
      tier: 'personal',
      participantIds: ['principal-1'],
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConversationPolicyError);
      if (!(error instanceof ConversationPolicyError)) {
        return false;
      }
      return error.code === 'PERSONAL_SINGLE_OWNER_ONLY';
    },
  );
});

test('enforces restricted-tier eligibility for creator and participants', async () => {
  const { tenancyRepository, tenant } = await seedMembers();
  const repository = new InMemoryConversationRepository();
  const service = new ConversationService(repository, tenancyRepository);

  await assert.rejects(
    service.createConversation({
      tenantId: tenant.id,
      actorUserId: 'member-1',
      tier: 'restricted',
      participantIds: ['restricted-1'],
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConversationPolicyError);
      if (!(error instanceof ConversationPolicyError)) {
        return false;
      }
      return error.code === 'RESTRICTED_CREATOR_NOT_ALLOWED';
    },
  );

  await assert.rejects(
    service.createConversation({
      tenantId: tenant.id,
      actorUserId: 'principal-1',
      tier: 'restricted',
      participantIds: ['member-1'],
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConversationPolicyError);
      if (!(error instanceof ConversationPolicyError)) {
        return false;
      }
      return error.code === 'RESTRICTED_PARTICIPANT_NOT_ALLOWED';
    },
  );
});

test('rejects suspended participants and non-participant detail access', async () => {
  const { tenancyRepository, tenant } = await seedMembers();
  const repository = new InMemoryConversationRepository();
  const service = new ConversationService(repository, tenancyRepository);

  await assert.rejects(
    service.createConversation({
      tenantId: tenant.id,
      actorUserId: 'principal-1',
      tier: 'confidential',
      participantIds: ['suspended-1'],
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConversationPolicyError);
      if (!(error instanceof ConversationPolicyError)) {
        return false;
      }
      return error.code === 'INACTIVE_PARTICIPANT_NOT_ALLOWED';
    },
  );

  const created = await service.createConversation({
    tenantId: tenant.id,
    actorUserId: 'principal-1',
    tier: 'confidential',
    participantIds: ['member-1'],
  });

  await assert.rejects(
    service.getConversation({
      tenantId: tenant.id,
      userId: 'guest-1',
      conversationId: created.id,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConversationPolicyError);
      if (!(error instanceof ConversationPolicyError)) {
        return false;
      }
      return error.code === 'CONVERSATION_ACCESS_DENIED';
    },
  );
});

test('exposes the baseline SQL schema for conversation and participant tables', () => {
  assert.match(conversationSchemaSql, /create table conversation/i);
  assert.match(conversationSchemaSql, /create table conversation_participant/i);
  assert.match(conversationSchemaSql, /tier text not null/i);
});
