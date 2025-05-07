import React, { JSX } from 'react';

interface EmptyChipRendererProps {
    id: number;
    width: number;
    height: number;
    cores?: number[][];
    dram?: number[][];
    eth?: number[][];
    pcie?: number[][];
    showActiveTransfers: (arg: null) => void;
    isAnnotatingCores: boolean;
    TENSIX_SIZE: number;
}

export const EmptyChipRenderer: React.FC<EmptyChipRendererProps> = ({
    id,
    width,
    height,
    cores,
    dram,
    eth,
    pcie,
    showActiveTransfers,
    isAnnotatingCores,
    TENSIX_SIZE,
}: EmptyChipRendererProps) => {
    const getNodeType = (location: number[]): JSX.Element => {
        const [y, x] = location;
        if (cores?.some((loc) => loc[0] === y && loc[1] === x)) {
            return <div className='node-type-label node-type-c'>T</div>;
        }
        if (dram?.some((loc) => loc[0] === y && loc[1] === x)) {
            return <div className='node-type-label node-type-d'>d</div>;
        }
        if (eth?.some((loc) => loc[0] === y && loc[1] === x)) {
            return <div className='node-type-label node-type-e'>e</div>;
        }
        if (pcie?.some((loc) => loc[0] === y && loc[1] === x)) {
            return <div className='node-type-label node-type-p'>p</div>;
        }
        return <div className='node-type-label' />;
    };

    return (
        <div
            className='tensix-grid empty'
            style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${width || 0}, ${TENSIX_SIZE}px)`,
                gridTemplateRows: `repeat(${height || 0}, ${TENSIX_SIZE}px)`,
            }}
        >
            <div className='chip-id'>{id}</div>

            {Array.from({ length: width }).map((_, x) =>
                Array.from({ length: height }).map((__, y) => (
                    // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions
                    <div
                        className='tensix empty-tensix'
                        onClick={() => showActiveTransfers(null)}
                        style={{
                            gridColumn: x + 1,
                            gridRow: y + 1,
                            width: `${TENSIX_SIZE}px`,
                            height: `${TENSIX_SIZE}px`,
                        }}
                        key={`${x}-${y}`}
                    >
                        {isAnnotatingCores ? getNodeType([y, x]) : ''}
                    </div>
                )),
            )}
        </div>
    );
};
