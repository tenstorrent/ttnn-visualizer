import React from 'react';
import { Tooltip } from '@blueprintjs/core';
import { CommonInfo, NPE_KPI, NPE_KPI_METADATA } from '../../model/NPEModel';

interface NPEMetadataProps {
    info?: CommonInfo;
    numTransfers: number;
}

const NPEMetadata: React.FC<NPEMetadataProps> = ({ info, numTransfers }) => {
    const formatMetadataValue = (key: keyof CommonInfo, value: string | number) => {
        const kpi = NPE_KPI_METADATA[key] as NPE_KPI;
        const unit = kpi.units;
        const decimals = kpi.decimals !== undefined ? kpi.decimals : 2;
        return `${typeof value === 'number' ? Number(value).toFixed(decimals) : value} ${unit}`;
    };
    const formatMetadataLabel = (key: keyof CommonInfo) => {
        const { label } = NPE_KPI_METADATA[key];
        const { description } = NPE_KPI_METADATA[key];
        return <Tooltip content={description}>{label ? `${label}: ` : key}</Tooltip>;
    };

    return (
        <div className='metadata'>
            <div>
                <h3 className='title'>Summary Table</h3>
                {info &&
                    (Object.keys(info) as (keyof CommonInfo)[]).map((key) => (
                        <div key={key}>
                            <span>{formatMetadataLabel(key)}: </span>
                            <span>{formatMetadataValue(key, info[key])}</span>
                        </div>
                    ))}
            </div>
            <div>
                <span>Active transfers:</span>
                <span>{numTransfers}</span>
            </div>
        </div>
    );
};
export default NPEMetadata;
