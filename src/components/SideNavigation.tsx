// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Alignment, Button, ButtonVariant, Icon, Position, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom } from 'jotai';
import classNames from 'classnames';
import { Link } from 'react-router';
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
// Leaves room for the collapse control beside it on the expanded rail's single header row.
const LOGO_WIDTH = 150;
// Fits the collapsed rail's width less its padding without crowding the edges.
const MARK_WIDTH = 32;
// Sits inside the mark's footprint, so swapping the two can't resize the control.
const EXPAND_ICON_SIZE = 20;

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
                {isCollapsed ? (
                    // renderTarget for the same reason as the collapse control: the Tooltip
                    // child path would clone this button with `aria-expanded: undefined`.
                    <Tooltip
                        content='Expand navigation'
                        position={Position.RIGHT}
                        renderTarget={({ isOpen: _isOpen, className, ...tooltipTargetProps }) => (
                            <button
                                {...tooltipTargetProps}
                                type='button'
                                aria-label='Expand navigation'
                                aria-expanded={false}
                                onClick={handleToggleCollapsed}
                                className={classNames(className, 'side-navigation-expand')}
                                data-testid={TEST_IDS.SIDE_NAVIGATION_TOGGLE}
                            >
                                <img
                                    width={MARK_WIDTH}
                                    alt=''
                                    src={TENSTORRENT_MARK_SRC}
                                />

                                {/* Takes the mark's place on hover: nothing else on the
                                    collapsed rail says the mark expands it, and the button's
                                    label only reaches a screen reader. Decorative, hence
                                    unlabelled. */}
                                <Icon
                                    icon={IconNames.MENU_OPEN}
                                    size={EXPAND_ICON_SIZE}
                                    aria-hidden
                                />
                            </button>
                        )}
                    />
                ) : (
                    <>
                        <Link
                            to={ROUTES.HOME}
                            className='title'
                        >
                            <img
                                width={LOGO_WIDTH}
                                alt='tenstorrent'
                                src={TENSTORRENT_LOGO_SRC}
                            />
                            <span className='visualizer-title'>TT-NN Visualizer</span>
                        </Link>

                        {/* renderTarget rather than a Tooltip child: the child path clones the
                            target with `aria-expanded: undefined` for hover popovers, which
                            would drop the state this button exists to report. */}
                        <Tooltip
                            content='Collapse navigation'
                            position={Position.RIGHT}
                            renderTarget={({ isOpen: _isOpen, className, ...tooltipTargetProps }) => (
                                <Button
                                    {...tooltipTargetProps}
                                    aria-label='Collapse navigation'
                                    aria-expanded
                                    onClick={handleToggleCollapsed}
                                    icon={IconNames.MENU_CLOSED}
                                    variant={ButtonVariant.MINIMAL}
                                    size={Size.MEDIUM}
                                    // Keeps Blueprint's own target class, which the spread
                                    // would otherwise lose to this one.
                                    className={classNames(className, 'side-navigation-toggle')}
                                    data-testid={TEST_IDS.SIDE_NAVIGATION_TOGGLE}
                                />
                            )}
                        />
                    </>
                )}
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
        </nav>
    );
}

export default SideNavigation;
