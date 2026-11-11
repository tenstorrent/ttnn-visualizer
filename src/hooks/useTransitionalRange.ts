// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { NumberRange } from '@blueprintjs/core';
import { startTransition, useCallback, useMemo, useState } from 'react';

interface TransitionalRange {
    // What the slider should show: the value being dragged, or the committed one between drags
    value: NumberRange | null;
    onChange: (value: NumberRange) => void;
    onRelease: () => void;
}

interface RangeDraft {
    value: NumberRange;
    // The track the value was dragged on; a draft from another track is discarded
    bounds: NumberRange | null;
}

/**
 * @description Lets a range slider follow the pointer while what it controls re-renders at
 * transition priority. Blueprint fires `onChange` on every pointer move, and committing each
 * move urgently re-derives every consumer before the handle can move again.
 *
 * Each move is still committed, inside `startTransition`, so views follow the drag — at most a
 * frame or two behind under load. This is not commit-on-release: `onRelease` only drops the local
 * copy of the value, and does so inside a transition too, so it lands with the last commit rather
 * than briefly showing the previous committed value.
 *
 * A local copy made against other `bounds` is ignored, so it cannot outlive its track when the
 * report or signpost window changes mid-drag. `commit` must be stable, and `bounds` should keep
 * its identity until the track really changes.
 */
const useTransitionalRange = (
    committed: NumberRange | null,
    commit: (value: NumberRange) => void,
    bounds: NumberRange | null,
): TransitionalRange => {
    const [draft, setDraft] = useState<RangeDraft | null>(null);

    const onChange = useCallback(
        (value: NumberRange) => {
            setDraft({ value, bounds });
            startTransition(() => commit(value));
        },
        [commit, bounds],
    );

    const onRelease = useCallback(() => {
        startTransition(() => setDraft(null));
    }, []);

    const value = draft && draft.bounds === bounds ? draft.value : committed;

    return useMemo(() => ({ value, onChange, onRelease }), [value, onChange, onRelease]);
};

export default useTransitionalRange;
