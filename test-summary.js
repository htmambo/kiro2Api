import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const testsRoot = path.resolve('tests');
const testFilePattern = /\.(test|spec)\.[cm]?[jt]sx?$/;

function walk(directory) {
  return readdirSync(directory).flatMap(entry => {
    const absolutePath = path.join(directory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      return walk(absolutePath);
    }

    return [absolutePath];
  });
}

if (!existsSync(testsRoot)) {
  console.log('No tests directory found.');
  process.exit(0);
}

const allTestFiles = walk(testsRoot)
  .filter(file => testFilePattern.test(file))
  .map(file => path.relative(process.cwd(), file))
  .sort();

const unitTests = allTestFiles.filter(file => file.startsWith(path.join('tests', 'unit')));
const integrationTests = allTestFiles.filter(file => file.startsWith(path.join('tests', 'integration')));

console.log('Test summary');
console.log(`- Total files: ${allTestFiles.length}`);
console.log(`- Unit files: ${unitTests.length}`);
console.log(`- Integration files: ${integrationTests.length}`);

if (allTestFiles.length > 0) {
  console.log('- Test files:');
  allTestFiles.forEach(file => console.log(`  - ${file}`));
}
