// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useAtom, useSetAtom } from 'jotai';
import { useCallback } from 'react';
import {
    listStatesAtom,
    operationListFilterAtom,
    selectedDeviceOperationsAtom,
    shouldCollapseAllOperationsAtom,
    shouldCollapseAllTensorsAtom,
    shouldSortByIDAtom,
    shouldSortBySizeAtom,
    shouldSortDurationAtom,
    showHighConsumerTensorsAtom,
    showLateDeallocatedTensorsAtom,
    tensorBufferTypeFiltersAtom,
    tensorListFilterAtom,
} from '../store/app';
import { ListStates, ScrollLocations, VirtualListState } from '../definitions/VirtualLists';
import { SortingOptions } from '../definitions/SortingOptions';

const useRestoreScrollPosition = (key?: ScrollLocations) => {
    const [listStates, setListStates] = useAtom(listStatesAtom);

    // Operation List
    const setOperationListFilter = useSetAtom(operationListFilterAtom);
    const setSelectedDeviceOperations = useSetAtom(selectedDeviceOperationsAtom);
    const setShouldSortByID = useSetAtom(shouldSortByIDAtom);
    const setShouldSortDuration = useSetAtom(shouldSortDurationAtom);
    const setShouldCollapseAllOperations = useSetAtom(shouldCollapseAllOperationsAtom);

    // Tensor List
    const setTensorBufferTypeFilters = useSetAtom(tensorBufferTypeFiltersAtom);
    const setTensorListFilter = useSetAtom(tensorListFilterAtom);
    const setShowHighConsumerTensors = useSetAtom(showHighConsumerTensorsAtom);
    const setShowLateDeallocatedTensors = useSetAtom(showLateDeallocatedTensorsAtom);
    const setShouldSortBySize = useSetAtom(shouldSortBySizeAtom);
    const setShouldCollapseAllTensors = useSetAtom(shouldCollapseAllTensorsAtom);

    const updateListState = useCallback(
        (state: Partial<VirtualListState>) => {
            if (key) {
                setListStates((currentValue): ListStates => {
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
        [key, setListStates],
    );

    const getListState = useCallback((): VirtualListState | null => {
        if (!key) {
            return null;
        }

        return listStates?.[key] || null;
    }, [key, listStates]);

    const resetOperationList = useCallback(() => {
        setOperationListFilter('');
        setSelectedDeviceOperations(new Set());
        setShouldSortByID(SortingOptions.ASCENDING);
        setShouldSortDuration(SortingOptions.OFF);
        setShouldCollapseAllOperations(false);
    }, [
        setOperationListFilter,
        setSelectedDeviceOperations,
        setShouldSortByID,
        setShouldSortDuration,
        setShouldCollapseAllOperations,
    ]);

    const resetTensorList = useCallback(() => {
        setTensorListFilter('');
        setTensorBufferTypeFilters([]);
        setShowHighConsumerTensors(false);
        setShowLateDeallocatedTensors(false);
        setShouldSortBySize(SortingOptions.OFF);
        setShouldCollapseAllTensors(false);
    }, [
        setTensorListFilter,
        setTensorBufferTypeFilters,
        setShowHighConsumerTensors,
        setShowLateDeallocatedTensors,
        setShouldSortBySize,
        setShouldCollapseAllTensors,
    ]);

    const resetListStates = useCallback(() => {
        setListStates(null);

        resetOperationList();
        resetTensorList();
    }, [setListStates, resetOperationList, resetTensorList]);

    return {
        getListState,
        updateListState,
        resetListStates,
    };
};

export default useRestoreScrollPosition;
