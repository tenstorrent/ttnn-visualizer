// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { LinkUtilization, NPE_LINK, NoCID, NoCTransfer, NoCType } from '../../model/NPEModel';
import { calculateLinkCongestionColor, getRouteColor } from './drawingApi';
import { formatSize } from '../../functions/math';

const ActiveTransferDetails = ({
    groupedTransfersByNoCID,
    selectedNode,
    showActiveTransfers,
    highlightedTransfer,
    setHighlightedTransfer,
    congestionData,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    nocType, // this may or may not be used in the future
}: {
    groupedTransfersByNoCID: Record<NoCID, NoCTransfer[]>;
    selectedNode: { index: number; coords: number[] } | null;
    showActiveTransfers: (route: LinkUtilization | null, index?: number) => void;
    highlightedTransfer: NoCTransfer | null;
    setHighlightedTransfer: (transfer: NoCTransfer | null) => void;
    congestionData: LinkUtilization[];
    nocType: NoCType | null;
}) => {
    return (
        <div className='side-data'>
            {Object.keys(groupedTransfersByNoCID).length !== 0 && (
                <>
                    <h3>
                        Active transfers through {selectedNode?.coords.join('-')}
                        <Button
                            variant='minimal'
                            icon={IconNames.CROSS}
                            onClick={() => showActiveTransfers(null)}
                        />
                    </h3>
                    {Object.entries(groupedTransfersByNoCID).map(([nocId, localTransferList]) => {
                        const nocData = congestionData.find((el) => el[NPE_LINK.NOC_ID] === nocId);
                        const congestion = nocData ? nocData[NPE_LINK.DEMAND] : 0;

                        return (
                            <div
                                className='local-transfer-ctn'
                                key={nocId}
                            >
                                <h4>
                                    NOC ID: {nocId}
                                    <span
                                        className='color-square'
                                        style={{ backgroundColor: calculateLinkCongestionColor(congestion) }}
                                    />
                                    {congestion.toFixed(2)}
                                </h4>
                                {localTransferList.map((transfer) => (
                                    <div
                                        className='local-transfer'
                                        key={transfer.id}
                                        style={{
                                            opacity:
                                                highlightedTransfer === null || highlightedTransfer === transfer
                                                    ? 1
                                                    : 0.25,
                                        }}
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
                                        <div>
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
                                        <div>{formatSize(transfer.total_bytes)}B</div>
                                        <div>{transfer.noc_event_type}</div>

                                        <div>
                                            <div className='route'>
                                                {transfer.route[0].injection_rate.toFixed(2)} b/cycle
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </>
            )}
        </div>
    );
};
export default ActiveTransferDetails;
