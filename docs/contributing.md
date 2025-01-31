# Contributing

**NOTE:** If you're just looking to run the app, [using the wheel](https://github.com/tenstorrent/ttnn-visualizer/blob/dev/docs/getting-started.md) is recommended as it is very simple to install and run.

## Running the app from source

### Frontend

```shell
nvm use
npm install
npm run dev
```

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

When both the frontend and backend are running you can access the app on [http://localhost:5173](http://localhost:5173) or whatever **Local** uri is printed in your terminal where you ran `npm run dev`.

### Environment

The application should run out of the box, but should you need to you can adjust certain values in the front end or back end code using a `.env` file. See `.env.sample` for some of the key variables available.

## Troubleshooting

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

## Docker

To run the application you can simply run `docker-compose up web`. To rebuild add the build flag, `docker-compose up web --build`.

To use the [provided SSH container](./docker/SSH/README.md) with the compose configuration you can substitute `web` in the above commands for `ssh`. To run the container in the background use `docker-compose up ssh -d`

To connect to this container through the remote connection manager you use the name of the service (`ssh`) as the 'host' and the default SSH port 22.
