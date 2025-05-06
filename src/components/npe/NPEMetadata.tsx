import React from 'react';
import { Tooltip } from '@blueprintjs/core';
import { CommonInfo, NPE_KPI, NPE_KPI_METADATA } from '../../model/NPEModel';
import Collapsible from '../Collapsible';

interface NPEMetadataProps {
    info?: CommonInfo;
    numTransfers: number;
}

const NPEMetadata: React.FC<NPEMetadataProps> = ({ info, numTransfers }) => {
    const hasKey = (key: keyof CommonInfo) => {
        return NPE_KPI_METADATA[key] !== undefined;
    };
    const formatMetadataValue = (key: keyof CommonInfo, value: string | number) => {
        if (!NPE_KPI_METADATA[key]) {
            return null;
        }
        const kpi = NPE_KPI_METADATA[key] as NPE_KPI;
        const unit = kpi.units;
        const decimals = kpi.decimals !== undefined ? kpi.decimals : 2;
        return `${typeof value === 'number' ? Number(value).toFixed(decimals) : value} ${unit}`;
    };
    const formatMetadataLabel = (key: keyof CommonInfo) => {
        if (!NPE_KPI_METADATA[key]) {
            return null;
        }
        const { label } = NPE_KPI_METADATA[key];
        const { description } = NPE_KPI_METADATA[key];
        return <Tooltip content={description}>{label ? `${label}: ` : key}</Tooltip>;
    };

    return (
        <div className='metadata'>
            <Collapsible
                label={<h3 className='title'>Run summary</h3>}
                isOpen
            >
                <div>
                    {info &&
                        (Object.keys(info) as (keyof CommonInfo)[]).map((key) => {
                            if (hasKey(key) && info[key] !== undefined) {
                                return (
                                    <div key={key}>
                                        <span>{formatMetadataLabel(key)}: </span>
                                        <span>{formatMetadataValue(key, info[key])}</span>
                                    </div>
                                );
                            }
                            return null;
                        })}
                </div>
                <hr />
                <div>
                    <span>Active transfers:</span>
                    <span>{numTransfers}</span>
                </div>
            </Collapsible>
        </div>
    );
};
export default NPEMetadata;
