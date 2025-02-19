import { Button, Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { NoCID, NoCTransfer } from '../../model/NPEModel';
import { getRouteColor } from './drawingApi';
import { formatSize } from '../../functions/math';

const ActiveTransferDetails = ({
    groupedTransfersByNoCID,
    selectedNode,
    showActiveTransfers,
    highlightedTransfer,
    setHighlightedTransfer,
}: {
    groupedTransfersByNoCID: Record<NoCID, NoCTransfer[]>;
    selectedNode: { index: number; coords: number[] } | null;
    showActiveTransfers: (route: [number, number, NoCID, number] | null, index?: number) => void;
    highlightedTransfer: NoCTransfer | null;
    setHighlightedTransfer: (transfer: NoCTransfer | null) => void;
}) => {
    return (
        <div className='side-data'>
            {Object.keys(groupedTransfersByNoCID).length !== 0 && (
                <>
                    <h3>
                        Active transfers through {selectedNode?.coords.join('-')}
                        <Button
                            minimal
                            icon={IconNames.CROSS}
                            onClick={() => showActiveTransfers(null)}
                        />
                    </h3>
                    {Object.entries(groupedTransfersByNoCID).map(([nocId, localTransferList]) => (
                        <div
                            className='local-transfer-ctn'
                            key={nocId}
                        >
                            <h4>NOC ID: {nocId}</h4>
                            {localTransferList.map((transfer) => (
                                <div
                                    className='local-transfer'
                                    key={transfer.id}
                                    style={{
                                        opacity:
                                            highlightedTransfer === null || highlightedTransfer === transfer ? 1 : 0.25,
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
                                    <div>injection rate: {transfer.injection_rate.toFixed(2)}</div>
                                </div>
                            ))}
                        </div>
                    ))}
                </>
            )}
        </div>
    );
};
export default ActiveTransferDetails;
