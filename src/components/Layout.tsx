// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Link, useLocation } from 'react-router-dom';
import { Classes } from '@blueprintjs/core';
import { Helmet } from 'react-helmet-async';
import { useAtomValue, useSetAtom } from 'jotai';
import { ToastContainer, cssTransition } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.min.css';
import 'styles/components/ToastOverrides.scss';
import { useEffect } from 'react';
import {
    activeNpeOpTraceAtom,
    activePerformanceReportAtom,
    activeProfilerReportAtom,
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
    const reportLocation = useAtomValue(profilerReportLocationAtom);
    const remote = useRemoteConnection();

    const appVersion = import.meta.env.APP_VERSION;
    const remoteFolders = remote.persistentState.getSavedReportFolders(remote.persistentState.selectedConnection);

    const { data: instance } = useInstance();
    const { data: reports } = useReportFolderList();
    const location = useLocation();

    const state = location.state as { background?: Location };

    useEffect(() => {
        if (instance?.active_report) {
            setActiveProfilerReport(
                instance.active_report?.profiler_name
                    ? {
                          path: instance.active_report.profiler_name,
                          reportName:
                              reportLocation === ReportLocation.REMOTE
                                  ? getRemoteReportName(remoteFolders, instance.active_report.profiler_name) || ''
                                  : getLocalReportName(reports, instance.active_report.profiler_name) || '',
                      }
                    : null,
            );
            setActivePerformanceReport(instance.active_report?.performance_name ?? null);
            setActiveNpe(instance.active_report?.npe_name ?? null);
        }
    }, [
        instance,
        setActiveProfilerReport,
        setActivePerformanceReport,
        setActiveNpe,
        reports,
        reportLocation,
        remoteFolders,
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
                    content='A comprehensive tool for visualizing and analysing model execution, offering interactive graphs, memory plots, tensor details, buffer overviews, operation flow graphs, and multi-instance support with file or SSH-based report loading.'
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
                position='top-right'
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

const getLocalReportName = (reports: ReportFolder[], path: string | null) =>
    reports?.find((report) => report.path === path)?.reportName;

const getRemoteReportName = (remoteFolders: RemoteFolder[], folderName: string | null) =>
    folderName ? remoteFolders?.find((report) => report.remotePath.includes(folderName))?.reportName : false;

export default Layout;
