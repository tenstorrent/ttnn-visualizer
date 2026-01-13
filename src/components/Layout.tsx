// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Link, useLocation } from 'react-router-dom';
import { Classes } from '@blueprintjs/core';
import { Helmet } from 'react-helmet-async';
import { useSetAtom } from 'jotai';
import { Theme, ToastContainer, ToastPosition, cssTransition } from 'react-toastify';
import 'styles/components/ToastOverrides.scss';
import { useEffect, useMemo } from 'react';
import {
    activeNpeOpTraceAtom,
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
} from '../store/app';
import MainNavigation from './MainNavigation';
import { useInstance, useReportFolderList } from '../hooks/useAPI';
import ROUTES from '../definitions/Routes';
import FooterInfobar from './FooterInfobar';
import ClusterRenderer from './cluster/ClusterRenderer';
import { ModalAwareOutlet } from '../libs/ModalAwareOutlet';
import FeedbackButton from './FeedbackButton';
import { ReportFolder, ReportLocation } from '../definitions/Reports';
import { RemoteFolder } from '../definitions/RemoteConnection';
import useRemoteConnection from '../hooks/useRemote';
import useRestoreScrollPosition from '../hooks/useRestoreScrollPosition';

const BounceIn = cssTransition({
    enter: `Toastify--animate Toastify__bounce-enter`,
    exit: ` no-toast-animation Toastify__bounce-exit`,
    appendPosition: true,
    collapseDuration: 0,
    collapse: true,
});

function Layout() {
    const setActiveProfilerReport = useSetAtom(activeProfilerReportAtom);
    const setActivePerformanceReport = useSetAtom(activePerformanceReportAtom);
    const setActiveNpe = useSetAtom(activeNpeOpTraceAtom);
    const setProfilerReportLocation = useSetAtom(profilerReportLocationAtom);
    const setPerformanceReportLocation = useSetAtom(performanceReportLocationAtom);

    const remote = useRemoteConnection();
    const { data: instance } = useInstance();
    const { data: reports } = useReportFolderList();
    const location = useLocation();
    const { resetListStates } = useRestoreScrollPosition();

    const isProfilerRemote = instance?.active_report?.profiler_location === ReportLocation.REMOTE;

    const appVersion = import.meta.env.APP_VERSION;
    const remoteFolders = remote.persistentState.getSavedReportFolders(remote.persistentState.selectedConnection);
    const state = location.state as { background?: Location };

    // TODO: Resolve naming issue here with profiler_name/performance_name being the path
    const profilerReportPath = instance?.active_report?.profiler_name || null;
    const profilerReportName =
        (isProfilerRemote && profilerReportPath) || instance?.remote_profiler_folder
            ? getRemoteReportName(remoteFolders, profilerReportPath) || ''
            : getLocalReportName(reports, profilerReportPath) || '';
    const perfReportPath = instance?.active_report?.performance_name || null;

    // Memoize active report objects to prevent unnecessary recalculations
    const activeReports = useMemo(() => {
        const activeProfilerReport = profilerReportPath
            ? {
                  path: profilerReportPath,
                  reportName: profilerReportName,
              }
            : null;
        const activeProfilerLocation = instance?.active_report?.profiler_location ?? null;
        const activePerfReport = perfReportPath
            ? {
                  path: perfReportPath,
                  reportName: perfReportPath,
              }
            : null;
        const activePerfLocation = instance?.active_report?.performance_location ?? null;

        return {
            profiler: activeProfilerReport,
            profilerLocation: activeProfilerLocation,
            performance: activePerfReport,
            performanceLocation: activePerfLocation,
            npe: instance?.active_report?.npe_name ?? null,
        };
    }, [instance, profilerReportPath, profilerReportName, perfReportPath]);

    // Loads the active reports into global state when the instance changes
    useEffect(() => {
        resetListStates();

        setActiveProfilerReport(activeReports.profiler);
        setProfilerReportLocation(activeReports.profilerLocation);

        setActivePerformanceReport(activeReports.performance);
        setPerformanceReportLocation(activeReports.performanceLocation);

        setActiveNpe(activeReports.npe);
    }, [
        activeReports,
        resetListStates,
        setActiveProfilerReport,
        setProfilerReportLocation,
        setActivePerformanceReport,
        setPerformanceReportLocation,
        setActiveNpe,
    ]);

    return (
        <div className={Classes.DARK}>
            <Helmet
                defaultTitle='TT-NN Visualizer'
                titleTemplate='%s | TT-NN Visualizer'
            >
                <meta charSet='utf-8' />
                <meta
                    name='description'
                    content='A comprehensive tool for visualizing and analyzing model execution, offering interactive graphs, memory plots, tensor details, buffer overviews, operation flow graphs, and multi-instance support with file or SSH-based report loading.'
                />
            </Helmet>

            <header className='app-header'>
                <nav className='nav-container'>
                    <Link
                        to={ROUTES.HOME}
                        className='title'
                    >
                        <h1>
                            <img
                                width={250}
                                alt='tenstorrent'
                                src='https://docs.tenstorrent.com/tt-tm-assets/Logo/Standard%20Lockup/svg/tt_logo_color-orange-whitetext.svg'
                            />
                            <span className='visualizer-title'>TT-NN Visualizer</span>
                        </h1>
                        <sup className='version'>v{appVersion}</sup>
                    </Link>

                    <MainNavigation />
                </nav>
            </header>

            <main>
                <ModalAwareOutlet />
                {location.pathname === ROUTES.CLUSTER && state?.background && <ClusterRenderer />}
            </main>

            <FooterInfobar />

            <FeedbackButton />

            <ToastContainer
                position={'bottom-right' as ToastPosition}
                autoClose={1000}
                newestOnTop={false}
                pauseOnHover={false}
                draggable={false}
                closeOnClick
                closeButton={false}
                theme={'light' as Theme}
                transition={BounceIn}
            />
        </div>
    );
}

const getLocalReportName = (reports: ReportFolder[], path: string | null): string | undefined =>
    reports?.find((report) => report.path === path)?.reportName;

const getRemoteReportName = (remoteFolders: RemoteFolder[], folderName: string | null): string | undefined =>
    folderName ? remoteFolders?.find((report) => report.remotePath.includes(folderName))?.reportName : undefined;

export default Layout;
