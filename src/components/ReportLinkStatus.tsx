// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Icon, Intent, Position, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { ReportLinkMatchResult } from '../functions/reportLinks';
import { useReportLinkMatch } from '../hooks/useReportLinkMatch';

const ReportLinkStatus = () => {
    const matchResult = useReportLinkMatch();
    const isLinked = matchResult === ReportLinkMatchResult.LINKED;

    const tooltipContent = isLinked ? (
        'Data linked between memory and performance reports'
    ) : (
        <>
            Unable to link active memory and performance reports
            <br />
            Please select reports generated from the same run to see additional data across the visualizer
        </>
    );

    return (
        <Tooltip
            content={tooltipContent}
            position={Position.TOP}
        >
            <Icon
                className={classNames({ 'no-sync-status-icon': !isLinked })}
                icon={isLinked ? IconNames.LINK : IconNames.UNLINK}
                intent={isLinked ? Intent.SUCCESS : Intent.NONE}
            />
        </Tooltip>
    );
};

export default ReportLinkStatus;
