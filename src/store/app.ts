// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { atomWithStorage } from 'jotai/utils';
import { atom } from 'jotai';
import { FileStatus, ReportMetaData } from '../model/APIData';

const reportMetaKey = 'reportMeta';
const reportLocationKey = 'reportLocation';

export const reportMetaAtom = atomWithStorage<ReportMetaData | null>(reportMetaKey, null);
export const reportLocationAtom = atomWithStorage<'local' | 'remote' | null>(reportLocationKey, null);
export const isFullStackTraceAtom = atom(false);
export const shouldCollapseAllOperationsAtom = atom(false);
export const expandedOperationsAtom = atom<number[]>([]);
export const expandedTensorsAtom = atom<number[]>([]);
export const selectedTensorAddressAtom = atom<number | null>(null);
export const isL1ActiveAtom = atom<boolean>(true);
export const isDramActiveAtom = atom<boolean>(false);

// This atom stores the file transfer progress data in localStorage (or sessionStorage)
export const fileTransferProgressAtom = atom({
    currentFileName: '',
    numberOfFiles: 0,
    percentOfCurrent: 0,
    finishedFiles: 0,
    status: FileStatus.FINISHED,
});
