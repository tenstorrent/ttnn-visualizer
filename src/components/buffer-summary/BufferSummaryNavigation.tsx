// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AnchorButton, ButtonGroup, ButtonVariant, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useScrollSpy } from '../../hooks/useScrollSpy';
import ROUTES from '../../definitions/Routes';
import { SECTION_IDS } from '../../definitions/BufferSummary';

const SECTIONS = [SECTION_IDS.PLOT, SECTION_IDS.TABLE];

/**
 * The sticky Plot/Table view buttons, highlighting the section being read. Kept apart from the
 * page so that a scroll re-renders these alone, not the plot and the table of every buffer.
 */
function BufferSummaryNavigation() {
    const { activeId: activeSection } = useScrollSpy(SECTIONS);

    return (
        <ButtonGroup className='sticky-nav'>
            <AnchorButton
                intent={Intent.PRIMARY}
                href={`${ROUTES.BUFFERS}#${SECTION_IDS.PLOT}`}
                icon={IconNames.HORIZONTAL_BAR_CHART}
                variant={activeSection !== SECTION_IDS.PLOT ? ButtonVariant.OUTLINED : undefined}
            >
                Plot view
            </AnchorButton>

            <AnchorButton
                intent={Intent.PRIMARY}
                href={`${ROUTES.BUFFERS}#${SECTION_IDS.TABLE}`}
                icon={IconNames.TH}
                variant={activeSection !== SECTION_IDS.TABLE ? ButtonVariant.OUTLINED : undefined}
            >
                Table view
            </AnchorButton>
        </ButtonGroup>
    );
}

export default BufferSummaryNavigation;
