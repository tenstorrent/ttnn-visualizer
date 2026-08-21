// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import Endpoints from '../definitions/Endpoints';
import { HostKeyOfferResponse, isHostKeyOffer } from '../model/HostKey';
import getServerConfig from '../functions/getServerConfig';
import axiosInstance from '../libs/axiosInstance';

/** The fields of a connection a host-key decision depends on. No report path bears on it. */
export interface HostKeyTarget {
    host: string;
    port: number;
    identityFile?: string;
    /**
     * Sent because `Match user …` stanzas can set HostName, Port, HostKeyAlias and
     * ProxyJump: resolving without it answers for a different connection.
     */
    username?: string;
}

const HOST_KEY_TRUST_ENDPOINT = `${Endpoints.REMOTE_HOST_KEY}/trust`;

/**
 * Reads and records SSH host keys for the connection dialogs.
 *
 * Both calls are `@local_only` on the backend, so both are refused under `SERVER_MODE`
 * here too rather than left to 403 — a request the UI knows will fail is a request it
 * should not make.
 */
const useHostKey = () => {
    const isServerMode = !!getServerConfig()?.SERVER_MODE;

    const fetchHostKeyOffer = async (target: HostKeyTarget): Promise<HostKeyOfferResponse | null> => {
        if (isServerMode) {
            return null;
        }

        const { data } = await axiosInstance.post<HostKeyOfferResponse>(Endpoints.REMOTE_HOST_KEY, target);

        // A malformed offer must render nothing rather than a trust button pointing at
        // an undefined fingerprint, so the list is filtered rather than trusted.
        return { ...data, offers: (data.offers ?? []).filter(isHostKeyOffer) };
    };

    const trustHostKey = async (target: HostKeyTarget, fingerprints: readonly string[]): Promise<void> => {
        if (isServerMode) {
            return;
        }

        await axiosInstance.post(HOST_KEY_TRUST_ENDPOINT, { target, fingerprints });
    };

    return { fetchHostKeyOffer, trustHostKey };
};

export default useHostKey;
