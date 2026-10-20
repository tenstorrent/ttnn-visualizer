// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { fireEvent, screen } from '@testing-library/react';

/** What `BufferFocusProbe` reads. */
export const getBufferFocusProbe = () => screen.getByRole('status', { name: 'Buffer focus' });

/** A click as a pointer makes one, which is what dismissing judges: pressed, then released, on `element`. */
export const pressAndRelease = (element: Element) => {
    fireEvent.pointerDown(element);
    fireEvent.click(element);
};

export const selectRange = (range: Range) => {
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
};

/** Selects all of `node`'s text, as a drag across it would. */
export const selectContents = (node: Node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    selectRange(range);
};
