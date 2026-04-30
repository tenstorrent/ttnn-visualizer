const { defineConfig, globalIgnores } = require('eslint/config');

const globals = require('globals');

const { fixupConfigRules, fixupPluginRules } = require('@eslint/compat');

const tsParser = require('@typescript-eslint/parser');
const reactRefreshModule = require('eslint-plugin-react-refresh');
const reactRefresh = reactRefreshModule.default || reactRefreshModule;
const unusedImports = require('eslint-plugin-unused-imports');
const jsxA11Y = require('eslint-plugin-jsx-a11y');
const _import = require('eslint-plugin-import');
const promise = require('eslint-plugin-promise');
const browserCompat = require('eslint-plugin-compat');
const prettier = require('eslint-plugin-prettier');
const js = require('@eslint/js');

const { FlatCompat } = require('@eslint/eslintrc');

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

module.exports = defineConfig([
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },

            parser: tsParser,

            parserOptions: {
                projectService: {
                    allowDefaultProject: [
                        '.stylelintrc.cjs',
                        'scripts/check-spdx.mjs',
                        'scripts/release.mjs',
                        'scripts/check-missing-dep-licenses.mjs',
                        'scripts/find-missing-js-dep-licenses.mjs',
                    ],
                },
            },
        },

        extends: fixupConfigRules(
            compat.extends(
                'eslint:recommended',
                'plugin:@typescript-eslint/recommended',
                'plugin:react/recommended',
                'plugin:react-hooks/recommended',
                'airbnb-base',
                'erb',
                'plugin:import/recommended',
                'plugin:jsx-a11y/recommended',
                'plugin:compat/recommended',
                'plugin:promise/recommended',
                'prettier',
                'plugin:prettier/recommended',
            ),
        ),

        plugins: {
            'react-refresh': reactRefresh,
            'unused-imports': unusedImports,
            'jsx-a11y': fixupPluginRules(jsxA11Y),
            import: fixupPluginRules(_import),
            promise: fixupPluginRules(promise),
            compat: fixupPluginRules(browserCompat),
            prettier: fixupPluginRules(prettier),
        },

        settings: {
            react: {
                version: '18',
            },

            'import/parsers': {
                '@typescript-eslint/parser': ['.ts', '.tsx'],
            },

            'import/resolver': {
                typescript: {
                    alwaysTryTypes: true,
                },

                alias: [['styles/*', './src/scss/*']],
            },
        },

        rules: {
            '@typescript-eslint/await-thenable': 'error',

            '@typescript-eslint/no-floating-promises': [
                'error',
                {
                    ignoreVoid: true,
                    ignoreIIFE: true,
                },
            ],

            '@typescript-eslint/no-misused-promises': [
                'error',
                {
                    checksConditionals: true,
                    checksSpreads: true,
                    checksVoidReturn: false,
                },
            ],

            '@typescript-eslint/no-shadow': 'error',

            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                },
            ],

            '@typescript-eslint/require-await': ['error'],
            'comma-dangle': ['error', 'always-multiline'],
            curly: ['error', 'all'],

            'import/extensions': [
                'warn',
                'never',
                {
                    css: 'always',
                    scss: 'always',
                    json: 'always',
                },
            ],

            'import/first': 'error',
            'import/no-duplicates': 'error',
            'import/no-extraneous-dependencies': 'off',
            'import/no-import-module-exports': 'off',
            'import/no-unresolved': 'error',
            'import/prefer-default-export': 'off',
            'max-classes-per-file': 'off',
            'no-plusplus': 'off',
            'no-restricted-syntax': 'off',
            'no-shadow': 'off',
            'no-underscore-dangle': 'off',
            'no-unused-vars': 'off',
            'no-use-before-define': 'off',
            'prefer-const': 'warn',
            'prettier/prettier': 'warn',

            'react-refresh/only-export-components': [
                'warn',
                {
                    allowConstantExport: true,
                },
            ],

            'react/function-component-definition': 0,

            'react/jsx-filename-extension': [
                'warn',
                {
                    extensions: ['.tsx'],
                },
            ],

            'react/jsx-props-no-spreading': 'off',
            'react/no-array-index-key': 'off',
            'react/react-in-jsx-scope': 'off',
            'react/require-default-props': 'off',
            'require-await': 'off',

            'sort-imports': [
                'error',
                {
                    ignoreDeclarationSort: true,
                },
            ],

            'unused-imports/no-unused-imports': 'error',

            'unused-imports/no-unused-vars': [
                'off',
                {
                    vars: 'all',
                    varsIgnorePattern: '^_',
                    args: 'after-used',
                    argsIgnorePattern: '^_',
                },
            ],
        },
    },
    globalIgnores([
        '**/dist',
        '**/*.svg',
        '**/*.scss',
        'src/libs/blueprintjs/legacySassSvgInlinerFactory.js',
        '**/node_modules',
        '**/.DS_Store',
        '**/build',
        '**/ttnn_env',
        '**/backend',
        'eslint.config.cjs',
        '**/docs/output',
    ]),
]);
