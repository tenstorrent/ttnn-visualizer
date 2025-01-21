// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Outlet } from 'react-router-dom';
import { Classes, Icon, Tooltip } from '@blueprintjs/core';
import { Helmet } from 'react-helmet-async';
import { useAtomValue } from 'jotai';
import { ToastContainer, cssTransition } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.min.css';
import classNames from 'classnames';
import { IconNames } from '@blueprintjs/icons';
import { activePerformanceTraceAtom, activeReportAtom } from '../store/app';
import MainNavigation from './MainNavigation';
import { useGetDeviceOperationListPerf } from '../hooks/useAPI';

const BounceIn = cssTransition({
    enter: `Toastify--animate Toastify__bounce-enter`,
    exit: ` no-toast-animation Toastify__bounce-exit`,
    appendPosition: true,
    collapseDuration: 0,
    collapse: true,
});

const MAX_TITLE_LENGTH = 20;

function Layout() {
    const appVersion = import.meta.env.APP_VERSION;
    const activeReport = useAtomValue(activeReportAtom);
    const activePerformanceTrace = useAtomValue(activePerformanceTraceAtom);
    const useGetDeviceOperationListPerfResult = useGetDeviceOperationListPerf();
    const isInSync = useGetDeviceOperationListPerfResult.length > 0;
    return (
        <div className={Classes.DARK}>
            <Helmet
                defaultTitle='TT-NN Visualizer'
                titleTemplate='%s | TT-NN Visualizer'
            >
                <meta charSet='utf-8' />
            </Helmet>

            <header className='app-header'>
                <nav className='nav-container'>
                    <div className='title'>
                        <h1>TT-NN Visualizer</h1>
                        <sup className='version'>v{appVersion}</sup>
                    </div>
                    <MainNavigation />
                </nav>

                <div className='current-data'>
                    {activeReport && (
                        <Tooltip
                            content={activeReport}
                            className={classNames('title', {
                                'is-lengthy': activeReport.length > MAX_TITLE_LENGTH,
                            })}
                        >
                            <span>
                                <strong>Report:</strong> {activeReport}
                            </span>
                        </Tooltip>
                    )}

                    {activePerformanceTrace && (
                        <Tooltip
                            content={activePerformanceTrace}
                            className={classNames('title', {
                                'is-lengthy': activePerformanceTrace.length > MAX_TITLE_LENGTH,
                            })}
                        >
                            <span>
                                <strong>Performance:</strong> {activePerformanceTrace}
                            </span>
                        </Tooltip>
                    )}

                    {activeReport && activePerformanceTrace && (
                        <span>
                            {isInSync ? (
                                <strong>
                                    <Icon
                                        icon={IconNames.TickCircle}
                                        color='#32a467'
                                    />{' '}
                                    Profiler and perf reports syncronized
                                </strong>
                            ) : (
                                <strong>
                                    <Icon
                                        icon={IconNames.ISSUE}
                                        color='#fa512e'
                                    />{' '}
                                    Profiler and perf reports cant be synchronized
                                </strong>
                            )}
                        </span>
                    )}
                </div>
            </header>

            <main>
                <Outlet />

                <ToastContainer
                    position='top-right'
                    autoClose={false}
                    newestOnTop={false}
                    closeOnClick
                    closeButton={false}
                    theme='light'
                    transition={BounceIn}
                />
            </main>
        </div>
    );
}

export default Layout;
