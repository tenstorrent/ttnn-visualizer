// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from 'react';

const ID_SEPARATOR = '|';

export function useActiveSection<TId extends string>(ids: TId[], offsetPx = 250): TId | null {
    const [trackedId, setTrackedId] = useState<TId | null>(ids[0] ?? null);

    // The set of sections can change after mount (e.g. matmul/conv charts appear as data loads, or
    // comparison reports are toggled). Clamp during render so a stale id never leaks out: keep the
    // tracked section while it's still present, otherwise fall back to the first section.
    const activeId = trackedId !== null && ids.includes(trackedId) ? trackedId : (ids[0] ?? null);

    // Callers commonly pass a fresh array literal each render. Keying the effect on the joined
    // ids (rather than the array reference) keeps the scroll listener from re-subscribing on
    // every render, while still re-running when the actual set of sections changes.
    const idsKey = ids.join(ID_SEPARATOR);

    useEffect(() => {
        const sectionIds = idsKey ? (idsKey.split(ID_SEPARATOR) as TId[]) : [];

        function navHighlighter() {
            const { scrollY } = window;
            let current: TId | null = null;

            sectionIds.forEach((id) => {
                const element = document.getElementById(id);

                if (element && element.offsetHeight > 0) {
                    const sectionHeight = element.offsetHeight;
                    const sectionTop = element.offsetTop - offsetPx;

                    if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
                        current = id;
                    }
                }
            });

            if (current !== null) {
                setTrackedId(current);
            }
        }

        window.addEventListener('scroll', navHighlighter);
        navHighlighter();

        return () => window.removeEventListener('scroll', navHighlighter);
    }, [idsKey, offsetPx]);

    return activeId;
}
