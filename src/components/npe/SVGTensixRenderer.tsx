import React, { Fragment } from 'react';
import { LinkPoints } from './drawingApi';

interface SVGTensixRendererProps {
    width: number;
    height: number;
    data: LinkPoints[];
    // multiPointData?: LinkPoints[];
    isMulticolor?: boolean;
}

const SVGTensixRenderer: React.FC<SVGTensixRendererProps> = ({
    width,
    height,
    data,
    isMulticolor = false,
}: SVGTensixRendererProps) => {
    const strokeLength = 5;
    const dashArray = [strokeLength, (data.length - 1) * strokeLength];
    return (
        <svg
            width={width}
            height={height}
            // style={{ border: '1px solid black' }}
        >
            <g>
                {data?.map((line, index) => {
                    return (
                        <Fragment key={index}>
                            <line
                                x1={line.x1}
                                y1={line.y1}
                                x2={line.x2}
                                y2={line.y2}
                                stroke={line.color}
                                strokeWidth={2}
                                // eslint-disable-next-line react/jsx-props-no-spreading
                                {...(isMulticolor ? { strokeDasharray: dashArray.join(',') } : {})}
                                // eslint-disable-next-line react/jsx-props-no-spreading
                                {...(isMulticolor ? { strokeDashoffset: index * dashArray[0]! } : {})}

                                // {...(isMulticolor ? { strokeWidth: 2 } : {})}
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
            {/* <g> */}
            {/*    {multiPointData?.map((line, index) => { */}
            {/*        */}
            {/*        return ( */}
            {/*            <Fragment key={index}> */}
            {/*                <line */}
            {/*                    x1={line.x1} */}
            {/*                    y1={line.y1} */}
            {/*                    x2={line.x2} */}
            {/*                    y2={line.y2} */}
            {/*                    stroke={line.color || 'white'} */}
            {/*                /> */}
            {/*                {line.arrow && ( */}
            {/*                    <polygon */}
            {/*                        points={`${line.arrow.p1} ${line.arrow.p2} ${line.arrow.p3}`} */}
            {/*                        fill={line.color || 'white'} */}
            {/*                    /> */}
            {/*                )} */}
            {/*            </Fragment> */}
            {/*        ); */}
            {/*    })} */}
            {/* </g> */}
        </svg>
    );
};

export default SVGTensixRenderer;
