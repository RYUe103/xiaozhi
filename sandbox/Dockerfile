FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive

# This layer enables high-fidelity Office conversion and OCR. It can be slow on
# flaky networks, so keep retries/timeouts generous and prefer a nearby mirror.
RUN sed -i 's#http://deb.debian.org/debian#https://mirrors.tuna.tsinghua.edu.cn/debian#g; s#http://deb.debian.org/debian-security#https://mirrors.tuna.tsinghua.edu.cn/debian-security#g' /etc/apt/sources.list.d/debian.sources \
  && apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=60 -o Acquire::https::Timeout=60 update \
  && apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=60 -o Acquire::https::Timeout=60 install -y --no-install-recommends \
    bash \
    ca-certificates \
    fontconfig \
    fonts-dejavu \
    ghostscript \
    libgl1 \
    libglib2.0-0 \
    libreoffice \
    libreoffice-calc \
    libreoffice-impress \
    libreoffice-writer \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-chi-sim \
    tesseract-ocr-eng \
    unzip \
    zip \
  && rm -rf /var/lib/apt/lists/*

RUN pip install -i https://pypi.tuna.tsinghua.edu.cn/simple --trusted-host pypi.tuna.tsinghua.edu.cn \
    beautifulsoup4==4.12.3 \
    lxml==5.3.0 \
    matplotlib==3.9.4 \
    numpy==2.0.2 \
    openpyxl==3.1.5 \
    pandas==2.2.3 \
    pillow==11.0.0 \
    pypdf==5.1.0 \
    reportlab==4.2.5 \
    python-docx==1.1.2 \
    python-pptx==1.0.2

WORKDIR /mnt/data
