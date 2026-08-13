// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Fragment } from 'react';
import { Alignment, Button, ButtonVariant, Icon, Navbar, Position, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import ROUTES from '../definitions/Routes';
import 'styles/components/MainNavigation.scss';
import { useMainNavigationItems } from '../hooks/useMainNavigationItems';

function MainNavigation() {
    const { items, handleNavigate } = useMainNavigationItems();

    return (
        <Navbar className='navbar'>
            <Navbar.Group align={Alignment.END}>
                {items.map((item) => (
                    <Fragment key={item.route}>
                        {/* Sets the report picker apart from the views it unlocks. */}
                        {item.route === ROUTES.OPERATIONS && (
                            <Icon
                                icon={IconNames.DragHandleVertical}
                                className='separator'
                            />
                        )}
                        <Tooltip
                            content={item.disabledReason ?? ''}
                            position={Position.BOTTOM}
                            disabled={!item.disabledReason}
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
                                className={item.className}
                            >
                                {item.badge ? <small>{item.badge}</small> : null}
                            </Button>
                        </Tooltip>
                    </Fragment>
                ))}
            </Navbar.Group>
        </Navbar>
    );
}

export default MainNavigation;
