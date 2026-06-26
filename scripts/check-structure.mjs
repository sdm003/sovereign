import { existsSync, statSync } from 'node:fs';

const requiredPaths = [
  'apps',
  'apps/ios-client',
  'apps/admin-console',
  'services',
  'services/api',
  'packages',
  'packages/contracts',
  'packages/ui-admin',
  'infra',
  'doc/architecture',
  'CONTRIBUTING.md',
  'README.md',
];

const missing = requiredPaths.filter((path) => !existsSync(path));

if (missing.length > 0) {
  console.error('Missing required monorepo paths:');
  for (const path of missing) {
    console.error(`- ${path}`);
  }
  process.exit(1);
}

for (const path of requiredPaths) {
  const stat = statSync(path);
  if (path.endsWith('.md')) {
    if (!stat.isFile()) {
      console.error(`Expected file but found something else: ${path}`);
      process.exit(1);
    }
    continue;
  }

  if (!stat.isDirectory()) {
    console.error(`Expected directory but found something else: ${path}`);
    process.exit(1);
  }
}

console.log('Monorepo structure is present.');
