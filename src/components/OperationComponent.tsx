// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import React from 'react';
import { Icon, IconName, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import HighlightedText from './HighlightedText';
import '../scss/components/Operation.scss';

interface OperationProps {
    filterName: string;
    filterQuery: string;
    icon?: IconName;
    intent?: Intent;
}

const OperationComponent: React.FC<OperationProps> = ({
    filterName,
    filterQuery,
    icon = IconNames.CUBE,
    intent = Intent.NONE,
}) => {
    return (
        <div className='operation-component'>
            <Icon
                size={20}
                icon={icon}
                intent={intent}
            />
            <HighlightedText
                text={filterName}
                filter={filterQuery}
            />
            {/* <Button title='Operation tensor report' minimal small icon={IconNames.GRAPH} /> */}
            {/* <Button title='Stack trace' minimal small icon={IconNames.CODE} /> */}
            {/* <GoldenTensorComparisonIndicator value={op.goldenGlobal} /> */}
            {/* <GoldenTensorComparisonIndicator value={op.goldenLocal} /> */}
        </div>
    );
};

export default OperationComponent;
