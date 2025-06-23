// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Alignment, Button, Navbar, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useNavigate } from 'react-router';
import { useAtomValue } from 'jotai';
import { useLocation } from 'react-router-dom';
import ROUTES from '../definitions/Routes';
import 'styles/components/MainNavigation.scss';
import { activePerformanceReportAtom, activeProfilerReportAtom } from '../store/app';
import { useGetClusterDescription } from '../hooks/useAPI';

const MEMORY_PROFILER_DISABLED = 'Upload or select an active memory report to enable this feature';
const PERFORMANCE_PROFILER_DISABLED = 'Upload or select an active performance report to enable this feature';
const CLUSTER_DISABLED = 'Active memory report does not contain cluster data';

function MainNavigation() {
    const navigate = useNavigate();
    const location = useLocation();
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);

    const handleNavigate = (path: string) => {
        navigate(path);
    };

    const handleOpenModal = (path: string) => {
        navigate(path, { state: { background: location } });
    };

    const clusterData = useGetClusterDescription();

    const hasActiveProfiler = !!activeProfilerReport;
    const hasActivePerf = !!activePerformanceReport;
    return (
        <Navbar className='navbar'>
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

                <Tooltip
                    content={MEMORY_PROFILER_DISABLED}
                    position='bottom'
                    disabled={hasActiveProfiler}
                >
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
                </Tooltip>

                <Tooltip
                    content={MEMORY_PROFILER_DISABLED}
                    position='bottom'
                    disabled={hasActiveProfiler}
                >
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
                </Tooltip>

                <Tooltip
                    content={MEMORY_PROFILER_DISABLED}
                    position='bottom'
                    disabled={hasActiveProfiler}
                >
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
                </Tooltip>

                <Tooltip
                    content={MEMORY_PROFILER_DISABLED}
                    position='bottom'
                    disabled={hasActiveProfiler}
                >
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
                </Tooltip>

                <Tooltip
                    content={PERFORMANCE_PROFILER_DISABLED}
                    position='bottom'
                    disabled={hasActivePerf}
                >
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
                </Tooltip>

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

                <Tooltip
                    content={CLUSTER_DISABLED}
                    position='bottom'
                    disabled={clusterData.data !== null}
                >
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
                </Tooltip>
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
