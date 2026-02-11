# Remote Sync

TT-NN Visualizer supports syncing data from remote servers via SSH. This feature downloads files from the remote server to your local machine using SSH/SFTP, allowing you to work with them as if they were generated locally.

## Benefits of remote sync
- Work with files locally after downloading for faster access
- Ability to work offline after the initial sync
- Full access to all file data and features
- No additional server-side requirements
- Ability to easily re-sync updated files

## SSH Setup

### How SSH key authentication works (overview)

Remote sync uses SSH key-based authentication only. The app never asks for a password or passphrase in the UI, and the underlying SSH commands are run in a way that prevents the terminal from prompting you. You must set things up so that the key is usable without interaction.

The pieces:
1. Key pair – You have a private key (e.g. `~/.ssh/id_ed25519`) and a public key (e.g. `~/.ssh/id_ed25519.pub`). The private key stays on your machine; the public key is what the server trusts.

2. Server – On the remote host, your public key must be in the right place: one line per key in `~/.ssh/authorized_keys` for the user you connect as (e.g. `ctr-smountenay@aus-wh-05` → that user’s `~/.ssh/authorized_keys` on the server).

3. Identity file – The “SSH identity file” in the app is the path to your private key on your machine. If you leave it empty, SSH uses its default (e.g. `~/.ssh/id_ed25519`). If you use a different key or path, enter it here (e.g. `~/.ssh/id_ed25519` or `/Users/you/break_id_ed25519_test`). When you set a custom identity, the app tells SSH to use only that key (and to ignore `~/.ssh/config` for that connection) so the right key is used.

4. Passphrase – If your private key has a passphrase, SSH would normally prompt for it. The app does not have a place to type that, and the SSH process has no terminal. So you must unlock the key once using ssh-agent; after that, the agent provides the key and no prompt is needed:
   ```bash
   ssh-add ~/.ssh/id_ed25519
   ```
   (Use the same path as your identity file.) Enter the passphrase once; then the app (and any `ssh` that uses that agent) can use the key without prompting. If the app is started from a terminal, run `ssh-add` in that same terminal before starting the app so the agent is available.

Quick checklist before using remote sync:
- [ ] Public key is in `~/.ssh/authorized_keys` on the remote server (for the user you connect as).
- [ ] You can log in from a terminal without a password: `ssh username@hostname` (or `ssh -i /path/to/key username@hostname` if you use a non-default key).
- [ ] If the key has a passphrase: you’ve run `ssh-add /path/to/private_key` in an environment the app can use (e.g. the same terminal where you start the app), so the agent holds the unlocked key.

### Prerequisites

Important: Remote sync requires SSH key-based authentication. Password authentication is not supported.

Before using remote sync, ensure that:

1. Your SSH public key is in the `~/.ssh/authorized_keys` file on the remote server (for the username you use in the app).
2. You can connect from a terminal without a password (and without a passphrase prompt if you use ssh-agent).
3. If your key has a passphrase: the key is loaded in ssh-agent (e.g. `ssh-add /path/to/key`) in the same environment you use to start the app.

To test from a terminal (use the same host and user as in the app):

```bash
ssh username@hostname
# Or, if you use a custom key:
ssh -i /path/to/your_private_key username@hostname
```

If you’re prompted for a password, the public key is not correctly set up on the server. If you’re prompted for a passphrase, use `ssh-add` as above.

### Setting up SSH key authentication (first time)

If you don’t have a key yet or haven’t set up the server:

#### 1. Generate a key pair (if you don’t have one)
```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
```

#### 2. Put your public key on the remote server
```bash
ssh-copy-id username@hostname
```
This appends your public key to `~/.ssh/authorized_keys` on the server. If you use a non-default key:
```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub username@hostname
```

#### 3. If the key has a passphrase: load it into ssh-agent (so the app can use it)
```bash
ssh-add ~/.ssh/id_ed25519
```
Use the path to your private key. Enter the passphrase once; after that, the agent provides the key and you won’t be prompted when using the app (as long as the app runs in an environment that has access to the same agent, e.g. started from the same terminal).

#### 4. Verify from a terminal
```bash
ssh username@hostname
```
You should get a shell without being asked for a password (or passphrase, if you used ssh-add).

### For developers: why the app never prompts

The app runs `ssh`/`sftp` via subprocess with no TTY and with `BatchMode=yes`, so the SSH client never prompts for a password or passphrase. If key-based auth isn’t already satisfied (e.g. key in ssh-agent), the connection fails and the app shows an error. When the user sets a custom identity file, the app also passes `-F /dev/null` for that run so SSH does not read `~/.ssh/config`; that way a catch-all `IdentityFile` in config (e.g. `Host * IdentityFile ~/.ssh/id_ed25519`) doesn’t override or conflict with the key the user chose in the UI.

## Using Remote Sync

To use remote sync you must first add the SSH connection details, set the remote report paths, and
sync the individual reports you would like to use.

### Add SSH Connection

1. Open TT-NN Visualizer and navigate to the Reports tab.
2. In the "Remote Sync" section, click "+ Add New Connection".
3. Enter your SSH connection details (hostname, username, and report paths).
4. SSH identity file (optional): Path to your private key on this machine (e.g. `~/.ssh/id_ed25519` or `/Users/you/break_id_ed25519_test`). Leave empty to use SSH’s default. Use this if you have multiple keys or the key is not in the default location. When set, the app uses only this key and ignores `~/.ssh/config` for this connection.
5. Passphrase: The app never prompts for a passphrase. If your key has one, run `ssh-add /path/to/your_private_key` once (in the same terminal you use to start the app, or in an environment the app can see), then start the app.
6. Click "Test Connection". If it succeeds, click "Add connection".

If authentication fails, the app will show a short message. Common causes: public key not in `~/.ssh/authorized_keys` on the server; wrong identity file path; or key has a passphrase and is not in ssh-agent (run `ssh-add` and restart the app from that environment). See [How SSH key authentication works](#how-ssh-key-authentication-works-overview) above for the full picture.

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