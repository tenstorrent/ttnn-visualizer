// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import GitCommitInfo from '../src/components/operation-details/GitCommitInfo';

const FULL_SHA = 'abcdef0123456789abcdef0123456789abcdef01';

afterEach(cleanup);

describe('GitCommitInfo', () => {
    it('renders a commit link when gitUrl is an HTTP remote', () => {
        render(
            <GitCommitInfo
                gitUrl='https://github.com/foo/bar.git'
                gitSha={FULL_SHA}
            />,
        );

        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('href', `https://github.com/foo/bar/commit/${FULL_SHA}`);
        expect(link).toHaveTextContent('abcdef0');
    });

    it('renders plain text when gitUrl is null', () => {
        render(
            <GitCommitInfo
                gitUrl={null}
                gitSha={FULL_SHA}
            />,
        );

        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.getByText(/Commit:/)).toHaveTextContent('abcdef0');
    });

    it('renders plain text when gitUrl is an SSH remote', () => {
        render(
            <GitCommitInfo
                gitUrl='git@github.com:foo/bar.git'
                gitSha={FULL_SHA}
            />,
        );

        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.getByText(/Commit:/)).toHaveTextContent('abcdef0');
    });
});
