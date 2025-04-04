module.exports = {
    extends: ['stylelint-config-standard-scss', 'stylelint-prettier/recommended'],
    overrides: [
        {
            files: ['**/*.scss'],
        },
    ],
    fix: true,
    rules: {
        'no-duplicate-selectors': true,
        'color-hex-length': 'short',
        'color-named': 'never',
        'declaration-no-important': true,
        'property-no-vendor-prefix': true,
        'value-no-vendor-prefix': true,
        'function-url-quotes': 'always',
        'font-family-name-quotes': 'always-where-recommended',
        'comment-whitespace-inside': 'always',
        'at-rule-no-vendor-prefix': true,
        'selector-pseudo-element-colon-notation': 'double',
        'comment-no-empty': null,
        'scss/comment-no-empty': null,
        'no-descending-specificity': null,
    },
};
