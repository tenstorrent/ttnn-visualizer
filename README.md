<div align="center">

<h1 style="color: #FA512E;"> TTNN Visualizer </h1>

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./src/assets/tt-logo-dark.svg">
  <img alt="" src="./src/assets/tt-logo.svg">
</picture>
</div>

<h2 style="text-align: center">

[Buy hardware](https://tenstorrent.com/cards/) | [Install TT-NN](https://github.com/tenstorrent/tt-metal/blob/main/INSTALLING.md) | [Discord](https://discord.gg/tvhGzHQwaj) | [Join Us](https://boards.greenhouse.io/tenstorrent/jobs/4155609007)

</h2>

</div>

### A tool for visualizing the Tenstorrent Neural Network (TTNN) model.

<!-- TOC start -->

- [Remote Querying ](#remote-querying)
    * [Installing SQLite 3.38 on Ubuntu 18.04 and 20.04](#installing-sqlite-338-on-ubuntu-1804-and-2004)
    * [Option 1: Install from Official Repository](#option-1-install-from-official-repository)
    * [Option 2: Downloading SQLite Binary on a Remote Linux Machine](#option-2-downloading-sqlite-binary-on-a-remote-linux-machine)
    * [Option 3: Build from Source (If Official Repository Version Is Outdated)](#option-3-build-from-source-if-official-repository-version-is-outdated)
- [Contributing](#contributing)
   * [React + TypeScript + Vite {#react-typescript-vite}](#react-typescript-vite-react-typescript-vite)
   * [Expanding the ESLint configuration](#expanding-the-eslint-configuration)
   * [Environment](#environment)
   * [Frontend](#frontend)
   * [Backend](#backend)
   * [Development](#development)
      + [Fix for python random errors not finding modules](#fix-for-python-random-errors-not-finding-modules)
      + [Fix for missing distutils package](#fix-for-missing-distutils-package)
   * [Docker](#docker)
      + [Running project](#running-project)

<!-- TOC end -->


<!-- TOC --><a name="remote-querying"></a>
## Remote Querying

**REQUIREMENTS**

```
glibc=>2.28.0 (`ldd --version`)
sqlite3=>3.38.0 (`sqlite3 --version`)
```



If your machine already has SQLite3 installed you can simply use the path provided by the command `which sqlite3`.

If you do not have SQLite3  installed you can download the SQLite3 binary, extract it and use the path. For instance:

`/home/user/bin/sqlite3`

<!-- TOC --><a name="installing-sqlite-338-on-ubuntu-1804-and-2004"></a>
#### Installing SQLite 3.38 on Ubuntu 18.04 and 20.04

This guide provides two methods for installing SQLite 3.38 on Ubuntu 18.04 and 20.04, depending on the version available in the official repository.

---

<!-- TOC --><a name="option-1-install-from-official-repository"></a>
#### Option 1: Install from Official Repository

1. **Update the Package List**
   Update your system’s package list to check for the latest versions.

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

---


<!-- TOC --><a name="option-2-downloading-sqlite-binary-on-a-remote-linux-machine"></a>
#### Option 2: Downloading SQLite Binary on a Remote Linux Machine

This guide provides instructions for downloading the SQLite binary on a remote Linux machine. The instructions include determining your operating system architecture and using `wget` or `curl` to download the appropriate binary.

<!-- TOC --><a name="step-1-determine-system-architecture"></a>
##### Step 1: Determine System Architecture

First, determine the architecture of your Linux system. This is important to ensure you download the correct SQLite binary.

```bash
uname -m
```

- `x86_64` indicates a 64-bit architecture.
- `i386` or `i686` indicates a 32-bit architecture.
- `aarch64` indicates a 64-bit ARM architecture.

<!-- TOC --><a name="step-2-download-the-sqlite-binary"></a>
#### Step 2: Download the SQLite Binary

Visit the [SQLite Download Page](https://sqlite.org/download.html) to find the latest version. Copy the link for the appropriate precompiled binary for your architecture.

<!-- TOC --><a name="example-download-using-wget"></a>
##### Example Download Using `wget`

Replace `<url>` with the URL of the SQLite binary (for instance https://sqlite.org/2024/sqlite-tools-linux-x64-3470000.zip):

```bash
wget <url> -O sqlite3.tar.gz
```

<!-- TOC --><a name="example-download-using-curl"></a>
##### Example Download Using `curl`

Replace `<url>` with the URL of the SQLite binary:

```bash
curl -o sqlite3.tar.gz <url>
```

<!-- TOC --><a name="step-3-extract-the-sqlite-binary"></a>
##### Step 3: Extract the SQLite Binary

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

<!-- TOC --><a name="step-4-verify-the-installation"></a>
##### Step 4: Verify the Installation

After the binary is moved and made executable, verify that SQLite is properly installed:

```bash
sqlite3 --version
```

This command should output the version of SQLite, confirming the installation was successful.



<!-- TOC --><a name="troubleshooting"></a>
##### Troubleshooting

- If `wget` or `curl` is not installed, you can install them using your system's package manager (e.g., `sudo apt-get install wget` for Debian-based systems). If you do not have `sudo` permissions, consider asking your system administrator.
- Ensure that the `~/bin` directory is included in your `PATH` by running:

  ```bash
  echo $PATH
  ```

- If `sqlite3` is not found, ensure you have reloaded your `.bashrc` file with `source ~/.bashrc`.


<!-- TOC --><a name="option-3-build-from-source-if-official-repository-version-is-outdated"></a>
#### Option 3: Build from Source (If Official Repository Version Is Outdated)

If your system’s `apt-get` package does not include SQLite 3.38 or later, follow these steps to install it from source.

<!-- TOC --><a name="step-1-update-and-install-build-dependencies"></a>
##### Step 1: Update and Install Build Dependencies

```bash
sudo apt-get update
sudo apt-get install -y build-essential wget libreadline-dev
```

<!-- TOC --><a name="step-2-download-sqlite-338-source-code"></a>
##### Step 2: Download SQLite 3.38 Source Code

1. **Navigate to a Download Directory**
   Move to a directory where you’d like to download the source code.

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

<!-- TOC --><a name="step-3-compile-and-install-sqlite"></a>
##### Step 3: Compile and Install SQLite

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

<!-- TOC --><a name="step-4-verify-the-installed-version"></a>
##### Step 4: Verify the Installed Version

Finally, confirm the installation of SQLite 3.38.

```bash
sqlite3 --version
```

You should now have SQLite 3.38 installed on your system.




<!-- TOC --><a name="contributing"></a>
## Contributing

<!-- TOC --><a name="react-typescript-vite-react-typescript-vite"></a>
### React + TypeScript + Vite {#react-typescript-vite}

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md)
  uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast
  Refresh

<!-- TOC --><a name="expanding-the-eslint-configuration"></a>
### Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type aware lint rules:

- Configure the top-level `parserOptions` property like this:

```js
export default {
    // other rules...
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: ['./tsconfig.json', './tsconfig.node.json'],
        tsconfigRootDir: __dirname,
    },
}
```

- Replace `plugin:@typescript-eslint/recommended` to `plugin:@typescript-eslint/recommended-type-checked`
  or `plugin:@typescript-eslint/strict-type-checked`
- Optionally add `plugin:@typescript-eslint/stylistic-type-checked`
- Install [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react) and
  add `plugin:react/recommended` & `plugin:react/jsx-runtime` to the `extends` list

<!-- TOC --><a name="environment"></a>
### Environment

Copy the provided `.env.sample` file to `.env` and change any necessary options. See the section on options
for more details on the available configuration options.

<!-- TOC --><a name="frontend"></a>
### Frontend

```shell
nvm use
npm install
npm run dev
```

<!-- TOC --><a name="backend"></a>
### Backend

create env

```shell
python3 -m venv myenv
```

activate env

```shell
source myenv/bin/activate
```

install requirements

```shell
pip install -r backend/ttnn_visualizer/requirements.txt
```

Starting the server

```shell
npm run flask:start
```

Starting with hot reload:

``` shell
npm run flask:start-debug
```

access on localhost:8000/

<!-- TOC --><a name="development"></a>
### Development

Copy report contents to `backend/data/active` - IE - `backend/data/active/db.sqlite`

<!-- TOC --><a name="fix-for-python-random-errors-not-finding-modules"></a>
#### Fix for python random errors not finding modules

```shell
deactivate
rm -rf myenv
```

Then follow steps for creating virtual environment and reinstalling dependencies

<!-- TOC --><a name="fix-for-missing-distutils-package"></a>
#### Fix for missing distutils package

With the virtualenv activated run:

```shell
pip install --upgrade setuptools
```

<!-- TOC --><a name="docker"></a>
### Docker

<!-- TOC --><a name="running-project"></a>
#### Running project

To run the application you can simply run `docker-compose up web`. To rebuild add the build flag, `docker-compose up web --build`.

To use the [provided SSH container](./docker/SSH/README.md) with the compose configuration you can substitute `web` in the above commands for `ssh`. To run the container in the background use `docker-compose up ssh -d`

To connect to this container through the remote connection manager you use the name of the service (`ssh`) as the 'host' and the default SSH port 22.
