// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * How a repository markdown document renders inside the application.
 *
 * A document rendered in a single-page application is a page that did not ask to be one:
 * a link left to its default would navigate in place and take the whole app with it. The
 * pages that render docs carry no links today (`docs/src/agent-tools.md` has none), which
 * is the reason this lives somewhere a test can reach rather than inline — unexercised
 * configuration is the kind that stops working without anyone noticing. #2035
 */
export const DOC_MARKDOWN_OPTIONS = {
    overrides: {
        a: {
            props: {
                target: '_blank',
                rel: 'noreferrer',
            },
        },
    },
};

export default DOC_MARKDOWN_OPTIONS;
