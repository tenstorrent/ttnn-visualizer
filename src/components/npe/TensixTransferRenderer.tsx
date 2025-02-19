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

    // TODO: find the ACTUAL source of the duplicates and fix it there

    const cleanedData = data.filter((line, index, self) => {
        return index === self.findIndex((t) => t.nocId === line.nocId && t.color === line.color);
    });

    cleanedData.forEach((line) => {
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

    const multiplierTracker: { nocId: NoCID; counter: number }[] = [];
    return (
        <svg
            width={width}
            height={height}
            style={style}
            aria-description={cleanedData.map((line) => line.nocId).join(',')}
        >
            <g>
                {cleanedData.map((line, index) => {
                    const multiplierObj = multiplierTracker.find((m) => m.nocId === line.nocId);
                    const multiplier = multiplierObj ? multiplierObj.counter : 0;
                    if (multiplierObj) {
                        multiplierObj.counter += 1;
                    } else {
                        multiplierTracker.push({ nocId: line.nocId, counter: 1 });
                    }
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
                                {...(isMulticolor
                                    ? { strokeDashoffset: multiplier * dashArray.get(line.nocId)![0] }
                                    : {})}
                            />
                            {line.arrow && !isMulticolor && (
                                <polygon
                                    transform={line.transform}
                                    points={`${line.arrow.p1} ${line.arrow.p2} ${line.arrow.p3}`}
                                    fill={line.color || 'white'}
                                />
                            )}
                            {line.arrow && isMulticolor && (
                                <polygon
                                    transform={line.transform}
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
