# 部署说明

本文档说明如何构建和运行当前仓库的 Docker 镜像。

## 前置条件

- 已安装 Docker
- Docker daemon 已启动
- 当前目录位于仓库根目录

```bash
cd openclaw
```

## 标准构建

这是推荐给团队成员和正式发布使用的标准方式。

构建镜像：

```bash
docker build -t openclaw:power-ui .
```

启动镜像：

```bash
docker run --rm -it \
  -p 18789:18789 \
  -p 18790:18790 \
  --name openclaw-power-ui \
  openclaw:power-ui
```

启动后可访问：

- 网关与前端界面：`http://127.0.0.1:18789/`
- 浏览器控制端口：`18790`

## 挂载本地配置和工作目录

如果希望容器直接使用本机已有配置和工作目录，可使用下面的方式：

```bash
docker run --rm -it \
  -p 18789:18789 \
  -p 18790:18790 \
  -v ~/.openclaw:/home/node/.openclaw \
  -v ~/.openclaw/workspace:/home/node/.openclaw/workspace \
  --name openclaw-power-ui \
  openclaw:power-ui
```

## 本地快速构建

这个方式主要用于本地开发验证。它会复用本机构建产物，构建速度更快，但不建议作为团队标准分发方式。

先生成本地产物：

```bash
pnpm build:docker
pnpm ui:build
pnpm power-ui:build
```

再构建本地快速镜像：

```bash
./scripts/build-docker-local.sh openclaw:power-ui-local
```

运行本地快速镜像：

```bash
docker run --rm -it \
  -p 18789:18789 \
  -p 18790:18790 \
  --name openclaw-power-ui \
  openclaw:power-ui-local
```

## 镜像内容

镜像默认包含：

- `power-ui` 作为默认控制台前端
- `power-backend` 作为运行时插件
- `network-guard-plugin`
- `workspace-guard-plugin`
- `high-risk-command-guard-plugin`

默认配置文件来源：

- `default_config/openclaw.json`

## 建议

- 团队协作、正式发布：使用标准构建
- 本地调试、快速验证：使用本地快速构建
- 如果拉取基础镜像较慢，优先重试标准构建，不建议临时修改 Dockerfile
