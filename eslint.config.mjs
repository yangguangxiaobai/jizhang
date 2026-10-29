// Flat ESLint config shared by the server and shared packages.
// Division of labour: ESLint = TypeScript correctness rules, Prettier = formatting.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.vite/**',
      'data/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/server/**/*.ts', 'packages/shared/**/*.ts', '**/*.mjs', '**/*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // TypeScript already disables the base rule for TS files; this keeps the
      // JS-recommended version from double-reporting.
      'no-unused-vars': 'off',
      'no-console': 'off',
    },
  },
  prettier,
);
