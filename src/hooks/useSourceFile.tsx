// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useRef, useState } from 'react';
import { SourceFileStatus, StackSourceOrigin } from '../definitions/StackTrace';
import useRemoteConnection from './useRemote';

interface UseSourceFileOptions {
    // Probe availability on mount instead of waiting for the first interaction.
    // Leave false on many-instance surfaces (virtualized lists) to avoid a burst
    // of availability requests on render.
    eager?: boolean;
}

export interface UseSourceFileResult {
    canProbeSource: boolean;
    status: SourceFileStatus;
    matchedViaRemap: boolean;
    isFetching: boolean;
    fileContents: string;
    errorDetails: string;
    resolvedPath: string | null;
    probe: () => Promise<boolean>;
    readSource: () => Promise<void>;
}

export function useSourceFile(
    filePath: string,
    sourceFileId: number | null,
    { eager = false }: UseSourceFileOptions = {},
): UseSourceFileResult {
    const { readRemoteFile, isSourceFileAvailable } = useRemoteConnection();
    const canProbeSource = !!filePath || sourceFileId != null;

    const [status, setStatus] = useState<SourceFileStatus>(SourceFileStatus.Unknown);
    const [matchedViaRemap, setMatchedViaRemap] = useState(false);
    const [isFetching, setIsFetching] = useState(false);
    const [fileContents, setFileContents] = useState('');
    const [errorDetails, setErrorDetails] = useState('');
    const [resolvedPath, setResolvedPath] = useState<string | null>(null);

    const probeAbortRef = useRef<AbortController | null>(null);
    // Shared between concurrent callers (hover + click) so they await one request.
    const probePromiseRef = useRef<Promise<boolean> | null>(null);

    useEffect(() => {
        probeAbortRef.current?.abort();
        probePromiseRef.current = null;
        queueMicrotask(() => {
            setStatus(canProbeSource ? SourceFileStatus.Unknown : SourceFileStatus.Unavailable);
            setMatchedViaRemap(false);
            setFileContents('');
            setErrorDetails('');
            setResolvedPath(null);
        });
    }, [filePath, sourceFileId, canProbeSource]);

    const probe = useCallback((): Promise<boolean> => {
        if (!canProbeSource) {
            return Promise.resolve(false);
        }

        if (probePromiseRef.current) {
            return probePromiseRef.current;
        }

        const controller = new AbortController();
        probeAbortRef.current = controller;
        setStatus(SourceFileStatus.Pending);

        const probePromise = (async () => {
            try {
                const result = await isSourceFileAvailable(filePath, controller.signal, sourceFileId);
                if (controller.signal.aborted) {
                    return false;
                }
                setStatus(result.available ? SourceFileStatus.Available : SourceFileStatus.Unavailable);
                setMatchedViaRemap(result.available && result.source === StackSourceOrigin.Remapped);
                return result.available;
            } catch {
                if (!controller.signal.aborted) {
                    setStatus(SourceFileStatus.Unavailable);
                    setMatchedViaRemap(false);
                }
                return false;
            } finally {
                // Release the cached promise once settled so later interactions can
                // re-probe (e.g. after a transient failure) while still deduplicating
                // concurrent in-flight callers. Guard on the controller so a newer
                // probe's cached promise isn't cleared.
                if (probeAbortRef.current === controller) {
                    probePromiseRef.current = null;
                }
            }
        })();

        probePromiseRef.current = probePromise;
        return probePromise;
    }, [canProbeSource, filePath, sourceFileId, isSourceFileAvailable]);

    useEffect(() => {
        if (eager) {
            (async () => {
                await probe();
            })();
        }

        return () => probeAbortRef.current?.abort();
    }, [eager, probe]);

    const readSource = useCallback(async () => {
        if (!canProbeSource || fileContents) {
            return;
        }

        setIsFetching(true);
        const { data, error, resolvedPath: readResolvedPath } = await readRemoteFile(filePath, sourceFileId);
        setErrorDetails(error || '');
        setResolvedPath(readResolvedPath);

        if (!error && data) {
            setFileContents(data);
        }

        setIsFetching(false);
    }, [canProbeSource, fileContents, readRemoteFile, filePath, sourceFileId]);

    return {
        canProbeSource,
        status,
        matchedViaRemap,
        isFetching,
        fileContents,
        errorDetails,
        resolvedPath,
        probe,
        readSource,
    };
}
