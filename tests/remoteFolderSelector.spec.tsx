// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TestProviders } from './helpers/TestProviders';
import RemoteSyncConfigurator from '../src/components/report-selection/RemoteSyncConfigurator';
import getButtonWithText from './helpers/getButtonWithText';
import getAllButtonsWithText from './helpers/getAllButtonsWithText';
import remoteConnection from './data/remoteConnection.json';

// Scrub the markup after each test
afterEach(cleanup);

it('renders the initial form state when there is no data', () => {
    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    const reportSelects = getAllButtonsWithText('(No selection)');
    const syncButtons = getAllButtonsWithText('Sync remote folder');

    expect(getButtonWithText('Add new connection')).to.exist;
    expect(getButtonWithText('(No connection)')).to.exist;
    expect(getButtonWithText('Edit selected connection')).to.have.property('disabled', true);
    expect(getButtonWithText('Remove selected connection')).to.have.property('disabled', true);
    expect(getButtonWithText('Fetch remote folders list')).to.have.property('disabled', true);
    expect(reportSelects).to.have.length(2);
    expect(syncButtons).to.have.length(2);

    reportSelects.forEach((select) => {
        expect(select).to.have.property('disabled', true);
    });

    syncButtons.forEach((button) => {
        expect(button).to.have.property('disabled', true);
    });
});

it('renders the initial form state when there is remote connection data', () => {
    window.localStorage.setItem('remoteConnections', JSON.stringify(remoteConnection));

    render(
        <TestProviders>
            <RemoteSyncConfigurator />
        </TestProviders>,
    );

    const reportSelects = getAllButtonsWithText('(No selection)');
    const syncButtons = getAllButtonsWithText('Sync remote folder');

    expect(getButtonWithText('Local - ssh://localhost:2222/')).to.exist;
    expect(getButtonWithText('Edit selected connection')).to.have.property('disabled', false);
    expect(getButtonWithText('Remove selected connection')).to.have.property('disabled', false);
    expect(getButtonWithText('Fetch remote folders list')).to.have.property('disabled', false);
    expect(reportSelects).to.have.length(2);
    expect(syncButtons).to.have.length(2);

    reportSelects.forEach((select) => {
        expect(select).to.have.property('disabled', true);
    });

    syncButtons.forEach((button) => {
        expect(button).to.have.property('disabled', true);
    });
});
