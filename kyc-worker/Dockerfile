# kyc-worker + kyc-runner (Security plan Phase 8). KYC level 1, queue and results, on the secondary server.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 KYC_DB_PATH=/data/kyc.sqlite
RUN useradd --system --uid 10001 --home /app kyc && mkdir -p /data && chown kyc /data
WORKDIR /app
COPY requirements.txt requirements-l2.txt requirements-holehe.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-l2.txt \
 && pip install --no-cache-dir --no-deps --no-build-isolation --require-hashes -r requirements-holehe.txt
COPY app ./app
USER kyc
EXPOSE 5201
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5201", "--workers", "2", "--no-server-header", "--proxy-headers", "--forwarded-allow-ips", "127.0.0.1"]
