import { randomUUID } from 'node:crypto';

import type {
  AuthContextResponse,
  Membership,
  Office,
  Tenant,
} from '@sovereign/contracts';
import type { AuthRole, MembershipStatus } from '@sovereign/contracts';

type CreateTenantInput = {
  name: string;
};

type CreateOfficeInput = {
  tenantId: string;
  name: string;
};

type CreateMembershipInput = {
  tenantId: string;
  officeId: string;
  userId: string;
  role: AuthRole;
  status: MembershipStatus;
};

type ResolveAuthContextInput = {
  tenantId: string;
  userId: string;
};

type Clock = {
  now: () => Date;
};

const defaultClock: Clock = {
  now: () => new Date(),
};

export class TenancyConstraintError extends Error {
  constructor(
    public readonly code:
      | 'TENANT_OFFICE_ALREADY_EXISTS'
      | 'OFFICE_TENANT_MISMATCH'
      | 'MEMBERSHIP_TENANT_MISMATCH'
      | 'DUPLICATE_MEMBERSHIP',
    message: string,
  ) {
    super(message);
    this.name = 'TenancyConstraintError';
  }
}

export class TenancyNotFoundError extends Error {
  constructor(
    public readonly code:
      | 'TENANT_NOT_FOUND'
      | 'OFFICE_NOT_FOUND'
      | 'MEMBERSHIP_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'TenancyNotFoundError';
  }
}

export class InMemoryTenancyRepository {
  private readonly tenants = new Map<string, Tenant>();
  private readonly offices = new Map<string, Office>();
  private readonly memberships = new Map<string, Membership>();

  async createTenant(tenant: Tenant): Promise<void> {
    this.tenants.set(tenant.id, tenant);
  }

  async getTenant(id: string): Promise<Tenant | null> {
    return this.tenants.get(id) ?? null;
  }

  async createOffice(office: Office): Promise<void> {
    this.offices.set(office.id, office);
  }

  async getOffice(id: string): Promise<Office | null> {
    return this.offices.get(id) ?? null;
  }

  async findOfficeByTenantId(tenantId: string): Promise<Office | null> {
    for (const office of this.offices.values()) {
      if (office.tenantId === tenantId) {
        return office;
      }
    }
    return null;
  }

  async createMembership(membership: Membership): Promise<void> {
    this.memberships.set(membership.id, membership);
  }

  async saveMembership(membership: Membership): Promise<void> {
    this.memberships.set(membership.id, membership);
  }

  async findMembershipByTenantAndUser(
    tenantId: string,
    userId: string,
  ): Promise<Membership | null> {
    for (const membership of this.memberships.values()) {
      if (membership.tenantId === tenantId && membership.userId === userId) {
        return membership;
      }
    }
    return null;
  }

  listMemberships(): Membership[] {
    return Array.from(this.memberships.values()).map((membership) => ({
      ...membership,
    }));
  }
}

type TenancyRepository = Pick<
  InMemoryTenancyRepository,
  | 'createTenant'
  | 'getTenant'
  | 'createOffice'
  | 'getOffice'
  | 'findOfficeByTenantId'
  | 'createMembership'
  | 'findMembershipByTenantAndUser'
>;

export class TenancyService {
  constructor(
    private readonly repository: TenancyRepository,
    private readonly clock: Clock = defaultClock,
  ) {}

  async createTenant(input: CreateTenantInput): Promise<Tenant> {
    const tenant: Tenant = {
      id: randomUUID(),
      name: input.name,
      createdAt: this.clock.now().toISOString(),
    };
    await this.repository.createTenant(tenant);
    return tenant;
  }

  async createOffice(input: CreateOfficeInput): Promise<Office> {
    await this.requireTenant(input.tenantId);

    const existingOffice = await this.repository.findOfficeByTenantId(
      input.tenantId,
    );
    if (existingOffice) {
      throw new TenancyConstraintError(
        'TENANT_OFFICE_ALREADY_EXISTS',
        'A tenant may only have one office in V1.',
      );
    }

    const office: Office = {
      id: randomUUID(),
      tenantId: input.tenantId,
      name: input.name,
      createdAt: this.clock.now().toISOString(),
    };
    await this.repository.createOffice(office);
    return office;
  }

  async createMembership(
    input: CreateMembershipInput,
  ): Promise<Membership> {
    await this.requireTenant(input.tenantId);

    const office = await this.repository.getOffice(input.officeId);
    if (!office) {
      throw new TenancyNotFoundError(
        'OFFICE_NOT_FOUND',
        'Office does not exist.',
      );
    }

    if (office.tenantId !== input.tenantId) {
      throw new TenancyConstraintError(
        'OFFICE_TENANT_MISMATCH',
        'Office must belong to the same tenant as the membership.',
      );
    }

    const existingMembership =
      await this.repository.findMembershipByTenantAndUser(
        input.tenantId,
        input.userId,
      );
    if (existingMembership) {
      throw new TenancyConstraintError(
        'DUPLICATE_MEMBERSHIP',
        'Membership already exists for this user in the tenant.',
      );
    }

    const membership: Membership = {
      id: randomUUID(),
      tenantId: input.tenantId,
      officeId: input.officeId,
      userId: input.userId,
      role: input.role,
      status: input.status,
      onboardingStatus: 'invited',
      kycStatus: 'not_started',
      createdAt: this.clock.now().toISOString(),
    };
    await this.repository.createMembership(membership);
    return membership;
  }

  async resolveAuthContext(
    input: ResolveAuthContextInput,
  ): Promise<AuthContextResponse> {
    await this.requireTenant(input.tenantId);

    const membership = await this.repository.findMembershipByTenantAndUser(
      input.tenantId,
      input.userId,
    );
    if (!membership) {
      throw new TenancyNotFoundError(
        'MEMBERSHIP_NOT_FOUND',
        'Membership does not exist for this tenant and user.',
      );
    }

    return {
      tenantId: membership.tenantId,
      officeId: membership.officeId,
      userId: membership.userId,
      role: membership.role,
      membershipStatus: membership.status,
    };
  }

  private async requireTenant(tenantId: string): Promise<Tenant> {
    const tenant = await this.repository.getTenant(tenantId);
    if (!tenant) {
      throw new TenancyNotFoundError(
        'TENANT_NOT_FOUND',
        'Tenant does not exist.',
      );
    }
    return tenant;
  }
}
