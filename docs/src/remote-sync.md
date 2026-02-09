# Remote Sync

TT-NN Visualizer supports syncing data from remote servers via SSH. This feature downloads files from the remote server to your local machine using SSH/SFTP, allowing you to work with them as if they were generated locally.

## Benefits of remote sync
- Work with files locally after downloading for faster access
- Ability to work offline after the initial sync
- Full access to all file data and features
- No additional server-side requirements
- Ability to easily re-sync updated files

## SSH Setup

### Prerequisites
**Important:** Remote sync requires SSH key-based authentication. Password authentication is not supported.

Before using remote sync, ensure that:
1. Your SSH public key is added to the `~/.ssh/authorized_keys` file on the remote server
2. You can successfully connect to the remote server using SSH without a password prompt
3. Your SSH agent is running and has your private key loaded (if using a passphrase-protected key)

To test SSH key authentication:
```bash
ssh username@hostname
```

If you're prompted for a password, SSH key authentication is not properly configured.

### Setting Up SSH Key Authentication

If you haven't set up SSH key authentication yet, follow these steps:

#### 1. Generate SSH Key Pair (if you don't have one)
```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
```

#### 2. Copy Public Key to Remote Server
```bash
ssh-copy-id username@hostname
```

#### 3. Verify SSH Key Authentication
```bash
ssh username@hostname
```

You should be able to connect without entering a password.

## Using Remote Sync

To use remote sync you must first add the SSH connection details, set the remote report paths, and
sync the individual reports you would like to use.

### Add SSH Connection

1. Open TT-NN Visualizer and navigate to the Reports tab
2. In the "Remote Sync" section, click the "+ Add New Connection" button
3. Enter your SSH connection details (hostname, username, and report paths)
4. Optionally specify an **SSH identity file** (path to your private key, e.g. `~/.ssh/id_ed25519`) if you use a non-default key or have multiple keys.
5. Click the "Test Connection" button to ensure a connection can be made
6. If connection is valid, click the "Add connection" button to save the connection details

If authentication fails, the app will show a message explaining that key-based authentication is required: add your public key to `~/.ssh/authorized_keys` on the remote server. Password authentication is not supported. If your key has a passphrase, add it to ssh-agent once (e.g. `ssh-add ~/.ssh/id_ed25519`) so you are not prompted.

Make sure you have sufficient local storage space for the files you want to sync.

### Report Paths

When adding the SSH connection, you must specify a _Memory report folder path_. This is either a
folder outside of tt-metal where you have stored reports, or you can point it directly to the
`generated` directory in `tt-metal`. If syncing directly from the generated directory, point
it to the `generated/ttnn/reports/` directory: `/home/username/tt-metal/generated/ttnn/reports/`.

You may optionally specify a _Performance report folder path_. As with memory reports, this can
either be any folder on the remote machine where you have a sub-folders with reports you have
stored there yourself, or you can point it at the generated directory in `tt-metal`:
`/home/username/tt-metal/generated/profiler/reports/`.


### Sync Folders

After saving the SSH connection details, you must fetch the list of remote folders. Any memory
and performance reports that were found at the provided report paths will appear in the respective
dropdowns. Choose which report you would like to sync, and press the sync button beside the
dropdown to perform the sync.

### Troubleshooting

See our [troubleshooting](./troubleshooting.md) section for some known issues and solutions.