// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import Markdown from 'markdown-to-jsx';
// Bundled at build time rather than fetched. `docs/` is not packaged into the wheel
// (`[tool.setuptools.packages.find]` takes `backend` only), so reading it from disk at
// runtime would work in a source checkout and 404 for every PyPI install. Importing it
// keeps one copy of the text: the page cannot drift from the published documentation,
// and it renders with no network. #2035
import agentToolsDoc from '../../docs/src/agent-tools.md?raw';
import { DOC_MARKDOWN_OPTIONS } from '../definitions/MarkdownOptions';
import 'styles/routes/MCP.scss';

export default function MCP() {
    return (
        <>
            <Helmet title='MCP' />

            <div className='mcp-page'>
                <Markdown options={DOC_MARKDOWN_OPTIONS}>{agentToolsDoc}</Markdown>
            </div>
        </>
    );
}
