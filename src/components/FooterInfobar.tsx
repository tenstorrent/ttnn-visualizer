// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import classNames from 'classnames';
import { Button, Collapse, NumberRange, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useLocation } from 'react-router';
import {
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    operationRangeAtom,
    performanceRangeAtom,
    reportLocationAtom,
    selectedOperationRangeAtom,
} from '../store/app';
import SyncStatus from './SyncStatus';
import Range from './RangeSlider';
import ROUTES from '../definitions/Routes';
import 'styles/components/FooterInfobar.scss';
import { useReportFolderList } from '../hooks/useAPI';
import { ReportFolder } from '../definitions/Reports';
import useRemoteConnection from '../hooks/useRemote';
import { RemoteFolder } from '../definitions/RemoteConnection';

const MAX_TITLE_LENGTH = 20;

function FooterInfobar() {
    const [sliderIsOpen, setSliderIsOpen] = useState(false);
    const selectedRange = useAtomValue(selectedOperationRangeAtom);
    const operationRange = useAtomValue(operationRangeAtom);
    const performanceRange = useAtomValue(performanceRangeAtom);
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const connectionType = useAtomValue(reportLocationAtom);
    const remote = useRemoteConnection();

    console.log('activeProfilerReport', activeProfilerReport);

    const { data: reports } = useReportFolderList();
    const location = useLocation();
    const remoteFolders = remote.persistentState.getSavedReportFolders(remote.persistentState.selectedConnection);

    const isOperationDetails = location.pathname.includes(`${ROUTES.OPERATIONS}/`);
    const isPerformanceRoute = location.pathname === ROUTES.PERFORMANCE;
    const isNPE = location.pathname.includes(`${ROUTES.NPE}`);

    useEffect(() => {
        if (isOperationDetails || isNPE) {
            setSliderIsOpen(false);
        }
    }, [isNPE, isOperationDetails]);

    const getSelectedRangeLabel = (): string | null => {
        if (isPerformanceRoute) {
            return performanceRange && `Selected Performance:  ${performanceRange[0]} - ${performanceRange[1]}`;
        }

        return selectedRange && `Selected: ${selectedRange[0]} - ${selectedRange[1]}`;
    };

    const activeReportName =
        connectionType === 'remote'
            ? getRemoteReportName(remoteFolders, activeProfilerReport)
            : getLocalReportName(reports, activeProfilerReport);

    return (
        <footer className={classNames('app-footer', { 'is-open': sliderIsOpen })}>
            <div className='current-data'>
                <div className='active-reports'>
                    {activeReportName && (
                        <Tooltip
                            content={`/${activeProfilerReport}`}
                            position={PopoverPosition.TOP}
                        >
                            <div className='title'>
                                <strong>Report:</strong>
                                <span
                                    className='report-name'
                                    data-testid='infobar-profiler-name'
                                >
                                    {activeReportName}
                                </span>
                            </div>
                        </Tooltip>
                    )}

                    {activePerformanceReport &&
                        (activePerformanceReport.length > MAX_TITLE_LENGTH ? (
                            <Tooltip
                                content={activePerformanceReport}
                                className='title'
                            >
                                <div className='title'>
                                    <strong>Performance:</strong>
                                    <span
                                        className='report-name'
                                        data-testid='infobar-performance-name'
                                    >
                                        {activePerformanceReport}
                                    </span>
                                </div>
                            </Tooltip>
                        ) : (
                            <div className='title'>
                                <strong>Performance:</strong>
                                <span className='report-name'>{activePerformanceReport}</span>
                            </div>
                        ))}
                    {activeProfilerReport && activePerformanceReport && <SyncStatus />}
                </div>

                {(operationRange || performanceRange) && (
                    <div className='slider-controls'>
                        {!sliderIsOpen && !hasRangeSelected(selectedRange, operationRange) && (
                            <span className='current-range'>{getSelectedRangeLabel()}</span>
                        )}

                        <Button
                            icon={sliderIsOpen ? IconNames.CARET_DOWN : IconNames.CARET_UP}
                            onClick={() => setSliderIsOpen(!sliderIsOpen)}
                            disabled={isOperationDetails}
                            size='small'
                        >
                            Range
                        </Button>
                    </div>
                )}
            </div>

            {(activeProfilerReport || activePerformanceReport) && (
                <Collapse
                    isOpen={sliderIsOpen}
                    keepChildrenMounted
                >
                    <Range />
                </Collapse>
            )}
        </footer>
    );
}

const hasRangeSelected = (selectedRange: NumberRange | null, operationRange: NumberRange | null): boolean =>
    !!(
        selectedRange &&
        operationRange &&
        selectedRange[0] === operationRange[0] &&
        selectedRange[1] === operationRange[1]
    );

const getLocalReportName = (reports: ReportFolder[], path: string | null) =>
    reports?.find((report) => report.path === path)?.reportName;

const getRemoteReportName = (remoteFolders: RemoteFolder[], folderName: string | null) =>
    folderName ? remoteFolders?.find((report) => report.remotePath.includes(folderName))?.reportName : false;

export default FooterInfobar;
