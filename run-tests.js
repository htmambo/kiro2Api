import { spawnSync } from 'child_process';

const args = process.argv.slice(2);
const passThroughArgs = args.filter((arg) => arg !== '--unit' && arg !== '--integration');
const mode = args.includes('--integration')
    ? 'integration'
    : args.includes('--unit')
        ? 'unit'
        : 'all';

const jestArgs = [
    '--experimental-vm-modules',
    './node_modules/jest/bin/jest.js',
    '--runInBand'
];

if (mode === 'unit') {
    jestArgs.push('--testPathPattern=tests/unit');
} else if (mode === 'integration') {
    jestArgs.push('--testPathPattern=tests/integration');
}

jestArgs.push(...passThroughArgs);

const result = spawnSync(process.execPath, jestArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
});

if (typeof result.status === 'number') {
    process.exit(result.status);
}

process.exit(1);
