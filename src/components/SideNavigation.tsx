// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Alignment, Button, ButtonVariant, Position, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom } from 'jotai';
import classNames from 'classnames';
import { Link } from 'react-router';
import 'styles/components/SideNavigation.scss';
import ROUTES from '../definitions/Routes';
import { TEST_IDS } from '../definitions/TestIds';
import { useMainNavigationItems } from '../hooks/useMainNavigationItems';
import getNavigationTooltip from '../functions/getNavigationTooltip';
import { isNavigationCollapsedAtom } from '../store/app';

const TENSTORRENT_LOGO_SRC =
    'https://docs.tenstorrent.com/tt-tm-assets/Logo/Standard%20Lockup/svg/tt_logo_color-orange-whitetext.svg';
const LOGO_WIDTH = 150;
// Ties the collapse toggle's `aria-expanded` to the region it actually expands.
const NAVIGATION_ITEMS_ID = 'side-navigation-items';

function SideNavigation() {
    const { items, handleNavigate } = useMainNavigationItems();
    const [isCollapsed, setIsCollapsed] = useAtom(isNavigationCollapsedAtom);
    const toggleLabel = isCollapsed ? 'Expand navigation' : 'Collapse navigation';

    const handleToggleCollapsed = () => {
        setIsCollapsed(!isCollapsed);
    };

    return (
        <nav
            aria-label='Main navigation'
            className={classNames('side-navigation', { collapsed: isCollapsed })}
            data-testid={TEST_IDS.SIDE_NAVIGATION}
        >
            <div className='side-navigation-header'>
                <Link
                    to={ROUTES.HOME}
                    className='logo-link'
                >
                    <img
                        width={LOGO_WIDTH}
                        alt='tenstorrent'
                        src={TENSTORRENT_LOGO_SRC}
                    />
                    <span className='visualizer-title'>TT-NN Visualizer</span>
                </Link>
            </div>

            <div
                className='side-navigation-items'
                id={NAVIGATION_ITEMS_ID}
            >
                {items.map((item) => {
                    const tooltipContent = getNavigationTooltip(item, isCollapsed);

                    return (
                        <Tooltip
                            key={item.route}
                            content={tooltipContent ?? undefined}
                            position={Position.RIGHT}
                            disabled={!tooltipContent}
                            fill
                        >
                            <Button
                                text={item.label}
                                aria-label={item.label}
                                // Blueprint emits only `aria-disabled` for `active`, so
                                // without this the current view is conveyed by colour alone.
                                // Keyed off `isCurrentPage`, not `isActive`: with a modal
                                // open both it and the page behind it are active, and only
                                // one item may be the current page.
                                aria-current={item.isCurrentPage ? 'page' : undefined}
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

            {/* Below the items rather than beside the lockup: the control belongs to the
                rail as a whole, and the header is the home link in both states. */}
            <div className='side-navigation-footer'>
                <Tooltip
                    content={toggleLabel}
                    position={Position.RIGHT}
                    // renderTarget rather than a Tooltip child: the child path clones the
                    // target with `aria-expanded: undefined` for hover popovers, which
                    // would drop the state this button exists to report.
                    renderTarget={({ isOpen: _isOpen, className, ...tooltipTargetProps }) => (
                        <Button
                            {...tooltipTargetProps}
                            aria-label={toggleLabel}
                            aria-expanded={!isCollapsed}
                            aria-controls={NAVIGATION_ITEMS_ID}
                            onClick={handleToggleCollapsed}
                            icon={isCollapsed ? IconNames.MENU_OPEN : IconNames.MENU_CLOSED}
                            variant={ButtonVariant.MINIMAL}
                            size={isCollapsed ? Size.LARGE : Size.MEDIUM}
                            alignText={Alignment.START}
                            fill={isCollapsed}
                            // Keeps Blueprint's own target class, which the spread would
                            // otherwise lose to this one.
                            className={classNames(className, 'side-navigation-toggle')}
                            data-testid={TEST_IDS.SIDE_NAVIGATION_TOGGLE}
                        />
                    )}
                />
            </div>
        </nav>
    );
}

export default SideNavigation;
