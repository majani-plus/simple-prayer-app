// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // The website is a separate project with its own toolchain and its own CI job; Astro's
    // generated .astro/ types are not ours to lint.
    // `.claude/` holds harness-created worktrees — full stale copies of this repo that lint and
    // jest must never treat as project sources (jest ignores it in package.json for the same
    // reason).
    ignores: [
      'dist/*',
      '.expo/*',
      'node_modules/*',
      'docs/internal/**',
      'website/*',
      '.claude/**',
    ],
  },
]);
