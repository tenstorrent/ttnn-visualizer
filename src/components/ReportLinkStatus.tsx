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
import { isSettledLinkMatch } from '../functions/reportLinks';
import { useReportLinkMatch } from '../hooks/useReportLinkMatch';

const ReportLinkStatus = () => {
    const matchResult = useReportLinkMatch();
    const isLinked = matchResult === ReportLinkMatchResult.LINKED;
    // One headline for the tooltip and the accessible name, so the two can't drift apart.
    const statusLabel = isLinked ? REPORTS_LINKED_TOOLTIP : REPORTS_UNLINKED_TOOLTIP;

    const tooltipContent = isLinked ? (
        statusLabel
    ) : (
        <>
            {statusLabel}
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
                state instead, without `title`, whose SVG <title> would add a native tooltip.
                PENDING and UNAVAILABLE stay hidden rather than read as "unable to link". */}
            <Icon
                {...(isSettledLinkMatch(matchResult) && {
                    role: 'img',
                    'aria-hidden': false,
                    'aria-label': statusLabel,
                })}
                className={classNames({ 'no-sync-status-icon': !isLinked })}
                icon={isLinked ? IconNames.LINK : IconNames.UNLINK}
                intent={isLinked ? Intent.SUCCESS : Intent.NONE}
            />
        </Tooltip>
    );
};

export default ReportLinkStatus;
