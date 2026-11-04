# Alcor-api

React / Vite 前端、FastAPI API、PostgreSQL 持久存储、Redis 缓存及独立 Worker。

## 本地运行

需要 Python 3.12、Node.js 22、uv 和用于编译 Redis 的构建工具。

在仓库目录执行：

```sh
uv sync --locked
npm ci
uv run python tools/bootstrap-redis.py
npm run build
uv run python tools/local-runtime.py
```

默认访问 `http://127.0.0.1:8088`。开发运行器管理项目私有的 PostgreSQL、Redis、API 和 Worker；不使用已有数据库作为测试库。首次注册成功的账号获得管理员权限，无默认账号或默认密码。

## 检查

```sh
uv run pytest -q
npm run test:web
npm run build
uv run python tools/validate-deployment.py --root .
python3 tools/audit-source.py
```

## 自定义汇率来源

默认不访问外部汇率来源。实例管理员先在私有环境配置 `ALCOR_FX_PROVIDER_TARGETS`，明确允许的协议、域名、端口、路径及目标 IP；空列表拒绝自定义目标。网页中的确认操作不能扩大该名单。HTTP 还须在实例名单与本次配置中明确允许。

在“汇率与日历”配置来源地址、可选 Bearer、缺省基准币种与来源时间字段。完整地址和凭据加密保存，读取不返回秘密；更换来源需重新填写秘密，普通开关或额度保存保留当前来源。缺失报价保持缺失，不使用内置假值。

定时表达式沿用旧 JavaScript 语法，配置时通过有界 Node 进程编译为最多 96 个时刻，须指定 IANA 时区；Worker 使用已保存时刻执行，不运行正则或追补无限历史。容器自带编译器，本地运行需要 Node.js 22。恢复副本默认禁止外部读取，原失败或中断任务不自动重发。

## Docker

群晖配置入口：**[.env.example](.env.example)** 和 **[compose.synology.yaml](deploy/compose.synology.yaml)**。

1. 将 `deploy/compose.synology.yaml` 保存为群晖项目目录的 `compose.yaml`。
2. 将根目录 `.env.example` 保存为同目录的 `.env`，按注释填写必填项；可选发布/OAuth 配置可以留空。
3. 先手动运行 GitHub Actions 的 **Publish AlcorApi**，成功后使用应用和更新器的 `latest` 镜像。无需手填 Git 提交、digest 或软件版本。实际版本由镜像自身提供。
4. 准备独立数据库与账号、Redis 权限及共同的自建 Docker 网络；准备持久目录，并在核对目标后单独完成首次数据库初始化。仅填 `.env` 或启动容器不会自动初始化数据库。

`deploy/synology.env.example` 保留同内容副本。真实 `.env` 保留在部署机器，不上传 Git。

镜像构建定义位于 `deploy/Dockerfile`，运行模板为 `deploy/compose.yaml`。包含应用与独立的 `alcor-api-updater` 两个容器；PostgreSQL 和 Redis 是外部依赖。使用独立数据库、账号和缓存权限，不重建已有数据卷。

`deploy/app.env.example`、`deploy/compose.env.example` 和 `deploy/runner.config.example.json` 只提供无秘密占位值。正式配置、凭据、数据和备份不得提交到仓库。

`/deploy-status` 提供管理员发布状态及配置入口。源码推送触发检查；镜像发布工作流需手动触发。应用启动和镜像更新均不自动执行数据库迁移，首次部署及迁移须明确核对目标后单独进行。

## 状态

软件版本由项目元数据及实际运行 API 提供，系统设置可打开版本记录。当前实现仍在开发；源码、测试通过、镜像发布与实际部署是不同状态。尚未迁移的旧业务和客户端能力不能视为已经可用。

## 持久文件与素材

群晖可使用带注释的 `deploy/compose.synology.yaml`，宿主机数据根目录由本机 `.env` 的 `ALCOR_DATA_DIR` 指定，Git 模板只保留占位值。连接配置放同目录 `.env`。五个持久目录为state、uploads、images、backups、backup-key；预先创建并设为UID/GID 10001、0700，文件0600。通用模板仍使用app.env和compose.env变量；选择一种配置，不混用。

用户文件根由ALCOR_FILE_ROOT指定，保留现有按SHA256命名的私有不可变文件约定；素材根由可选ALCOR_ASSET_ROOT指定，平铺ASCII文件名，容器只读，不放秘密。已配置素材通过管理员接口 `/api/media/assets/{name}` 以附件下载，不直接发布HTML/SVG或公开整个目录。素材上传管理界面及普通用户文件分发不由本次目录准备自动提供。

