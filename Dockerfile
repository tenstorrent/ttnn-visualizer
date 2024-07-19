# Frontend Docker Build
FROM node:20.11.0-bookworm-slim AS assets

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

COPY --chown=node:node package.json *yarn* index.html ./

RUN yarn install && yarn cache clean

ARG NODE_ENV="production"
ENV NODE_ENV="${NODE_ENV}" \
    PATH="${PATH}:/node_modules/.bin" \
    USER="node"

COPY --chown=node:node . .

RUN yarn vite build

CMD ["bash"]

# # Backend Docker Build
# FROM python:3.12.3-slim-bookworm AS app
#
# WORKDIR /app
#
# ARG UID=1000
# ARG GID=1000
#
# RUN apt-get update \
#     && apt-get install -y --no-install-recommends build-essential curl libpq-dev \
#     && rm -rf /var/lib/apt/lists/* /usr/share/doc /usr/share/man \
#     && apt-get clean \
#     && groupadd -g "${GID}" python \
#     && useradd --create-home --no-log-init -u "${UID}" -g "${GID}" python \
#     && chown python:python -R /app
#
# RUN mkdir -p /public
#
# USER python
#
#
# COPY --chown=python:python ./backend/requirements.txt ./
# COPY --chown=python:python ./backend/bin/ ./bin
#
# RUN chmod 0755 bin/* && bin/pip3-install
#
# ARG FLASK_DEBUG="false"
# ENV FLASK_DEBUG="${FLASK_DEBUG}" \
#     FLASK_APP="api.app" \
#     FLASK_SKIP_DOTENV="true" \
#     PYTHONUNBUFFERED="true" \
#     PYTHONPATH="." \
#     PATH="${PATH}:/home/python/.local/bin" \
#     USER="python"
#
# COPY --chown=python:python . .
#
# ENTRYPOINT ["/app/bin/docker-entrypoint-web"]
#
# EXPOSE 8000
#
# CMD ["gunicorn", "-c", "python:config.gunicorn", "-k", "uvicorn.workers.UvicornWorker",  "main:app"]
