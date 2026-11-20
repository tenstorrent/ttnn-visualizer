// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect } from 'react';
import { DBVersionValidation } from '../definitions/Versions';
import { ToastType } from '../definitions/ToastType';
import { evaluateDbVersion } from '../functions/compareDbVersion';
import createToastNotification from '../functions/createToastNotification';
import { useReportMetadata } from './useAPI';

export const INCOMPATIBLE_REPORT_VERSION_TOAST_TITLE = 'Incompatible report version';

/**
 * Warns when the active memory report's DB version is outside the supported range. Call it
 * once per surface: both report selectors used to own a copy, and Home mounts them together.
 */
const useDbVersionWarning = () => {
    const { data: reportMetadata } = useReportMetadata();

    useEffect(() => {
        if (!reportMetadata) {
            return;
        }

        const { statusCode, message } = evaluateDbVersion(reportMetadata.version);

        // `message` is only absent when the version is supported
        if (statusCode !== DBVersionValidation.OK && message) {
            createToastNotification(INCOMPATIBLE_REPORT_VERSION_TOAST_TITLE, message, ToastType.WARNING);
        }
    }, [reportMetadata]);
};

export default useDbVersionWarning;
