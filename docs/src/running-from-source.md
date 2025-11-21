# Running from source

**NOTE:** If you're just looking to run the app, [installing via PyPI](https://docs.tenstorrent.com/ttnn-visualizer/src/installing.html#installing-from-pypi) or using the [hosted version](https://ttnn-visualizer.tenstorrent.com/) is highly recommended.

## Front end

The current supported Node version is listed in the [.nvmrc](https://github.com/tenstorrent/ttnn-visualizer/blob/dev/.nvmrc) file. We recommend using a node version manager such as NVM for ease of use. 

We use [pnpm](https://pnpm.io/) as our package manager. Please see their guidelines for [installing pnpm on your machine](https://pnpm.io/installation).

```shell
nvm use
pnpm install
pnpm run dev
```

## Back end

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

When both the frontend and backend are running you can access the app on [http://localhost:5173](http://localhost:5173), but an alternative local URI may be provided in the terminal when running `pnpm run dev`.

## Environment variables

The application should run out of the box, but should you need to you can adjust certain values in the front end or back end code using a `.env` file. See [.env.sample](https://github.com/tenstorrent/ttnn-visualizer/blob/dev/.env.sample) for some of the key variables available.