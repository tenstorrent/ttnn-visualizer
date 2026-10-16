// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useAtomValue } from 'jotai';
import { isBufferFocusedAtom } from '../../src/store/app';

/** Reads "focused" while a buffer is, by the app's own rule, so a spec can tell whether a click dismissed it. */
export const BufferFocusProbe = () => (
    <output aria-label='Buffer focus'>{useAtomValue(isBufferFocusedAtom) ? 'focused' : 'dismissed'}</output>
);
