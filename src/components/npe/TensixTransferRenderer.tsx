import React, { Fragment } from 'react';
import { LinkPoints } from './drawingApi';
import { NoCID } from '../../model/NPEModel';

interface SVGTensixRendererProps {
    width: number;
    height: number;
    data: LinkPoints[];
    isMulticolor?: boolean;
    style?: React.CSSProperties;
}

const TensixTransferRenderer: React.FC<SVGTensixRendererProps> = ({
    width,
    height,
    data,
    isMulticolor = false,
    style,
}: SVGTensixRendererProps) => {
    const strokeLength = 5;
    const dashMap: Map<NoCID, number> = new Map();
    const dashArray: Map<NoCID, number[]> = new Map();
    data.forEach((line) => {
        if (!dashMap.has(line.nocId)) {
            dashMap.set(line.nocId, 1);
        } else {
            const cnt = dashMap.get(line.nocId)!;
            dashMap.set(line.nocId, cnt + 1);
        }
    });
    dashMap.forEach((cnt, nocId) => {
        dashArray.set(nocId, [strokeLength, (cnt - 1) * strokeLength]);
    });

    return (
        <svg
            width={width}
            height={height}
            style={style}
        >
            <g>
                {data.map((line, index) => {
                    return (
                        <Fragment key={`${index}-${line.x1}-${line.y1}-${line.x2}-${line.y2}`}>
                            <line
                                x1={line.x1}
                                y1={line.y1}
                                x2={line.x2}
                                y2={line.y2}
                                stroke={line.color}
                                strokeWidth={1}
                                // eslint-disable-next-line react/jsx-props-no-spreading
                                {...(isMulticolor ? { strokeDasharray: dashArray.get(line.nocId)!.join(',') } : {})}
                                // eslint-disable-next-line react/jsx-props-no-spreading
                                {...(isMulticolor ? { strokeDashoffset: index * dashArray.get(line.nocId)![0] } : {})}
                            />
                            {line.arrow && !isMulticolor && (
                                <polygon
                                    points={`${line.arrow.p1} ${line.arrow.p2} ${line.arrow.p3}`}
                                    fill={line.color || 'white'}
                                />
                            )}
                            {line.arrow && isMulticolor && (
                                <polygon
                                    points={`${line.arrow.p1} ${line.arrow.p2} ${line.arrow.p3}`}
                                    fill='#999'
                                />
                            )}
                        </Fragment>
                    );
                })}
            </g>
        </svg>
    );
};

export default TensixTransferRenderer;
