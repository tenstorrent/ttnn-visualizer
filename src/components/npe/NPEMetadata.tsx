import React from 'react';
import { CommonInfo } from '../../model/NPEModel';

interface NPEMetadataProps {
    info?: CommonInfo;
    numTransfers: number;
}

const NPEMetadata: React.FC<NPEMetadataProps> = ({ info, numTransfers }) => {
    const formatMetadata = (value: string | number) => {
        if (typeof value === 'number') {
            return value.toFixed(2);
        }
        return value;
    };
    return (
        <div className='metadata'>
            <div>
                {info &&
                    Object.keys(info).map((key) => (
                        <div key={key}>
                            <span>{key}:</span>
                            <span>{formatMetadata(info[key as keyof CommonInfo])}</span>
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
