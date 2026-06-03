// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from 'react';

export function useActiveSection<TId extends string>(ids: TId[], offsetPx = 250): TId | null {
    const [activeId, setActiveId] = useState<TId | null>(ids[0] ?? null);

    useEffect(() => {
        function navHighlighter() {
            const { scrollY } = window;
            let current: TId | null = null;

            ids.forEach((id) => {
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
    }, [ids, offsetPx]);

    return activeId;
}
