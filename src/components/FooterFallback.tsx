// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtomValue, useSetAtom } from 'jotai';
import {
    operationRangeAtom,
    performanceRangeAtom,
    selectedOperationRangeAtom,
    selectedPerformanceRangeAtom,
} from '../store/app';
import 'styles/components/FooterInfobar.scss';

interface FooterFallbackProps {
    retry: () => void;
}

/**
 * @description Stands in for a footer that failed to render. The footer hosts the range slider, the
 * only writer of the selected ranges, so without it the routes keep filtering by a range the user
 * can no longer see. Retrying clears that range to the full tracks first, so a footer that fails
 * again does not leave the views narrowed.
 */
function FooterFallback({ retry }: FooterFallbackProps) {
    const operationRange = useAtomValue(operationRangeAtom);
    const performanceRange = useAtomValue(performanceRangeAtom);
    const setSelectedOperationRange = useSetAtom(selectedOperationRangeAtom);
    const setSelectedPerformanceRange = useSetAtom(selectedPerformanceRangeAtom);

    const resetRangeAndRetry = () => {
        setSelectedOperationRange(operationRange);
        setSelectedPerformanceRange(performanceRange);
        retry();
    };

    return (
        <footer
            className='app-footer'
            role='alert'
        >
            <div className='current-data'>
                <span>The footer failed to load, so the range selection is hidden.</span>
                <Button
                    icon={IconNames.RESET}
                    onClick={resetRangeAndRetry}
                    size={Size.SMALL}
                >
                    Reset range and retry
                </Button>
            </div>
        </footer>
    );
}

export default FooterFallback;
