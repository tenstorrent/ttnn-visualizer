// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import isSignpostOutsideRange from '../src/functions/isSignpostOutsideRange';
import { SignpostSelectType } from '../src/definitions/Performance';
import { Signpost } from '../src/model/Signpost';

// Ordered as the API lists them: by the row a bound on each resolves to.
const A = { id: 4, op_code: 'A' };
const B = { id: 9, op_code: 'B' };
const C = { id: 12, op_code: 'C' };
const LISTED = [A, B, C];

const offered = (selected: (Signpost | null)[], selectType: SignpostSelectType) =>
    LISTED.filter((signpost) => !isSignpostOutsideRange(signpost, selected, LISTED, selectType)).map(
        (signpost) => signpost.op_code,
    );

describe('isSignpostOutsideRange', () => {
    it('offers every start and end while nothing is chosen', () => {
        expect(offered([null, null], SignpostSelectType.START)).toEqual(['A', 'B', 'C']);
        expect(offered([null, null], SignpostSelectType.END)).toEqual(['A', 'B', 'C']);
    });

    it('offers as an end only what comes after the start', () => {
        expect(offered([B, null], SignpostSelectType.END)).toEqual(['C']);
    });

    it('offers as a start only what comes before the end', () => {
        expect(offered([null, B], SignpostSelectType.START)).toEqual(['A']);
    });

    // The end chosen first and listed first: every start would come after it.
    it('offers no start when the end is the first signpost', () => {
        expect(offered([null, A], SignpostSelectType.START)).toEqual([]);
    });

    it('offers no end when the start is the last signpost', () => {
        expect(offered([C, null], SignpostSelectType.END)).toEqual([]);
    });

    it('matches a chosen bound by name, as the API is sent it', () => {
        // Tracing mode can move the row a name resolves to, and with it the id.
        const movedB = { id: 2, op_code: 'B' };

        expect(offered([null, movedB], SignpostSelectType.START)).toEqual(['A']);
    });

    it('withholds nothing for a bound the list no longer holds', () => {
        const gone = { id: 40, op_code: 'GONE' };

        expect(offered([null, gone], SignpostSelectType.START)).toEqual(['A', 'B', 'C']);
        expect(offered([gone, null], SignpostSelectType.END)).toEqual(['A', 'B', 'C']);
    });
});
