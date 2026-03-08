export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  transform: {},
  moduleFileExtensions: ['js', 'mjs', 'json'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.example.js',
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/examples/'],
  testTimeout: 15000,
};
