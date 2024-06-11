// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import React from 'react';
import { Button, Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import HighlightedText from './HighlightedText';
import '../scss/components/Operation.scss';

interface OperationProps {
    // temp interface until we have Operation data model defined
    op: {
        name: string;
    };
    filterQuery: string;
}

const OperationComponent: React.FC<OperationProps> = ({op, filterQuery}) => {
    return (
        <div className='operation-component'>
            <Icon className='operation-icon' size={20} icon={IconNames.CUBE}/>
            <HighlightedText text={op.name} filter={filterQuery}/>
            <Button title='Operation tensor report' minimal small icon={IconNames.GRAPH}/>
            <Button title='Stack trace' minimal small icon={IconNames.CODE}/>
            <Button title='Buffer view' minimal small icon={IconNames.SEGMENTED_CONTROL}/>
            {/* <GoldenTensorComparisonIndicator value={op.goldenGlobal} /> */}
            {/* <GoldenTensorComparisonIndicator value={op.goldenLocal} /> */}
        </div>
    );
};

export default OperationComponent;
