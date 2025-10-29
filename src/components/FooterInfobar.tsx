// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import classNames from 'classnames';
import { Button, ButtonVariant, Collapse, NumberRange, PopoverPosition, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useCallback, useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useLocation } from 'react-router';
import {
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    operationRangeAtom,
    performanceRangeAtom,
    selectedOperationRangeAtom,
} from '../store/app';
import SyncStatus from './SyncStatus';
import Range from './RangeSlider';
import ROUTES from '../definitions/Routes';
import 'styles/components/FooterInfobar.scss';
import { useInstance } from '../hooks/useAPI';
import getServerConfig from '../functions/getServerConfig';
import { Instance } from '../model/APIData';

const MAX_TITLE_LENGTH = 20;

const RANGE_DISALLOWED_ROUTES: string[] = [ROUTES.NPE];

function FooterInfobar() {
    const [sliderIsOpen, setSliderIsOpen] = useState(false);
    const selectedRange = useAtomValue(selectedOperationRangeAtom);
    const operationRange = useAtomValue(operationRangeAtom);
    const performanceRange = useAtomValue(performanceRangeAtom);
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const { data: instance } = useInstance();

    const location = useLocation();

    const isAllowedRoute = useCallback(() => {
        if (RANGE_DISALLOWED_ROUTES.includes(location.pathname)) {
            return false;
        }

        // Check if the path matches /operations/${number} i.e. an operation details page
        const operationsRegex = /^\/operations\/\d+$/;
        if (operationsRegex.test(location.pathname)) {
            return false;
        }

        return true;
    }, [location]);
    const isPerformanceRoute = location.pathname === ROUTES.PERFORMANCE;

    useEffect(() => {
        if (!isAllowedRoute()) {
            setSliderIsOpen(false);
        }
    }, [isAllowedRoute]);

    const getSelectedRangeLabel = (): string | null => {
        if (isPerformanceRoute) {
            return performanceRange && `Selected Performance:  ${performanceRange[0]} - ${performanceRange[1]}`;
        }

        return selectedRange && `Selected: ${selectedRange[0]} - ${selectedRange[1]}`;
    };

    const activeProfilerReportName = activeProfilerReport?.reportName;
    const activeProfilerReportPath = activeProfilerReport?.path;
    const hasLoadedRemoteReport =
        instance?.remote_connection?.profilerPath || instance?.remote_connection?.performancePath;
    const activePerformanceReportName = activePerformanceReport?.reportName;

    const serverConfig = getServerConfig();
    const isServerMode = serverConfig.SERVER_MODE;

    return (
        <footer className={classNames('app-footer', { 'is-open': sliderIsOpen })}>
            <div className='current-data'>
                <div className='active-reports'>
                    {!isServerMode && (
                        <Tooltip
                            content={
                                <>
                                    <strong>Local report path:</strong> {serverConfig.REPORT_DATA_DIRECTORY}
                                    {hasLoadedRemoteReport && (
                                        <>
                                            <br />
                                            <strong>Remote report paths: </strong> {getRemotePaths(instance)}
                                        </>
                                    )}
                                </>
                            }
                            position={PopoverPosition.TOP}
                        >
                            <Button
                                className='path-button'
                                icon={IconNames.FOLDER_OPEN}
                                variant={ButtonVariant.MINIMAL}
                            />
                        </Tooltip>
                    )}

                    {activeProfilerReportName && (
                        <Tooltip
                            content={`/${activeProfilerReportPath}`}
                            position={PopoverPosition.TOP}
                        >
                            <div className='title'>
                                <strong>Memory:</strong>
                                <span className='report-name'>{activeProfilerReportName}</span>
                            </div>
                        </Tooltip>
                    )}

                    {activePerformanceReportName && (
                        <Tooltip
                            content={
                                activePerformanceReportName?.length > MAX_TITLE_LENGTH
                                    ? `/${activePerformanceReportName}`
                                    : ''
                            }
                            position={PopoverPosition.TOP}
                        >
                            <div className='title'>
                                <strong>Performance:</strong>
                                <span className='report-name'>{activePerformanceReportName}</span>
                            </div>
                        </Tooltip>
                    )}
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
                            disabled={!isAllowedRoute()}
                            size={Size.SMALL}
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

const getRemotePaths = (instance: Instance): string => {
    const paths = [instance?.remote_connection?.profilerPath, instance?.remote_connection?.performancePath].filter(
        (path) => path,
    );

    // Return a more easily readable stringified array
    return `[ ${paths.toString().replace(/,/g, ', ')} ]`;
};

export default FooterInfobar;
