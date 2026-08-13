// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Alignment, Button, ButtonVariant, Position, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom } from 'jotai';
import classNames from 'classnames';
import { Link } from 'react-router-dom';
import 'styles/components/SideNavigation.scss';
import ROUTES from '../definitions/Routes';
import { TEST_IDS } from '../definitions/TestIds';
import { ResolvedNavigationItem, useMainNavigationItems } from '../hooks/useMainNavigationItems';
import { isNavigationCollapsedAtom } from '../store/app';

const TENSTORRENT_LOGO_SRC =
    'https://docs.tenstorrent.com/tt-tm-assets/Logo/Standard%20Lockup/svg/tt_logo_color-orange-whitetext.svg';
// Files under `public/` are copied verbatim rather than resolved as imports, so the URL has
// to carry Vite's base itself: a literal `/logo-small.png` 404s in the build, which serves
// from `/static/`.
const TENSTORRENT_MARK_SRC = `${import.meta.env.BASE_URL}logo-small.png`;
const LOGO_WIDTH = 180;
// Fits the collapsed rail's width less its padding without crowding the edges.
const MARK_WIDTH = 32;

// Collapsed, the label is the only thing identifying an icon, so it has to reach the
// tooltip; expanded, the label is already on screen and only a blocked item has
// something left to say.
function getTooltipContent(item: ResolvedNavigationItem, isCollapsed: boolean): string {
    if (item.disabledReason) {
        return item.disabledReason;
    }

    return isCollapsed ? item.label : '';
}

function SideNavigation() {
    const { items, handleNavigate } = useMainNavigationItems();
    const [isCollapsed, setIsCollapsed] = useAtom(isNavigationCollapsedAtom);

    const handleToggleCollapsed = () => {
        setIsCollapsed(!isCollapsed);
    };

    return (
        <nav
            className={classNames('side-navigation', { collapsed: isCollapsed })}
            data-testid={TEST_IDS.SIDE_NAVIGATION}
        >
            <div className='side-navigation-header'>
                <Link
                    to={ROUTES.HOME}
                    className='title'
                >
                    {isCollapsed ? (
                        <img
                            width={MARK_WIDTH}
                            alt='tenstorrent'
                            src={TENSTORRENT_MARK_SRC}
                        />
                    ) : (
                        <>
                            <img
                                width={LOGO_WIDTH}
                                alt='tenstorrent'
                                src={TENSTORRENT_LOGO_SRC}
                            />
                            <span className='visualizer-title'>TT-NN Visualizer</span>
                        </>
                    )}
                </Link>
            </div>

            <div className='side-navigation-items'>
                {items.map((item) => {
                    const tooltipContent = getTooltipContent(item, isCollapsed);

                    return (
                        <Tooltip
                            key={item.route}
                            content={tooltipContent}
                            position={Position.RIGHT}
                            disabled={!tooltipContent}
                            fill
                        >
                            <Button
                                text={item.label}
                                aria-label={item.label}
                                onClick={() => handleNavigate(item)}
                                active={item.isActive}
                                icon={item.icon}
                                disabled={item.isDisabled}
                                variant={ButtonVariant.MINIMAL}
                                size={Size.LARGE}
                                alignText={Alignment.START}
                                fill
                                className={item.className}
                            >
                                {item.badge ? <small>{item.badge}</small> : null}
                            </Button>
                        </Tooltip>
                    );
                })}
            </div>

            <div className='side-navigation-footer'>
                <Tooltip
                    content={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
                    position={Position.RIGHT}
                    disabled={!isCollapsed}
                    fill
                >
                    <Button
                        aria-label={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
                        aria-expanded={!isCollapsed}
                        onClick={handleToggleCollapsed}
                        icon={isCollapsed ? IconNames.MENU_OPEN : IconNames.MENU_CLOSED}
                        text={isCollapsed ? 'Expand' : 'Collapse'}
                        variant={ButtonVariant.MINIMAL}
                        size={Size.LARGE}
                        className='side-navigation-toggle'
                        data-testid={TEST_IDS.SIDE_NAVIGATION_TOGGLE}
                    />
                </Tooltip>
            </div>
        </nav>
    );
}

export default SideNavigation;
