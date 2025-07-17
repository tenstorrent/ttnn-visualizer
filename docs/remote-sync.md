# Remote Sync

TT-NN Visualizer supports syncing data from remote servers via SSH. This feature downloads files from the remote server to your local machine using SSH/SFTP, allowing you to work with them as if they were generated locally.

## SSH Setup

### Prerequisites
**Important**: Remote sync requires SSH key-based authentication. Password authentication is not supported.

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

#### 4. Troubleshooting SSH Key Issues

If you encounter a 'no keys found' error:

<img width="492" alt="Screenshot 2025-01-30 at 1 55 10 PM" src="https://github.com/user-attachments/assets/3f7f9983-f92d-4900-9321-9d46c6355c36" />

Check your local ssh agent has your ssh key by running:

```shell
ssh-add -L
```

If your key isn't present, run the following on your local machine:

```shell
ssh-add
```

## How Remote Sync Works

Remote sync downloads files from the remote server to your local machine using SSH/SFTP. This is the default behavior when connecting to a remote server in TT-NN Visualizer.

**Benefits of remote sync:**
- Work with files locally after downloading for faster access
- Ability to work offline after the initial sync
- Full access to all file data and features
- No additional server-side requirements

The sync process will transfer all necessary files from the remote directories to your local machine, allowing you to work with them as if they were generated locally.

## Using Remote Sync

To use remote sync you must first add the SSH connection details, and sync the individual reports you would like to use.

### Add SSH Connection

1. Open TT-NN Visualizer and navigate to the Reports tab
2. In the "Remote Sync" section, click the "+ Add New Connection" button
3. Enter your SSH connection details (hostname, username, and report paths)
4. Click the "Test Connection" button to ensure a connection can be made
5. If connection is valid, click the "Add connection" button to save the connection details

Make sure you have sufficient local storage space for the files you want to sync.

### Sync Folders

After saving the SSH connection details, you must fetch the list of remote folders. Any memory and performance reports that were found at the provided report paths will appear in the respective dropdowns. Choose which
report you would like to sync, and press the sync button beside the dropdown to perform the sync.
