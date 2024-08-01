# React + TypeScript + Vite

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
pip install -r requirements.txt
```

run server

```shell
npm run start-flask
```

access on localhost:8000/

## Development

Copy report contents to `backend/data/active` - IE - `backend/data/active/db.sqlite`

### !fix for python random errors not finding modules:

```shell
deactivate
rm -rf myenv
```

then follow steps for creating virtual environment and reinstalling dependencies

## Docker

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

### Running project

To run the application you can simply run `docker-compose up web`. To rebuild add the build flag, `docker-compose up web --build`. 

To use the [provided SSH container](./docker/SSH/README.md) with the compose configuration you can substitute `web` in the above commands for `ssh`. To run the container in the background use `docker-compose up ssh -d`

To connect to this container through the remote connection manager you use the name of the service (`ssh`) as the 'host' and the default SSH port 22. 

### Using Docker Image 

`docker run -p 8000:8000 -e SSH_AUTH_SOCK=/ssh-agent -v /run/host-services/ssh-auth.sock:/ssh-agent ghcr.io/tenstorrent/ttnn-visualizer:latest`
