// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { Virtualizer } from '@tanstack/react-virtual';
import { selectedBufferSummaryTabAtom } from '../store/app';
import { TensorsByOperationByAddress } from '../model/BufferSummary';
import { BuffersByOperation } from '../model/APIData';
import useBufferFocus from './useBufferFocus';
import { BufferType } from '../model/BufferType';
import { TAB_IDS } from '../definitions/BufferSummary';

interface BufferDetailsLocationState {
    tensorId: number;
    tensorAddress: number;
    bufferType: BufferType;
}

function isBufferDetailsLocationState(value: unknown): boolean {
    if (
        typeof value !== 'object' ||
        value === null ||
        !('tensorId' in value) ||
        !('bufferType' in value) ||
        !('tensorAddress' in value)
    ) {
        return false;
    }

    const isValidTensorId = typeof (value as { tensorId: unknown }).tensorId === 'number';
    const isValidBufferType = value.bufferType === BufferType.DRAM || value.bufferType === BufferType.L1; // Only care about these two types
    const isValidTensorAddress = typeof (value as { tensorAddress: unknown }).tensorAddress === 'number';

    return isValidTensorId && isValidBufferType && isValidTensorAddress;
}

function parseBufferDetailsState(state: unknown): BufferDetailsLocationState | null {
    if (!isBufferDetailsLocationState(state)) {
        return null;
    }

    const { tensorId, tensorAddress, bufferType } = state as BufferDetailsLocationState;

    return {
        tensorId,
        tensorAddress,
        bufferType,
    };
}

function findFirstOperationIndexForTensor(
    buffersByOperation: BuffersByOperation[],
    tensorListByOperation: TensorsByOperationByAddress,
    tensorId: number,
    tensorAddress?: number,
): number {
    const byTensorId = buffersByOperation.findIndex((operation) =>
        Array.from(tensorListByOperation.get(operation.id)?.values() ?? []).some((tensor) => tensor.id === tensorId),
    );

    if (byTensorId !== -1) {
        return byTensorId;
    }

    if (tensorAddress === undefined) {
        return -1;
    }

    return buffersByOperation.findIndex((operation) => operation.buffers.some((b) => b.address === tensorAddress));
}

interface UseBufferNavigationProps {
    buffersByOperation: BuffersByOperation[];
    tensorListByOperation: TensorsByOperationByAddress;
    virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>;
}

const useBufferNavigation = ({ buffersByOperation, tensorListByOperation, virtualizer }: UseBufferNavigationProps) => {
    const location = useLocation();
    const navigate = useNavigate();
    const setSelectedTabId = useSetAtom(selectedBufferSummaryTabAtom);
    const { updateBufferFocus } = useBufferFocus();
    const lastIntentNavigationKeyRef = useRef<string | null>(null);
    const scrollRafRef = useRef<number | null>(null);

    useEffect(() => {
        const parsed = parseBufferDetailsState(location.state);

        if (!parsed) {
            return undefined;
        }

        const { tensorId, tensorAddress, bufferType } = parsed;
        const intentKey = `${location.key}:${tensorId}:intent`;

        if (lastIntentNavigationKeyRef.current !== intentKey) {
            lastIntentNavigationKeyRef.current = intentKey;
            updateBufferFocus(tensorAddress, tensorId);
            setSelectedTabId(bufferType === BufferType.DRAM ? TAB_IDS.DRAM : TAB_IDS.L1);
        }

        const firstOperationWithTensor = findFirstOperationIndexForTensor(
            buffersByOperation,
            tensorListByOperation,
            tensorId,
            tensorAddress,
        );

        const canScroll = Boolean(virtualizer) && firstOperationWithTensor !== -1;
        if (!canScroll) {
            return undefined;
        }

        const scrollIndex = Math.max(0, firstOperationWithTensor - 1);

        if (scrollRafRef.current !== null) {
            cancelAnimationFrame(scrollRafRef.current);
        }

        scrollRafRef.current = requestAnimationFrame(() => {
            scrollRafRef.current = null;
            // TanStack Virtual can no-op the first scrollToIndex when the scroll element or
            // item measurements are not ready yet; calling twice after requestAnimationFrame reliably lands the offset.
            virtualizer.scrollToIndex(scrollIndex, { align: 'start' });
            virtualizer.scrollToIndex(scrollIndex, { align: 'start' });

            navigate(
                {
                    pathname: location.pathname,
                    search: location.search,
                    hash: location.hash,
                },
                { replace: true, state: {} },
            );
        });

        return () => {
            if (scrollRafRef.current !== null) {
                cancelAnimationFrame(scrollRafRef.current);
                scrollRafRef.current = null;
            }
        };
    }, [
        buffersByOperation,
        location,
        navigate,
        setSelectedTabId,
        tensorListByOperation,
        updateBufferFocus,
        virtualizer,
    ]);
};

export default useBufferNavigation;
