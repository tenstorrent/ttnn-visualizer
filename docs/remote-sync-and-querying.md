# Remote Sync and Querying

TT-NN Visualizer supports two methods for working with remote data via SSH:

1. **Remote Sync**: Downloads files from the remote server to your local machine using SSH/SFTP
2. **Remote Querying**: Queries data directly on the remote server without downloading files locally

Both features require SSH key-based authentication.

## SSH Setup (Required for Both Features)

### Prerequisites
**Important**: Both remote sync and remote querying require SSH key-based authentication. Password authentication is not supported.

Before using either remote feature, ensure that:
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

## Remote Sync

Remote sync downloads files from the remote server to your local machine using SSH/SFTP. This is the default behavior when connecting to a remote server.

**Use remote sync when:**
- You want to work with files locally after downloading
- You have sufficient local storage space
- You prefer faster access to data once downloaded
- You want to work offline after the initial sync

The sync process will transfer all necessary files from the remote directories to your local machine, allowing you to work with them as if they were generated locally.

## Remote Querying

Remote querying allows you to analyze data directly on the remote server without downloading files to your local machine. This feature requires additional setup on the remote server.

**Use remote querying when:**
- You want to minimize local storage usage
- Files are very large and you only need to query specific data
- You want to avoid the time required for file transfers
- The remote server has sufficient resources for query processing

### Additional Requirements for Remote Querying

Remote querying requires SQLite3 to be installed on the **remote server** with the following minimum versions:

```
glibc>=2.28.0 (check with: ldd --version)
sqlite3>=3.38.0 (check with: sqlite3 --version)
```

If your machine already has SQLite3 installed you can simply use the path provided by the command `which sqlite3`.

If you do not have SQLite3 installed you can download the SQLite3 binary, extract it and use the path. For instance:

`/home/user/bin/sqlite3`

## Installing SQLite 3.38 on Ubuntu 18.04 and 20.04

This guide provides methods for installing SQLite 3.38 on Ubuntu 18.04 and 20.04, which is required for remote querying functionality.

### Option 1: Install from Official Repository

1. **Update the Package List**
   Update your system's package list to check for the latest versions.

   ```bash
   sudo apt-get update
   ```

2. **Install SQLite**
   Install the latest version of SQLite available in the repository.

   ```bash
   sudo apt-get install -y sqlite3
   ```

3. **Verify the Installed Version**
   Confirm the installed version of SQLite meets the 3.38 requirement.

   ```bash
   sqlite3 --version
   ```

   - **If the installed version is 3.38 or higher**, your setup is complete.
   - **If the installed version is older than 3.38**, proceed to Option 2 to download a pre-compiled binary or Option 3 to build from source.

### Option 2: Downloading SQLite Binary on a Remote Linux Machine

This guide provides instructions for downloading the SQLite binary on a remote Linux machine.

#### Step 1: Determine System Architecture

First, determine the architecture of your Linux system.

```bash
uname -m
```

- `x86_64` indicates a 64-bit architecture.
- `i386` or `i686` indicates a 32-bit architecture.
- `aarch64` indicates a 64-bit ARM architecture.

#### Step 2: Download the SQLite Binary

Visit the [SQLite Download Page](https://sqlite.org/download.html) to find the latest version. Copy the link for the appropriate precompiled binary for your architecture.

##### Example Download Using `wget`

Replace `<url>` with the URL of the SQLite binary, e.g. <https://sqlite.org/2024/sqlite-tools-linux-x64-3470000.zip>

```bash
wget <url> -O sqlite3.tar.gz
```

##### Example Download Using `curl`

Replace `<url>` with the URL of the SQLite binary:

```bash
curl -o sqlite3.tar.gz <url>
```

#### Step 3: Extract the SQLite Binary

Once downloaded, extract the binary:

```bash
tar -xzf sqlite3.tar.gz
```

This will create a folder with the SQLite binary inside. You can move it to a directory in your home folder to avoid needing root permissions:

```bash
mv sqlite3 ~/bin/
```

Make sure the `bin` directory exists and add it to your `PATH` if not already done:

```bash
mkdir -p ~/bin
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

#### Step 4: Verify the Installation

After the binary is moved and made executable, verify that SQLite is properly installed:

```bash
sqlite3 --version
```

This command should output the version of SQLite, confirming the installation was successful.

#### Troubleshooting

- If `wget` or `curl` is not installed, you can install them using your system's package manager (e.g., `sudo apt-get install wget` for Debian-based systems). If you do not have `sudo` permissions, consider asking your system administrator.
- Ensure that the `~/bin` directory is included in your `PATH` by running:

  ```bash
  echo $PATH
  ```

- If `sqlite3` is not found, ensure you have reloaded your `.bashrc` file with `source ~/.bashrc`.

### Option 3: Build from Source (If Official Repository Version Is Outdated)

If your system's `apt-get` package does not include SQLite 3.38 or later, follow these steps to install it from source.

#### Step 1: Update and Install Build Dependencies

```bash
sudo apt-get update
sudo apt-get install -y build-essential wget libreadline-dev
```

#### Step 2: Download SQLite 3.38 Source Code

1. **Navigate to a Download Directory**
   Move to a directory where you'd like to download the source code.

   ```bash
   cd /tmp
   ```

2. **Download the SQLite 3.38 Source Code**
   Fetch the source code for SQLite 3.38.

   ```bash
   wget https://www.sqlite.org/2022/sqlite-autoconf-3380000.tar.gz
   ```

3. **Extract the Tar File**
   Unpack the downloaded source archive.

   ```bash
   tar -xzf sqlite-autoconf-3380000.tar.gz
   cd sqlite-autoconf-3380000
   ```

#### Step 3: Compile and Install SQLite

1. **Configure the Build**
   Prepare the build environment.

   ```bash
   ./configure --prefix=/usr/local
   ```

2. **Compile SQLite**
   Build SQLite from the source code.

   ```bash
   make
   ```

3. **Install SQLite**
   Install the compiled program.

   ```bash
   sudo make install
   ```

#### Step 4: Verify the Installed Version

Finally, confirm the installation of SQLite 3.38.

```bash
sqlite3 --version
```

You should now have SQLite 3.38 installed on your system. 