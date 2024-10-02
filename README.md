# TTNN Visualizer 

A tool for visualizing the Tenstorrent Neural Network (TTNN) model.

## Running Application

### Downloading Docker Image

Before executing the command below please see the note on SSH agent configuration.

In order to pull the image from ghcr.io you need to create an authentication token that allows you to "read:packages".
To create and use the token follow the instructions found [here](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-with-a-personal-access-token-classic) .

After following the instructions above you should be able to pull the image by running the following command:

`docker pull ghcr.io/tenstorrent/ttnn-visualizer:latest`

Other image versions can be found [here](https://github.com/tenstorrent/ttnn-visualizer/).

#### Running Image

The following commands will run the docker image on your machine. See the docker-compose configuration section for a 
description of the run options. 

*Note*: Docker Desktop for MacOS does not currently forward the ssh-agent. To run the container with a forwarded ssh-agent
add your keys to the agent using `ssh-add` before running the docker run command in your terminal.

*MacOS Run Command*

`docker run -p 8000:8000 -e SSH_AUTH_SOCK=/ssh-agent -v ./data:/app/backend/data -v /run/host-services/ssh-auth.sock:/ssh-agent ghcr.io/tenstorrent/ttnn-visualizer:latest`

*Linux Run Command*

`docker run -p 8000:8000 -e SSH_AUTH_SOCK=/ssh-agent -v ./data:/app/backend/data -v $SSH_AUTH_SOCK:/ssh-agent ghcr.io/tenstorrent/ttnn-visualizer:latest`

Or using docker compose:

``` YAML
services:
  web:
    image: ghcr.io/tenstorrent/ttnn-visualizer:latest
    # Local port to host the application. Application 
    # will be available on `http://localhost:PORT`
    ports:
      - 8000:8000
    # If using a VPN to connect to remote machines remove ports
    # and use the host network
    # network: host
    environment:
      - SSH_AUTH_SOCK=/ssh-agent
    volumes:
      # Directory/volume for stored report data
      - ./data:/app/backend/data
      # Linux configuration
      # - ${SSH_AUTH_SOCK}:/ssh-agent
      # MacOS configuration
      - /run/host-services/ssh-auth.sock:/ssh-agent

```

### SSH

To avoid exposing private keys in the docker image an ssh-agent is required to be running on the host machine. The agent
socket is then mounted to the guest container. For instructions on setting up your ssh-agent
see [this article](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent?platform=windows#adding-your-ssh-key-to-the-ssh-agent)

Ensure that you are able to connect to the remote machine in question using your local ssh-agent (or the ssh-agent of the remote machine).

To view your currently available keys, `ssh-add -L`.

The docker-compose file should expand the parameter for your agent socket - you can confirm/see this value by entering `echo $SSH_AUTH_SOCK`.
The printed value should be the location of your SSH agent socket.

For MacOS you need to use the 'magic' socket file. The docker-compose.yml file has a volume mapping that points to this magic file, ensure that it is being used rather than `SSH_AUTH_SOCK`.

Before running the application ensure that your keys are added to the agent (`ssh-add -L`). If your keys are not present, run `ssh-add` to add them.

# Contributing

## React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md)
  uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast
  Refresh

## Expanding the ESLint configuration

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
  
## Environment 

Copy the provided `.env.sample` file to `.env` and change any necessary options. See the section on options 
for more details on the available configuration options.

## Frontend

```shell
nvm use
npm install
npm run dev
```

## Backend

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

## Development

Copy report contents to `backend/data/active` - IE - `backend/data/active/db.sqlite`

### Fix for python random errors not finding modules:

```shell
deactivate
rm -rf myenv
```

Then follow steps for creating virtual environment and reinstalling dependencies

### Fix for missing distutils package

With the virtualenv activated run:

```shell
pip install --upgrade setuptools
```

## Docker

### Running project

To run the application you can simply run `docker-compose up web`. To rebuild add the build flag, `docker-compose up web --build`.

To use the [provided SSH container](./docker/SSH/README.md) with the compose configuration you can substitute `web` in the above commands for `ssh`. To run the container in the background use `docker-compose up ssh -d`

To connect to this container through the remote connection manager you use the name of the service (`ssh`) as the 'host' and the default SSH port 22.

### Installing as Wheel

Download the wheel file from the [releases page](https://github.com/tenstorrent/ttnn-visualizer/releases) and install using `pip install release_name.whl`. After installation
simply run `ttnn-visualizer` to start the application.

