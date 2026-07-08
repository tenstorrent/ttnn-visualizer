// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback } from 'react';
import { PlotMouseEvent } from 'plotly.js';
import { getRawOpCodeFromPlotClick } from '../functions/getRawOpCodeFromPlotClick';

export type OnOpCodeClick = (opCode: string) => void;

export function useHandlePerfChartPlotClick(onOpCodeClick?: OnOpCodeClick) {
    return useCallback(
        (event: Readonly<PlotMouseEvent>) => {
            if (!onOpCodeClick) {
                return;
            }

            const opCode = getRawOpCodeFromPlotClick(event);
            if (opCode) {
                onOpCodeClick(opCode);
            }
        },
        [onOpCodeClick],
    );
}
