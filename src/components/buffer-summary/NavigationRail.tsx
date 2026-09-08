// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { CSSProperties, memo } from 'react';
import classNames from 'classnames';
import { Tooltip } from '@blueprintjs/core';
import { NavigationRailItem } from '../../definitions/NavigationRail';

interface NavigationRailProps {
    ariaLabel: string;
    testId: string;
    /** Rows the rail spans; dots are placed by `rowIndex / rowCount`. */
    rowCount: number;
    items: readonly NavigationRailItem[];
    onDotClick: (rowIndex: number) => void;
}

/**
 * A minimap strip of clickable dots down the side of the buffer summary list,
 * one per finding, placed by the row it points at.
 *
 * Memoised because it renders inside the virtualized list, which re-renders on
 * every scroll tick: without the boundary each dot's tooltip (a popover) is
 * reconciled many times a second while the user scrolls. That makes prop
 * stability a contract — callers pass memoised `items` and a `useCallback`
 * handler, never inline literals.
 */
function NavigationRail({ ariaLabel, testId, rowCount, items, onDotClick }: NavigationRailProps) {
    return (
        <ul
            className='navigation-rail'
            aria-label={ariaLabel}
            data-testid={testId}
        >
            {items.map((item) => {
                // The `<li>` carries the positioning so Blueprint's tooltip
                // target span has non-zero geometry to anchor against —
                // positioning the dot instead collapsed the wrapper span to
                // 0×0 at the rail's origin and parked every popover there.
                const itemStyle: CSSProperties = {
                    top: `${(item.rowIndex / rowCount) * 100}%`,
                };

                return (
                    <li
                        key={item.key}
                        className='rail-item'
                        style={itemStyle}
                    >
                        <Tooltip
                            content={item.tooltip}
                            placement='left'
                        >
                            <button
                                type='button'
                                className={classNames('rail-dot', item.dotClassName)}
                                style={item.dotStyle}
                                onClick={() => onDotClick(item.rowIndex)}
                                aria-label={`Jump to ${item.tooltip}`}
                                data-testid={item.dotTestId}
                            >
                                {item.content}
                            </button>
                        </Tooltip>
                    </li>
                );
            })}
        </ul>
    );
}

export default memo(NavigationRail);
