// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useAtomValue } from 'jotai';
import { reportLinksAtom } from '../../src/store/app';
import { REPORT_LINKS_PROBE_TEST_ID } from './reportLinkFixtures';

/** Renders `reportLinksAtom` so a spec can assert what was persisted without reading storage. */
export function ReportLinksProbe() {
    const links = useAtomValue(reportLinksAtom);

    return <pre data-testid={REPORT_LINKS_PROBE_TEST_ID}>{JSON.stringify(links)}</pre>;
}
