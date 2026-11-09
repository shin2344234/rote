// Stands in for the Codex CLI in the bridge test. It echoes what it was given into the answer file.
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('codex-cli 9.9.9');
  process.exit(0);
}

const after = (flag) => args[args.indexOf(flag) + 1];
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', () => {
  if (stdin.includes('FAIL')) {
    console.error('not signed in');
    process.exit(1);
  }
  const answer = stdin.includes('GARBLE') ? 'not json' : JSON.stringify({
    answers: [],
    seen: { args, stdin, schema: JSON.parse(readFileSync(after('--output-schema'), 'utf8')), cwd: process.cwd() },
  });
  writeFileSync(after('--output-last-message'), answer);
});
