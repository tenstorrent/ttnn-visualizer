// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import StackTrace from '../src/components/operation-details/StackTrace';
import { StackTraceLanguage } from '../src/definitions/StackTrace';

const renderStackTrace = (stackTrace: string) =>
    render(
        <StackTrace
            stackTrace={stackTrace}
            language={StackTraceLanguage.CPP}
            hideSourceButton
        />,
    );

afterEach(cleanup);

describe('StackTrace expand toggle', () => {
    it('is hidden when the preview already shows the whole trace', () => {
        renderStackTrace("Operation 'ttnn.conv2d' started but never completed (likely crashed)");

        expect(screen.queryByRole('button', { name: /expand/i })).not.toBeInTheDocument();
    });

    it('is shown when the trace is longer than the preview', () => {
        renderStackTrace('line 1\nline 2\nline 3');

        expect(screen.getByRole('button', { name: /expand/i })).toBeInTheDocument();
    });
});
