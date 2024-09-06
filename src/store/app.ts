// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { atomWithStorage } from 'jotai/utils';
import { atom } from 'jotai';
import { ReportMetaData } from '../model/APIData';

const reportMetaKey = 'reportMeta';
const reportLocationKey = 'reportLocation';

export const reportMetaAtom = atomWithStorage<ReportMetaData | null>(reportMetaKey, null);
export const reportLocationAtom = atomWithStorage<'local' | 'remote' | null>(reportLocationKey, null);
export const isFullStackTraceAtom = atom(false);
export const shouldCollapseAllOperationsAtom = atom(false);
export const expandedOperationsAtom = atom<number[]>([]);
export const selectedTensorAddressAtom = atom<number | null>(null);
