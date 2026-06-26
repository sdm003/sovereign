import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAuditReviewDetailScreen,
  buildAuditReviewListScreen,
} from './index';
import type { AuditReviewDetail, AuditReviewListItem } from '@sovereign/contracts';

test('builds an admin audit list screen with filter chips and event rows', () => {
  const item: AuditReviewListItem = {
    id: 'event-1',
    tenantId: 'tenant-1',
    officeId: 'office-1',
    actorId: 'member-1',
    type: 'tier.conversation_tier_changed',
    occurredAt: '2026-06-26T11:02:00.000Z',
    conversationId: 'conversation-1',
  };

  const screen = buildAuditReviewListScreen({
    filters: {
      actorId: 'member-1',
      conversationId: 'conversation-1',
      type: 'tier.conversation_tier_changed',
    },
    items: [item],
  });

  assert.equal(screen.title, 'Audit Review');
  assert.deepEqual(screen.filterChips, [
    'Actor: member-1',
    'Conversation: conversation-1',
    'Type: tier.conversation_tier_changed',
  ]);
  assert.deepEqual(screen.rows, [
    {
      id: 'event-1',
      primaryText: 'tier.conversation_tier_changed',
      secondaryText: 'Actor member-1 • Conversation conversation-1',
      timestamp: '2026-06-26T11:02:00.000Z',
      href: '/audit/events/event-1',
    },
  ]);
  assert.equal(screen.exportAction, null);
});

test('builds an admin audit detail screen without export affordances', () => {
  const detail: AuditReviewDetail = {
    id: 'event-1',
    tenantId: 'tenant-1',
    officeId: 'office-1',
    actorId: 'admin-1',
    type: 'support.elevation_requested',
    occurredAt: '2026-06-26T11:02:00.000Z',
    metadata: {
      supportActionId: 'support-1',
    },
  };

  const screen = buildAuditReviewDetailScreen(detail);

  assert.equal(screen.title, 'support.elevation_requested');
  assert.deepEqual(screen.properties, [
    ['Event ID', 'event-1'],
    ['Tenant', 'tenant-1'],
    ['Office', 'office-1'],
    ['Actor', 'admin-1'],
    ['Occurred at', '2026-06-26T11:02:00.000Z'],
  ]);
  assert.deepEqual(screen.metadataRows, [
    ['supportActionId', 'support-1'],
  ]);
  assert.equal(screen.exportAction, null);
});
