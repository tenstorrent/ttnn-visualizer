// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import useAppConfig from './useAppConfig';

export interface RemoteConnection {
    name: string;
    host: string;
    port: number;
    path: string;
}

export enum ConnectionTestStates {
    IDLE,
    PROGRESS,
    FAILED,
    OK,
}

export interface ConnectionStatus {
    status: ConnectionTestStates;
    message: string;
}

export interface RemoteFolder {
    /** Name of the test results folder */
    testName: string;
    /** Remote absolute path to the test results folder */
    remotePath: string;
    /** Local absolute path to the test results folder */
    localPath: string;
    /** Last time the folder was modified on remote */
    lastModified: string;
    /** Last time the folder was synced */
    lastSynced?: string;
}

const useRemoteConnection = () => {
    const { getAppConfig, setAppConfig, deleteAppConfig } = useAppConfig();

    const testConnection = async (connection: Partial<RemoteConnection>) => {
        const connectionStatus: ConnectionStatus = {
            status: ConnectionTestStates.IDLE,
            message: '',
        };

        if (!connection.host || !connection.port) {
            connectionStatus.status = ConnectionTestStates.FAILED;
            connectionStatus.message = 'No connection provided';

            return connectionStatus;
        }

        connectionStatus.status = ConnectionTestStates.PROGRESS;

        // TODO: Replace with real call to API
        const response = await getTestConnection(200);

        if (response.status === 200) {
            connectionStatus.status = ConnectionTestStates.OK;
            connectionStatus.message = 'Connection successful';
        } else {
            connectionStatus.status = ConnectionTestStates.FAILED;
            connectionStatus.message = 'Could not connect to SSH server';

            // TODO: Handle errors more better
            console.error(response?.message ?? 'Unknown error');
        }

        return connectionStatus;
    };

    const testRemoteFolder = async (connection: Partial<RemoteConnection>) => {
        const connectionStatus: ConnectionStatus = {
            status: ConnectionTestStates.IDLE,
            message: '',
        };

        if (!connection.host || !connection.port || !connection.path) {
            connectionStatus.status = ConnectionTestStates.FAILED;
            connectionStatus.message = 'No connection provided';

            return connectionStatus;
        }

        connectionStatus.status = ConnectionTestStates.PROGRESS;

        // TODO: Replace with real call to API
        const response = await getTestConnection(200);

        if (response.status === 200) {
            connectionStatus.status = ConnectionTestStates.OK;
            connectionStatus.message = 'Remote folder path exists';
        } else {
            connectionStatus.status = ConnectionTestStates.FAILED;
            connectionStatus.message = 'Remote folder path does not exist';

            // TODO: Handle errors more better
            console.error(response?.message ?? 'Unknown error');
        }

        return connectionStatus;
    };

    const listRemoteFolders = async (connection?: RemoteConnection) => {
        if (!connection || !connection.host || !connection.port) {
            throw new Error('No connection provided');
        }

        // const remote = await import('@electron/remote');

        // const parseResults = (results: string) =>
        //     results
        //         .split('\n')
        //         .filter((s) => s.length > 0)
        //         .map<RemoteFolder>((folderInfo) => {
        //             const [_createdDate, lastModified, remoteFolderPath] = folderInfo.split(';');
        //             const configDir = remote.app.getPath('userData');
        //             const folderName = path.basename(remoteFolderPath);
        //             const localFolderForRemote = `${connection.name}-${connection.host}${connection.port}`;

        //             return {
        //                 testName: folderName,
        //                 remotePath: remoteFolderPath,
        //                 localPath: path.join(configDir, 'remote-tests', localFolderForRemote, folderName),
        //                 lastModified: new Date(lastModified).toISOString(),
        //             };
        //         });

        /**
         * This command will be executed on the ssh server, and run the foolowing steps:
         * 1. Find all files named `runtime_data.yaml` or `device_desc.yaml` in the remote path
         * 2. Get the directory that contains the files.
         * 3. Remove duplicates
         * 4. For each directory, separated by a `;`, print:
         *   - The creation date (as an ISO timestamp)
         *   - The last modified date (as an ISO timestamp)
         *   - The directory absolute path on the server
         *
         * The output will look like this:
         * ```csv
         * 2000-01-01T00:00:00.000Z;2000-01-01T00:00:00.000Z;/path/to/remote/folder
         * 2000-01-01T00:00:00.000Z;2000-01-01T00:00:00.000Z;/path/to/remote/folder2
         * ```
         */
        // const shellCommand = [
        //     `find -L "${connection.path}" -mindepth 1 -maxdepth 3 -type f \\( -name "runtime_data.yaml" -o -name "device_desc.yaml" \\) -print0`,
        //     'xargs -0 -I{} dirname {}',
        //     'uniq',
        //     `xargs -I{} sh -c "echo \\"\\$(date -d \\"\\$(stat -c %w \\"{}\\")\\" --iso-8601=seconds);\\$(date -d \\"\\$(stat -c %y \\"{}\\")\\" --iso-8601=seconds);$(echo \\"{}\\")\\""`,
        // ].join(' | ');
        // const sshParams = [
        //     ...defaultSshOptions,
        //     connection.host,
        //     '-p',
        //     connection.port.toString(),
        //     `'${shellCommand}'`,
        // ];

        // const stdout = await runShellCommand('ssh', sshParams);

        // return stdout ? parseResults(stdout) : ([] as RemoteFolder[]);
    };

    // const syncRemoteFolder = async (connection?: RemoteConnection, remoteFolder?: RemoteFolder) => {
    //     if (!connection || !connection.host || !connection.port || !connection.path) {
    //         throw new Error('No connection provided');
    //     }

    //     if (!remoteFolder) {
    //         throw new Error('No remote folder provided');
    //     }

    //     if (!existsSync(remoteFolder.localPath)) {
    //         await mkdir(remoteFolder.localPath, { recursive: true });
    //     }

    //     // const sourcePath = `${connection.host}:${escapeWhitespace(remoteFolder.remotePath)}`;
    //     // const baseOptions = ['-az', '-e', `'ssh -p ${connection.port.toString()}'`];
    //     // const pathOptions = [
    //     //     '--delete',
    //     //     `'${sourcePath}'`,
    //     //     escapeWhitespace(remoteFolder.localPath.replace(remoteFolder.testName, '')),
    //     // ];

    //     try {
    //         /**
    //          * First try running with the `-s` option.
    //          * This option handles the case where the file path has spaces in it.
    //          * This option is not supported on Mac, so if it fails, we will try again without it.
    //          *
    //          * See: https://linux.die.net/man/1/rsync#:~:text=receiving%20host%27s%20charset.-,%2Ds%2C%20%2D%2Dprotect%2Dargs,-This%20option%20sends
    //          */
    //         // TODO: review the need for the `-s` option
    //         // await runShellCommand('rsync', ['-s', ...baseOptions, ...pathOptions]);
    //     } catch (err: any) {
    //         console.info(
    //             `Initial RSYNC attempt failed: ${(err as Error)?.message ?? err?.toString() ?? 'Unknown error'}`,
    //         );

    //         /**
    //          * If the `-s` option fails, try running without it.
    //          * On Mac, this will work as expected.
    //          */
    //         // await runShellCommand('rsync', [...baseOptions, ...pathOptions]);
    //     }
    // };

    const persistentState = {
        get savedConnectionList() {
            return JSON.parse(getAppConfig('remoteConnections') ?? '[]') as RemoteConnection[];
        },
        set savedConnectionList(connections: RemoteConnection[]) {
            setAppConfig('remoteConnections', JSON.stringify(connections));
        },
        get selectedConnection() {
            const savedSelectedConnection = JSON.parse(getAppConfig('selectedConnection') ?? 'null');

            return (savedSelectedConnection ?? this.savedConnectionList[0]) as RemoteConnection | undefined;
        },
        set selectedConnection(connection: RemoteConnection | undefined) {
            setAppConfig('selectedConnection', JSON.stringify(connection ?? null));
        },
        getSavedRemoteFolders: (connection?: RemoteConnection) => {
            return JSON.parse(getAppConfig(`${connection?.name}-remoteFolders`) ?? '[]') as RemoteFolder[];
        },
        setSavedRemoteFolders: (connection: RemoteConnection | undefined, folders: RemoteFolder[]) => {
            setAppConfig(`${connection?.name}-remoteFolders`, JSON.stringify(folders));
        },
        updateSavedRemoteFoldersConnection(oldConnection?: RemoteConnection, newConnection?: RemoteConnection) {
            const folders = this.getSavedRemoteFolders(oldConnection);

            this.deleteSavedRemoteFolders(oldConnection);
            this.setSavedRemoteFolders(newConnection, folders);
        },
        deleteSavedRemoteFolders: (connection?: RemoteConnection) => {
            deleteAppConfig(`${connection?.name}-remoteFolders`);
        },
    };

    return {
        testConnection,
        testRemoteFolder,
        // syncRemoteFolder,
        listRemoteFolders,
        persistentState,
    };
};

// Delay is a function for development so we can simulate async calls
// eslint-disable-next-line compat/compat, no-promise-executor-return
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const getTestConnection = async (status: number) => {
    await delay(1000);

    return {
        status,
        message: '',
    };
};

export default useRemoteConnection;
