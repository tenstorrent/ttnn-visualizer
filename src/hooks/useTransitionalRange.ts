// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { NumberRange } from '@blueprintjs/core';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

// The longest a drag waits on a transition that keeps being interrupted before a step is
// committed urgently. Short enough that views visibly follow, long enough that a cheap view
// never hits it.
export const MAX_TRANSITION_LAG_MS = 120;

/**
 * @description Lets a range slider follow the pointer while what it controls re-renders at
 * transition priority. Blueprint fires `onChange` on every pointer move, and committing each
 * move urgently re-derives every consumer before the handle can move again.
 *
 * Each move is still committed, inside `startTransition`; this is not commit-on-release. A cheap
 * view keeps up with the drag. A view slower to render than the gap between pointer moves would
 * never finish: the handle's own urgent update interrupts the transition render, which restarts on
 * every move. So once a transition has gone unrendered for `MAX_TRANSITION_LAG_MS` while moves keep
 * arriving, the next move is committed urgently. Slow views then follow at that cadence rather than
 * only when the pointer pauses, at the cost of the handle waiting for that one render.
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
    // When the oldest commit not yet rendered was made, or null when none is pending
    const pendingSinceRef = useRef<number | null>(null);
    // Counts commits that have rendered. It is set in the same update as each commit, so it renders
    // in the same pass as the views. A new `committed` would not do: Jotai hands a component the
    // store's latest value on any re-render, so the slider's own urgent draft update already sees
    // the new range while the views' transition is still pending.
    const [renderedCommits, setRenderedCommits] = useState(0);

    useEffect(() => {
        pendingSinceRef.current = null;
    }, [renderedCommits]);

    const onChange = useCallback(
        (value: NumberRange) => {
            setDraft({ value, bounds });

            const now = performance.now();
            const pendingSince = pendingSinceRef.current;

            if (pendingSince !== null && now - pendingSince >= MAX_TRANSITION_LAG_MS) {
                commit(value);
                setRenderedCommits((count) => count + 1);
                return;
            }

            pendingSinceRef.current = pendingSince ?? now;
            startTransition(() => {
                commit(value);
                setRenderedCommits((count) => count + 1);
            });
        },
        [commit, bounds],
    );

    const onRelease = useCallback(() => {
        startTransition(() => setDraft(null));
    }, []);

    const cancel = useCallback(() => {
        pendingSinceRef.current = null;
        setDraft(null);
    }, []);

    const value = draft && draft.bounds === bounds ? draft.value : committed;

    return useMemo(() => ({ value, onChange, onRelease, cancel }), [value, onChange, onRelease, cancel]);
};

export default useTransitionalRange;
