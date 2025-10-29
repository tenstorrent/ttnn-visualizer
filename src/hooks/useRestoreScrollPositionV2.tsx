// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useAtom } from 'jotai';
import { scrollPositionsV2Atom } from '../store/app';
import { ScrollLocationsV2, ScrollPositionV2, VirtualListState } from '../definitions/ScrollPositionsV2';

const useRestoreScrollPositionV2 = (key?: ScrollLocationsV2) => {
    const [scrollPositions, setScrollPositions] = useAtom(scrollPositionsV2Atom);

    const updateListState = (state: Partial<VirtualListState>) => {
        if (key) {
            setScrollPositions((currentValue): ScrollPositionV2 => {
                if (!currentValue) {
                    return {
                        [key]: {
                            ...(state as VirtualListState),
                        },
                    };
                }

                return {
                    ...currentValue,
                    [key]: {
                        ...currentValue[key],
                        ...state,
                    },
                };
            });
        }
    };

    const getListState = (): VirtualListState | null => {
        if (!key) {
            return null;
        }

        return scrollPositions?.[key] || null;
    };

    const resetScrollPositions = () => {
        setScrollPositions(null);
    };

    return {
        getListState,
        updateListState,
        resetScrollPositions,
    };
};

export default useRestoreScrollPositionV2;
