// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { atomWithStorage } from 'jotai/utils';
import { atom } from 'jotai';
import { FileProgress, FileStatus, ReportMetaData } from '../model/APIData';

const reportMetaKey = 'reportMeta';
const reportLocationKey = 'reportLocation';
const showHexKey = 'showHex';

export const reportMetaAtom = atomWithStorage<ReportMetaData | null>(reportMetaKey, null);
export const reportLocationAtom = atomWithStorage<'local' | 'remote' | null>(reportLocationKey, null);
export const showHexAtom = atomWithStorage<boolean>(showHexKey, false);

export const isFullStackTraceAtom = atom(false);
export const shouldCollapseAllOperationsAtom = atom(false);
export const expandedOperationsAtom = atom<number[]>([]);
export const expandedTensorsAtom = atom<number[]>([]);
export const activeToastAtom = atom<number | null>(null);
export const selectedAddressAtom = atom<number | null>(null);
export const selectedTensorAtom = atom<number | null>(null);

// This atom stores the file transfer progress data in localStorage (or sessionStorage)
export const fileTransferProgressAtom = atom<FileProgress>({
    currentFileName: '',
    numberOfFiles: 0,
    percentOfCurrent: 0,
    finishedFiles: 0,
    status: FileStatus.INACTIVE,
});

export const selectedDeviceAtom = atom<number | null>(0); // Assumes device_id always uses a zero based index
export const renderMemoryLayoutAtom = atom<boolean>(false);