既有数据库头像保留；新增个人背景与旧协议原样头像位于 `ALCOR_FILE_ROOT/profile-media`，PG 保存本人归属、摘要、版本与操作回执。此私有目录随同一数据库快照加密备份，不直接公开为静态目录。内置前端素材仍随镜像发布。用户文件和已配置素材一并加密备份，素材恢复到隔离目标的assets目录，旧备份保持可恢复。新增目录不自动搬迁旧state/files，不执行PG迁移。已有部署更换路径前须单独核对并转移原文件；本项目不会静默复制或删除它们。

## 配置网页一键更新（独立更新器容器）

`alcor-api-updater` 常驻运行，网页提交更新后通过私有内网接口立即唤醒；不需要 DSM 任务计划、宿主机 Python 或群晖 git pull。更新器仅选择 Compose 项目 `alcor-api` 下带 `com.alcor.update.scope=alcor-api` 的 `app` 服务，不触碰其他项目，也不自动更新自身。

1. `.env` 中配置 `ALCOR_APP_IMAGE=ghcr.io/自己的账号/仓库:latest`；更新器镜像自动使用同仓库名加 `-updater:latest`，两个镜像由同一个发布工作流提供。`ALCOR_DEPLOYMENT_REPOSITORY` 填源码仓库，`ALCOR_DEPLOYMENT_IMAGE` 填不带标签的应用镜像仓库。
2. 设置至少 32 个随机字符的 `ALCOR_DEPLOYMENT_RUNNER_TOKEN`。Compose 将同一密钥传给应用和更新器；更新器接口没有宿主机端口映射，只在内部控制网络可见。Docker socket 仅挂入更新器，应用没有 Docker 权限。更新器拥有该宿主机 Docker 控制权限，须与应用一同由受信任操作员管理。
3. 更新器状态使用独立 Docker 持久卷，自动以 root、0700 初始化，不挂入应用；保存中断状态、回执和含私有环境配置的更新前快照。保留此卷，不上传 Git。
4. 使用有私有镜像读取权限的账号执行 `docker login ghcr.io`；PAT classic 至少具有 `read:packages`。`DOCKER_CONFIG_DIR` 指向该次登录的 `config.json` 所在目录，仅更新器只读挂载。支持 Docker config 的内联 auth/identitytoken；使用外部 credential helper 的部署须先为更新器配置独立内联登录文件。
5. 首次单独完成数据库初始化并启动应用和更新器。网页发布配置填写 GitHub 授权或仓库专用 Token；手动 Token 使用 Contents 读取、Actions 读写、Metadata 读取。之后在 `/deploy-status` 点击“构建发布”，成功后点击“更新群晖”。源码 push 仍只触发检查，不自动发布或部署。

配置一直使用 `latest`，不必每次改 `.env`。每次更新先在平台持久化批准的版本、提交、数据库结构摘要和实际镜像 digest；更新器拉取 `latest` 后核对同一镜像与标签，再以解析出的镜像 ID 创建容器，避免标签变化换成另一个版本。数据库结构不同则停止，须先单独安排备份和迁移。不会随更新执行数据库迁移。

更新保留现有环境、持久目录、端口、网络和资源限制；实际软件版本与源码标识从新镜像取值；`.env` 不设置 `ALCOR_RELEASE_VERSION`、`ALCOR_SOURCE_REVISION` 或 `ALCOR_DEPLOYMENT_RUNNING_IMAGE`。只有新应用的 Docker 健康检查、镜像 ID、版本及提交均匹配，才报告成功。旧镜像保留，不删除数据卷；旧容器仅在新容器健康后移除。更新不自动同步新的 Compose 文件、挂载、秘密或更新器脚本；这些变更仍须单独核对后重建。

健康检查统一使用镜像中的 `deploy/healthcheck.py`：API 必须同时通过数据库结构校验和 Worker 心跳检查，更新器必须近期成功联系 API。失败时返回非零退出码和简短中文提示，不输出响应正文或连接异常详情；成功不会把仅存活的进程误报为就绪。HTTP 503 需要进一步核对启动日志，不能单凭此状态认定数据库需要升级。

手动重建也不会升级数据库结构。跨结构版本更新前，先核对目标实例和迁移记录，完成加密备份、独立恢复及升级演练，再安排实际结构升级与重建的维护窗口。验收须核对实际版本、数据库就绪、Worker 和更新器健康；不能通过清空库、跳过结构校验或写入测试数据解决启动失败。

页面关闭不影响已受理的请求。进程中断后只核对原 UUID 和容器，不自动再次替换；回执发送失败只重传同一回执。没有待执行请求时，更新器仅报告在线状态。既有 `deploy/update-runner.py` 和配置模板继续供旧宿主机执行器兼容使用，同一项目只启用一种执行方式。

本机与 CI 隔离检查不等同群晖现场安装或更新验收。
