// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import 'highlight.js/styles/a11y-dark.css';
import 'styles/components/NPEComponent.scss';
import React from 'react';
import { NPEData } from '../../model/NPE';
import SVGTensixRenderer from './SVGTensixRenderer';
import { NODE_SIZE, getLinkPoints } from './drawingApi';
import { getBufferColor } from '../../functions/colorGenerator';

interface NPEViewProps {
    npeData: NPEData;
}

const NPEView: React.FC<NPEViewProps> = ({ npeData }) => {
    const tensixSize: number = NODE_SIZE;
    const width = npeData.common_info.num_cols;
    const height = npeData.common_info.num_rows;

    const transfers = npeData.noc_transfers.map((transfer) => transfer.route);
    // console.log(routes);
    // const transfers = npeData.noc_transfers;
    // const data = [
    //     // //
    //     // getLinkPoints(NoCID.NOC1_NORTH, '#ff0000'),
    //     // getLinkPoints(NoCID.NOC1_WEST, '#00ff00'),
    //     // getLinkPoints(NoCID.NOC0_SOUTH, '#0000ff'),
    //     // getLinkPoints(NoCID.NOC0_EAST, '#00ffff'),
    // ];

    // routes.find((route) => route[0] === Math.floor(index / width) && route[1] === index % width)[2]
    // <div style={{ gridColumn: x + 1, gridRow: y + 1 }} key={`${x}-${y}`} />
    return (
        <div className='npe'>
            <h1>NPE</h1>
            <p>{npeData.common_info.device_name}</p>
            <div className='chip'>
                <div
                    className='tensix-grid empty'
                    style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${width || 0}, ${tensixSize}px)`,
                        gridTemplateRows: `repeat(${height || 0}, ${tensixSize}px)`,
                    }}
                >
                    {Array.from({ length: width }).map((_, x) =>
                        Array.from({ length: height }).map((__, y) => (
                            <div
                                style={{
                                    gridColumn: x + 1,
                                    gridRow: y + 1,
                                    width: `${tensixSize}px`,
                                    height: `${tensixSize}px`,
                                    border: '1px solid black',
                                }}
                                key={`${x}-${y}`}
                            />
                        )),
                    )}
                </div>
                <div
                    className='tensix-grid'
                    style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${width || 0}, ${tensixSize}px)`,
                        gridTemplateRows: `repeat(${height || 0}, ${tensixSize}px)`,
                    }}
                >
                    {transfers.map((transfer, num) =>
                        transfer.map((route, index) => (
                            <div
                                key={`${num}-${index}`}
                                className='tensix empty-tensix'
                                style={{
                                    position: 'relative',
                                    width: `${tensixSize}px`,
                                    height: `${tensixSize}px`,
                                    gridColumn: route[1] + 1,
                                    gridRow: route[0] + 1,
                                    // backgroundColor: `hsl(${(index * 360) / (width * height)}, 100%, 50%)`,
                                }}
                            >
                                <SVGTensixRenderer
                                    width={tensixSize}
                                    height={tensixSize}
                                    data={[getLinkPoints(route[2], getBufferColor(num))]}
                                />
                                <div style={{ position: 'absolute', top: 0 }}>
                                    {route[0]}-{route[1]}
                                </div>
                            </div>
                        )),
                    )}
                </div>
                <div
                    className='tensix-grid'
                    style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${width || 0}, ${tensixSize}px)`,
                        gridTemplateRows: `repeat(${height || 0}, ${tensixSize}px)`,
                    }}
                />
            </div>
        </div>
    );
};

export default NPEView;
