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
import { ResolvedNavigationItem, useMainNavigationItems } from '../hooks/useMainNavigationItems';
import { isNavigationCollapsedAtom } from '../store/app';

const TENSTORRENT_LOGO_SRC =
    'https://docs.tenstorrent.com/tt-tm-assets/Logo/Standard%20Lockup/svg/tt_logo_color-orange-whitetext.svg';
// Files under `public/` are copied verbatim rather than resolved as imports, so the URL has
// to carry Vite's base itself: a literal `/logo-small.png` 404s in the build, which serves
// from `/static/`.
const TENSTORRENT_MARK_SRC = `${import.meta.env.BASE_URL}logo-small.png`;
// The expanded rail's header row is the lockup alone, so it can take the full width less
// the rail's padding.
const LOGO_WIDTH = 150;
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
    const toggleLabel = isCollapsed ? 'Expand navigation' : 'Collapse navigation';

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
                        // The collapsed rail is too narrow for the lockup, and the mark
                        // carries the same meaning: home, not a rail control.
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

            {/* Below the items rather than beside the lockup: the control belongs to the
                rail as a whole, and the foot is the one spot it can hold while the header
                swaps between lockup and mark. */}
            <div className='side-navigation-footer'>
                <Tooltip
                    content={toggleLabel}
                    position={Position.RIGHT}
                    // Expanded, the button carries its own label; collapsed, the tooltip is
                    // the only thing naming a bare icon.
                    disabled={!isCollapsed}
                    fill
                    // renderTarget rather than a Tooltip child: the child path clones the
                    // target with `aria-expanded: undefined` for hover popovers, which
                    // would drop the state this button exists to report.
                    renderTarget={({ isOpen: _isOpen, className, ...tooltipTargetProps }) => (
                        <Button
                            {...tooltipTargetProps}
                            text={toggleLabel}
                            aria-label={toggleLabel}
                            aria-expanded={!isCollapsed}
                            onClick={handleToggleCollapsed}
                            icon={isCollapsed ? IconNames.MENU_OPEN : IconNames.MENU_CLOSED}
                            variant={ButtonVariant.MINIMAL}
                            size={Size.LARGE}
                            alignText={Alignment.START}
                            fill
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
