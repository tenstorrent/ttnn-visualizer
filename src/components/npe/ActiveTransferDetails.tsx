// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from 'react';
import { Button, Icon, Intent, Switch, Tag } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { LinkUtilization, NPE_LINK, NoCID, NoCTransfer, NoCType } from '../../model/NPEModel';
import { calculateLinkCongestionColor, getRouteColor } from './drawingApi';
import { formatPercentage, formatUnit } from '../../functions/math';
import 'styles/components/ActiveTransferDetails.scss';

const ActiveTransferDetails = ({
    groupedTransfersByNoCID,
    selectedNode,
    showActiveTransfers,
    highlightedTransfer,
    setHighlightedTransfer,
    congestionData,
    highlightedRoute,
    setHighlightedRoute,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    nocType, // this may or may not be used in the future
}: {
    groupedTransfersByNoCID: Record<NoCID, NoCTransfer[]>;
    selectedNode: { index: number; coords: number[] } | null;
    showActiveTransfers: (route: LinkUtilization | null, index?: number) => void;
    highlightedTransfer: NoCTransfer | null;
    setHighlightedTransfer: (transfer: NoCTransfer | null) => void;
    congestionData: LinkUtilization[];
    highlightedRoute: number | null;
    setHighlightedRoute: (route: number | null) => void;
    nocType: NoCType | null;
}) => {
    const hasData = Object.keys(groupedTransfersByNoCID).length !== 0;
    const [showRoutes, setShowRoutes] = useState(false);
    return (
        <aside
            className={classNames('side-data', {
                'has-data': hasData,
            })}
        >
            {hasData && (
                <>
                    <h3 className='active-transfer-details-title'>
                        <span>Active transfers through {selectedNode?.coords.join('-')}</span>
                        <Button
                            aria-label='Close active transfers'
                            variant='minimal'
                            icon={IconNames.CROSS}
                            onClick={() => showActiveTransfers(null)}
                        />
                    </h3>
                    <h4 className='active-transfer-details-title'>
                        <Switch
                            labelElement={
                                <>
                                    <Icon icon={IconNames.FLOW_LINEAR} /> Show individual routes
                                </>
                            }
                            checked={showRoutes}
                            onChange={() => setShowRoutes(!showRoutes)}
                        />
                    </h4>
                    <div className='wrapper'>
                        {Object.entries(groupedTransfersByNoCID).map(([nocId, localTransferList]) => {
                            const nocData = congestionData.find((el) => el[NPE_LINK.NOC_ID] === nocId);
                            const congestion = nocData ? nocData[NPE_LINK.DEMAND] : 0;

                            return (
                                <div
                                    className='local-transfer-ctn'
                                    key={nocId}
                                >
                                    <h4 className='noc-id'>
                                        {nocId}
                                        <span
                                            className='color-square'
                                            style={{ backgroundColor: calculateLinkCongestionColor(congestion) }}
                                        />
                                        {formatPercentage(congestion)}
                                    </h4>

                                    {localTransferList.map((transfer) => (
                                        <div
                                            className='transfer-info'
                                            key={`${nocId}${transfer.id}`}
                                        >
                                            <div
                                                className='local-transfer'
                                                style={{
                                                    opacity:
                                                        highlightedTransfer === null || highlightedTransfer === transfer
                                                            ? 1
                                                            : 0.25,
                                                }}
                                                // TODO: Figure out the appropriate accessibility handling for mouse events
                                                // eslint-disable-next-line jsx-a11y/mouse-events-have-key-events
                                                onMouseOver={() => setHighlightedTransfer(transfer)}
                                                // eslint-disable-next-line jsx-a11y/mouse-events-have-key-events
                                                onMouseOut={() => setHighlightedTransfer(null)}
                                            >
                                                <div
                                                    className='color-square'
                                                    style={{
                                                        backgroundColor: getRouteColor(transfer.id),
                                                    }}
                                                />
                                                {transfer.id}
                                                <div className='transfer-src-dst'>
                                                    <span className='transfer-src'>{transfer.src.join('-')}</span>{' '}
                                                    <Icon
                                                        size={12}
                                                        icon={IconNames.ArrowRight}
                                                    />{' '}
                                                    <span className='transfer-dst'>
                                                        {transfer.dst.length === 1
                                                            ? transfer.dst[0].join('-')
                                                            : `${transfer.dst[0].join('-')} - ${transfer.dst[transfer.dst.length - 1].join('-')}`}
                                                    </span>
                                                </div>
                                                <div>{formatUnit(transfer.total_bytes, 'byte')}</div>
                                                <div>{transfer.noc_event_type}</div>
                                                {transfer.route[0].injection_rate.toFixed(2)} b/cycle
                                                {transfer.fabric_event_type && (
                                                    <Tag
                                                        icon={IconNames.FLOW_LINEAR}
                                                        intent={Intent.PRIMARY}
                                                        minimal
                                                    >
                                                        Fabric
                                                    </Tag>
                                                )}
                                                {showRoutes && (
                                                    <ul className='routes'>
                                                        {transfer.route.map((route, index) => (
                                                            <li
                                                                key={`${transfer.id}-${route.src}-${route.dst.join('-')}`}
                                                                // eslint-disable-next-line jsx-a11y/mouse-events-have-key-events
                                                                onMouseOver={() => setHighlightedRoute(index)}
                                                                // eslint-disable-next-line jsx-a11y/mouse-events-have-key-events
                                                                onMouseOut={() => setHighlightedRoute(null)}
                                                                style={{
                                                                    opacity:
                                                                        highlightedRoute === null ||
                                                                        highlightedRoute === index
                                                                            ? 1
                                                                            : 0.5,
                                                                }}
                                                            >
                                                                <Icon icon={IconNames.FLOW_LINEAR} />
                                                                {route.src.join('-')}
                                                                <Icon
                                                                    size={11}
                                                                    icon={IconNames.ArrowRight}
                                                                />{' '}
                                                                {route.dst.map((el) => el.join('-')).join('-')}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </aside>
    );
};
export default ActiveTransferDetails;
