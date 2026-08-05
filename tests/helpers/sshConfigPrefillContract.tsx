// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The SSH config prefill behaviour both connection dialogs share.
 *
 * Remote connections and MLIR servers render the same SshConfigHostPicker through the same
 * useSshConfigHostSelection hook and getSshConfigHostPrefill helper, so this is one contract with
 * two consumers. Asserting it separately per dialog let the two copies drift: whichever spec was
 * updated alongside a change to the shared code left the other passing against the old behaviour.
 *
 * Only what the dialogs genuinely have in common lives here. Field labels, prop shapes and copy
 * differ, so they arrive as options — and anything one dialog does alone (the MLIR port staying
 * untouched, the remote dialog keeping a name the user chose) stays in that dialog's own spec.
 */

import { RenderResult, fireEvent, screen, waitFor } from '@testing-library/react';
import { Mock, describe, expect, it } from 'vitest';
import { SSH_CONFIG_HOST_CUSTOM, SSH_CONFIG_HOST_LABEL } from '../../src/definitions/SshConfigHostPicker';
import { SSH_IDENTITY_FILE_LABEL } from '../../src/definitions/SshConnectionFields';
import getButtonWithText from './getButtonWithText';
import { SshConfigHostsQueryResult, noSshConfigResult, sshConfigHostsResult } from './sshConfigFixtures';

/** An existing entity being edited, mapped by each spec onto its own dialog prop. */
export interface ExistingTarget {
    name: string;
    host: string;
    username: string;
}

export interface SshConfigPrefillContractOptions {
    /** Renders the dialog under test; `existing` means "edit this" rather than "add new". */
    renderDialog: (options?: { open?: boolean; existing?: ExistingTarget }) => RenderResult;
    /** Accessible name of the SSH host field — capitalisation differs between dialogs. */
    hostLabel: string;
    /** Accessible name of the SSH port field, not the MLIR server port. */
    sshPortLabel: string;
    runTestsLabel: string;
    saveLabel: string;
    /** Message the mocked connection test resolves with, shown on success. */
    passingTestMessage: string;
    /** Prompt shown once a target change invalidates a passing result. */
    invalidatedTestMessage: string;
    /** The spec's hoisted useSshConfigHosts mock, so the suite can seed payloads. */
    useSshConfigHostsMock: Mock<(enabled?: boolean) => SshConfigHostsQueryResult>;
    /** Flips SERVER_MODE on the spec's getServerConfig mock. */
    setServerMode: (serverMode: boolean) => void;
    /** Makes the dialog's connection test resolve with `passingTestMessage`. */
    mockPassingTest: () => void;
    /** USERNAME from the spec's getServerConfig mock, restored when a prefill is cancelled. */
    defaultUsername: string;
}

const ALIAS = 'work-gpu';
const ALIAS_USER = 'alice';
const ALIAS_PORT = 2222;

const getPicker = () => screen.getByLabelText(SSH_CONFIG_HOST_LABEL) as HTMLSelectElement;

const selectConfigHost = (alias: string) => {
    fireEvent.change(screen.getByLabelText(SSH_CONFIG_HOST_LABEL), { target: { value: alias } });
};

