// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { formatSize } from './math';
import { TensorMemoryLayout } from '../model/MemoryConfig';
import { SshConfigHost } from '../model/SshConfigHost';

export const toReadableShape = (input: string) => {
    const match = input.match(/(?:Shape|torch\.Size)\((\[.*\])\)/);
    if (!match) {
        return input;
    }
    return match[1];
};

export const toReadableType = (input: string) => {
    return toShortTypeLabel(stripEnum(input));
};

export const toReadableLayout = (input: TensorMemoryLayout | string) => {
    // TODO: we may want to consider getting rid of uppercase and underscores in the future
    return stripEnum(input); // .toLowerCase().replaceAll('_', '-');
};

export const capitalizeString = (input: string) => {
    return input.charAt(0).toUpperCase() + input.slice(1).toLowerCase();
};

export const stripEnum = (v: string) => {
    if (!v) {
        return v;
    }
    const str = v.toString();
    const parsed = str.split(/::|\./);

    return parsed[parsed.length - 1] || str;
};

const TYPE_LABELS: Record<string, string> = {
    UINT8: 'u8',
    UINT16: 'u16',
    INT32: 'i32',
    UINT32: 'u32',
    FLOAT32: 'f32',
    BFLOAT16: 'bf16',
    BFLOAT8_B: 'bf8',
    BFLOAT4_B: 'bf4',
};

const toShortTypeLabel = (input: string) => {
    const key = stripEnum(input);
    if (!key) {
        return input;
    }
    return TYPE_LABELS[key] ?? key.toLowerCase();
};

const SHORT_SHA_LENGTH = 7;
const HTTP_GIT_URL_PATTERN = /^https?:\/\//;

export const formatShortSha = (sha: string): string => sha.slice(0, SHORT_SHA_LENGTH);

export const stripGitRemoteSuffix = (url: string): string => url.replace(/\.git$/, '');

export const buildGitCommitUrl = (gitUrl: string, gitSha: string): string | null => {
    if (!HTTP_GIT_URL_PATTERN.test(gitUrl)) {
        return null;
    }

    return `${stripGitRemoteSuffix(gitUrl)}/commit/${gitSha}`;
};

/**
 * Human-readable nanosecond formatter — picks the largest unit that still
 * yields a reasonable mantissa (ns → µs → ms → s).
 *
 * Zero, negative, and non-finite input collapse to `'0 ns'` so callers can
 * use this in legends/labels without guarding upstream.
 *
 * Numeric formatting goes through `formatSize` so we get locale-aware
 * separators and consistent fraction-digit handling across the codebase.
 * `Intl.NumberFormat` doesn't sanction `nanosecond`/`microsecond` as unit
 * identifiers yet, so we keep the unit suffix as a literal string instead
 * of using `formatUnit` for some tiers only — uniform formatting beats a
 * half-and-half split.
 */
export const formatDuration = (ns: number): string => {
    if (!Number.isFinite(ns) || ns <= 0) {
        return '0 ns';
    }
    if (ns < 1_000) {
        return `${formatSize(ns, 0)} ns`;
    }
    if (ns < 1_000_000) {
        return `${formatSize(ns / 1_000, 1)} µs`;
    }
    if (ns < 1_000_000_000) {
        return `${formatSize(ns / 1_000_000, 2)} ms`;
    }
    return `${formatSize(ns / 1_000_000_000, 2)} s`;
};

/** Remote folder sync timestamps are Unix epoch seconds. */
export const getUTCFromEpoch = (epoch: number): Date => new Date(epoch * 1000);

/** Dropdown label for a `~/.ssh/config` alias, disambiguated by its HostName. */
export const getSshConfigHostLabel = (host: SshConfigHost): string =>
    host.hostName ? `${host.host} — ${host.hostName}` : host.host;

// The CB legend row and the pressure modal both spell out these multipliers.
// Written twice, they drifted on pluralisation; callers keep their own gating,
// which genuinely differs, and share only the wording. #1844
export const getCoreCountLabel = (numCores: number): string => `x ${numCores} ${numCores === 1 ? 'core' : 'cores'}`;

export const getDeviceCountLabel = (deviceCount: number): string =>
    `x ${deviceCount} ${deviceCount === 1 ? 'device' : 'devices'}`;
