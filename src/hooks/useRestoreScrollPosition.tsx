// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect } from 'react';
import { useAtom } from 'jotai';
import { Virtualizer } from '@tanstack/react-virtual';
import { ScrollLocations, ScrollPositions } from '../definitions/ScrollPositions';
import { scrollPositionsAtom } from '../store/app';

const useRestoreScrollPosition = (virtualizer: Virtualizer<HTMLDivElement, Element>, key: ScrollLocations) => {
    const [scrollPositions, setScrollPositions] = useAtom(scrollPositionsAtom);

    const updateScrollPosition = (index: number) => {
        setScrollPositions((currentValue): ScrollPositions => {
            const updatedPosition = {
                [key]: {
                    index,
                },
            };

            if (!currentValue) {
                return updatedPosition;
            }

            return {
                ...currentValue,
                ...updatedPosition,
            };
        });
    };

    useEffect(() => {
        const offsetIndex = scrollPositions?.[key].index || 0;

        if (offsetIndex > 0) {
            virtualizer.scrollToIndex(offsetIndex, { align: 'start' }); // start seems to align best with the centre of the list
            setScrollPositions(
                (currentValue): ScrollPositions => ({
                    ...currentValue,
                    [key]: { index: 0 },
                }),
            );
        }
    }, [virtualizer, scrollPositions, setScrollPositions, key]);

    return {
        scrollPositions,
        updateScrollPosition,
    };
};

export default useRestoreScrollPosition;
