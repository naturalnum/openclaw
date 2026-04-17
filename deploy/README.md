# PowerClaw Deploy

这个目录用于交付打包后的 OpenClaw 镜像。

当前这套 `deploy/` 已经把 `release-20260314` 那条“重依赖、本地先构建再打镜像”的方式迁过来了：

- 构建时先在本地执行 `pnpm build:docker`
- 再把运行时产物打进 deploy 专用镜像
- 镜像内默认带 Python 运行库、文档处理工具、`ssh` 客户端等依赖
- gateway 根路径默认直接服务你的 `power-ui`

这样镜像进入内网后，运行阶段可以脱离互联网。

这也意味着对部署来说，你现在只需要维护 `deploy/` 目录：

- `deploy/Dockerfile`
- `deploy/openclaw-home/.env`
- `deploy/openclaw-home/openclaw.json`

根目录的这些旧文件不再是 deploy 方案的依赖：

- `Dockerfile.local`
- `default_config/.env`

它们目前仍保留在仓库里，只是为了兼容旧流程，不是这套部署必需品。

交付物建议：

1. Docker 镜像
2. 这个 `deploy/` 目录

这样同事不需要源码仓库，只要拿到镜像和这个目录，就可以启动网关，并使用你自己的 `power-ui` 前端去连接。

## 目录结构

- `build.env.example`
  镜像构建参数示例。
- `build-image.sh`
  从源码构建镜像的脚本。
- `Dockerfile`
  deploy 专用镜像构建文件，默认内置 Python/apt 运行依赖。
- `requirements-openclaw-runtime.txt`
  Python 运行时依赖列表。
- `docker-compose.yml`
  Docker Compose 启动文件，只启动 OpenClaw gateway 容器。
- `.env.example`
  Compose 级别变量示例，例如镜像名、端口。
- `openclaw-home/`
  挂载到容器 `/home/node/.openclaw` 的外部目录。
  这里放运行配置、状态、workspace、agent 数据。

## 构建镜像

如果交付的是源码而不是现成镜像，先构建：

```bash
cd deploy
cp build.env.example build.env
./build-image.sh
```

这个脚本会自动做：

1. 在仓库根目录执行 `pnpm build:docker`
2. 执行 `pnpm qa:lab:build`
3. `pnpm prune --prod`
4. 用 `deploy/Dockerfile` 构建最终镜像
5. 最后恢复本地依赖

默认会按 `linux/amd64` 构建，这样你在 macOS ARM 机器上打出来的镜像也能直接部署到 x86 Linux 环境。
Compose 运行时也默认声明 `linux/amd64`，这样在 ARM 主机本地验证时不会再出现平台未指定告警。

常见构建参数放在 `build.env`：

- `OPENCLAW_IMAGE`
- `OPENCLAW_DOCKERFILE`
- `OPENCLAW_BUILD_CONTEXT`
- `OPENCLAW_NODE_IMAGE`
- `OPENCLAW_PLATFORM`
- `OPENCLAW_EXTENSIONS`
- `OPENCLAW_INSTALL_DOCKER_CLI`
- `OPENCLAW_INSTALL_BROWSER`
- `OPENCLAW_DOCKER_APT_PACKAGES`

默认镜像内已经安装：

- `python3` / `python3-pip`
- `openssh-client` / `sshpass`
- `pandoc` / `libreoffice` / `poppler-utils`
- `tesseract-ocr` / `ffmpeg`
- 一批图像、地理、表格、PDF 处理依赖

默认也会安装 `requirements-openclaw-runtime.txt` 中的 Python 包。

## 第一次部署

1. 准备镜像

如果你是从镜像 tar 包导入：

```bash
docker load -i openclaw-power.tar
```

2. 准备 Compose 变量

```bash
cd deploy
cp .env.example .env
```

3. 准备 OpenClaw 运行配置

```bash
cp openclaw-home/.env.example openclaw-home/.env
```

然后编辑：

- `openclaw-home/.env`
- `openclaw-home/openclaw.json`

如果要让 OpenClaw 在运行时继续从你自己的 Skill Center / ClawHub 安装技能，需要在 `openclaw-home/.env` 里保留：

- `CLAWHUB_REGISTRY`
- `CLAWHUB_SITE`
- `CLAWHUB_WORKDIR`

默认示例已经写进 deploy 目录，不再依赖根目录 `default_config/.env`。

其中 `openclaw-home/openclaw.json` 已默认包含：

- `power-backend`
- `deepseek`
- `openai`
- `memory-core`
- `memory-wiki`
- `network-guard-plugin`
- `workspace-guard-plugin`
- `high-risk-command-guard-plugin`

这三个 guard 插件已经按 `release-20260314` 的方式写进 `plugins.allow` 和 `plugins.entries`，启动后会直接生效。

4. 启动

```bash
docker compose up -d
```

5. 查看状态

```bash
docker compose ps
docker compose logs -f openclaw
```

## 访问 Power UI

这个 Compose 只启动一个服务，但根路径直接就是你的 `power-ui`。

启动后直接访问：

- `http://<部署机IP>:18789/`

`power-ui` 会同源连接当前 gateway，不需要再额外部署一个前端服务。

## 外部可修改目录

`openclaw-home/` 就是外部挂载目录，容器内对应：

```text
/home/node/.openclaw
```

常用内容：

- `openclaw-home/openclaw.json`
  主配置文件
- `openclaw-home/.env`
  模型 API Key、gateway token 等环境变量
- `openclaw-home/workspace/`
  项目工作区
- `openclaw-home/agents/`
  agent 数据

## 两个 `.env` 的区别

- `deploy/.env`
  Docker Compose 层配置。
  控制镜像名、容器名、对外端口、时区。

- `deploy/openclaw-home/.env`
  OpenClaw 运行时环境变量。
  控制 gateway token、模型 API key、ClawHub/Skill Center 地址等。

也就是说：

- 想改“容器怎么启动”改 `deploy/.env`
- 想改“OpenClaw 怎么工作”改 `deploy/openclaw-home/.env`

## 更新镜像

如果镜像版本更新：

```bash
docker compose down
docker load -i openclaw-power.tar
docker compose up -d
```

`openclaw-home/` 数据会保留。
