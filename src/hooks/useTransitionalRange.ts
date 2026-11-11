// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { NumberRange } from '@blueprintjs/core';
import { startTransition, useCallback, useMemo, useState } from 'react';

interface TransitionalRange {
    // What the slider should show: the value being dragged, or the committed one between drags
    value: NumberRange | null;
    onChange: (value: NumberRange) => void;
    // For the slider's `onRelease`, and for focus leaving it: a keyboard drag whose keyup lands
    // elsewhere never reaches `onRelease`
    onRelease: () => void;
    // For writers other than the slider (reset, typed values), so the slider shows what they wrote
    cancel: () => void;
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
 * Each move is still committed, inside `startTransition`; this is not commit-on-release. How
 * closely views follow depends on how long they take to render. A cheap view keeps up with the
 * drag. A view slower to render than the gap between pointer moves restarts its render on every
 * move, because the handle's own urgent update interrupts it, so it catches up when the pointer
 * pauses or is released — and React forces a pending transition through after five seconds.
 *
 * `onRelease` drops the local copy inside a transition too, so it lands with the last commit
 * rather than briefly showing the previous committed value. `cancel` drops it at once, for a
 * writer whose own update is urgent. A local copy made against other `bounds` is ignored, so it
 * cannot outlive its track when the report or signpost window changes mid-drag. `commit` must be
 * stable, and `bounds` should keep its identity until the track really changes.
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

    const cancel = useCallback(() => setDraft(null), []);

    const value = draft && draft.bounds === bounds ? draft.value : committed;

    return useMemo(() => ({ value, onChange, onRelease, cancel }), [value, onChange, onRelease, cancel]);
};

export default useTransitionalRange;
