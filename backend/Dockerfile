FROM python:3.12.3-slim-bookworm AS app

WORKDIR /app

ARG UID=1000
ARG GID=1000

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl libpq-dev \
    && rm -rf /var/lib/apt/lists/* /usr/share/doc /usr/share/man \
    && apt-get clean \
    && groupadd -g "${GID}" python \
    && useradd --create-home --no-log-init -u "${UID}" -g "${GID}" python \
    && chown python:python -R /app

RUN mkdir -p /public

USER python


COPY --chown=python:python ./requirements.txt ./
COPY --chown=python:python ./bin/ ./bin
RUN mkdir -p ./config
COPY ./config/gunicorn.py /app/config/gunicorn


RUN chmod 0755 bin/* && bin/pip3-install

ARG FLASK_DEBUG="false"
ENV FLASK_DEBUG="${FLASK_DEBUG}" \
    FLASK_APP="api.app" \
    FLASK_SKIP_DOTENV="true" \
    PYTHONUNBUFFERED="true" \
    PYTHONPATH="." \
    PATH="${PATH}:/home/python/.local/bin" \
    USER="python"

COPY --chown=python:python ./public/ ./public

ENTRYPOINT ["/app/bin/docker-entrypoint-web"]

EXPOSE 8000

CMD ["gunicorn", "-c", "python:config.gunicorn", "-k", "uvicorn.workers.UvicornWorker",  "main:app"]
