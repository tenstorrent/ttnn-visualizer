// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Signpost } from '../model/Signpost';
import { SignpostSelectType } from '../definitions/Performance';

/**
 * Whether a signpost picker should withhold `signpost` given the other bound.
 *
 * The API lists one signpost per name, ordered by the row a bound on it resolves to,
 * so a range is one the API accepts exactly when its end comes after its start in
 * that list. A start is withheld at or after the chosen end, an end at or before the
 * chosen start. Bounds are matched by name, which is what the API is sent: an id
 * moves when tracing mode reorders the list, a name does not. A bound the list no
 * longer holds withholds nothing, so the user can pick a replacement.
 */
export default function isSignpostOutsideRange(
    signpost: Signpost,
    [startSignpost, endSignpost]: (Signpost | null)[],
    allSignposts: Signpost[],
    selectType: SignpostSelectType,
): boolean {
    const indexOf = (name: string) => allSignposts.findIndex((candidate) => candidate.op_code === name);
    const currentIndex = indexOf(signpost.op_code);
    const other = selectType === SignpostSelectType.START ? endSignpost : startSignpost;
    const otherIndex = other ? indexOf(other.op_code) : -1;

    if (currentIndex === -1 || otherIndex === -1) {
        return false;
    }

    return selectType === SignpostSelectType.START ? currentIndex >= otherIndex : currentIndex <= otherIndex;
}
