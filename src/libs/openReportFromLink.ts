// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import Endpoints from '../definitions/Endpoints';
import getServerConfig from '../functions/getServerConfig';
import getResponseError from '../functions/getResponseError';
import axiosInstance from './axiosInstance';

// The query parameters the agent tools' links carry (`backend/ttnn_visualizer/agent/app_links.py`).
const REPORT_PATH_PARAMS = ['profiler_path', 'performance_path'] as const;

// A hung server would otherwise hold the tab blank: no render, no toast saying why.
const OPEN_TIMEOUT_MS = 10_000;

const HOSTED_REFUSAL = 'A hosted visualizer cannot open a report by path.';
const FRAMED_REFUSAL = 'A visualizer inside another page does not open a report by path.';

// Raised by `Layout` rather than here: StrictMode re-subscribes the toast container, losing an earlier toast.
let linkError: string | null = null;

/** Why a link's report could not be opened, until `clearReportLinkError`. */
export const getReportLinkError = (): string | null => linkError;

export const clearReportLinkError = () => {
    linkError = null;
};

const reload = (url: URL) => window.location.replace(url);

// A page that frames the app could otherwise switch it onto a directory of its choosing unseen.
const isInsideAnotherPage = () => window.top !== window.self;

const refuse = (url: URL, reason: string): false => {
    window.history.replaceState(window.history.state, '', url);
    linkError = reason;

    return false;
};

/**
 * Opens the report an agent tool's link names by its directories (#2047). The server makes an
 * instance on them, as `ttnn-visualizer --profiler-path` does, and the tab reloads onto it.
 * @returns whether the tab is reloading, so nothing should render.
 */
export const openReportFromLink = async (
    navigate: (url: URL) => void = reload,
    isFramed: () => boolean = isInsideAnotherPage,
): Promise<boolean> => {
    const url = new URL(window.location.href);
    const paths = Object.fromEntries(
        REPORT_PATH_PARAMS.flatMap((param) => {
            const path = url.searchParams.get(param);

            return path ? [[param, path]] : [];
        }),
    );

    if (Object.keys(paths).length === 0) {
        return false;
    }

    REPORT_PATH_PARAMS.forEach((param) => url.searchParams.delete(param));

    if (getServerConfig().SERVER_MODE) {
        return refuse(url, HOSTED_REFUSAL);
    }

    if (isFramed()) {
        return refuse(url, FRAMED_REFUSAL);
    }

    try {
        const { data } = await axiosInstance.post<{ instance_id: string }>(Endpoints.INSTANCE_LOCAL_PATHS, paths, {
            timeout: OPEN_TIMEOUT_MS,
        });

        url.searchParams.set('instanceId', data.instance_id);
        navigate(url);

        return true;
    } catch (error) {
        return refuse(url, getResponseError(error));
    }
};

/**
 * Renders the app unless a link is reloading the tab onto its report. Opening the link runs first,
 * so the router `render` builds reads the URL with the link's paths already stripped from it.
 */
export const startWithReportLink = async (
    render: () => void,
    open: () => Promise<boolean> = openReportFromLink,
): Promise<void> => {
    const isNavigating = await open().catch(() => false);

    if (!isNavigating) {
        render();
    }
};
