module.exports = {
    root: true,
    env: { browser: true, es2022: true },
    extends: [
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
    ],
    ignorePatterns: ['dist', '.eslintrc.cjs', '*.svg', '*.scss', 'legacySassSvgInlinerFactory.js', 'node_modules', '.DS_Store', 'build'], // move to eslint.config if we upgrade to eslint v9
    parser: '@typescript-eslint/parser',
    parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
    },
    plugins: [
        'react-refresh', // eslint-plugin-react-refresh
        'eslint-plugin-unused-imports',
        'jsx-a11y', // eslint-plugin-jsx-a11y
        'import', // eslint-import-resolver-typescript
        'promise', // eslint-plugin-promise
        'compat', // eslint-plugin-compat
        'prettier',
    ],
    settings: {
        react: {
            version: '18',
        },
        'import/parsers': {
            '@typescript-eslint/parser': ['.ts', '.tsx'],
        },
        "import/resolver": {
            "typescript": {
                "alwaysTryTypes": true
            },
            "alias": [
                ["styles/*", "./src/scss/*"]
            ]
        }

    },
    rules: {
        'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
        'import/no-unresolved': 'error',
        'import/no-extraneous-dependencies': 'off',
        '@typescript-eslint/await-thenable': 'error',
        '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true, ignoreIIFE: true }],
        '@typescript-eslint/no-misused-promises': [
            'error',
            {
                checksConditionals: true,
                checksSpreads: true,
                checksVoidReturn: false,
            },
        ],
        '@typescript-eslint/no-shadow': 'error',
        'require-await': 'off',
        '@typescript-eslint/require-await': ['error'],
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        'comma-dangle': ['error', 'always-multiline'],
        curly: ['error', 'all'],
        'import/extensions': ['warn', 'never', { css: 'always', scss: 'always', json: 'always' }],
        'import/no-import-module-exports': 'off',
        'max-classes-per-file': 'off',
        'no-shadow': 'off',
        'no-unused-vars': 'off',
        'no-use-before-define': 'off',
        'prefer-const': 'warn',
        'prettier/prettier': 'warn',
        'react/jsx-filename-extension': ['warn', { extensions: ['.tsx'] }],
        'react/no-array-index-key': 'off',
        'react/react-in-jsx-scope': 'off',
        'no-plusplus': 'off',
        'no-underscore-dangle': 'off',
        'react/function-component-definition': 0,
        'sort-imports': [
            'error',
            {
                ignoreDeclarationSort: true,
            },
        ],
        'import/first': 'error',
        'import/no-duplicates': 'error',
        'import/prefer-default-export': 'off',
        'unused-imports/no-unused-imports': 'error',
        'unused-imports/no-unused-vars': [
            'off',
            { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
        ],
        'react/require-default-props': 'off',
        'no-restricted-syntax': 'off'
    },
};
