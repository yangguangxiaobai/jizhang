// Flat ESLint config shared by all three packages (root `pnpm lint` runs it in each).
// Division of labour: ESLint = correctness rules (TS + Vue essential), Prettier = formatting.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
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
  ...pluginVue.configs['flat/essential'],
  {
    // `tseslint.configs.recommended` only claims .ts/.tsx, so the <script> block
    // of a .vue SFC needs the TS parser wired in explicitly.
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      'vue/multi-word-component-names': ['error', { ignores: ['App'] }],
    },
  },
  {
    files: ['packages/server/**/*.ts', 'packages/shared/**/*.ts', '**/*.mjs', '**/*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['packages/web/**/*.{ts,vue}'],
    languageOptions: { globals: { ...globals.browser } },
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
