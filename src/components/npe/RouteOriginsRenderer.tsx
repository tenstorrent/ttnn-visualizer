// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import classNames from 'classnames';
import { NPE_LINK, NoCFlowBase } from '../../model/NPEModel';

interface SourceDestinationRendererProps {
    transfer: NoCFlowBase;
    clusterChip: {
        id: number;
    };
    index: number;
    getOriginOpacity: (transfer: NoCFlowBase) => number;
}

export const RouteOriginsRenderer = ({
    transfer,
    clusterChip,
    index,
    getOriginOpacity,
}: SourceDestinationRendererProps) => {
    return (
        <>
            {transfer.src && clusterChip.id === transfer.src[NPE_LINK.CHIP_ID] && (
                <div
                    key={`${transfer.id}-src-${index}`}
                    className={`tensix src-dst src  ${transfer.id === null || transfer.id === undefined ? ' route-origin ' : ''}`}
                    style={{
                        gridColumn: transfer.src[NPE_LINK.X] + 1,
                        gridRow: transfer.src[NPE_LINK.Y] + 1,
                        opacity: getOriginOpacity(transfer),
                    }}
                />
            )}
            {transfer.dst.map((dst) => {
                const classname = transfer.src?.toString() === dst.toString() ? 'both' : 'dst';
                if (clusterChip.id === dst[NPE_LINK.CHIP_ID]) {
                    return (
                        <div
                            key={`${transfer.id}-dst-${index}-${dst[NPE_LINK.Y]}-${dst[NPE_LINK.X]}`}
                            className={classNames('tensix src-dst', classname, {
                                'route-origin': transfer.id === null || transfer.id === undefined,
                            })}
                            style={{
                                gridColumn: dst[NPE_LINK.X] + 1,
                                gridRow: dst[NPE_LINK.Y] + 1,
                                opacity: getOriginOpacity(transfer),
                            }}
                        />
                    );
                }
                return null;
            })}
        </>
    );
};
