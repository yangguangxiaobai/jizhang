FROM python:3.12-slim-bookworm AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SAM2_BUILD_CUDA=0 \
    OMP_NUM_THREADS=2 \
    MKL_NUM_THREADS=2 \
    OPENBLAS_NUM_THREADS=2 \
    JIZHANG_CUTOUT_CHECKPOINT=/opt/models/sam2.1_hiera_small.pt \
    JIZHANG_CUTOUT_CONFIG=configs/sam2.1/sam2.1_hiera_s.yaml \
    JIZHANG_CUTOUT_TMP_DIR=/tmp/jizhang-cutout-jobs

WORKDIR /app

ARG PYTHON_PACKAGE_INDEX_URL=https://pypi.org/simple

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY packages/cutout/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir --timeout 120 --retries 5 \
    --index-url "${PYTHON_PACKAGE_INDEX_URL}" -r requirements.txt

COPY packages/cutout/app ./app
COPY packages/cutout/THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md

FROM base AS test
COPY packages/cutout/requirements-test.txt ./requirements-test.txt
RUN python -m pip install --no-cache-dir --timeout 120 --retries 5 \
    --index-url "${PYTHON_PACKAGE_INDEX_URL}" -r requirements-test.txt
COPY packages/cutout/tests ./tests
RUN python -m pytest -q

FROM base AS model

# Install current CPU wheels from the official PyTorch index separately from the rest of
# the pinned service dependencies; this image deliberately does not include CUDA libraries.
RUN python -m pip install --no-cache-dir \
    --timeout 180 --retries 5 \
    --index-url https://download.pytorch.org/whl/cpu \
    torch==2.9.1 torchvision==0.24.1

# Pin the upstream implementation to an immutable commit and skip its optional CUDA extension.
ARG SAM2_COMMIT=2b90b9f5ceec907a1c18123530e92e794ad901a4
RUN mkdir -p /tmp/sam2-src \
    && curl -fsSL --retry 3 --connect-timeout 20 --max-time 600 \
      "https://github.com/facebookresearch/sam2/archive/${SAM2_COMMIT}.tar.gz" \
      -o /tmp/sam2.tar.gz \
    && tar -xzf /tmp/sam2.tar.gz --strip-components=1 -C /tmp/sam2-src \
    && SAM2_BUILD_CUDA=0 PIP_INDEX_URL="${PYTHON_PACKAGE_INDEX_URL}" \
      python -m pip install --no-cache-dir --no-build-isolation --no-deps /tmp/sam2-src \
    && mkdir -p /opt/licenses \
    && cp /tmp/sam2-src/LICENSE /opt/licenses/SAM2-LICENSE \
    && cp /tmp/sam2-src/LICENSE_cctorch /opt/licenses/SAM2-CCTORCH-LICENSE \
    && rm -rf /tmp/sam2-src /tmp/sam2.tar.gz

ARG SAM2_CHECKPOINT_URL=https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt
ARG SAM2_CHECKPOINT_SHA256=6d1aa6f30de5c92224f8172114de081d104bbd23dd9dc5c58996f0cad5dc4d38
RUN mkdir -p /opt/models \
    && curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
      --connect-timeout 20 --max-time 900 \
      "${SAM2_CHECKPOINT_URL}" -o /opt/models/sam2.1_hiera_small.pt \
    && echo "${SAM2_CHECKPOINT_SHA256}  /opt/models/sam2.1_hiera_small.pt" | sha256sum --check

FROM model AS runtime
RUN useradd --system --uid 10001 --create-home cutout \
    && mkdir -p /tmp/jizhang-cutout-jobs \
    && chown -R cutout:cutout /tmp/jizhang-cutout-jobs

USER 10001:10001
EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/health/ready', timeout=3).read()"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090", "--no-access-log"]
