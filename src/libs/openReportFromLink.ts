// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import Endpoints from '../definitions/Endpoints';
import getServerConfig from '../functions/getServerConfig';
import getResponseError from '../functions/getResponseError';
import axiosInstance from './axiosInstance';

// The query parameters the agent tools' links carry (`backend/ttnn_visualizer/agent/links.py`).
const REPORT_PATH_PARAMS = ['profiler_path', 'performance_path'] as const;

// Held until the toast container mounts: a toast raised before it is dropped.
let linkError: string | undefined;

/** Why a link's report could not be opened, until `clearReportLinkError`. */
export const getReportLinkError = (): string | undefined => linkError;

export const clearReportLinkError = () => {
    linkError = undefined;
};

const reload = (url: URL) => window.location.replace(url);

/**
 * Opens the report an agent tool's link names by its directories (#2047). The server makes an
 * instance on them, as `ttnn-visualizer --profiler-path` does, and the tab reloads onto it.
 * @returns whether the tab is reloading, so nothing should render.
 */
export const openReportFromLink = async (navigate: (url: URL) => void = reload): Promise<boolean> => {
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
        window.history.replaceState(window.history.state, '', url);
        linkError = 'A hosted visualizer cannot open a report by path.';

        return false;
    }

    try {
        const { data } = await axiosInstance.post<{ instance_id: string }>(Endpoints.INSTANCE_LOCAL_PATHS, paths);

        url.searchParams.set('instanceId', data.instance_id);
        navigate(url);

        return true;
    } catch (error) {
        window.history.replaceState(window.history.state, '', url);
        linkError = getResponseError(error);

        return false;
    }
};
