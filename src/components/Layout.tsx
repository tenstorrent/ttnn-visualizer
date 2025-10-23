// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Link, useLocation } from 'react-router-dom';
import { Classes, PopoverPosition } from '@blueprintjs/core';
import { Helmet } from 'react-helmet-async';
import { useAtom, useSetAtom } from 'jotai';
import { ToastContainer, cssTransition } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.min.css';
import 'styles/components/ToastOverrides.scss';
import { useEffect } from 'react';
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
    const [profilerReportLocation, setProfilerReportLocation] = useAtom(profilerReportLocationAtom);
    const setPerformanceReportLocation = useSetAtom(performanceReportLocationAtom);

    const remote = useRemoteConnection();
    const { data: instance } = useInstance();
    const { data: reports } = useReportFolderList();
    const location = useLocation();

    const appVersion = import.meta.env.APP_VERSION;
    const remoteFolders = remote.persistentState.getSavedReportFolders(remote.persistentState.selectedConnection);
    const state = location.state as { background?: Location };

    // TODO: Resolve naming issue here with profiler_name/performance_name being the path
    const profilerReportPath = instance?.active_report?.profiler_name || null;
    const profilerReportName =
        (profilerReportLocation === ReportLocation.REMOTE && profilerReportPath) || instance?.remote_profiler_folder
            ? getRemoteReportName(remoteFolders, profilerReportPath) || ''
            : getLocalReportName(reports, profilerReportPath) || '';
    const perfReportPath = instance?.active_report?.performance_name || null;

    useEffect(() => {
        if (instance?.active_report) {
            setActiveProfilerReport(
                profilerReportPath
                    ? {
                          path: profilerReportPath,
                          reportName: profilerReportName,
                      }
                    : null,
            );
            setActivePerformanceReport(
                perfReportPath
                    ? {
                          path: perfReportPath,
                          reportName: perfReportPath,
                      }
                    : null,
            );
            setActiveNpe(instance.active_report?.npe_name ?? null);
            setProfilerReportLocation(
                instance?.profiler_path?.includes('/remote') ? ReportLocation.REMOTE : ReportLocation.LOCAL,
            );
            setPerformanceReportLocation(
                instance?.performance_path?.includes('/remote') ? ReportLocation.REMOTE : ReportLocation.LOCAL,
            );
        }
    }, [
        instance,
        profilerReportPath,
        profilerReportName,
        perfReportPath,
        setActiveProfilerReport,
        setActivePerformanceReport,
        setActiveNpe,
        profilerReportLocation,
        setProfilerReportLocation,
        setPerformanceReportLocation,
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
                position={PopoverPosition.TOP_RIGHT}
                autoClose={false}
                newestOnTop={false}
                closeOnClick
                closeButton={false}
                theme='light'
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
