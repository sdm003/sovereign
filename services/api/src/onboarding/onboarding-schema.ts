export const onboardingMembershipAlterSql = `
alter table membership
  add column onboarding_status text not null default 'invited',
  add column kyc_status text not null default 'not_started';
`.trim();
