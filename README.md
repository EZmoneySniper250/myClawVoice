# MyVoice

个人专属的本地 AI 语音对话界面。在浏览器中与你的 AI 助手进行实时语音通话，支持聊天历史归档、自定义助手名称与主题色。

---

## 功能特性

- **实时语音对话** — 全双工语音通话，说话即触发，无需手动按键
- **语音活动检测（VAD）** — 自动识别说话开始与结束，静音 1 秒后自动提交
- **手动打断** — AI 回复播放期间可点击按钮手动打断
- **文字输入** — 底部输入框支持直接发送文字消息
- **流式 LLM 响应** — 对话内容实时流式显示
- **TTS 语音合成** — 支持豆包实时双向 TTS / ElevenLabs / 浏览器内置语音三种模式
- **语音识别（STT）** — 支持 faster-whisper / FunASR 离线模型 / mock 三种模式
- **聊天历史归档** — 对话记录按日期归类，左侧侧边栏随时查看历史
- **自动断线保护** — 3 分钟无互动后倒计时提示，可一键继续或说"再见"主动挂断
- **自定义主题** — 底部调色盘可实时更换 AI 星球颜色
- **自定义助手** — `.env` 中修改助手名称，即可打造自己的专属 AI
- **Redis 持久化** — 聊天记录存储于 Redis，重启不丢失（最多保留 500 条）

---

## 技术架构

```
浏览器 (React + Three.js)
    │
    ├── WebSocket  ──→  Node.js 服务端 (Express + ws)
    │                       │
    │                       ├── LLM：OpenAI 兼容接口（OpenClaw / 其他）
    │                       ├── TTS：豆包 / ElevenLabs / 浏览器合成
    │                       ├── STT：faster-whisper / FunASR（Python 子进程）
    │                       └── Redis：聊天历史持久化
    │
    └── HTTP /api/transcribe/audio  （上传音频 → STT）
```

---

## 快速开始（Docker）

### 前置要求

- [Docker](https://docs.docker.com/get-docker/) 及 Docker Compose
- OpenAI 兼容 LLM 接口（OpenClaw 或其他）
- 可选：豆包 TTS API Key / ElevenLabs API Key

### 第一步：配置环境变量

```bash
cp .env.example .env
```

用编辑器打开 `.env`，至少填写以下字段：

```env
AGENT_NAME=October           # 助手名称，可自定义

OPENCLAW_BASE_URL=http://...  # LLM 接口地址（OpenAI 兼容）
OPENCLAW_API_KEY=...          # LLM API Key
OPENCLAW_MODEL=...            # 模型名称，如 gpt-4o

STT_MODE=faster-whisper       # 语音识别模式（见下方说明）
TTS_MODE=elevenlabs           # 语音合成模式（见下方说明）
```


### 第二步：构建 Docker 镜像

```bash
docker compose build
```

首次构建会安装 Node 依赖、编译前端与后端、安装 Python 依赖，预计 3～10 分钟。

当然你也可以不用compose
你需要去configure一个redis
### 第三步：启动服务

```bash
docker compose up -d
```

启动后访问：**http://localhost:8787**

### 查看日志

```bash
docker compose logs -f app
```

### 停止服务

```bash
docker compose down
```

### 完全清理（含聊天记录）

```bash
docker compose down -v
```

---

## 环境变量说明

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8787` | 服务监听端口 |
| `AGENT_NAME` | `October` | 助手显示名称 |
| `OPENCLAW_BASE_URL` | — | LLM 接口基础地址 |
| `OPENCLAW_API_KEY` | — | LLM API Key |
| `OPENCLAW_MODEL` | `openclaw/default` | 使用的模型 |
| `OPENCLAW_SESSION_KEY` | `myvoice-october` | 对话隔离 session 标识 |
| `REDIS_URL` | `redis://localhost:6379` | Redis 连接地址（Docker 内已自动设置）|
| `STT_MODE` | `mock` | 语音识别模式 |
| `TTS_MODE` | `mock` | 语音合成模式 |

---

## 语音识别（STT）配置

### mock（默认）

不进行真实识别，仅用于测试界面。

### faster-whisper（推荐）

本地离线识别，首次运行会自动下载模型。

```env
STT_MODE=faster-whisper
WHISPER_MODEL=small        # 可选：tiny / base / small / medium / large-v3
WHISPER_LANGUAGE=zh
WHISPER_BEAM_SIZE=1        # 1 为最快，5 为最准
```

模型大小参考：

| 模型 | 显存/内存 | 中文效果 |
|---|---|---|
| `tiny` | ~400MB | 一般 |
| `small` | ~1GB | 良好 |
| `medium` | ~3GB | 很好 |
| `large-v3` | ~6GB | 最佳 |

### FunASR（国产离线模型）

```env
STT_MODE=funasr
FUNASR_MODEL=paraformer-zh
```

> 使用 FunASR 需在 `Dockerfile` 中将 `faster-whisper` 替换为 `funasr modelscope` 并重新构建。

---

## 语音合成（TTS）配置

### mock（默认）

使用浏览器内置 `speechSynthesis`，无需 API Key，音质较差。

### 豆包实时 TTS（还没做好呢 这个需要开发）

流式双向 WebSocket，延迟最低，支持中文女声/男声等多种音色。

```env
TTS_MODE=doubao
DOUBAO_TTS_API_KEY=...
DOUBAO_TTS_MODEL=doubao-tts
DOUBAO_TTS_VOICE=zh_female_kailangjiejie_moon_bigtts
DOUBAO_TTS_REALTIME_URL=wss://ai-gateway.vei.volces.com/v1/realtime
```

音色列表参考：[火山引擎音色文档](https://www.volcengine.com/docs/6561/97465)

### ElevenLabs（推荐）

```env
TTS_MODE=elevenlabs
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
```

---

## 本地开发模式

无需 Docker，直接在本地运行：

### 前置要求

- Node.js 20+
- Python 3.9+（如使用 STT）
- Redis（如使用历史记录，可用 `docker run -d -p 6379:6379 redis:7-alpine`）

### 启动

```bash
# 安装依赖
npm install
cd client && npm install && cd ..

# 配置环境变量
cp .env.example .env
# 编辑 .env 填写 API Key

# 同时启动后端（含热重载）与前端开发服务器
npm run dev          # 后端：http://localhost:8787
npm run dev:client   # 前端：http://localhost:5173（自动代理到后端）
```

---

## 常见问题

**Q：页面一直显示"连接中"**
检查后端日志 `docker compose logs app`，确认 LLM 接口地址和 API Key 配置正确。

**Q：识别总是为空或乱码**
尝试增大 `WHISPER_MODEL`（如从 `small` 换成 `medium`），或检查麦克风权限。

**Q：说话没有反应**
浏览器需要麦克风权限，点击允许后刷新页面。部分浏览器在 `http://` 下限制麦克风，建议用 Chrome 或配置 HTTPS。

**Q：历史记录不保存**
确认 Redis 服务正常运行：`docker compose ps`，查看 redis 服务状态。

**Q：更换助手名称后前端没变化**
修改 `.env` 中的 `AGENT_NAME` 后需重启服务：`docker compose restart app`。

~~1.5新增 挂断词~~
