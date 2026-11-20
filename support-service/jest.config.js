module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/tests/**/*.test.ts'],
    setupFiles: ['<rootDir>/src/tests/env.setup.ts'],
    transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { isolatedModules: true } }] },
    testTimeout: 30000,
    // One shared test database: suites run one after the other.
    maxWorkers: 1,
};
