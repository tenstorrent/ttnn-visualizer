// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios from 'axios';
import { ReportKind } from '../definitions/UsageEvent';
import createToastNotification from './createToastNotification';
import { ToastType } from '../definitions/ToastType';
import getResponseError from './getResponseError';
import { recordReportLoadFailure } from './reportLoadUsage';

export const FOLDER_LIST_SYNC_ERROR_TOAST_TITLE = 'Folder list sync error';
export const FOLDER_SYNC_ERROR_TOAST_TITLE = 'Folder sync error';
export const REMOTE_FOLDER_MOUNT_ERROR_TOAST_TITLE = 'Unable to open report';

/**
 * Surfaces sync failures except intentional cancels (orphan reconnect abort).
 */
export default function notifyFolderSyncError(err: unknown): void {
    if (axios.isCancel(err)) {
        return;
    }

    createToastNotification(FOLDER_SYNC_ERROR_TOAST_TITLE, getResponseError(err), ToastType.ERROR);
}

/** Toast a sync failure and record it, sharing the cancel skip. */
export function notifyAndRecordFolderSyncError(kind: ReportKind, err: unknown): void {
    notifyFolderSyncError(err);
    recordReportLoadFailure(kind, err);
}

/** Surfaces failures when listing remote folders (SSH or transport errors). */
export function notifyFolderListSyncError(detail: string): void {
    createToastNotification(FOLDER_LIST_SYNC_ERROR_TOAST_TITLE, detail, ToastType.ERROR);
}

/** Surfaces failures when mounting a remote report that is missing locally. */
export function notifyRemoteFolderMountError(err: unknown): void {
    if (axios.isCancel(err)) {
        return;
    }

    createToastNotification(REMOTE_FOLDER_MOUNT_ERROR_TOAST_TITLE, getResponseError(err), ToastType.ERROR);
}

/** Toast a mount failure and record it, sharing the cancel skip. */
export function notifyAndRecordRemoteFolderMountError(kind: ReportKind, err: unknown): void {
    notifyRemoteFolderMountError(err);
    recordReportLoadFailure(kind, err);
}
