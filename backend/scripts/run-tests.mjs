/**
 * npm run test — run generated Playwright tests for a fix.
 *
 * Usage:
 *   npm run test -- --fix-id fix_xxx                 # run tests for one fix
 *   npm run test -- --all                            # run tests for all fixes that have them
 *   npm run test -- --fix-id fix_xxx --visual        # also run the visual UI test
 *
 * Requires the backend server to be running (it reads fix records via the API).
 */
import { api, pickFix } from './test-lib.mjs';

const args = process.argv.slice(2);
const fixIdArg = args.includes('--fix-id') ? args[args.indexOf('--fix-id') + 1] : null;
const runAll = args.includes('--all');
const withVisual = args.includes('--visual');

async function main() {
  const fixes = await api('/api/fixes'); // convenience list endpoint
  if (fixes.status === 404) {
    console.error('❌ Server does not expose /api/fixes list — is it running the latest code?');
    process.exit(1);
  }

  const allFixes = fixes.body.fixes || [];
  const withTests = allFixes.filter(f => f.testFile);

  let targets;
  if (fixIdArg) {
    targets = allFixes.filter(f => f.fixId === fixIdArg);
    if (targets.length === 0) {
      console.error(`❌ Fix ${fixIdArg} not found`);
      process.exit(1);
    }
  } else if (runAll) {
    targets = withTests;
    if (targets.length === 0) {
      console.error('❌ No fixes have generated tests. Generate some first via /tests/generate.');
      process.exit(1);
    }
  } else {
    console.error('Usage: npm run test -- --fix-id <fixId> [--visual]  |  npm run test -- --all');
    process.exit(1);
  }

  let failures = 0;
  for (const fix of targets) {
    console.log(`\n▶ Running tests for ${fix.fixId} (${fix.ruleId}) — ${fix.testFile}`);

    if (withVisual) {
      console.log('  📷 Visual UI test…');
      const visual = await api(`/api/fixes/${fix.fixId}/visual-test`, { method: 'POST' });
      if (visual.status === 200) {
        const v = visual.body.visual;
        console.log(`     ${v.status === 'passed' ? '✅' : '❌'} visual: ${v.status} (maxDiff=${v.summary?.maxDiffRatio}, layoutShifts=${v.summary?.layoutShiftCount})`);
        if (v.status !== 'passed') failures++;
      } else {
        console.log(`     ⚠️ visual test unavailable: ${JSON.stringify(visual.body)}`);
      }
    }

    const run = await api(`/api/fixes/${fix.fixId}/tests/run`, { method: 'POST' });
    if (run.status === 200 && run.body.passed) {
      console.log('  ✅ functional tests passed');
    } else if (run.status === 200) {
      console.log('  ❌ functional tests FAILED');
      console.log(run.body.output?.split('\n').slice(-20).join('\n'));
      failures++;
    } else {
      console.log(`  ❌ could not run tests: ${JSON.stringify(run.body)}`);
      failures++;
    }
  }

  console.log(failures === 0 ? '\n🎉 ALL TESTS PASSED' : `\n💥 ${failures} test run(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
