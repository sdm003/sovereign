import type {
  AuditQueryParams,
  AuditReviewDetail,
  AuditReviewListItem,
} from '@sovereign/contracts';

export type AuditReviewListScreen = {
  title: 'Audit Review';
  filterChips: string[];
  rows: AuditReviewRow[];
  emptyState: string | null;
  exportAction: null;
};

export type AuditReviewRow = {
  id: string;
  primaryText: string;
  secondaryText: string;
  timestamp: string;
  href: string;
};

export type AuditReviewDetailScreen = {
  title: string;
  properties: Array<[label: string, value: string]>;
  metadataRows: Array<[key: string, value: string]>;
  exportAction: null;
};

export function buildAuditReviewListScreen(input: {
  filters: AuditQueryParams;
  items: AuditReviewListItem[];
}): AuditReviewListScreen {
  return {
    title: 'Audit Review',
    filterChips: buildFilterChips(input.filters),
    rows: input.items.map(toAuditReviewRow),
    emptyState:
      input.items.length === 0
        ? 'No audit events match the current filters.'
        : null,
    exportAction: null,
  };
}

export function buildAuditReviewDetailScreen(
  detail: AuditReviewDetail,
): AuditReviewDetailScreen {
  const properties: Array<[string, string]> = [
    ['Event ID', detail.id],
    ['Tenant', detail.tenantId],
    ['Office', detail.officeId],
  ];

  if (detail.actorId !== undefined) {
    properties.push(['Actor', detail.actorId]);
  }

  properties.push(['Occurred at', detail.occurredAt]);

  return {
    title: detail.type,
    properties,
    metadataRows: Object.entries(detail.metadata).map(([key, value]) => [
      key,
      stringifyMetadataValue(value),
    ]),
    exportAction: null,
  };
}

function buildFilterChips(filters: AuditQueryParams): string[] {
  const chips: string[] = [];

  if (filters.actorId) {
    chips.push(`Actor: ${filters.actorId}`);
  }

  if (filters.conversationId) {
    chips.push(`Conversation: ${filters.conversationId}`);
  }

  if (filters.type) {
    chips.push(`Type: ${filters.type}`);
  }

  if (filters.from) {
    chips.push(`From: ${filters.from}`);
  }

  if (filters.to) {
    chips.push(`To: ${filters.to}`);
  }

  return chips;
}

function toAuditReviewRow(item: AuditReviewListItem): AuditReviewRow {
  const secondarySegments: string[] = [];

  if (item.actorId !== undefined) {
    secondarySegments.push(`Actor ${item.actorId}`);
  }

  if (item.conversationId !== undefined) {
    secondarySegments.push(`Conversation ${item.conversationId}`);
  }

  if (secondarySegments.length === 0) {
    secondarySegments.push(`Office ${item.officeId}`);
  }

  return {
    id: item.id,
    primaryText: item.type,
    secondaryText: secondarySegments.join(' • '),
    timestamp: item.occurredAt,
    href: `/audit/events/${item.id}`,
  };
}

function stringifyMetadataValue(value: unknown): string {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }

  return JSON.stringify(value);
}
