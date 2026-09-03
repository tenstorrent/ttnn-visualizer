// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useMemo, useRef, useState } from 'react';
import { NPEValidationError } from '../definitions/NPEData';
import { ReportKind, ReportSource } from '../definitions/EventLogEvent';
import getNpeReportLoadFailureReason from '../functions/getNpeReportLoadFailureReason';
import { recordReportLoadFailed, recordReportLoaded } from '../functions/reportLoadEvents';

interface NpeLoadAttempt {
    id: number;
    source: ReportSource;
}

export interface NpeLoadAttemptController {
    id: number | null;
    complete: (attemptId: number) => void;
    fail: (attemptId: number, errorCode: NPEValidationError, error?: unknown) => void;
}

export default function useNpeLoadAttempt() {
    const nextIdRef = useRef(0);
    const pendingAttemptRef = useRef<NpeLoadAttempt | null>(null);
    const [pendingAttemptId, setPendingAttemptId] = useState<number | null>(null);

    const begin = useCallback((source: ReportSource) => {
        nextIdRef.current += 1;
        const attempt = { id: nextIdRef.current, source };
        pendingAttemptRef.current = attempt;
        setPendingAttemptId(attempt.id);
    }, []);

    const complete = useCallback((attemptId: number) => {
        const attempt = pendingAttemptRef.current;
        if (!attempt || attempt.id !== attemptId) {
            return;
        }

        pendingAttemptRef.current = null;
        setPendingAttemptId(null);
        recordReportLoaded(ReportKind.NPE, attempt.source);
    }, []);

    const fail = useCallback((attemptId: number, errorCode: NPEValidationError, error: unknown = null) => {
        const attempt = pendingAttemptRef.current;
        if (!attempt || attempt.id !== attemptId) {
            return;
        }

        pendingAttemptRef.current = null;
        setPendingAttemptId(null);
        recordReportLoadFailed(ReportKind.NPE, getNpeReportLoadFailureReason(errorCode, error));
    }, []);

    const controller = useMemo<NpeLoadAttemptController>(
        () => ({ id: pendingAttemptId, complete, fail }),
        [complete, fail, pendingAttemptId],
    );

    return { begin, controller };
}
