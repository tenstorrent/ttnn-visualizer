// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useState } from 'react';
import { Alignment, Button, Navbar } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useNavigate } from 'react-router';
import { useAtomValue } from 'jotai';
import { useLocation } from 'react-router-dom';
import ROUTES from '../definitions/Routes';
import 'styles/components/MainNavigation.scss';
import { activePerformanceReportAtom, activeProfilerReportAtom } from '../store/app';
import { useGetClusterDescription } from '../hooks/useAPI';
import getServerConfig from '../functions/getServerConfig';

function MainNavigation() {
    const navigate = useNavigate();
    const location = useLocation();
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const [showBanner, setShowBanner] = useState(false);

    const handleNavigate = (path: string) => {
        navigate(path);
    };

    const handleOpenModal = (path: string) => {
        navigate(path, { state: { background: location } });
    };

    const clusterData = useGetClusterDescription();

    const hasActiveProfiler = !!activeProfilerReport;
    const hasActivePerf = !!activePerformanceReport;
    const serverMode = getServerConfig().SERVER_MODE;

    useEffect(() => {
        if (!serverMode) {
            return () => {};
        }
        const handleMouseMove = (e: MouseEvent) => {
            if (e.clientY < 80) {
                setShowBanner(true);
            } else {
                setShowBanner(false);
            }
        };

        window.addEventListener('mousemove', handleMouseMove);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
        };
    }, [serverMode]);

    return (
        <Navbar className='navbar'>
            {serverMode && (
                <div
                    className='server-mode-banner'
                    style={{
                        transform: showBanner ? 'translateY(0)' : 'translateY(-100%)',
                    }}
                >
                    For full featured application, please install from PyPi or head over to&nbsp;{' '}
                    <a
                        href='https://github.com/tenstorrent/ttnn-visualizer'
                        target='_blank'
                        rel='noreferrer'
                    >
                        GitHub
                    </a>
                </div>
            )}
            <Navbar.Group align={Alignment.END}>
                <Button
                    text='Reports'
                    onClick={() => handleNavigate(ROUTES.HOME)}
                    active={hasMatchingPath(ROUTES.HOME)}
                    icon={IconNames.DOCUMENT_OPEN}
                    variant='minimal'
                    size='large'
                    className='reports-button'
                />

                <Button
                    text='Operations'
                    onClick={() => handleNavigate(ROUTES.OPERATIONS)}
                    active={hasMatchingPath(ROUTES.OPERATIONS)}
                    icon={IconNames.CUBE}
                    disabled={!hasActiveProfiler}
                    variant='minimal'
                    size='large'
                    className='operations-button'
                />

                <Button
                    text='Tensors'
                    onClick={() => handleNavigate(ROUTES.TENSORS)}
                    active={hasMatchingPath(ROUTES.TENSORS)}
                    icon={IconNames.FLOW_LINEAR}
                    disabled={!hasActiveProfiler}
                    variant='minimal'
                    size='large'
                    className='tensors-button'
                />

                <Button
                    text='Buffers'
                    onClick={() => handleNavigate(ROUTES.BUFFERS)}
                    active={hasMatchingPath(ROUTES.BUFFERS)}
                    icon={IconNames.SMALL_SQUARE}
                    disabled={!hasActiveProfiler}
                    variant='minimal'
                    size='large'
                    className='buffers-button'
                />

                <Button
                    text='Graph'
                    onClick={() => handleNavigate(ROUTES.GRAPHTREE)}
                    active={hasMatchingPath(ROUTES.GRAPHTREE)}
                    icon={IconNames.GRAPH}
                    disabled={!hasActiveProfiler}
                    variant='minimal'
                    size='large'
                    className='graph-button'
                />

                <Button
                    text='Performance'
                    onClick={() => handleNavigate(ROUTES.PERFORMANCE)}
                    active={hasMatchingPath(ROUTES.PERFORMANCE)}
                    icon={IconNames.LIGHTNING}
                    disabled={!hasActivePerf}
                    variant='minimal'
                    size='large'
                    className='performance-button'
                />

                <Button
                    text='NPE'
                    onClick={() => handleNavigate(ROUTES.NPE)}
                    active={hasMatchingPath(ROUTES.NPE)}
                    icon={IconNames.Random}
                    variant='minimal'
                    size='large'
                    className='npe-button'
                >
                    <small>beta</small>
                </Button>
                <Button
                    text='Topology'
                    onClick={() => handleOpenModal(ROUTES.CLUSTER)}
                    active={hasMatchingPath(ROUTES.CLUSTER)}
                    disabled={clusterData.data === null}
                    icon={IconNames.LayoutGrid}
                    variant='minimal'
                    size='large'
                    className='cluster-button modal'
                />
            </Navbar.Group>
        </Navbar>
    );

    function hasMatchingPath(path: string) {
        if (location.pathname === path) {
            return true;
        }
        if (location.pathname.includes(path) && path !== ROUTES.HOME) {
            return true;
        }
        if (location.state?.background?.pathname === path) {
            return true;
        }
        if (location.state?.background?.pathname.includes(path) && path !== ROUTES.HOME) {
            return true;
        }

        return false;
    }
}

export default MainNavigation;
