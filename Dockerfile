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

RUN npm install

ARG NODE_ENV="production"
ENV NODE_ENV="${NODE_ENV}" \
    PATH="${PATH}:/node_modules/.bin" \
    USER="node"

COPY --chown=node:node . .

# See below for environment priority
# https://vitejs.dev/guide/env-and-mode
COPY --chown=node:node ./.env* /app/

RUN npm run build

CMD ["bash"]

# Backend Docker Build
FROM python:3.12.3-slim-bookworm AS app

WORKDIR /app

ARG UID=1000
ARG GID=1000

# Setup base environment
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl libpq-dev openssh-client\
    && rm -rf /var/lib/apt/lists/* /usr/share/doc /usr/share/man \
    && apt-get clean \
    && groupadd -g "${GID}" python \
    && useradd --create-home --no-log-init -u "${UID}" -g "${GID}" python \
    && chown python:python -R /app

# Copy Python setup files / environment if exists
COPY --chown=python:python backend/ttnn_visualizer/requirements.txt ./
COPY --chown=python:python ./.env* /app/

# Copy and run installation scripts
COPY --chown=python:python ./backend/ttnn_visualizer/bin ./bin
RUN chmod 0755 bin/* && bin/pip3-install

# Copy backend files to image
COPY --chown=python:python ./backend /app/backend

# Copy the assets rom the frontend build to the public folder in app container
COPY --chown=python:python --from=assets /app/assets/backend/ttnn_visualizer/static /public

# Create directory for user data (reports/etc)
RUN mkdir -p /app/backend/ttnn_visualizer/data && chmod a+rw /app/backend/ttnn_visualizer/data

USER root

ARG FLASK_ENV="production"
ENV PYTHONUNBUFFERED="true" \
    FLASK_ENV="${FLASK_ENV}" \
    PYTHONPATH="/app/backend/" \
    PATH="${PATH}:/root/.local/bin" \
    USER="root" \
    RUN_ENV="docker"

ENTRYPOINT ["/app/bin/docker-entrypoint-web"]

EXPOSE 8000

CMD ["python", "-m", "backend.ttnn_visualizer.app"]