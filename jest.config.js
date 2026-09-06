/**
 * Jest is split into two named projects so the pipeline can run them as
 * separate jobs:  `jest --selectProjects unit`  /  `--selectProjects integration`.
 * Coverage options live at the top level and apply to whichever projects ran.
 */

/** @type {import('jest').Config['transform']} */
const tsTransform = {
  '^.+\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: { warnOnly: false } }],
};

/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
      transform: tsTransform,
      clearMocks: true,
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
      transform: tsTransform,
      setupFilesAfterEnv: ['<rootDir>/tests/helpers/setupIntegration.ts'],
      clearMocks: true,
    },
  ],

  // ---- Coverage gate: this is what makes the CI job fail ----
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/server.ts',
    '!src/db/seed.ts',
    '!src/services/types.ts', // type-only module: nothing to execute
    '!src/**/*.d.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'cobertura', 'json-summary'],
  // Deliberately loose: the demo pipeline must be green unless you break it on
  // purpose. Baseline is ~98% statements / ~96% branches, so there is a wide
  // margin before this gate ever trips by accident.
  coverageThreshold: {
    global: { statements: 85, branches: 80, functions: 85, lines: 85 },
    // The pure business rules are the heart of the system - hold them higher.
    './src/domain/': { statements: 95, branches: 90, functions: 95, lines: 95 },
  },
};
