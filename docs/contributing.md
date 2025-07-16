# Contributing

**NOTE:** If you're just looking to run the app, [installing via PyPI](https://github.com/tenstorrent/ttnn-visualizer/blob/dev/docs/getting-started.md#installing-from-pypi) is highly recommended.

## Running the app from source

### Front end

Currently the project requires **Node 20.11**. We have a `.nvmrc` file for ease of versioning if you're using a node version manager.

We use [pnpm](https://pnpm.io/) as our package manager. Please see their guidelines for [installing pnpm on your machine](https://pnpm.io/installation).

```shell
nvm use
pnpm install
pnpm run dev
```

### Back end

create env

```shell
python3 -m venv myenv
```

activate env

```shell
source myenv/bin/activate
```

install dependencies

```shell
pip install '.[dev]'
```

Starting the server

```shell
pnpm run flask:start
```

Starting with hot reload:

``` shell
pnpm run flask:start-debug
```

When both the frontend and backend are running you can access the app on [http://localhost:5173](http://localhost:5173) or whatever local URI is printed in your terminal where you ran `pnpm run dev`.

### Environment

The application should run out of the box, but should you need to you can adjust certain values in the front end or back end code using a `.env` file. See `.env.sample` for some of the key variables available.

## Troubleshooting

### Fix for 'no keys found' error

<img width="492" alt="Screenshot 2025-01-30 at 1 55 10 PM" src="https://github.com/user-attachments/assets/3f7f9983-f92d-4900-9321-9d46c6355c36" />

Check your local ssh agent has your ssh key by running:

```shell
ssh-add -L
```

If your key isn't present, run the following on your local machine:

```shell
ssh-add
```

### Fix for python random errors not finding modules

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
