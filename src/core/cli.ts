import { isOperatorError, listCompanies, operatorError, slugId } from './config.ts';

/**
 * `--company <slug>` for every script, stripped from argv before the script
 * reads its own positional arguments.
 *
 * Scripts resolve their company through the environment, so setting it here
 * means nothing downstream has to know a flag exists.
 */
export const takeCompanyFlag = (argv = process.argv): void => {
  // A misconfiguration is not a crash. Print the one line that helps and stop.
  process.on('uncaughtException', (e) => {
    if (!isOperatorError(e)) throw e;
    console.error(`\n  ${e.message}\n`);
    process.exit(1);
  });

  const i = argv.findIndex((a) => a === '--company' || a === '-c');
  if (i === -1) return;
  const value = argv[i + 1];
  if (!value) {
    const all = listCompanies().map((c) => c.slug).sort().join(', ');
    throw operatorError(`--company needs a slug. Known: ${all || '(none)'}`);
  }
  process.env['RIFF_COMPANY_ID'] = slugId(value);
  argv.splice(i, 2);
};
