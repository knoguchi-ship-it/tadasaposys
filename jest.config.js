/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/unit/**/*.test.js'],
  setupFiles: ['./tests/unit/__mocks__/gas-globals.js'],
  transform: {},
  collectCoverageFrom: ['tests/unit/src/**/*.js'],
  coverageReporters: ['text', 'lcov'],
};
