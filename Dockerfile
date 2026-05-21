# ── Stage 1: 构建前端 ────────────────────────────────────────────────────────
FROM node:20-slim AS client-builder

WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
COPY public/ ../public/
RUN npm run build

# ── Stage 2: 编译后端 TypeScript ─────────────────────────────────────────────
FROM node:20-slim AS server-builder

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

# ── Stage 3: 运行时镜像 ───────────────────────────────────────────────────────
FROM node:20-slim

# 安装 Python（STT 语音识别子进程所需）及 ffmpeg（音频处理）
# python-is-python3 提供 `python` → `python3` 软链接，兼容 PYTHON_BIN=python 的配置
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python-is-python3 ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# 安装 faster-whisper（若使用 STT_MODE=faster-whisper）
# 如不需要语音识别可注释掉以减小镜像体积
RUN pip3 install faster-whisper --break-system-packages

# 若需要 FunASR（STT_MODE=funasr），改为：
# RUN pip3 install funasr modelscope --break-system-packages

WORKDIR /app

# 仅安装生产依赖
COPY package*.json ./
RUN npm ci --omit=dev

# 复制编译产物
COPY --from=server-builder /app/dist ./dist
COPY --from=client-builder /app/client/dist ./client/dist

# 静态资源（头像等）
COPY public/ ./public/

# STT Python 脚本
COPY stt/ ./stt/

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8787/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/server.js"]
