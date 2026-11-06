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
3. 先手动运行 GitHub Actions 的 **Publish AlcorApi**，成功后使用应用的 `latest` 镜像。无需手填 Git 提交、digest 或软件版本。实际版本由镜像自身提供。
4. 准备独立数据库与账号、Redis 权限及共同的自建 Docker 网络；准备持久目录，并在核对目标后单独完成首次数据库初始化。仅填 `.env` 或启动容器不会自动初始化数据库。

`deploy/synology.env.example` 保留同内容副本。真实 `.env` 保留在部署机器，不上传 Git。

镜像构建定义位于 `deploy/Dockerfile`，运行模板为 `deploy/compose.yaml`。仅包含应用容器；PostgreSQL、Redis 和 Watchtower 由宿主机独立管理。使用独立数据库、账号和缓存权限，不重建已有数据卷。

`deploy/app.env.example`和 `deploy/compose.env.example` 只提供无秘密占位值。正式配置、凭据、数据和备份不得提交到仓库。

`/deploy-status` 提供管理员发布状态及配置入口。源码推送触发检查；镜像发布工作流需手动触发。应用启动和镜像更新均不自动执行数据库迁移，首次部署及迁移须明确核对目标后单独进行。

## 状态

软件版本由项目元数据及实际运行 API 提供，系统设置可打开版本记录。当前实现仍在开发；源码、测试通过、镜像发布与实际部署是不同状态。尚未迁移的旧业务和客户端能力不能视为已经可用。

## 持久文件与素材

群晖可使用带注释的 `deploy/compose.synology.yaml`，宿主机数据根目录由本机 `.env` 的 `ALCOR_DATA_DIR` 指定，Git 模板只保留占位值。连接配置放同目录 `.env`。五个持久目录为state、uploads、images、backups、backup-key；预先创建并设为UID/GID 10001、0700，文件0600。通用模板仍使用app.env和compose.env变量；选择一种配置，不混用。

用户文件根由ALCOR_FILE_ROOT指定，保留现有按SHA256命名的私有不可变文件约定；素材根由可选ALCOR_ASSET_ROOT指定，平铺ASCII文件名，容器只读，不放秘密。已配置素材通过管理员接口 `/api/media/assets/{name}` 以附件下载，不直接发布HTML/SVG或公开整个目录。素材上传管理界面及普通用户文件分发不由本次目录准备自动提供。

既有数据库头像保留；新增个人背景与旧协议原样头像位于 `ALCOR_FILE_ROOT/profile-media`，PG 保存本人归属、摘要、版本与操作回执。此私有目录随同一数据库快照加密备份，不直接公开为静态目录。内置前端素材仍随镜像发布。用户文件和已配置素材一并加密备份，素材恢复到隔离目标的assets目录，旧备份保持可恢复。新增目录不自动搬迁旧state/files，不执行PG迁移。已有部署更换路径前须单独核对并转移原文件；本项目不会静默复制或删除它们。

## 配置网页一键更新（独立 Watchtower）

发布与旧 Web 使用同一流程：GitHub Actions 构建应用镜像，构建成功后点击“通知群晖更新”，由独立 Watchtower 拉取并替换容器。此仓库不构建 Watchtower 镜像，不在应用 Compose 项目中编排更新服务。

- Watchtower 由宿主机单独部署，使用 HTTP API 模式，仅监控 `alcor-api` 范围；应用模板已设置 `com.centurylinklabs.watchtower.enable=true` 与 `com.centurylinklabs.watchtower.scope=alcor-api`。
- 应用与 Watchtower 加入经过核对的共同私有 Docker 网络。应用中的 `ALCOR_DEPLOYMENT_UPDATER_URL` 填该私网服务的 `/v1/update` 地址，`ALCOR_DEPLOYMENT_RUNNER_TOKEN` 沿用为其 HTTP API 令牌，与 Watchtower 的本机配置一致；不用网页更新时两项留空。应用没有 Docker socket 权限。
- 私有镜像的登录配置只放宿主机和 Watchtower 的本机配置。不开启删除数据卷选项；替换应用容器保留原端口、环境与持久挂载。已有自建更新器须先停止，避免两个更新服务同时操作同一应用。
- 通知请求先保存原 UUID；通知返回成功仅表示更新服务接受，不表示新容器已经健康。页面继续核对实际运行提交，只有目标版本、提交、数据库结构及 Worker 就绪匹配才报告成功。中断后查询原回执，不自动重复通知。

源码 push 只触发检查，不自动发布镜像或通知 Watchtower。发布工作流核对同一 main 提交的完整检查，并在运行标题中关联原构建回执。历史未知请求保留，重新构建须由用户明确确认且再次核对 main 与活跃发布。

应用更新不会执行数据库迁移。手动或 Watchtower 更新前，必须核对新镜像与目标数据库结构；结构不兼容时先安排可恢复备份和独立升级演练。不要通过清空数据库或跳过结构检查解决启动失败。

镜像健康检查使用 `deploy/healthcheck.py api`，同时核对数据库与 Worker。独立 Watchtower 的实际配置及群晖安装结果以宿主机验收为准，不以本机测试或 HTTP 200 代替。

## 更新前检查

手动重建项目前，先拉取目标镜像并用新镜像核对现有数据库。以下命令在部署项目目录执行，使用原 Compose 配置及连接身份：

```sh
docker compose pull &&
  docker compose run --rm --no-deps --entrypoint alcor app check-schema &&
  docker compose up -d
```

上述串联命令仅在检查退出码为 0 且 `compatible` 为 true 时执行重建。退出码 2 会列出 missing（缺少迁移）、changed（历史校验变化）、extra（数据库较新）；连接或身份核对失败退出码为 1。检查只读，不自动执行迁移。结构不兼容时保持原容器，先确认目标与可恢复备份，再单独安排迁移；不使用初始化参数。直接在界面重建项目会绕过此前置检查。

也可将 `deploy/update-project.sh` 单独放入部署项目目录并执行 `sh update-project.sh`；该入口严格按拉取、只读检查、重建顺序执行，任一步失败立即停止。不会自动迁移数据库。
