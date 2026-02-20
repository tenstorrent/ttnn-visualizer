// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useAtom, useSetAtom } from 'jotai';
import { useCallback } from 'react';
import {
    operationListFilterAtom,
    scrollPositionsAtom,
    selectedDeviceOperationsAtom,
    shouldSortByIDAtom,
    shouldSortDurationAtom,
} from '../store/app';
import { ScrollLocations, ScrollPosition, VirtualListState } from '../definitions/ScrollPositions';
import { SortingOptions } from '../definitions/SortingOptions';

const useRestoreScrollPosition = (key?: ScrollLocations) => {
    const [scrollPositions, setScrollPositions] = useAtom(scrollPositionsAtom);
    const setOperationListFilter = useSetAtom(operationListFilterAtom);
    const setSelectedDeviceOperations = useSetAtom(selectedDeviceOperationsAtom);
    const setShouldSortByID = useSetAtom(shouldSortByIDAtom);
    const setShouldSortDuration = useSetAtom(shouldSortDurationAtom);

    const updateListState = useCallback(
        (state: Partial<VirtualListState>) => {
            if (key) {
                setScrollPositions((currentValue): ScrollPosition => {
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
        },
        [key, setScrollPositions],
    );

    const getListState = useCallback((): VirtualListState | null => {
        if (!key) {
            return null;
        }

        return scrollPositions?.[key] || null;
    }, [key, scrollPositions]);

    const resetListStates = useCallback(() => {
        setScrollPositions(null);

        // Operation List specific resets
        setOperationListFilter('');
        setSelectedDeviceOperations(new Set());
        setShouldSortByID(SortingOptions.ASCENDING);
        setShouldSortDuration(SortingOptions.OFF);
    }, [
        setScrollPositions,
        setOperationListFilter,
        setSelectedDeviceOperations,
        setShouldSortByID,
        setShouldSortDuration,
    ]);

    return {
        getListState,
        updateListState,
        resetListStates,
    };
};

export default useRestoreScrollPosition;
