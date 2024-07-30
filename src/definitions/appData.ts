import { atomWithStorage } from 'jotai/utils';
import { ReportMetaData } from '../model/APIData';

export const reportMetaKey = 'reportMeta';
export const reportLocationKey = 'reportLocation';

export const reportMetaAtom = atomWithStorage<ReportMetaData | null>(reportMetaKey, null);
export const reportLocationAtom = atomWithStorage<'local' | 'remote' | null>(reportLocationKey, null);
