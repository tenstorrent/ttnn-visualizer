FROM python:3.11.6
WORKDIR /api
COPY ./requirements.txt /api/requirements.txt
RUN mkdir /api/config
COPY ./config/gunicorn.py /api/config/gunicorn.py
RUN pip install --no-cache-dir --upgrade -r /api/requirements.txt
COPY ./ /api/

EXPOSE 8000

CMD ["gunicorn", "-c", "/api/config/gunicorn.py", "main:app"]
