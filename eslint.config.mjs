// Root ESLint flat config — applies to all packages
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

/** @type {import("eslint").Linter.FlatConfig[]} */
export default [
  // Ignore compiled output and deps
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**'],
  },

  // TypeScript base rules (all packages)
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      // TS recommended
      ...tsPlugin.configs.recommended.rules,

      // React
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off', // Not needed with Vite + React 17+
      'react/prop-types': 'off', // TypeScript handles this

      // Strictness
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': 'error',

      // Prettier disables conflicting style rules
      ...prettierConfig.rules,
    },
    settings: {
      react: { version: 'detect' },
    },
  },
];
