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
 *
 * Prefilling *an edit* is one of those: only the MLIR dialog offers the picker for a target it
 * already has values for, so what the picker reads as when a saved host matches an alias is
 * asserted in its spec, and the remote dialog's spec asserts the picker's absence instead.
 */

import { RenderResult, fireEvent, screen, waitFor } from '@testing-library/react';
import { Mock, describe, expect, it } from 'vitest';
import {
    SSH_CONFIG_HOST_CUSTOM,
    SSH_CONFIG_HOST_LABEL,
    SSH_CONFIG_HOST_UNSELECTED,
} from '../../src/definitions/SshConfigHostPicker';
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

/**
 * A new connection opens on neither an alias nor Custom, and the remote dialog shows nothing
 * but the picker until that changes. Tests that start from the form rather than from a prefill
 * make the same choice a user would; the MLIR dialog, which shows its form throughout, is
 * unaffected by choosing it.
 */
const chooseAddNewConnection = () => selectConfigHost(SSH_CONFIG_HOST_CUSTOM);

export const describeSshConfigPrefillContract = (
    dialogName: string,
    {
        renderDialog,
        hostLabel,
        sshPortLabel,
        runTestsLabel,
        saveLabel,
        passingTestMessage,
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

            chooseAddNewConnection();
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

            // A dialog that waits on a host choice has to ask about the config from outside the
            // body Blueprint unmounts, so the hook being called at all no longer says anything.
            // Passing enabled={open} is what keeps a closed dialog from reading ~/.ssh/config.
            expect(useSshConfigHostsMock).not.toHaveBeenCalledWith(true);
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
            expect(getPicker().value).toBe(SSH_CONFIG_HOST_UNSELECTED);

            chooseAddNewConnection();

            expect(screen.getByLabelText(hostLabel)).toHaveValue('');
            expect(screen.getByLabelText('Username')).toHaveValue(defaultUsername);
        });

        it('restores the edited target, not the defaults, when an edit is backed out of', () => {
            useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: ALIAS, user: ALIAS_USER }]));

            renderDialog({ existing: { name: 'saved', host: 'old-host', username: 'carol' } });

            fireEvent.change(screen.getByLabelText(hostLabel), { target: { value: 'typed-host' } });
            fireEvent.click(screen.getByRole('button', { name: 'Close' }));

            expect(screen.getByLabelText(hostLabel)).toHaveValue('old-host');
            expect(screen.getByLabelText('Username')).toHaveValue('carol');
        });

        it('stops a passing test result gating the save when a config host changes the target', async () => {
            useSshConfigHostsMock.mockReturnValue(
                sshConfigHostsResult([{ host: ALIAS, user: ALIAS_USER, port: ALIAS_PORT }]),
            );
            mockPassingTest();

            renderDialog();

            // Both dialogs gate their save button on the target being complete, so the test has to
            // run against a real one before a prefill can invalidate it. Neither treats the name as
            // part of the target, so filling it in doesn't itself discard the result.
            chooseAddNewConnection();
            fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'my lab box' } });
            fireEvent.change(screen.getByLabelText(hostLabel), { target: { value: 'aus-wh-05' } });
            fireEvent.click(getButtonWithText(runTestsLabel));
            await waitFor(() => expect(getButtonWithText(saveLabel)).toBeEnabled());
            expect(screen.getByText(passingTestMessage)).toBeInTheDocument();

            selectConfigHost(ALIAS);

            // What each dialog does with the now-untested result is its own concern:
            // the remote dialog keeps it on screen marked stale, the MLIR one drops
            // it for a prompt. Both must stop it gating the save.
            expect(getButtonWithText(saveLabel)).toBeDisabled();
        });

        it('keeps a passing test result when only the name changes', async () => {
            useSshConfigHostsMock.mockReturnValue(sshConfigHostsResult([{ host: ALIAS, user: ALIAS_USER }]));
            mockPassingTest();

            renderDialog();

            chooseAddNewConnection();
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
