// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterRenderer from '../src/components/cluster/ClusterRenderer';
import { DeviceArchitecture } from '../src/definitions/DeviceArchitecture';
import { getChipDesign } from '../src/functions/getChipDesign';
import { ResizeObserverStub, hostOf, topologyOfHosts, topologyQueryResult } from './helpers/clusterTopologyFixtures';
import { QUASAR_32_GRID } from './helpers/quasarGrids';

vi.mock('../src/functions/getChipDesign', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/functions/getChipDesign')>();
    return { ...actual, getChipDesign: vi.fn(actual.getChipDesign) };
});
vi.mock('react-router', async () => ({
    ...(await vi.importActual<typeof import('react-router')>('react-router')),
    useNavigate: () => vi.fn(),
}));

const host = hostOf({ rank: 0, chipCount: 2, mesh: true });
const quasarTopology = topologyOfHosts([
    { ...host, descriptor: { ...host.descriptor, arch: { 0: 'quasar', 1: 'quasar' } } },
]);

vi.mock('../src/hooks/useAPI', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/hooks/useAPI')>()),
    useGetClusterTopology: () => topologyQueryResult(quasarTopology),
}));

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Cluster with a Quasar chip', () => {
    // The cluster descriptor carries no grid, so a QSR3.A2 chip is drawn as Quasar-32 too.
    // Neither part has Ethernet or PCIe, so nothing on screen differs today. #2237
    it('draws it with the default Quasar-32 descriptor', () => {
        render(<ClusterRenderer />);

        const { calls, results } = vi.mocked(getChipDesign).mock;
        const quasarDesigns = calls.flatMap(([arch], index) =>
            arch === DeviceArchitecture.QUASAR ? [results[index].value] : [],
        );
        expect(quasarDesigns).not.toHaveLength(0);
        quasarDesigns.forEach((design) => expect(design?.grid).toEqual(QUASAR_32_GRID));
    });
});
