// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Callout, Intent } from '@blueprintjs/core';
import { Helmet } from 'react-helmet-async';
import Markdown from 'markdown-to-jsx';
// Bundled at build time rather than fetched. `docs/` is not packaged into the wheel
// (`[tool.setuptools.packages.find]` takes `backend` only), so reading it from disk at
// runtime would work in a source checkout and 404 for every PyPI install. Importing it
// keeps one copy of the text: the page cannot drift from the published documentation,
// and it renders with no network. #2035
import agentToolsDoc from '../../docs/src/agent-tools.md?raw';
import { DOC_MARKDOWN_OPTIONS } from '../definitions/MarkdownOptions';
import getServerConfig from '../functions/getServerConfig';
import 'styles/routes/MCP.scss';

export default function MCP() {
    const isServerMode = getServerConfig().SERVER_MODE;

    return (
        <>
            <Helmet title='MCP' />

            <div className='mcp-page'>
                {isServerMode && (
                    <Callout
                        intent={Intent.PRIMARY}
                        title='This describes a server you run yourself'
                    >
                        TT-NN Visualizer is hosted here, but the MCP server is a local process started by your own
                        agent, and it addresses reports by path on the machine it runs on. To use it against the reports
                        on this deployment you need them, and the package, on that machine.
                    </Callout>
                )}

                <Markdown options={DOC_MARKDOWN_OPTIONS}>{agentToolsDoc}</Markdown>
            </div>
        </>
    );
}
