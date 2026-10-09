// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { Navigate } from 'react-router';
import Markdown from 'markdown-to-jsx';
// Bundled at build time rather than fetched. `docs/` is not packaged into the wheel
// (`[tool.setuptools.packages.find]` takes `backend` only), so reading it from disk at
// runtime would work in a source checkout and 404 for every PyPI install. Importing it
// keeps one copy of the text: the page cannot drift from the published documentation,
// and it renders with no network. #2035
import agentToolsDoc from '../../docs/src/agent-tools.md?raw';
import { DOC_MARKDOWN_OPTIONS } from '../definitions/MarkdownOptions';
import ROUTES from '../definitions/Routes';
import getServerConfig from '../functions/getServerConfig';
import 'styles/routes/MCP.scss';

export default function MCP() {
    const isServerMode = !!getServerConfig()?.SERVER_MODE;

    // Hidden from the rail when hosted, so a typed or bookmarked URL lands on Home rather
    // than on instructions for a process the reader cannot point at this deployment. #2101
    if (isServerMode) {
        return (
            <Navigate
                to={ROUTES.HOME}
                replace
            />
        );
    }

    return (
        <>
            <Helmet title='MCP' />

            <div className='mcp-page'>
                <Markdown options={DOC_MARKDOWN_OPTIONS}>{agentToolsDoc}</Markdown>
            </div>
        </>
    );
}
