// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useObservedWidth from '../src/hooks/useObservedWidth';
import {
    CapturingResizeObserver,
    getObserverFor,
    installCapturingResizeObserver,
} from './helpers/capturingResizeObserver';

const WidthProbe = ({ target }: { target: 'first' | 'second' }) => {
    const [ref, width] = useObservedWidth();

    return (
        <>
            {/* Different element types, so React replaces the node rather than reusing it */}
            {target === 'first' ? (
                <div
                    data-testid='first'
                    ref={ref}
                />
            ) : (
                <span
                    data-testid='second'
                    ref={ref}
                />
            )}
            <output data-testid='width'>{width}</output>
        </>
    );
};

const getWidth = () => screen.getByTestId('width').textContent;

describe('useObservedWidth', () => {
    beforeEach(installCapturingResizeObserver);

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('starts at 0 and reports the observed width rounded to whole pixels', () => {
        render(<WidthProbe target='first' />);
        expect(getWidth()).toBe('0');

        getObserverFor(screen.getByTestId('first')).report(300.6);

        expect(getWidth()).toBe('301');
    });

    it('disconnects its observer when the element unmounts', () => {
        const { unmount } = render(<WidthProbe target='first' />);
        const observer = getObserverFor(screen.getByTestId('first'));

        unmount();

        expect(observer.disconnect).toHaveBeenCalled();
    });

    it('stops watching the old element and watches the new one when the ref moves', () => {
        const { rerender } = render(<WidthProbe target='first' />);
        const firstObserver = getObserverFor(screen.getByTestId('first'));

        rerender(<WidthProbe target='second' />);

        expect(firstObserver.disconnect).toHaveBeenCalled();
        const secondObserver = getObserverFor(screen.getByTestId('second'));
        expect(secondObserver).not.toBe(firstObserver);

        secondObserver.report(120);
        expect(getWidth()).toBe('120');
    });

    it('stays at 0 without a ResizeObserver', () => {
        vi.stubGlobal('ResizeObserver', undefined);

        expect(() => render(<WidthProbe target='first' />)).not.toThrow();
        expect(getWidth()).toBe('0');
        expect(CapturingResizeObserver.instances).toHaveLength(0);
    });
});
