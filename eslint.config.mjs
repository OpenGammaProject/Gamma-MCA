import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Default Configs
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Project Config
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...Object.fromEntries(
          Object.entries(globals.serviceworker).map(([key]) => [key, 'off'])
        ),
      },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },

    rules: {
      eqeqeq: 'error',
      quotes: ['warn', 'single'],
      'no-unused-private-class-members': 'warn',
      'no-unreachable-loop': 'error',
      'no-template-curly-in-string': 'error',
      'no-self-compare': 'error',
      'no-duplicate-imports': 'error',
      'no-await-in-loop': 'warn',
    },
  },

  // Ignore Paths
  {
    ignores: ['dist/', 'node_modules/'],
  }
);