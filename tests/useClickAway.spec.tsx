// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useClickAway from '../src/hooks/useClickAway';

const mount = (html: string): HTMLElement => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.append(host);
    return host;
};

afterEach(() => {
    cleanup();
    document.body.replaceChildren();
});

describe('useClickAway', () => {
    it('calls back for a click on nothing that handles it, and only while enabled', () => {
        const host = mount('<h3 id="heading">L1</h3><button id="control">L1 Memory</button>');
        const onClickAway = vi.fn();
        const { rerender } = renderHook(({ isEnabled }) => useClickAway(isEnabled, onClickAway), {
            initialProps: { isEnabled: true },
        });

        fireEvent.click(host.querySelector('#control')!);
        expect(onClickAway).not.toHaveBeenCalled();
        fireEvent.click(host.querySelector('#heading')!);
        expect(onClickAway).toHaveBeenCalledTimes(1);

        rerender({ isEnabled: false });
        fireEvent.click(host.querySelector('#heading')!);
        expect(onClickAway).toHaveBeenCalledTimes(1);
    });

    it('stops listening once unmounted', () => {
        const host = mount('<h3 id="heading">L1</h3>');
        const onClickAway = vi.fn();
        const { unmount } = renderHook(() => useClickAway(true, onClickAway));

        unmount();
        fireEvent.click(host.querySelector('#heading')!);

        expect(onClickAway).not.toHaveBeenCalled();
    });

    it('judges a click before the handler it lands on can re-render it', () => {
        // A plot replaces its own nodes on click. Judged afterwards, the detached node is
        // inside no plot, and picking a buffer would dismiss the focus it just set.
        const host = mount('<div class="js-plotly-plot"><div id="trace"><span id="bar">bar</span></div></div>');
        const trace = host.querySelector('#trace')!;
        trace.addEventListener('click', () => trace.remove());
        const onClickAway = vi.fn();
        renderHook(() => useClickAway(true, onClickAway));

        fireEvent.click(host.querySelector('#bar')!);

        expect(onClickAway).not.toHaveBeenCalled();
    });
});
