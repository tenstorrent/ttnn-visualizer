// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AxiosError, AxiosResponse } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Endpoints from '../src/definitions/Endpoints';
import { clearReportLinkError, getReportLinkError, openReportFromLink } from '../src/libs/openReportFromLink';

const h = vi.hoisted(() => ({ serverMode: false, post: vi.fn() }));

vi.mock('../src/functions/getServerConfig', () => ({
    default: () => ({ SERVER_MODE: h.serverMode, BASE_PATH: '/' }),
}));

vi.mock('../src/libs/axiosInstance', () => ({ default: { post: h.post } }));

const PROFILER = '/reports/bge m3';
const PERFORMANCE = '/reports/perf';

const openAt = (path: string) => window.history.replaceState(null, '', path);

const linkTo = (route: string) =>
    `${route}?profiler_path=${encodeURIComponent(PROFILER)}&performance_path=${encodeURIComponent(PERFORMANCE)}`;

const refusal = (error: string) =>
    new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 400,
        data: { error },
    } as AxiosResponse);

beforeEach(() => {
    h.serverMode = false;
    h.post.mockReset();
    clearReportLinkError();
});

afterEach(() => openAt('/'));

describe('openReportFromLink', () => {
    it('leaves a page without report paths alone', async () => {
        openAt('/operations/4?instanceId=mine');
        const navigate = vi.fn();

        expect(await openReportFromLink(navigate)).toBe(false);
        expect(h.post).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
        expect(window.location.search).toBe('?instanceId=mine');
    });

    it("reloads onto an instance on the link's directories, at the same route", async () => {
        openAt(`${linkTo('/operations/4')}&tab=perf`);
        h.post.mockResolvedValue({ data: { instance_id: 'linked' } });
        const navigate = vi.fn();

        expect(await openReportFromLink(navigate)).toBe(true);

        expect(h.post).toHaveBeenCalledWith(Endpoints.INSTANCE_LOCAL_PATHS, {
            profiler_path: PROFILER,
            performance_path: PERFORMANCE,
        });
        const target: URL = navigate.mock.calls[0][0];
        expect(target.pathname).toBe('/operations/4');
        expect([...target.searchParams]).toEqual([
            ['tab', 'perf'],
            ['instanceId', 'linked'],
        ]);
    });

    it("stays on the tab's own report and keeps the reason when the server refuses", async () => {
        openAt(linkTo('/operations/4'));
        h.post.mockRejectedValue(refusal('No report directory at /reports/perf.'));
        const navigate = vi.fn();

        expect(await openReportFromLink(navigate)).toBe(false);

        expect(navigate).not.toHaveBeenCalled();
        expect(window.location.pathname).toBe('/operations/4');
        expect(window.location.search).toBe('');
        expect(getReportLinkError()).toBe('No report directory at /reports/perf.');
    });

    it('asks nothing of a hosted app, and says why', async () => {
        h.serverMode = true;
        openAt(linkTo('/operations/4'));

        expect(await openReportFromLink(vi.fn())).toBe(false);

        expect(h.post).not.toHaveBeenCalled();
        expect(window.location.search).toBe('');
        expect(getReportLinkError()).toBe('A hosted visualizer cannot open a report by path.');
    });

    it('keeps the reason until it is cleared', async () => {
        h.serverMode = true;
        openAt(linkTo('/operations'));
        await openReportFromLink(vi.fn());

        clearReportLinkError();

        expect(getReportLinkError()).toBeUndefined();
    });
});
