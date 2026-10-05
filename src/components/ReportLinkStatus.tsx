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
import { useReportLinkMatch } from '../hooks/useReportLinkMatch';

const ReportLinkStatus = () => {
    const matchResult = useReportLinkMatch();
    const isLinked = matchResult === ReportLinkMatchResult.LINKED;
    // Only a settled comparison has a state worth announcing; PENDING and UNAVAILABLE
    // would otherwise read as "unable to link".
    const isSettled = isLinked || matchResult === ReportLinkMatchResult.UNLINKED;

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
            {/* Blueprint hides a title-less icon from assistive tech; expose a settled link
                state instead, without `title`, whose SVG <title> would add a native tooltip. */}
            <Icon
                {...(isSettled && {
                    role: 'img',
                    'aria-hidden': false,
                    'aria-label': isLinked ? REPORTS_LINKED_TOOLTIP : REPORTS_UNLINKED_TOOLTIP,
                })}
                className={classNames({ 'no-sync-status-icon': !isLinked })}
                icon={isLinked ? IconNames.LINK : IconNames.UNLINK}
                intent={isLinked ? Intent.SUCCESS : Intent.NONE}
            />
        </Tooltip>
    );
};

export default ReportLinkStatus;