export const describeSshConfigPrefillContract = (
    dialogName: string,
    {
        renderDialog,
        hostLabel,
        sshPortLabel,
        runTestsLabel,
        saveLabel,
        passingTestMessage,
        invalidatedTestMessage,
        useSshConfigHostsMock,
        setServerMode,
        mockPassingTest,
        defaultUsername,
    }: SshConfigPrefillContractOptions,
) => {
    describe(`${dialogName} SSH config prefill contract`, () => {
        it('prefills host, name, username, and SSH port from a config host and clears identity', () => {
            useSshConfigHostsMock.mockReturnValue(
                sshConfigHostsResult([
                    { host: ALIAS, user: ALIAS_USER, port: ALIAS_PORT, hostName: 'gpu.example.com' },
                ]),
            );

            renderDialog();

            fireEvent.change(screen.getByLabelText(SSH_IDENTITY_FILE_LABEL), {
                target: { value: '/tmp/id_ed25519' },
            });
            selectConfigHost(ALIAS);

            expect(screen.getByLabelText('Name')).toHaveValue(ALIAS);
            expect(screen.getByLabelText(hostLabel)).toHaveValue(ALIAS);
            expect(screen.getByLabelText('Username')).toHaveValue(ALIAS_USER);
            expect(screen.getByLabelText(sshPortLabel)).toHaveValue(String(ALIAS_PORT));
            // Cleared so OpenSSH keeps applying the stanza's own IdentityFile and ProxyJump.
            expect(screen.getByLabelText(SSH_IDENTITY_FILE_LABEL)).toHaveValue('');
        });

        it('opens with the alias selected when the existing host matches one', () => {
            useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: ALIAS, user: ALIAS_USER }]));

            renderDialog({ existing: { name: 'saved', host: ALIAS, username: 'carol' } });

            // initialHost exists for this: a saved connection pointing at an alias should not
            // read as Custom, or reopening the dialog implies the stanza no longer applies.
            expect(getPicker().value).toBe(ALIAS);
        });

        it('reads as Custom when the existing host matches no alias', () => {
            useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: ALIAS, user: ALIAS_USER }]));

            renderDialog({ existing: { name: 'saved', host: 'not-an-alias', username: 'carol' } });

            expect(getPicker().value).toBe(SSH_CONFIG_HOST_CUSTOM);
        });

        it('resets the picker to Custom when the host is typed by hand', () => {
            useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: ALIAS, user: ALIAS_USER }]));

            renderDialog();

            selectConfigHost(ALIAS);
            expect(getPicker().value).toBe(ALIAS);

            fireEvent.change(screen.getByLabelText(hostLabel), { target: { value: 'typed-host' } });

            expect(getPicker().value).toBe(SSH_CONFIG_HOST_CUSTOM);
            expect(screen.getByLabelText(hostLabel)).toHaveValue('typed-host');
        });

        it('hides the SSH config host picker under SERVER_MODE', () => {
            setServerMode(true);
            useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: 'should-not-show' }]));

            renderDialog();

            expect(screen.queryByLabelText(SSH_CONFIG_HOST_LABEL)).not.toBeInTheDocument();
        });

        it('hides the SSH config host picker when ~/.ssh/config does not exist', () => {
            useSshConfigHostsMock.mockReturnValue(noSshConfigResult());

            renderDialog();

            expect(screen.queryByLabelText(SSH_CONFIG_HOST_LABEL)).not.toBeInTheDocument();
        });

        it('gates the config-host fetch on the dialog being open', () => {
            useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: ALIAS }]));

            const { unmount } = renderDialog({ open: false });

            // Blueprint unmounts the dialog body when closed, so nothing reads ~/.ssh/config;
            // enabled={open} keeps the fetch gated if the picker is ever rendered outside it.
            expect(useSshConfigHostsMock).not.toHaveBeenCalled();
            unmount();

            renderDialog();

            expect(useSshConfigHostsMock).toHaveBeenLastCalledWith(true);
        });

        it('discards a prefill the user backed out of', () => {
            useSshConfigHostsMock.mockReturnValue(
                sshConfigHostsResult([{ host: ALIAS, user: ALIAS_USER, port: ALIAS_PORT }]),
            );

            renderDialog();

            selectConfigHost(ALIAS);
            expect(screen.getByLabelText(hostLabel)).toHaveValue(ALIAS);

            fireEvent.click(screen.getByRole('button', { name: 'Close' }));

            // The dialog stays mounted while closed, so this reset is the only thing keeping
            // a cancelled prefill from reappearing the next time it opens.
            expect(screen.getByLabelText(hostLabel)).toHaveValue('');
            expect(screen.getByLabelText('Username')).toHaveValue(defaultUsername);
            expect(getPicker().value).toBe(SSH_CONFIG_HOST_CUSTOM);
        });

        it('restores the edited target, not the defaults, when an edit is backed out of', () => {
            useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: ALIAS, user: ALIAS_USER }]));

            renderDialog({ existing: { name: 'saved', host: 'old-host', username: 'carol' } });

            selectConfigHost(ALIAS);
            fireEvent.click(screen.getByRole('button', { name: 'Close' }));

            expect(screen.getByLabelText(hostLabel)).toHaveValue('old-host');
            expect(screen.getByLabelText('Username')).toHaveValue('carol');
        });

        it('discards a passing test result when a config host changes the target', async () => {
            useSshConfigHostsMock.mockReturnValue(
                sshConfigHostsResult([{ host: ALIAS, user: ALIAS_USER, port: ALIAS_PORT }]),
            );
            mockPassingTest();

            renderDialog();

            // Both dialogs gate their save button on the target being complete, so the test has to
            // run against a real one before a prefill can invalidate it. Neither treats the name as
            // part of the target, so filling it in doesn't itself discard the result.
            fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'my lab box' } });
            fireEvent.change(screen.getByLabelText(hostLabel), { target: { value: 'aus-wh-05' } });
            fireEvent.click(getButtonWithText(runTestsLabel));
            await waitFor(() => expect(getButtonWithText(saveLabel)).toBeEnabled());
            expect(screen.getByText(passingTestMessage)).toBeInTheDocument();

            selectConfigHost(ALIAS);

            expect(screen.queryByText(passingTestMessage)).not.toBeInTheDocument();
            expect(screen.getByText(invalidatedTestMessage)).toBeInTheDocument();
            expect(getButtonWithText(saveLabel)).toBeDisabled();
        });

        it('keeps a passing test result when only the name changes', async () => {
            useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: ALIAS, user: ALIAS_USER }]));
            mockPassingTest();

            renderDialog();

            fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'my lab box' } });
            fireEvent.change(screen.getByLabelText(hostLabel), { target: { value: 'aus-wh-05' } });
            fireEvent.click(getButtonWithText(runTestsLabel));
            await waitFor(() => expect(getButtonWithText(saveLabel)).toBeEnabled());

            fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'renamed box' } });

            // The name isn't part of what the test exercised, so discarding the result here would
            // make a rename cost a fresh SSH round-trip before the edit could be saved at all.
            expect(screen.getByText(passingTestMessage)).toBeInTheDocument();
            expect(getButtonWithText(saveLabel)).toBeEnabled();
            expect(screen.getByLabelText('Name')).toHaveValue('renamed box');
        });
    });
};
