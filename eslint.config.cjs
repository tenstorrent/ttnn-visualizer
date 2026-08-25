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
        files: ['**/*.ts', '**/*.tsx'],

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
                        'eslint.config.cjs',
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
                    mjs: 'always',
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
            // `src/functions/createToastNotification.tsx` is the only module that may call
            // `toast`, so every toast shares the one `<ToastContainer>` in `Layout.tsx`.
            // Types are unrestricted -- `activeToastAtom` is typed `Id | null`.
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: 'react-toastify',
                            importNames: ['toast'],
                            message:
                                'Emit toasts through src/functions/createToastNotification: createToastNotification for the file-change template, createToast/dismissToast for custom content.',
                        },
                    ],
                },
            ],

            'no-restricted-syntax': [
                'error',
                {
                    selector: "TSTypeReference[typeName.name='FC']",
                    message:
                        'Type props directly: function Foo({…}: FooProps). Do not use FC. Declare children: ReactNode on FooProps if needed.',
                },
                {
                    selector:
                        "TSTypeReference[typeName.type='TSQualifiedName'][typeName.left.name='React'][typeName.right.name='FC']",
                    message:
                        'Type props directly: function Foo({…}: FooProps). Do not use React.FC. Declare children: ReactNode on FooProps if needed.',
                },
                {
                    selector: "TSTypeReference[typeName.name='FunctionComponent']",
                    message: 'Type props directly: function Foo({…}: FooProps). Do not use FunctionComponent.',
                },
                {
                    selector:
                        "TSTypeReference[typeName.type='TSQualifiedName'][typeName.left.name='React'][typeName.right.name='FunctionComponent']",
                    message: 'Type props directly: function Foo({…}: FooProps). Do not use React.FunctionComponent.',
                },
            ],
            // Migrated from eslint-config-erb: preserve prior lint behaviour after removing the preset.
            'no-param-reassign': ['error', { props: false }], // overrides airbnb-base `props: true`
            'no-shadow': 'off',
            'no-underscore-dangle': 'off',
            'no-unused-vars': 'off',
            'no-use-before-define': 'off',
            // Statement-position `void` is how we acknowledge a fire-and-forget promise under
            // `no-floating-promises` (`ignoreVoid: true`); airbnb-base's blanket `no-void` forbids it.
            // Still an error when `void` is used as an expression, which is the confusing case.
            'no-void': ['error', { allowAsStatement: true }],
            'prefer-const': 'warn',
            'prettier/prettier': 'warn',

            'react-refresh/only-export-components': [
                'warn',
                {
                    allowConstantExport: true,
                },
            ],

            'react/function-component-definition': [
                'error',
                {
                    namedComponents: ['function-declaration', 'arrow-function'],
                    unnamedComponents: 'arrow-function',
                },
            ],

            // erb pulled in eslint-config-airbnb react rules; pin the two we still rely on.
            'react/display-name': 'off', // airbnb disabled; react/recommended would error on anonymous components
            'react/no-danger': 'warn', // keeps existing eslint-disable comments valid under --max-warnings 0

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
    {
        // The toast wrapper is the one place the restriction above exists to funnel into.
        files: ['src/functions/createToastNotification.tsx'],

        rules: {
            'no-restricted-imports': 'off',
        },
    },
    {
        files: ['**/*.cjs'],

        languageOptions: {
            globals: {
                ...globals.node,
            },

            ecmaVersion: 'latest',
            sourceType: 'commonjs',
        },

        plugins: {
            prettier: fixupPluginRules(prettier),
        },

        rules: {
            '@typescript-eslint/no-require-imports': 'off',
            'import/newline-after-import': 'off',
            'import/no-unresolved': 'off',
            'prettier/prettier': 'warn',
        },
    },
    globalIgnores([
        '**/.DS_Store',
        '**/.venv',
        '**/*.scss',
        '**/*.svg',
        '**/backend',
        '**/build',
        '**/dist',
        '**/docs',
        '**/docs/output',
        '**/myenv',
        '**/node_modules',
        '**/ttnn_env',
        'eslint.config.cjs',
        'src/libs/blueprintjs/legacySassSvgInlinerFactory.js',
    ]),
]);
