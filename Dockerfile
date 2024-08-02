# Frontend Docker Build
FROM node:20.11-bookworm-slim AS assets

WORKDIR /app/assets

ARG UID=1000
ARG GID=1000

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/* /usr/share/doc /usr/share/man \
    && apt-get clean \
    && groupmod -g "${GID}" node && usermod -u "${UID}" -g "${GID}" node \
    && mkdir -p /node_modules && chown node:node -R /node_modules /app


USER node

COPY --chown=node:node ./package.json package-lock.json index.html ./

RUN npm install && npm cache clean --force

ARG NODE_ENV="production"
ENV NODE_ENV="${NODE_ENV}" \
    PATH="${PATH}:/node_modules/.bin" \
    VITE_API_ROOT="api" \
    USER="node"

COPY --chown=node:node . .

# See below for environment priority
# https://vitejs.dev/guide/env-and-mode
COPY --chown=node:node ./.env /app/.env."${NODE_ENV}}"
COPY --chown=node:node ./.env /app/.env

RUN npm run build

CMD ["bash"]

# # Backend Docker Build
FROM python:3.12.3-slim-bookworm AS app

WORKDIR /app

ARG UID=1000
ARG GID=1000

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl libpq-dev openssh-client\
    && rm -rf /var/lib/apt/lists/* /usr/share/doc /usr/share/man \
    && apt-get clean \
    && groupadd -g "${GID}" python \
    && useradd --create-home --no-log-init -u "${UID}" -g "${GID}" python \
    && chown python:python -R /app

RUN mkdir -p /public

# Backend Build steps

# ROOTLESS BUILD - WIP
# Currently we can not use the MacOS magic socket as non-root.
# Once this issue is resolved we can replace root with the python user
# To avoid running the container as root we can su -c in the entrypoint

# USER python

COPY --chown=python:python ./backend/requirements.txt ./
COPY --chown=python:python ./.env /app
COPY --chown=python:python ./backend/bin ./bin

RUN chmod 0755 bin/* && bin/pip3-install

# ARG FLASK_ENV="production"
# ENV PYTHONUNBUFFERED="true" \
#    FLASK_ENV="${FLASK_ENV}" \
#    PYTHONPATH="." \
#    PATH="${PATH}:/home/python/.local/bin" \
#    USER="python"

COPY --chown=python:python ./backend /app/backend
COPY --chown=python:python --from=assets /app/assets/dist /public

USER root

ARG FLASK_ENV="production"
ENV PYTHONUNBUFFERED="true" \
    FLASK_ENV="${FLASK_ENV}" \
    PYTHONPATH="." \
    PATH="${PATH}:/root/.local/bin" \
    USER="root"

ENTRYPOINT ["/app/bin/docker-entrypoint-web"]

EXPOSE 8000

CMD ["gunicorn", "-c", "backend/config/gunicorn.py", "-k", "uvicorn.workers.UvicornWorker",  "backend.main:app"]
