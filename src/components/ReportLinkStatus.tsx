// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Icon, Intent, Position, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import {
    REPORTS_LINKED_TOOLTIP,
    REPORTS_UNLINKED_TOOLTIP,
    REPORTS_UNLINKED_TOOLTIP_HINT,
    ReportLinkMatchResult,
} from '../definitions/ReportLinks';
import { TEST_IDS } from '../definitions/TestIds';
import { useReportLinkMatch } from '../hooks/useReportLinkMatch';

const ReportLinkStatus = () => {
    const matchResult = useReportLinkMatch();
    const isLinked = matchResult === ReportLinkMatchResult.LINKED;

    const tooltipContent = isLinked ? (
        REPORTS_LINKED_TOOLTIP
    ) : (
        <>
            {REPORTS_UNLINKED_TOOLTIP}
            <br />
            {REPORTS_UNLINKED_TOOLTIP_HINT}
        </>
    );

    return (
        <Tooltip
            content={tooltipContent}
            position={Position.TOP}
        >
            <Icon
                data-testid={TEST_IDS.REPORT_LINK_STATUS}
                className={classNames({ 'no-sync-status-icon': !isLinked })}
                icon={isLinked ? IconNames.LINK : IconNames.UNLINK}
                intent={isLinked ? Intent.SUCCESS : Intent.NONE}
            />
        </Tooltip>
    );
};

export default ReportLinkStatus;
