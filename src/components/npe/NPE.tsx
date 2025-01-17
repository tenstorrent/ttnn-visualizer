// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import 'highlight.js/styles/a11y-dark.css';
import 'styles/components/NPEComponent.scss';
import React, { useEffect } from 'react';
import { Button } from '@blueprintjs/core';
import { NPEData } from '../../model/NPE';
import SVGTensixRenderer from './SVGTensixRenderer';
import { NODE_SIZE, calculateLinkCongestionColor, getLinkPoints } from './drawingApi';

interface NPEViewProps {
    npeData: NPEData;
}

const NPEView: React.FC<NPEViewProps> = ({ npeData }) => {
    const tensixSize: number = NODE_SIZE; // * 0.75;
    const width = npeData.common_info.num_cols;
    const height = npeData.common_info.num_rows;
    // const [selectedTransfer, setSelectedTransfer] = React.useState<number | null>(null);
    const [selectedTimestep, setSelectedTimestep] = React.useState<number>(0);
    // const transfer = npeData.noc_transfers.find((tr) => tr.id === selectedTransfer) || null;
    const links = npeData.timestep_data[selectedTimestep];
    const transfers = npeData.noc_transfers.filter((tr) => links.active_transfers.includes(tr.id));

    // const showTransfer = (id: number) => () => {
    //     // setSelectedTransfer(id);
    // };
    const showTimestepData = (id: number) => () => {
        setSelectedTimestep(id);
    };

    useEffect(() => {
        const range = npeData.timestep_data.length;

        const interval = setInterval(() => {
            setSelectedTimestep((prev) => {
                return prev < range - 1 ? prev + 1 : 0;
            });
        }, 250);

        return () => clearInterval(interval);
    }, [npeData.timestep_data.length]);

    return (
        <div className='npe'>
            <p>{npeData.common_info.device_name}</p>
            {/* <div> */}
            {/*    {npeData.noc_transfers.map((tr) => ( */}
            {/*        <Button */}
            {/*            disabled={tr.id === selectedTransfer} */}
            {/*            onClick={showTransfer(tr.id)} */}
            {/*        > */}
            {/*            {tr.id} */}
            {/*        </Button> */}
            {/*    ))} */}
            {/* </div> */}
            <div>
                {npeData.timestep_data.map((tr, index) => (
                    <Button
                        className='timestep'
                        minimal
                        small
                        disabled={index === selectedTimestep}
                        onClick={showTimestepData(index)}
                    >
                        {index}
                    </Button>
                ))}
            </div>
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
                    {transfers.map((transfer) => (
                        <>
                            {transfer?.src && (
                                <div
                                    className='tensix'
                                    style={{
                                        position: 'relative',
                                        gridColumn: transfer.src[1] + 1,
                                        gridRow: transfer.src[0] + 1,
                                        color: '#00eaff',
                                    }}
                                >
                                    <div style={{ position: 'absolute', right: 0 }}>[s]</div>
                                </div>
                            )}
                            {transfer?.dst && (
                                <div
                                    className='tensix'
                                    style={{
                                        position: 'relative',
                                        gridColumn: transfer.dst[1] + 1,
                                        gridRow: transfer.dst[0] + 1,
                                        color: '#b700ffaa',
                                    }}
                                >
                                    <div style={{ position: 'absolute', right: 0 }}>[d]</div>
                                </div>
                            )}
                        </>
                    ))}

                    {links.link_utilization.map((route, index) => (
                        <div
                            key={`-${index}`}
                            className='tensix'
                            style={{
                                position: 'relative',
                                gridColumn: route[1] + 1,
                                gridRow: route[0] + 1,
                            }}
                        >
                            <SVGTensixRenderer
                                width={tensixSize * 2}
                                height={tensixSize * 2}
                                data={[getLinkPoints(route[2], calculateLinkCongestionColor(route[3]))]}
                            />
                            <div style={{ position: 'absolute', top: 0 }}>
                                {route[0]}-{route[1]}
                            </div>
                        </div>
                    ))}
                </div>
                {/* <div */}
                {/*    className='tensix-grid' */}
                {/*    style={{ */}
                {/*        display: 'grid', */}
                {/*        gridTemplateColumns: `repeat(${width || 0}, ${tensixSize}px)`, */}
                {/*        gridTemplateRows: `repeat(${height || 0}, ${tensixSize}px)`, */}
                {/*    }} */}
                {/* > */}
                {/*    {transfer?.src && ( */}
                {/*        <div */}
                {/*            className='tensix' */}
                {/*            style={{ */}
                {/*                position: 'relative', */}
                {/*                gridColumn: transfer.src[1] + 1, */}
                {/*                gridRow: transfer.src[0] + 1, */}
                {/*                backgroundColor: '#ff000033', */}
                {/*            }} */}
                {/*        /> */}
                {/*    )} */}
                {/*    {transfer?.dst && ( */}
                {/*        <div */}
                {/*            className='tensix' */}
                {/*            style={{ */}
                {/*                position: 'relative', */}
                {/*                gridColumn: transfer.dst[1] + 1, */}
                {/*                gridRow: transfer.dst[0] + 1, */}
                {/*                backgroundColor: '#00ff0033', */}
                {/*            }} */}
                {/*        /> */}
                {/*    )} */}
                {/*    {transfer?.route.map((route, index) => ( */}
                {/*        <div */}
                {/*            key={`-${index}`} */}
                {/*            className='tensix' */}
                {/*            style={{ */}
                {/*                position: 'relative', */}
                {/*                gridColumn: route[1] + 1, */}
                {/*                gridRow: route[0] + 1, */}
                {/*            }} */}
                {/*        > */}
                {/*            <SVGTensixRenderer */}
                {/*                width={tensixSize * 2} */}
                {/*                height={tensixSize * 2} */}
                {/*                data={[getLinkPoints(route[2], getBufferColor(1))]} */}
                {/*            /> */}
                {/*            <div style={{ position: 'absolute', top: 0 }}> */}
                {/*                {route[0]}-{route[1]} */}
                {/*            </div> */}
                {/*        </div> */}
                {/*    ))} */}
                {/* </div> */}
            </div>
        </div>
    );
};

export default NPEView;
