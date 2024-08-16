import typescriptEslint from '@typescript-eslint/eslint-plugin';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default [
    ...compat.extends('eslint:recommended', 'plugin:@typescript-eslint/recommended'),
    {
        plugins: {
            '@typescript-eslint': typescriptEslint,
        },

        languageOptions: {
            globals: {
                ...globals.browser,
                ...Object.fromEntries(Object.entries(globals.serviceworker).map(([key]) => [key, 'off'])),
            },

            parser: tsParser,
            ecmaVersion: 13,
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
];