const config = {
  displayName: "claude-gdoc-review-plugin",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  // Every worker gets its own throwaway CLAUDE_CONFIG_DIR before any test
  // module loads, so no test can read or write the developer's real
  // ~/.claude/gdoc-review; the teardown removes them after the run.
  setupFiles: ["<rootDir>/tests/support/setupEnvironment.ts"],
  // globalSetup runs once, in the Jest process, before any worker is forked: it
  // creates the one directory the whole run writes inside and exports its path,
  // which every worker inherits and the teardown reads back.
  globalSetup: "<rootDir>/tests/support/globalSetup.ts",
  globalTeardown: "<rootDir>/tests/support/testEnvironment.ts",
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/etc/tsconfig/tsconfig.base.jest.json"
      }
    ]
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^claude-gdoc-review-plugin$": "<rootDir>/src/index",
    "^claude-gdoc-review-plugin/(.*)$": "<rootDir>/src/$1"
  },
  testTimeout: 120_000
}

export default config
