import test from 'node:test';
import assert from 'node:assert/strict';

import type {
  AuthContext,
  CompleteInviteAuthRequest,
  CompleteInviteAuthResponse,
  IssueInvitationRequest,
} from '@sovereign/contracts';

import {
  InMemoryInvitationRepository,
  InvitationAuthError,
  InvitationAuthService,
} from './index';

const baseInvitationRequest: IssueInvitationRequest = {
  tenantId: 'tenant-1',
  officeId: 'office-1',
  userId: 'user-1',
  email: 'member@example.com',
  role: 'member',
  expiresAt: '2030-01-01T00:00:00.000Z',
};

test('issues an invitation without storing the raw token', async () => {
  const repository = new InMemoryInvitationRepository();
  const service = new InvitationAuthService(repository);

  const issued = await service.issueInvitation(baseInvitationRequest);
  const stored = repository.list()[0];

  assert.ok(stored);
  assert.ok(issued.token.length > 20);
  assert.equal(stored.email, baseInvitationRequest.email);
  assert.notEqual(stored.tokenHash, issued.token);
});

test('completes auth for a valid invitation and returns a session payload', async () => {
  const repository = new InMemoryInvitationRepository();
  const service = new InvitationAuthService(repository, {
    issueSession: async ({
      authContext,
    }: {
      authContext: AuthContext;
    }): Promise<CompleteInviteAuthResponse> => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      authContext,
    }),
  });

  const issued = await service.issueInvitation(baseInvitationRequest);
  const response = await service.completeInvitationAuth({
    token: issued.token,
    deviceMetadata: {
      platform: 'ios',
      deviceName: 'Daniiar iPhone',
    },
  });

  assert.deepEqual(response, {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    authContext: {
      tenantId: 'tenant-1',
      officeId: 'office-1',
      userId: 'user-1',
      role: 'member',
      membershipStatus: 'active',
    },
  });
  const stored = repository.list()[0];
  assert.ok(stored);
  assert.equal(stored.status, 'completed');
});

test('rejects an invalid invitation token', async () => {
  const repository = new InMemoryInvitationRepository();
  const service = new InvitationAuthService(repository);

  await assert.rejects(
    service.completeInvitationAuth({
      token: 'not-a-real-token',
    }),
    (error: unknown) => {
      assert.ok(error instanceof InvitationAuthError);
      return error.code === 'INVALID_TOKEN';
    },
  );
});

test('rejects an expired invitation token explicitly', async () => {
  const repository = new InMemoryInvitationRepository();
  const service = new InvitationAuthService(repository, undefined, {
    now: () => new Date('2030-01-02T00:00:00.000Z'),
  });

  const issued = await service.issueInvitation(baseInvitationRequest);

  await assert.rejects(
    service.completeInvitationAuth({
      token: issued.token,
    }),
    (error: unknown) => {
      assert.ok(error instanceof InvitationAuthError);
      return error.code === 'EXPIRED_TOKEN';
    },
  );
  const stored = repository.list()[0];
  assert.ok(stored);
  assert.equal(stored.status, 'expired');
});

test('rejects re-use of a completed invitation token', async () => {
  const repository = new InMemoryInvitationRepository();
  const service = new InvitationAuthService(repository);

  const issued = await service.issueInvitation(baseInvitationRequest);
  const request: CompleteInviteAuthRequest = {
    token: issued.token,
  };

  await service.completeInvitationAuth(request);

  await assert.rejects(
    service.completeInvitationAuth(request),
    (error: unknown) => {
      assert.ok(error instanceof InvitationAuthError);
      return error.code === 'INVITATION_ALREADY_USED';
    },
  );
});
