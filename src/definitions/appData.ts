import { atomWithStorage } from 'jotai/utils';
import { atom } from 'jotai';
import { ReportMetaData } from '../model/APIData';

export const reportMetaKey = 'reportMeta';
export const reportLocationKey = 'reportLocation';

export const reportMetaAtom = atomWithStorage<ReportMetaData | null>(reportMetaKey, null);
export const reportLocationAtom = atomWithStorage<'local' | 'remote' | null>(reportLocationKey, null);
export const isFullStackTraceAtom = atom(false);
export const expandedOperationsAtom = atom<number[]>([]);
