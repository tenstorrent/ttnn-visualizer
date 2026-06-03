// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from 'react';

const ID_SEPARATOR = '|';

export function useActiveSection<TId extends string>(ids: TId[], offsetPx = 250): TId | null {
    const [activeId, setActiveId] = useState<TId | null>(ids[0] ?? null);

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

                if (element?.offsetHeight && element.offsetTop) {
                    const sectionHeight = element.offsetHeight;
                    const sectionTop = element.offsetTop - offsetPx;

                    if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
                        current = id;
                    }
                }
            });

            if (current !== null) {
                setActiveId(current);
            }
        }

        window.addEventListener('scroll', navHighlighter);
        navHighlighter();

        return () => window.removeEventListener('scroll', navHighlighter);
    }, [idsKey, offsetPx]);

    return activeId;
}
