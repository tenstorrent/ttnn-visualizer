// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import Markdown from 'markdown-to-jsx';
import { ServerConfig } from '../src/definitions/ServerConfig';
import { DOC_MARKDOWN_OPTIONS } from '../src/definitions/MarkdownOptions';
import MCP from '../src/routes/MCP';

vi.mock('react-helmet-async', () => ({ Helmet: () => null }));

const getServerConfigMock = vi.hoisted(() => vi.fn((): Partial<ServerConfig> => ({ SERVER_MODE: false })));

vi.mock('../src/functions/getServerConfig', () => ({ default: getServerConfigMock }));

afterEach(cleanup);
beforeEach(() => getServerConfigMock.mockReturnValue({ SERVER_MODE: false }));

describe('MCP', () => {
    it('renders the published documentation rather than a copy of it', () => {
        // The page imports docs/src/agent-tools.md. Asserting on content the page never
        // declares is the point: if the import is dropped for hand-written prose, or the
        // doc moves, there is nothing here to render and this fails.
        render(<MCP />);

        expect(screen.getByRole('heading', { level: 1, name: /agent tools/i })).toBeInTheDocument();
        expect(screen.getByText('ttnn-visualizer-mcp', { selector: 'code' })).toBeInTheDocument();
    });

    it('renders the tool table as a table, so the tools are readable as a set', () => {
        // GFM tables need the renderer to support them; without that the whole table
        // arrives as one run of pipe-separated text and the page is unusable.
        render(<MCP />);

        const [toolTable] = screen.getAllByRole('table');

        expect(within(toolTable).getByText('memory_profile')).toBeInTheDocument();
        expect(within(toolTable).getByText('load_report')).toBeInTheDocument();
    });

    it('does not print the licence header every doc file carries', () => {
        // Characterises the renderer rather than our code: markdown-to-jsx drops HTML
        // comments, so the page needs no stripping of its own. Pinned because that is a
        // property we rely on and would lose silently in a renderer swap.
        render(<MCP />);

        expect(screen.queryByText(/SPDX-License-Identifier/)).not.toBeInTheDocument();
    });

    it('sends a documentation link to a new tab rather than out of the application', () => {
        // agent-tools.md carries no links yet, so nothing in the page exercises this.
        // Driving the options directly keeps it from becoming configuration that quietly
        // stops working — in place, a link would unload the whole SPA.
        render(<Markdown options={DOC_MARKDOWN_OPTIONS}>{'[docs](https://docs.tenstorrent.com)'}</Markdown>);

        const link = screen.getByRole('link', { name: 'docs' });

        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
    });

    it('says the server is the reader’s to run when the app is hosted', () => {
        // Hosted, "run ttnn-visualizer-mcp" is about the reader's own machine, and the
        // tools address reports by path on whichever machine that is.
        getServerConfigMock.mockReturnValue({ SERVER_MODE: true });

        render(<MCP />);

        expect(screen.getByText(/server you run yourself/i)).toBeInTheDocument();
    });

    it('leaves the hosted note out of a local run, where it would only mislead', () => {
        render(<MCP />);

        expect(screen.queryByText(/server you run yourself/i)).not.toBeInTheDocument();
    });
});
