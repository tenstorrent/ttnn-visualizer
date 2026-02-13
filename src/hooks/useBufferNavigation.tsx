// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { Virtualizer } from '@tanstack/react-virtual';
import { selectedAddressAtom, selectedBufferSummaryTabAtom, selectedTensorAtom } from '../store/app';
import { TensorsByOperationByAddress } from '../model/BufferSummary';
import { BuffersByOperation } from '../model/APIData';
import useBufferFocus from './useBufferFocus';
import { BufferType } from '../model/BufferType';
import { TAB_IDS } from '../definitions/BufferSummary';

interface UseBufferNavigationProps {
    buffersByOperation: BuffersByOperation[];
    tensorListByOperation: TensorsByOperationByAddress;
    virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>;
}

const useBufferNavigation = ({ buffersByOperation, tensorListByOperation, virtualizer }: UseBufferNavigationProps) => {
    const location = useLocation();
    const setSelectedTensorId = useSetAtom(selectedTensorAtom);
    const setSelectedAddress = useSetAtom(selectedAddressAtom);
    const setSelectedTabId = useSetAtom(selectedBufferSummaryTabAtom);
    const { createToast } = useBufferFocus();

    useEffect(() => {
        if (location.state?.tensorId) {
            const { tensorId, tensorAddress, bufferType } = location.state;

            setSelectedTensorId(tensorId);
            setSelectedAddress(tensorAddress ?? null);
            setSelectedTabId(bufferType === BufferType.DRAM ? TAB_IDS.DRAM : TAB_IDS.L1);
            createToast(tensorAddress, tensorId);

            const firstOperationWithTensor = buffersByOperation.findIndex(
                (operation) =>
                    Array.from(tensorListByOperation.get(operation.id)?.values() ?? []).some(
                        (tensor) => tensor.id === tensorId,
                    ) ?? false,
            );

            if (virtualizer && firstOperationWithTensor !== -1) {
                virtualizer.scrollToIndex(firstOperationWithTensor - 1, { align: 'start' });
                location.state = {};
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
};

export default useBufferNavigation;
