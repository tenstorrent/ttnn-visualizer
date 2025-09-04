// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import classNames from 'classnames';
import { Button, Collapse, Icon, NumberRange, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useLocation } from 'react-router';
import {
    ReportLocation,
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    operationRangeAtom,
    performanceRangeAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
    selectedOperationRangeAtom,
} from '../store/app';
import SyncStatus from './SyncStatus';
import Range from './RangeSlider';
import ROUTES from '../definitions/Routes';
import 'styles/components/FooterInfobar.scss';
import { useInstance, useReportFolderList } from '../hooks/useAPI';
import { ReportFolder } from '../definitions/Reports';
import useRemoteConnection from '../hooks/useRemote';
import { RemoteFolder } from '../definitions/RemoteConnection';
import getServerConfig from '../functions/getServerConfig';

const MAX_TITLE_LENGTH = 20;

function FooterInfobar() {
    const [sliderIsOpen, setSliderIsOpen] = useState(false);
    const selectedRange = useAtomValue(selectedOperationRangeAtom);
    const operationRange = useAtomValue(operationRangeAtom);
    const performanceRange = useAtomValue(performanceRangeAtom);
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const profilerReportLocationType = useAtomValue(profilerReportLocationAtom);
    const performanceReportLocationType = useAtomValue(performanceReportLocationAtom);
    const remote = useRemoteConnection();
    const { data: instance } = useInstance();

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

    const activeProfilerReportName =
        profilerReportLocationType === ReportLocation.REMOTE
            ? getRemoteReportName(remoteFolders, activeProfilerReport)
            : getLocalReportName(reports, activeProfilerReport);

    const serverConfig = getServerConfig();
    const isProfilerRemote = profilerReportLocationType === ReportLocation.REMOTE;
    const isPerformanceRemote = performanceReportLocationType === ReportLocation.REMOTE;
    const profilerReportPath =
        isProfilerRemote && instance?.remote_profiler_folder
            ? getCleanRemotePath(instance.remote_profiler_folder.remotePath)
            : serverConfig.REPORT_DATA_DIRECTORY;
    const performanceReportPath =
        isPerformanceRemote && instance?.remote_performance_folder
            ? getCleanRemotePath(instance.remote_performance_folder.remotePath)
            : serverConfig.REPORT_DATA_DIRECTORY;

    return (
        <footer className={classNames('app-footer', { 'is-open': sliderIsOpen })}>
            <div className='current-data'>
                <div className='active-reports'>
                    {isProfilerRemote || isPerformanceRemote ? (
                        <>
                            <Tooltip
                                content={
                                    profilerReportPath && profilerReportPath.length > MAX_TITLE_LENGTH
                                        ? `${profilerReportPath}`
                                        : ''
                                }
                                position={PopoverPosition.TOP}
                            >
                                <div className='title'>
                                    <Icon icon={isProfilerRemote ? IconNames.CLOUD : IconNames.FOLDER_OPEN} />
                                    <div className='report-name'>{profilerReportPath}</div>
                                </div>
                            </Tooltip>

                            <Tooltip
                                content={`${performanceReportPath}`}
                                position={PopoverPosition.TOP}
                            >
                                <div className='title'>
                                    <Icon icon={isPerformanceRemote ? IconNames.CLOUD : IconNames.FOLDER_OPEN} />
                                    <div className='report-name'>{performanceReportPath}</div>
                                </div>
                            </Tooltip>
                        </>
                    ) : (
                        <Tooltip
                            content={
                                profilerReportPath && profilerReportPath.length > MAX_TITLE_LENGTH
                                    ? `${profilerReportPath}`
                                    : ''
                            }
                            position={PopoverPosition.TOP}
                        >
                            <div className='title'>
                                <Icon icon={IconNames.FOLDER_OPEN} />
                                <div className='report-name'>{serverConfig.REPORT_DATA_DIRECTORY}</div>
                            </div>
                        </Tooltip>
                    )}

                    {activeProfilerReportName && (
                        <Tooltip
                            content={`/${activeProfilerReport}`}
                            position={PopoverPosition.TOP}
                        >
                            <div className='title'>
                                <strong>Report:</strong>
                                <span className='report-name'>{activeProfilerReportName}</span>
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
                                    <span className='report-name'>{activePerformanceReport}</span>
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

const getCleanRemotePath = (remotePath: string): string => remotePath.split('/').slice(0, -1).join('/');

export default FooterInfobar;
