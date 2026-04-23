ARG OPENCLAW_NODE_IMAGE="swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/node:24-bookworm-slim-linuxarm64"
ARG OPENCLAW_CLAUDE_CODE_VERSION="latest"
ARG OPENCLAW_APT_MIRROR="http://mirrors.aliyun.com"
ARG OPENCLAW_PYPI_INDEX_URL="https://mirrors.aliyun.com/pypi/simple"
ARG OPENCLAW_NPM_REGISTRY="https://registry.npmmirror.com"

FROM ${OPENCLAW_NODE_IMAGE}

ARG OPENCLAW_CLAUDE_CODE_VERSION
ARG OPENCLAW_APT_MIRROR
ARG OPENCLAW_PYPI_INDEX_URL
ARG OPENCLAW_NPM_REGISTRY

LABEL org.opencontainers.image.source="https://github.com/openclaw/openclaw" \
  org.opencontainers.image.url="https://openclaw.ai" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.title="OpenClaw Power Deploy" \
  org.opencontainers.image.description="OpenClaw gateway image for offline intranet deployment"

WORKDIR /app

RUN sed -i \
      -e "s|http://deb.debian.org/debian-security|${OPENCLAW_APT_MIRROR}/debian-security|g" \
      -e "s|http://deb.debian.org/debian|${OPENCLAW_APT_MIRROR}/debian|g" \
      /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i \
      -e "s|http://deb.debian.org/debian-security|${OPENCLAW_APT_MIRROR}/debian-security|g" \
      -e "s|http://deb.debian.org/debian|${OPENCLAW_APT_MIRROR}/debian|g" \
      /etc/apt/sources.list 2>/dev/null || true && \
    apt-get update -qq && \
    DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --no-install-recommends && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ant ant-optional bash build-essential ca-certificates curl \
      ffmpeg fonts-noto-cjk fonts-wqy-zenhei gdal-bin ghostscript git \
      imagemagick inkscape libreoffice libfribidi-dev libfreetype6-dev \
      libgdal-dev libheif-examples libharfbuzz-dev libjpeg-dev libjxr-tools \
      liblcms2-dev libopenjp2-7-dev libpq-dev libproj-dev libspatialindex-dev \
      libtiff6 libwebp-dev libxcb1-dev libxml2-dev libxslt1-dev \
      openssh-client openssl pandoc pkg-config poppler-utils procps \
      proj-bin python3-dev python3-pip sshpass tesseract-ocr \
      texlive-xetex zlib1g-dev && \
    rm -rf /var/lib/apt/lists/*

ENV PIP_BREAK_SYSTEM_PACKAGES=1
ENV PIP_DEFAULT_TIMEOUT=300
ENV PIP_RETRIES=10

COPY deploy/requirements-openclaw-runtime.txt /tmp/requirements-openclaw-runtime.txt
RUN python3 -m pip install -i "${OPENCLAW_PYPI_INDEX_URL}" --upgrade pip setuptools wheel && \
    python3 -m pip install -i "${OPENCLAW_PYPI_INDEX_URL}" \
      --default-timeout="${PIP_DEFAULT_TIMEOUT}" --retries="${PIP_RETRIES}" \
      -r /tmp/requirements-openclaw-runtime.txt && \
    python3 -m pip install -i "${OPENCLAW_PYPI_INDEX_URL}" \
      --default-timeout="${PIP_DEFAULT_TIMEOUT}" --retries="${PIP_RETRIES}" \
      --no-deps --only-binary=:all: vaex-core==4.19.0 && \
    python3 -m pip install -i "${OPENCLAW_PYPI_INDEX_URL}" \
      --default-timeout="${PIP_DEFAULT_TIMEOUT}" --retries="${PIP_RETRIES}" \
      --upgrade "polars[rtcompat]" && \
    rm -f /tmp/requirements-openclaw-runtime.txt

RUN npm config set registry "${OPENCLAW_NPM_REGISTRY}" && \
    npm install -g clawhub docx pptxgenjs @anthropic-ai/claude-code@${OPENCLAW_CLAUDE_CODE_VERSION} --prefer-offline && \
    npm config set registry https://registry.npmjs.org

COPY dist ./dist
COPY node_modules ./node_modules
COPY package.json ./package.json
RUN npm config set registry "${OPENCLAW_NPM_REGISTRY}" && \
    npm install --no-save --include=optional --legacy-peer-deps @lydell/node-pty@1.2.0-beta.12 && \
    npm config set registry https://registry.npmjs.org
COPY openclaw.mjs ./openclaw.mjs
COPY extensions ./extensions
COPY skills ./skills
COPY docs ./docs
COPY qa ./qa
COPY deploy/entrypoint.sh /usr/local/bin/openclaw-deploy-entrypoint.sh

RUN mkdir -p ./extensions/power-backend && \
    if [ -d ./dist/extensions/power-backend ]; then \
      cp -R ./dist/extensions/power-backend/. ./extensions/power-backend/; \
    fi

RUN ln -sf /app/openclaw.mjs /usr/local/bin/openclaw && \
    chmod 755 /app/openclaw.mjs /usr/local/bin/openclaw-deploy-entrypoint.sh

ENV NODE_ENV=production
ENV HOME=/home/node

USER root

HEALTHCHECK --interval=3m --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:18789/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/openclaw-deploy-entrypoint.sh"]
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
