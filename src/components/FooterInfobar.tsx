// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import classNames from 'classnames';
import {
    Button,
    Classes,
    Collapse,
    Icon,
    Intent,
    NumberRange,
    PopoverPosition,
    Size,
    Tag,
    Tooltip,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useLocation } from 'react-router';
import {
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    operationRangeAtom,
    performanceRangeAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
    selectedOperationRangeAtom,
} from '../store/app';
import { ReportLocation } from '../definitions/Reports';
import ReportLinkStatus from './ReportLinkStatus';
import Range from './RangeSlider';
import ROUTES from '../definitions/Routes';
import 'styles/components/FooterInfobar.scss';
import { useGetLatestAppVersion, useInstance } from '../hooks/useAPI';
import getServerConfig from '../functions/getServerConfig';
import { Instance } from '../model/APIData';
import LoadingSpinner from './LoadingSpinner';
import { LoadingSpinnerSizes } from '../definitions/LoadingSpinner';
import AppVersionStatus from './AppVersionStatus';

const RANGE_DISALLOWED_ROUTES: string[] = [ROUTES.NPE];

function FooterInfobar() {
    const [sliderIsOpen, setSliderIsOpen] = useState(false);
    const selectedRange = useAtomValue(selectedOperationRangeAtom);
    const operationRange = useAtomValue(operationRangeAtom);
    const performanceRange = useAtomValue(performanceRangeAtom);
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const profilerReportLocation = useAtomValue(profilerReportLocationAtom);
    const performanceReportLocation = useAtomValue(performanceReportLocationAtom);

    const { data: instance } = useInstance();
    const location = useLocation();
    const {
        data: latestAppVersion,
        isPending: isLatestAppPending,
        isError: isLatestAppVersionError,
    } = useGetLatestAppVersion();
    const serverConfig = getServerConfig();

    const isServerMode = serverConfig.SERVER_MODE || false;
    const appVersion = import.meta.env.APP_VERSION;

    const activeProfilerReportName = activeProfilerReport?.reportName;
    const activeProfilerReportPath = activeProfilerReport?.path;
    const hasLoadedRemoteReport =
        instance?.remote_connection?.profilerPath || instance?.remote_connection?.performancePath;
    const activePerformanceReportPath = activePerformanceReport?.path;
    const isPerformanceRoute = location.pathname === ROUTES.PERFORMANCE;

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
    }, [location.pathname]);

    const getSelectedRangeLabel = (): string | null => {
        if (isPerformanceRoute) {
            return performanceRange && `Selected Performance:  ${performanceRange[0]} - ${performanceRange[1]}`;
        }

        return selectedRange && `Selected: ${selectedRange[0]} - ${selectedRange[1]}`;
    };

    const versionStatus = getAppVersionStatus(
        appVersion,
        isLatestAppPending,
        isServerMode,
        latestAppVersion,
        isLatestAppVersionError,
    );

    useEffect(() => {
        if (!isAllowedRoute()) {
            // Synchronize slider state with route availability
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSliderIsOpen(false);
        }
    }, [location.pathname, isAllowedRoute]);

    return (
        <footer className={classNames('app-footer', { 'is-open': sliderIsOpen })}>
            <div className='current-data'>
                <div className='version-container'>{versionStatus}</div>

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
                            <Icon
                                icon={IconNames.FOLDER_OPEN}
                                aria-label='Base folder paths'
                                size={16}
                            />
                        </Tooltip>
                    )}

                    {activeProfilerReportPath && (
                        <Tooltip
                            disabled={!activeProfilerReportPath}
                            content={formatPath(activeProfilerReportPath)}
                            position={PopoverPosition.TOP}
                        >
                            <div className='title'>
                                <strong>Memory:</strong>
                                <span className={classNames('report-name', Classes.TOOLTIP_INDICATOR)}>
                                    {activeProfilerReportName || formatName(activeProfilerReportPath)}
                                </span>
                                {profilerReportLocation !== null && (
                                    <ReportLocationTag location={profilerReportLocation} />
                                )}
                            </div>
                        </Tooltip>
                    )}

                    {activeProfilerReportPath && activePerformanceReportPath && <ReportLinkStatus />}

                    {activePerformanceReportPath && (
                        <Tooltip
                            disabled={!activePerformanceReportPath}
                            content={formatPath(activePerformanceReportPath)}
                            position={PopoverPosition.TOP}
                        >
                            <div className='title'>
                                <strong>Performance:</strong>
                                <span className={classNames('report-name', Classes.TOOLTIP_INDICATOR)}>
                                    {formatName(activePerformanceReportPath)}
                                </span>
                                {performanceReportLocation !== null && (
                                    <ReportLocationTag location={performanceReportLocation} />
                                )}
                            </div>
                        </Tooltip>
                    )}
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

            {(activeProfilerReportPath || activePerformanceReportPath) && (
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

const ReportLocationTag = ({ location }: { location: ReportLocation }) => {
    const isRemote = location === ReportLocation.REMOTE;
    const label = isRemote ? 'Remote' : 'Local';

    return (
        <Tag
            minimal
            className='report-source-tag'
            aria-label={`Report source: ${label}`}
            intent={Intent.PRIMARY}
        >
            {label}
        </Tag>
    );
};

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

const formatPath = (str?: string): string => {
    if (!str) {
        return '';
    }

    const endPath = str.includes('/') ? str.split('/').at(-1) : str;

    return endPath?.startsWith('/') ? endPath : `/${endPath}`;
};

// If the name is a path, return the parent folder name otherwise return the name (name is optional)
const formatName = (str: string): string => {
    const isPath = str.includes('/');

    if (isPath) {
        return str.split('/').at(-1) || str;
    }

    return str;
};

const getAppVersionStatus = (
    appVersion: string,
    isLatestAppPending: boolean,
    isServerMode: boolean,
    latestAppVersion: string | null | undefined,
    isLatestAppVersionError: boolean,
): ReactNode => {
    if (isServerMode) {
        return (
            <AppVersionStatus
                appVersion={appVersion}
                isServerMode
            />
        );
    }

    if (isLatestAppPending) {
        return <LoadingSpinner size={LoadingSpinnerSizes.SMALL} />;
    }

    if (isLatestAppVersionError && latestAppVersion == null) {
        return (
            <AppVersionStatus
                appVersion={appVersion}
                latestVersionCheckFailed
            />
        );
    }

    return (
        <AppVersionStatus
            appVersion={appVersion}
            latestAppVersion={latestAppVersion ?? undefined}
        />
    );
};

export default FooterInfobar;
