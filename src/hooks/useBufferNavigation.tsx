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
import isValidNumber from '../functions/isValidNumber';

interface BufferDetailsLocationState {
    tensorId: number;
    tensorAddress?: number;
    bufferType: BufferType;
}

function parseBufferDetailsState(state: unknown): BufferDetailsLocationState | null {
    if (typeof state !== 'object' || state === null || !('tensorId' in state) || !('bufferType' in state)) {
        return null;
    }

    if (!isValidNumber(state.tensorId)) {
        return null;
    }

    if (state.bufferType !== BufferType.DRAM && state.bufferType !== BufferType.L1) {
        return null;
    }

    const rawAddress = 'tensorAddress' in state ? state.tensorAddress : undefined;
    const tensorAddress = rawAddress != null && isValidNumber(rawAddress) ? rawAddress : undefined;
    if (rawAddress != null && tensorAddress === undefined) {
        return null;
    }

    return {
        tensorId: state.tensorId,
        tensorAddress,
        bufferType: state.bufferType,
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
        location.hash,
        location.key,
        location.pathname,
        location.search,
        location.state,
        navigate,
        setSelectedTabId,
        tensorListByOperation,
        updateBufferFocus,
        virtualizer,
    ]);
};

export default useBufferNavigation;
