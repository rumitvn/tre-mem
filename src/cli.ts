#!/usr/bin/env node
import { cac } from 'cac';

import { migrate } from './store/migrate.js';
import { TRE_MEM_DB_PATH, TRE_MEM_HOME } from './store/paths.js';

const cli = cac('tre');

cli
  .command('init', 'Initialize ~/.tre-mem/ and run schema migrations')
  .action(() => {
    const result = migrate();
    if (result.applied.length === 0) {
      console.log(`tre-mem: already at schema v${result.toVersion} (${result.dbPath})`);
    } else {
      console.log(
        `tre-mem: migrated ${result.dbPath} from v${result.fromVersion} -> v${result.toVersion}`,
      );
      console.log(`  applied: ${result.applied.join(', ')}`);
    }
    console.log(`  home: ${TRE_MEM_HOME}`);
    console.log(`  db:   ${TRE_MEM_DB_PATH}`);
  });

cli.help();
cli.version(getPackageVersion());

try {
  cli.parse();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`tre: ${msg}`);
  process.exit(1);
}

function getPackageVersion(): string {
  return '0.0.0';
}
