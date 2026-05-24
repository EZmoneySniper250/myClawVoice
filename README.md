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
| `STT_MODE` | `mock` | 语音识别模式：`mock` / `faster-whisper` / `funasr` |
| `PYTHON_BIN` | `python` | STT 子进程使用的 Python 路径，建议指向 conda 环境 |
| `WHISPER_MODEL` | `small` | faster-whisper 模型大小 |
| `WHISPER_LANGUAGE` | `zh` | 识别语言 |
| `WHISPER_BEAM_SIZE` | `1` | 1 最快，5 最准 |
| `FUNASR_MODEL` | `paraformer-zh` | FunASR 模型 ID，如 `iic/SenseVoiceSmall` |
| `MODELSCOPE_CACHE` | `~/.cache/modelscope` | FunASR 模型缓存目录（本地开发可指向 D 盘） |
| `TTS_MODE` | `mock` | 语音合成模式：`mock` / `elevenlabs` / `doubao` |

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
FUNASR_MODEL=iic/SenseVoiceSmall   # 多语言，速度快（推荐）
# FUNASR_MODEL=paraformer-zh       # 纯中文，精度高
# FUNASR_MODEL=paraformer-en       # 英文
```

模型 ID 格式为 `iic/<模型名>`，首次启动会自动从 ModelScope 下载，之后从本地缓存加载。

**本地开发 — 推荐用 conda 管理 Python 环境**

FunASR 依赖较多，Python 3.13 部分包暂无预编译 wheel，建议用 conda 创建 3.12 环境：

```bash
conda create -n myvoice python=3.12
conda activate myvoice
pip install funasr modelscope
```

然后在 `.env` 中将 `PYTHON_BIN` 指向该环境的 Python：

```env
# Windows
PYTHON_BIN=C:\Users\<你的用户名>\anaconda3\envs\myvoice\python.exe

# macOS / Linux
PYTHON_BIN=/opt/anaconda3/envs/myvoice/bin/python
```

> **Docker 用户：** 需在 `Dockerfile` 中将 `faster-whisper` 替换为 `funasr modelscope` 并重新构建。`docker-compose.yml` 已自动覆盖 `PYTHON_BIN=python`（容器内系统 Python）和 ModelScope 缓存路径，无需手动配置。

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

### 已知问题：长回复可能不继续出声

2026-05-24 语音测试发现：当 October 的回复超过一定长度时，前端文字可能仍能显示/模型仍在生成，但后续语音不一定会继续播放出来。

当前初步判断不是单纯的 LLM 理解问题，而是 **流式 LLM 与 ElevenLabs TTS 串行耦合** 导致的长回复瓶颈：

```text
OpenClaw 流式生成 delta
  → createSpeechChunker 切句/按长度切段
  → await tts.append(chunk)
  → ElevenLabs 合成该段音频
  → emit tts_audio 给浏览器播放
  → 再继续处理后续 delta
```

关键代码位置：

- `src/server.ts`
  - `handleStreamingTextChat(...)`
  - `createSpeechChunker(...)`
- `src/clients/elevenlabsTts.ts`
  - `ElevenLabsTtsSession.append(...)`
- `public/call.js`
  - `playPcm(...)`
  - `scheduleReturnToListening(...)`

风险点：

- `handleStreamingTextChat` 在 OpenClaw delta 回调里 `await chunker.push(delta)`。
- `chunker.push` 触发分段后会 `await onChunk(chunk)`。
- ElevenLabs `append` 内部排队后仍 `await this.queue`，等于 TTS 合成会反压/阻塞 LLM stream 的持续消费。
- `streamOpenClaw` 当前有约 `120_000ms` timeout；长回复 + 慢 TTS 可能导致后半段被断尾。
- 前端 `call.js` 在 `tts_done` / `chat_done` 后会按 `nextPlayTime` 安排回到 listening；如果服务端提前 done、TTS error、或音频队列与状态不同步，可能出现“文字有但声音没继续”的体验。

临时规避：

- 语音模式下让助手回复更短、更口语化。
- 避免一次性要求长段解释；改成分多轮回答。

建议修复方向：

1. **TTS 独立异步队列**：LLM stream 不要等待 ElevenLabs 合成完成；delta 只负责快速写入待播队列。
2. **服务端完成语义拆分**：保证 `chat_done` 与 `tts_done` 的顺序可靠，只有所有 TTS chunk 合成并发送完后才发 `tts_done`。
3. **增加日志**：记录每个 chunk 的长度、发送时间、TTS 合成耗时、`tts_audio` 数量、`tts_done` 时间，方便定位是服务端断、ElevenLabs 断，还是浏览器播放断。
4. **可选：限制语音回复最大长度**：在 voice system prompt 或服务端截断/总结，优先保证实时对话体验。

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
