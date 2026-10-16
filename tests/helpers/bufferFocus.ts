// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { fireEvent, screen } from '@testing-library/react';

/** What `BufferFocusProbe` reads. */
export const bufferFocus = () => screen.getByRole('status', { name: 'Buffer focus' });

/** A click as a pointer makes one, which is what dismissing judges: pressed, then released, on `element`. */
export const pressAndRelease = (element: Element) => {
    fireEvent.pointerDown(element);
    fireEvent.click(element);
};
