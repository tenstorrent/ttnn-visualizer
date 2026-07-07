// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import GitCommitInfo, { ReportGitMetadataLines } from '../src/components/operation-details/GitCommitInfo';
import { MOCK_FULL_GIT_SHA, MOCK_HTTP_GIT_URL, MOCK_SHORT_GIT_SHA, MOCK_SSH_GIT_URL } from './helpers/gitFixtures';

afterEach(cleanup);

describe('GitCommitInfo', () => {
    it('renders a commit link when gitUrl is an HTTP remote', () => {
        render(
            <GitCommitInfo
                gitUrl={MOCK_HTTP_GIT_URL}
                gitSha={MOCK_FULL_GIT_SHA}
            />,
        );

        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('href', `https://github.com/foo/bar/commit/${MOCK_FULL_GIT_SHA}`);
        expect(link).toHaveTextContent(MOCK_SHORT_GIT_SHA);
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noreferrer');
    });

    it('renders plain text when gitUrl is null', () => {
        render(
            <GitCommitInfo
                gitUrl={null}
                gitSha={MOCK_FULL_GIT_SHA}
            />,
        );

        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.getByText('Commit:')).toBeInTheDocument();
        expect(screen.getByText(MOCK_SHORT_GIT_SHA)).toBeInTheDocument();
    });

    it('renders plain text when gitUrl is an SSH remote', () => {
        render(
            <GitCommitInfo
                gitUrl={MOCK_SSH_GIT_URL}
                gitSha={MOCK_FULL_GIT_SHA}
            />,
        );

        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.getByText('Commit:')).toBeInTheDocument();
        expect(screen.getByText(MOCK_SHORT_GIT_SHA)).toBeInTheDocument();
    });

    it('renders nothing when gitSha is null', () => {
        render(
            <GitCommitInfo
                gitUrl={MOCK_HTTP_GIT_URL}
                gitSha={null}
            />,
        );

        expect(screen.queryByText(/Commit:/)).not.toBeInTheDocument();
    });
});

describe('ReportGitMetadataLines', () => {
    it('renders nothing when git metadata is absent', () => {
        const { container } = render(
            <ReportGitMetadataLines
                gitUrl={null}
                gitSha={null}
            />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('renders git repo only when gitUrl is present', () => {
        const { container } = render(
            <ReportGitMetadataLines
                gitUrl={MOCK_HTTP_GIT_URL}
                gitSha={null}
            />,
        );

        expect(container.textContent).toContain(`Git repo: ${MOCK_HTTP_GIT_URL}`);
        expect(screen.queryByText('Commit:')).not.toBeInTheDocument();
    });

    it('renders commit only when gitSha is present', () => {
        render(
            <ReportGitMetadataLines
                gitUrl={null}
                gitSha={MOCK_FULL_GIT_SHA}
            />,
        );

        expect(screen.queryByText(/Git repo:/)).not.toBeInTheDocument();
        expect(screen.getByText('Commit:')).toBeInTheDocument();
        expect(screen.getByText(MOCK_SHORT_GIT_SHA)).toBeInTheDocument();
    });

    it('renders git repo and a commit link when both are present with an HTTP remote', () => {
        const { container } = render(
            <ReportGitMetadataLines
                gitUrl={MOCK_HTTP_GIT_URL}
                gitSha={MOCK_FULL_GIT_SHA}
            />,
        );

        expect(container.textContent).toContain(`Git repo: ${MOCK_HTTP_GIT_URL}`);

        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('href', `https://github.com/foo/bar/commit/${MOCK_FULL_GIT_SHA}`);
        expect(within(link).getByText(MOCK_SHORT_GIT_SHA)).toBeInTheDocument();
    });

    it('renders plain commit text when both are present with an SSH remote', () => {
        const { container } = render(
            <ReportGitMetadataLines
                gitUrl={MOCK_SSH_GIT_URL}
                gitSha={MOCK_FULL_GIT_SHA}
            />,
        );

        expect(container.textContent).toContain(`Git repo: ${MOCK_SSH_GIT_URL}`);
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.getByText(MOCK_SHORT_GIT_SHA)).toBeInTheDocument();
    });
});
