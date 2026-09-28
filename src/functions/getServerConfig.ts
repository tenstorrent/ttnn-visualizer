// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { DEFAULT_SSH_PORT } from '../definitions/RemoteConnection';
import { HOSTED_DEFAULT_MAX_CONTENT_LENGTH, ServerConfig } from '../definitions/ServerConfig';
import { MAX_PORT } from '../definitions/SshConnectionFields';

declare global {
    interface Window {
        TTNN_VISUALIZER_CONFIG?: Partial<ServerConfig>;
    }
}

const MIN_SSH_PORT = 1;
const BYTE_COUNT_PATTERN = /^[+-]?\d+$/;

// Unlike the backend parser this warns rather than throws: `axiosInstance` reads the config
// at module scope, so a throw here blanks the whole dev app, and the check this value feeds
// is advisory — Flask behind the `/api` proxy still enforces its own limit.
export function getViteMaxContentLength(value: unknown, serverMode: boolean): number | null {
    const fallback = serverMode ? HOSTED_DEFAULT_MAX_CONTENT_LENGTH : null;

    if (value === undefined) {
        return fallback;
    }

    if (typeof value !== 'string' || value === '') {
        return null;
    }

    const normalised = value.trim();
    const parsedValue = Number(normalised);
    if (!BYTE_COUNT_PATTERN.test(normalised) || !Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
        // eslint-disable-next-line no-console -- there is no UI yet at config-read time, and this branch is dev-only.
        console.warn(
            `VITE_MAX_CONTENT_LENGTH=${JSON.stringify(value)} is not a positive whole number of bytes, so the ` +
                'default applies. Set a byte count above zero, or leave it empty for no limit.',
        );

        return fallback;
    }

    return parsedValue;
}

export function getValidSshDefaultPort(value: unknown): number {
    const parsedPort = Number(value);

    if (Number.isInteger(parsedPort) && parsedPort >= MIN_SSH_PORT && parsedPort <= MAX_PORT) {
        return parsedPort;
    }

    return DEFAULT_SSH_PORT;
}

export function getOptionalPathDefault(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim();
}

// The same vocabulary the backend's `parse_bool` accepts, so one spelling can't select
// opposite answers either side of the boundary. Named for the vocabulary rather than for
// SERVER_MODE: `isFlagEnabled` now decides USAGE_RECORDING_ACTIVE through these too, and a
// constant named for one setting that silently governs another is the trap the naming
// rules in AGENTS.md exist to prevent.
const BOOLEAN_TRUE_VALUES = new Set<string>(['true', '1']);
const BOOLEAN_FALSE_VALUES = new Set<string>(['false', '0']);

// Accepts both shapes the two branches below supply: a real boolean from the JSON the
// backend inlines, and a string from a Vite env var — where `!!value` made the
// `VITE_SERVER_MODE=false` that `.env.sample` documents truthy. Anything else — a missing
// key, a spelling neither side recognises — is off, which is the local posture and the
// only safe answer a dev checkout can default to.
export function isFlagEnabled(value: unknown): boolean {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value !== 'string') {
        return false;
    }

    return BOOLEAN_TRUE_VALUES.has(value.trim().toLowerCase());
}

// Kept as its own name because this flag is a security posture rather than a feature
// toggle: call sites read as the boundary they gate, and the warning below is only owed
// to this one. Off here means the local posture, which is the only safe answer a dev
// checkout can default to.
export function isServerModeEnabled(value: unknown): boolean {
    return isFlagEnabled(value);
}

// The backend refuses to start on a SERVER_MODE it can't read, because falling back means
// the local posture. A predicate has no such option, so an unrecognised value here means a
// developer verifying hosted-mode gating silently tests the wrong posture instead — which
// is how a `@local_only` UI regression reaches the hosted build.
function warnOnUnrecognisedServerMode(value: unknown): void {
    if (typeof value !== 'string') {
        return;
    }

    const normalised = value.trim().toLowerCase();
    if (BOOLEAN_TRUE_VALUES.has(normalised) || BOOLEAN_FALSE_VALUES.has(normalised)) {
        return;
    }

    const recognised = [...BOOLEAN_TRUE_VALUES, ...BOOLEAN_FALSE_VALUES].join(', ');

    // eslint-disable-next-line no-console -- there is no UI yet at config-read time, and this branch is dev-only.
    console.warn(
        `VITE_SERVER_MODE="${value}" is not a recognised boolean, so server mode is off. Use one of: ${recognised}.`,
    );
}

function getSshDefaults(port: unknown, profilerPath: unknown, performancePath: unknown) {
    return {
        SSH_DEFAULT_PORT: getValidSshDefaultPort(port),
        SSH_DEFAULT_PROFILER_PATH: getOptionalPathDefault(profilerPath),
        SSH_DEFAULT_PERFORMANCE_PATH: getOptionalPathDefault(performancePath),
    };
}

const getServerConfig = (): ServerConfig => {
    // Dev mode configuration - use environment variables to simulate the server config
    if (import.meta.env.DEV) {
        warnOnUnrecognisedServerMode(import.meta.env.VITE_SERVER_MODE);
        const serverMode = isServerModeEnabled(import.meta.env.VITE_SERVER_MODE);

        return {
            BASE_PATH: '/',
            SERVER_MODE: serverMode,
            MAX_CONTENT_LENGTH: getViteMaxContentLength(import.meta.env.VITE_MAX_CONTENT_LENGTH, serverMode),
            TT_METAL_HOME: import.meta.env.VITE_TT_METAL_HOME,
            REPORT_DATA_DIRECTORY: import.meta.env.VITE_REPORT_DATA_DIRECTORY || '/path/to/data/directory', // Default value for development
            // On, matching the backend default, because this is not the switch: `/api`
            // proxies to Flask in dev, so the real `is_recording_enabled` decides whether
            // anything is written. A second flag here could only disagree with it, and
            // would stop dev exercising the path production takes.
            USAGE_RECORDING_ACTIVE: true,
            USERNAME: import.meta.env.VITE_USERNAME,
            ...getSshDefaults(
                import.meta.env.VITE_SSH_DEFAULT_PORT,
                import.meta.env.VITE_SSH_DEFAULT_PROFILER_PATH,
                import.meta.env.VITE_SSH_DEFAULT_PERFORMANCE_PATH,
            ),
        };
    }

    const windowConfig = window?.TTNN_VISUALIZER_CONFIG;

    return {
        BASE_PATH: windowConfig?.BASE_PATH || '/',
        MAX_CONTENT_LENGTH: windowConfig?.MAX_CONTENT_LENGTH,
        // Through the same predicate as the dev branch: `|| false` is the truthy-string
        // reading that made `SERVER_MODE` invertible in the first place, and this is the
        // branch the hosted deployment actually takes.
        SERVER_MODE: isServerModeEnabled(windowConfig?.SERVER_MODE),
        TT_METAL_HOME: windowConfig?.TT_METAL_HOME,
        REPORT_DATA_DIRECTORY: windowConfig?.REPORT_DATA_DIRECTORY,
        USAGE_RECORDING_ACTIVE: isFlagEnabled(windowConfig?.USAGE_RECORDING_ACTIVE),
        USERNAME: windowConfig?.USERNAME,
        ...getSshDefaults(
            windowConfig?.SSH_DEFAULT_PORT,
            windowConfig?.SSH_DEFAULT_PROFILER_PATH,
            windowConfig?.SSH_DEFAULT_PERFORMANCE_PATH,
        ),
    };
};

export default getServerConfig;
