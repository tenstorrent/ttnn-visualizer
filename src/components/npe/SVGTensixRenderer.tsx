import React, { Fragment } from 'react';
import { LinkPoints } from './drawingApi';

interface SVGTensixRendererProps {
    width: number;
    height: number;
    data: LinkPoints[];
}

const SVGTensixRenderer: React.FC<SVGTensixRendererProps> = ({ width, height, data }: SVGTensixRendererProps) => {
    return (
        <svg
            width={width}
            height={height}
            // style={{ border: '1px solid black' }}
        >
            <g>
                {data.map((line, index) => {
                    return (
                        <Fragment key={index}>
                            <line
                                x1={line.x1}
                                y1={line.y1}
                                x2={line.x2}
                                y2={line.y2}
                                stroke={line.color || 'red'}
                            />
                            {line.arrow && (
                                <polygon
                                    points={`${line.arrow.p1} ${line.arrow.p2} ${line.arrow.p3}`}
                                    fill={line.color || 'red'}
                                />
                            )}
                        </Fragment>
                    );
                })}
            </g>
        </svg>
    );
};

export default SVGTensixRenderer;
