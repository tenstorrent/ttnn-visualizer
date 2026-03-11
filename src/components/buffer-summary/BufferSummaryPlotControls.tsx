// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Switch } from '@blueprintjs/core';
import { useAtom, useAtomValue } from 'jotai';
import GlobalSwitch from '../GlobalSwitch';
import {
    renderMemoryLayoutAtom,
    selectedBufferSummaryTabAtom,
    showBufferSummaryZoomedAtom,
    showDeallocationReportAtom,
    showHexAtom,
    showMemoryRegionsAtom,
} from '../../store/app';
import { TAB_IDS } from '../../definitions/BufferSummary';

const BufferSummaryPlotControls = () => {
    const [showDeallocationReport, setShowDeallocationReport] = useAtom(showDeallocationReportAtom);
    const [renderMemoryLayout, setRenderMemoryLayout] = useAtom(renderMemoryLayoutAtom);
    const [showHex, setShowHex] = useAtom(showHexAtom);
    const [isZoomedIn, setIsZoomedIn] = useAtom(showBufferSummaryZoomedAtom);
    const [showMemoryRegions, setShowMemoryRegions] = useAtom(showMemoryRegionsAtom);
    const selectedTabId = useAtomValue(selectedBufferSummaryTabAtom);

    return (
        <div className='controls'>
            <Switch
                label='Buffer zoom'
                checked={isZoomedIn}
                onChange={() => {
                    setIsZoomedIn(!isZoomedIn);
                }}
            />

            {selectedTabId === TAB_IDS.L1 ? (
                <GlobalSwitch
                    label='Mark late tensor deallocations'
                    checked={showDeallocationReport}
                    onChange={() => {
                        setShowDeallocationReport(!showDeallocationReport);
                    }}
                />
            ) : null}

            <GlobalSwitch
                label='Use Hex'
                checked={showHex}
                onChange={() => {
                    setShowHex(!showHex);
                }}
            />

            <GlobalSwitch
                label='Tensor memory layout overlay'
                checked={renderMemoryLayout}
                onChange={() => {
                    setRenderMemoryLayout(!renderMemoryLayout);
                }}
            />

            {selectedTabId === TAB_IDS.L1 ? (
                <GlobalSwitch
                    label='Memory regions'
                    checked={showMemoryRegions}
                    onChange={() => {
                        setShowMemoryRegions(!showMemoryRegions);
                    }}
                />
            ) : null}
        </div>
    );
};

export default BufferSummaryPlotControls;
