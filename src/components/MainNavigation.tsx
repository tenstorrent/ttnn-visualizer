// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Alignment, Button, Navbar } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useNavigate } from 'react-router';
import { useAtomValue } from 'jotai';
import ROUTES from '../definitions/Routes';
import 'styles/components/MainNavigation.scss';
import { activePerformanceTraceAtom, activeReportAtom } from '../store/app';

function MainNavigation() {
    const navigate = useNavigate();
    const activeReport = useAtomValue(activeReportAtom);
    const activePerformanceTrace = useAtomValue(activePerformanceTraceAtom);

    const handleNavigate = (path: string) => {
        navigate(path);
    };

    const hasActiveReport = !!activeReport;
    const hasActiveProfile = !!activePerformanceTrace;

    return (
        <Navbar className='navbar'>
            <Navbar.Group align={Alignment.RIGHT}>
                <Button
                    text='Home'
                    onClick={() => handleNavigate(ROUTES.HOME)}
                    active={hasMatchingPath(ROUTES.HOME)}
                    icon={IconNames.HOME}
                    variant='minimal'
                    size='large'
                    className='home-button'
                />

                <Button
                    text='Operations'
                    onClick={() => handleNavigate(ROUTES.OPERATIONS)}
                    active={hasMatchingPath(ROUTES.OPERATIONS)}
                    icon={IconNames.CUBE}
                    disabled={!hasActiveReport}
                    variant='minimal'
                    size='large'
                    className='operations-button'
                />

                <Button
                    text='Tensors'
                    onClick={() => handleNavigate(ROUTES.TENSORS)}
                    active={hasMatchingPath(ROUTES.TENSORS)}
                    icon={IconNames.FLOW_LINEAR}
                    disabled={!hasActiveReport}
                    variant='minimal'
                    size='large'
                    className='tensors-button'
                />

                <Button
                    text='Buffers'
                    onClick={() => handleNavigate(ROUTES.BUFFERS)}
                    active={window.location.pathname === ROUTES.BUFFERS}
                    icon={IconNames.SMALL_SQUARE}
                    disabled={!hasActiveReport}
                    variant='minimal'
                    size='large'
                    className='buffers-button'
                />

                <Button
                    text='Graph'
                    onClick={() => handleNavigate(ROUTES.GRAPHTREE)}
                    active={window.location.pathname === ROUTES.GRAPHTREE}
                    icon={IconNames.GRAPH}
                    disabled={!hasActiveReport}
                    variant='minimal'
                    size='large'
                    className='graph-button'
                />

                <Button
                    text='Performance'
                    onClick={() => handleNavigate(ROUTES.PERFORMANCE)}
                    active={window.location.pathname === ROUTES.PERFORMANCE}
                    icon={IconNames.LIGHTNING}
                    disabled={!hasActiveProfile}
                    variant='minimal'
                    size='large'
                    className='performance-button'
                />
                <Button
                    text='NPE'
                    onClick={() => handleNavigate(ROUTES.NPE)}
                    active={window.location.pathname === ROUTES.NPE}
                    icon={IconNames.Random}
                    variant='minimal'
                    size='large'
                    className='npe-button'
                >
                    <small>beta</small>
                </Button>
            </Navbar.Group>
        </Navbar>
    );
}

function hasMatchingPath(path: string) {
    return window.location.pathname === path;
}

export default MainNavigation;
