# Frontend Docker Build
FROM node:20-bookworm-slim AS assets

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

COPY --chown=node:node ./package.json *yarn* index.html ./

RUN yarn install && yarn cache clean

ARG NODE_ENV="production"
ENV NODE_ENV="${NODE_ENV}" \
    PATH="${PATH}:/node_modules/.bin" \
    USER="node"

COPY --chown=node:node . .

RUN yarn vite build

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

USER python

COPY --chown=python:python ./backend/requirements.txt ./
COPY --chown=python:python ./.env /app
COPY --chown=python:python ./backend/bin ./bin

RUN chmod 0755 bin/* && bin/pip3-install
ARG FLASK_ENV="production"
ENV PYTHONUNBUFFERED="true" \
    FLASK_ENV="${FLASK_ENV}" \
    PYTHONPATH="." \
    PATH="${PATH}:/home/python/.local/bin" \
    USER="python"

COPY --chown=python:python ./backend /app/backend
COPY --chown=python:python --from=assets /app/assets/dist /public

# In order to support the ssh-agent on MacOS we have to run as root
# The mounted ssh-agent socket needs to be made accessible to the app user
# After the permission change is made we su back to that user to avoid running
# the container as root.

USER root

ENTRYPOINT ["/app/bin/docker-entrypoint-web"]

EXPOSE 8000

CMD ["gunicorn", "-c", "backend/config/gunicorn.py", "-k", "uvicorn.workers.UvicornWorker",  "backend.main:app"]
