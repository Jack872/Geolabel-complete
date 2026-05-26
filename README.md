# RS-Labeler — AI 辅助的遥感样本协作标注平台

## 项目简介

RS-Labeler 是一个面向遥感影像的在线协作标注平台，整合人机交互、AI 辅助算法与团队协作机制，为遥感数据标注团队提供从原始影像接入、在线协同标注、AI 预标注/训练/推理，到标准化样本集生成与导出的一体化解决方案。

平台集成了 YOLO、SAM 等深度学习模型，支持用户在标注过程中实时调用 AI 进行辅助标注、在线训练和批量推理；同时提供团队管理、任务分发、审核流程、数据溯源和基于积分的社区共享机制，显著提升遥感影像标注和高质量数据集生产的效率。

---

## 系统架构

```
┌──────────────────────────────────────────────────────────┐
│                     Frontend (React)                      │
│              Umi 3 + Ant Design Pro + OpenLayers           │
│                    http://localhost:8000                    │
└──────────┬──────────────┬──────────────┬─────────────────┘
           │              │              │
     /wegismarkapi/   /api/       /api3/
           │              │              │
           ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ SpringBoot   │ │  FastAPI     │ │  GeoServer   │
│ (业务中台)    │ │  (AI 引擎)   │ │  (地图服务)   │
│ :1290        │ │  :5000       │ │  :8081       │
└──────┬───────┘ └──────┬───────┘ └──────────────┘
       │                │
       ▼                ▼
┌─────────────────────────────────────────────────┐
│            基础设施                                │
│  PostgreSQL :5432  │  Redis :6379  │  MinIO :9000 │
└─────────────────────────────────────────────────┘
```

- **前端 (React)**：用户交互界面，负责标注画布 (OpenLayers)、任务管理、模型管理、数据集浏览等
- **SpringBoot 后端**：业务中台，负责用户认证、任务调度、标注数据存储、样本集生成、GeoServer 联动、PROV 溯源
- **FastAPI 后端**：AI 执行引擎，负责 SAM/YOLO 模型推理、在线训练、标签更新等 GPU 密集型任务
- **GeoServer**：遥感影像瓦片服务，支持动态坐标系发布
- **MinIO**：对象存储，管理影像文件和模型文件
- **PostgreSQL + Redis**：业务数据持久化与缓存

---

## 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| **前端框架** | React + Umi | React 17 / Umi 3 | 企业级前端框架 |
| **UI 组件** | Ant Design Pro | v4 | ProTable / ProForm / ProLayout |
| **地图引擎** | OpenLayers | v5.3 | 矢量绘制、GeoJSON 编辑 |
| **坐标转换** | proj4 | v2 | 动态坐标系投影转换 |
| **业务后端** | Spring Boot | 2.7.6 (Java 17) | 主业务逻辑 |
| **ORM** | MyBatis-Plus | 3.4.3.4 | 数据库访问 |
| **安全** | Spring Security + JWT | java-jwt 4.3.0 | 认证与授权 |
| **API 文档** | Knife4j / Swagger | 3.0.0 | 自动生成 API 文档 |
| **AI 后端** | FastAPI + Uvicorn | Python 3.10 | GPU 任务执行 |
| **目标检测** | Ultralytics YOLO | — | YOLOv8 训练与推理 |
| **分割模型** | SAM (segment-geospatial) | sam2-hiera-tiny | 交互式分割 |
| **深度学习** | PyTorch + torchvision | — | 模型训练框架 |
| **传统 ML** | XGBoost / SVM / RandomForest | — | 地物分类 |
| **GIS 处理** | rasterio / shapely / pyproj / GDAL | — | 栅格/矢量/坐标处理 |
| **数据库** | PostgreSQL | 10 | 业务数据 + PostGIS |
| **缓存** | Redis | 7 | Session 缓存 + 消息 |
| **对象存储** | MinIO | latest | S3 兼容存储 |
| **地图服务** | GeoServer | latest | WMS/WMTS 瓦片发布 |
| **容器化** | Docker Compose | 3.8 | 6 个服务编排 |

---

## 功能概览

### 用户与团队管理
- 用户注册/登录 (JWT 认证)
- 角色权限控制 (管理员 / 普通用户)
- 团队创建与加入 (团队邀请码)
- 用户管理 (增删改查)

### 数据管理
- 遥感影像上传 (支持 TIF/GeoTIFF 大文件分片上传)
- 矢量数据上传与管理
- 坐标系选择 (支持 EPSG/ESRI 格式，自动从文件元数据检测)
- 本地文件与 GeoServer 双模式

### 任务管理
- 任务创建与发布 (支持 GeoServer 影像和本地影像)
- 任务分配到团队/个人
- 任务类型管理 (目标检测、地物分类、变化检测等)
- 任务生命周期 (发布 → 标注 → 提交 → 审核)
- 批量训练 / 批量推理
- 任务积分与统计

### 在线标注 (markPage)
- OpenLayers 矢量标注 (点/线/面/矩形)
- 几何编辑 (分割、合并、框选删除)
- 属性面板动态配置
- 增量保存 (一次请求处理新增/修改/删除)
- 唯一提交者锁定
- 快捷键支持

### AI 辅助标注
- **SAM 交互分割**：点击提示点自动生成分割掩膜
- **SAM 全图自动预标注**：基于 YOLO 检测 + SAM 分割
- **XGBoost 地物分类**：基于标注样本训练并推理全图
- **模型推理**：从模型库选择已训练模型执行推理

### 模型管理
- 模型上传 (支持 .pt / .pth / .h5 等格式)
- 模型元数据自动解析
- 在线训练 (YOLO / UNet / DeepLabV3+ / FastSCNN)
- 训练参数可视化配置
- 模型详情查看 (训练指标、超参数、类别映射)

### 样本集管理
- 标准化样本集生成 (COCO / YOLO / TDML 格式)
- 多版本发布管理
- 样本预览 (影像 + 掩膜 + 分类标签)
- 批量下载与导出
- 数据集社区共享 (积分机制)

### 审核与质量
- 审核流程 (通过/打回 + 反馈意见)
- 审核报告查看
- 质量参考评估 (覆盖率、IoU、分类准确率等)

### 数据溯源 (PROV)
- 全链路动作记录 (任务创建、标注提交、训练、推理)
- W3C PROV 标准模型 (Activity / Agent / Entity / Relation)

---

## 目录结构

```
Geolabel-complete/
├── Backend(SpringBoot)/          # Java 业务后端
│   ├── pom.xml                   # Maven 配置 (SpringBoot 2.7.6, Java 17)
│   ├── Dockerfile                # SpringBoot 容器镜像
│   ├── database_migration_*.sql  # 数据库迁移脚本
│   └── src/main/
│       ├── java/com/example/labelMark/
│       │   ├── LabelMarkApplication.java   # 启动入口
│       │   ├── config/           # Spring 配置 (Redis/Security/WebSocket/Swagger)
│       │   ├── controller/       # 18 个 REST 控制器
│       │   ├── domain/           # 26 个实体类
│       │   ├── DTO/              # 数据传输对象
│       │   ├── filter/           # JWT 过滤器
│       │   ├── handle/           # 认证成功/失败处理器
│       │   ├── mapper/           # MyBatis Mapper 接口
│       │   ├── service/          # 服务接口与实现 (40+ 个)
│       │   └── utils/            # 工具类 (GeoServer/MinIO/JWT/PROV等)
│       └── resources/
│           ├── application.yml   # 主配置 (profile 切换)
│           ├── mapper/           # MyBatis XML 映射文件
│           └── logback.xml       # 日志配置
│
├── Backend(FastAPI)/             # Python AI 后端
│   ├── main.py                   # FastAPI 入口 (4 个核心端点)
│   ├── requirements.txt          # Python 依赖
│   ├── Dockerfile                # FastAPI 容器镜像
│   ├── train.py                  # 模型训练逻辑
│   ├── train_mult.py             # 批量多影像训练
│   ├── inference.py              # 模型推理逻辑
│   ├── utils_sam.py              # SAM 交互分割工具
│   ├── utils_yolo.py             # YOLO 训练/推理工具
│   ├── update_label.py           # 标注结果更新
│   ├── utils_prov.py             # PROV 溯源记录
│   ├── utils_db.py               # 数据库工具
│   ├── utils_storage.py          # 文件存储工具
│   ├── dataset.py                # 数据集处理
│   ├── trainers.py               # 训练器工厂
│   ├── model_runtime/            # 模型运行时 (元数据解析/加载/构建)
│   └── models/                   # 模型定义 (UNet/DeepLab/FastSCNN/RF/SVM/XGBoost)
│
├── Frontend(React)/portal/       # 前端项目
│   ├── package.json              # 依赖 (React 17, Umi 3, OpenLayers 5, Antd 4)
│   ├── config/
│   │   ├── config.js             # Umi 配置
│   │   ├── routes.js             # 路由定义
│   │   ├── proxy.js              # 开发代理配置
│   │   └── defaultSettings.js    # 主题设置
│   └── src/
│       ├── pages/
│       │   ├── markPage/         # 核心标注页面
│       │   ├── auditPage/        # 审核页面
│       │   ├── taskManage/       # 任务管理
│       │   ├── dataManage/       # 数据管理 (上传)
│       │   ├── modelManage/      # 模型管理
│       │   ├── personalTaskList/ # 个人任务列表
│       │   ├── datasetStore/     # 数据集商店
│       │   ├── serviceManage/    # 服务管理
│       │   ├── userManage/       # 用户管理
│       │   ├── home/             # 首页
│       │   ├── Category/         # 类别管理
│       │   └── user/             # 登录/注册
│       ├── services/map/api.js   # API 调用封装
│       └── utils/                # 工具函数 (坐标系等)
│
├── depoly/
│   └── docker-compose.yml        # Docker Compose 编排 (6 个服务)
│
└── images/                       # 文档图片
```

---

## 快速开始

### 环境要求

| 工具 | 最低版本 | 说明 |
|------|----------|------|
| JDK | 17+ | SpringBoot 编译运行 |
| Maven | 3.6+ | Java 依赖管理 |
| Node.js | 16+ | 前端开发 |
| Python | 3.10+ | AI 后端运行 |
| Docker & Docker Compose | — | 启动 PostgreSQL/Redis/GeoServer/MinIO |
| CUDA | 11.8+ (可选) | GPU 加速 (SAM/YOLO) |

### 方式一：Docker Compose 一键启动 (推荐)

```bash
# 1. 进入部署目录
cd depoly

# 2. 启动所有基础设施 + 后端服务
docker-compose up -d

# 3. 验证服务状态
docker-compose ps
```

Docker Compose 会启动 6 个容器：

| 服务 | 端口 | 说明 |
|------|------|------|
| geolabel-postgres | 5432 | PostgreSQL 数据库 |
| geolabel-redis | 6379 | Redis 缓存 |
| geolabel-geoserver | 8081→8080 | GeoServer 地图服务 |
| geolabel-minio | 9000/9001 | MinIO 对象存储 |
| geolabel-python-api | 5000 | FastAPI AI 服务 |
| geolabel-app | 1290 | SpringBoot 业务服务 |

### 方式二：手动启动各服务

#### 1. 启动基础设施

```bash
# PostgreSQL (数据库 geolabel, 用户 postgres, 密码 88888888)
docker run -d --name geolabel-postgres \
  -e POSTGRES_DB=geolabel -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=88888888 \
  -p 5432:5432 postgres:10

# Redis (密码 123321)
docker run -d --name geolabel-redis \
  -p 6379:6379 redis:7 redis-server --requirepass 123321

# GeoServer (admin/geoserver)
docker run -d --name geolabel-geoserver \
  -p 8081:8080 kartoza/geoserver:latest

# MinIO (minioadmin/minioadmin, Console :9001)
docker run -d --name geolabel-minio \
  -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio:latest server /data --console-address ":9001"
```

#### 2. 启动 SpringBoot 后端

```bash
cd Backend(SpringBoot)

# 创建 application-dev.yml (从模板复制或参考 docker-compose 中的环境变量)
# 必须配置: 数据库连接, Redis, GeoServer URL, MinIO, Python 服务地址

mvn spring-boot:run
# 服务启动在 http://localhost:1290
# Swagger 文档: http://localhost:1290/doc.html
```

#### 3. 启动 FastAPI 后端

```bash
cd Backend(FastAPI)

# 安装依赖
pip install -r requirements.txt

# 创建 .env 文件 (参考 docker-compose 中的环境变量)
echo 'SPRING_BOOT_BASE_URL=http://localhost:1290' > .env
echo 'CORS_ORIGINS=http://localhost:8000,http://localhost:3000' >> .env

# 启动 (开发模式)
python -m uvicorn main:app --host 0.0.0.0 --port 5000 --reload
# API 文档: http://localhost:5000/docs
```

#### 4. 启动前端

```bash
cd Frontend(React)/portal

# 安装依赖
npm install

# 启动开发服务器
npm run start:dev
# 访问 http://localhost:8000
```

---

## 核心业务流程

### 标注流程
```
管理员创建任务 → 选择影像(GeoServer/本地) → 配置标注类型(目标检测/地物分类等)
  → 发布任务 → 分配标注员 → 标注员打开 markPage → 在线绘制矢量标注
  → 增量保存(新增/修改/删除) → 提交任务 → 审核员审核(通过/打回+反馈)
  → 生成样本集 → 导出(COCO/YOLO/TDML)
```

### AI 辅助流程
```
标注员选择模型 → 在影像上添加提示点 → 调用 SAM 交互分割
  → 或基于已有标注训练 XGBoost → 推理全图 → 后处理掩膜
  → 更新标注 → 标注员审核修正 → 提交
```

### 训练流程
```
用户上传模型 → 选择训练任务(已审核的标注数据) → 配置参数(epochs/batch/lr等)
  → 提交训练 → SpringBoot 异步投递到 FastAPI → GPU 训练
  → 训练完成回调 → 通知用户 → 模型入库 → 可执行推理
```

### 坐标系处理流程
```
影像上传 → 用户选择/系统自动检测坐标系(EPSG/ESRI) → 存储到 server 表
  → GeoServer 发布时配置对应 SRS → 前端按任务坐标系渲染
  → 标注数据按正确坐标语义保存 → 导出时转换到目标坐标系
```

---

## 前端页面路由

| 路由 | 页面 | 说明 |
|------|------|------|
| `/home` | 首页 | 系统概览 |
| `/user/login` | 登录 | 用户登录 |
| `/user/register` | 注册 | 用户注册 |
| `/userlist` | 用户管理 | 管理员管理用户(需 admin 权限) |
| `/dataManage` | 数据管理 | 矢量/影像上传 |
| `/personalTaskList` | 个人任务 | 我的标注任务列表 |
| `/taskmanage` | 任务管理 | 创建/发布/分配任务 |
| `/map` | 标注页面 | 核心标注画布 (嵌入 iframe 新窗口打开) |
| `/auditPage` | 审核页面 | 审核标注结果 |
| `/servicemanage` | 服务管理 | GeoServer 服务管理 |
| `/datasetStore` | 数据集商店 | 样本集浏览/下载/共享 |
| `/modelManage` | 模型管理 | 模型上传/训练/详情 |
| `/category` | 类别管理 | 标注类别配置 |

---

## API 概览

### SpringBoot REST API (基础路径: `/wegismarkapi`)

| Controller | 路径前缀 | 主要功能 |
|------------|----------|----------|
| SysUserController | `/user` | 注册、登录、用户管理、密码重置 |
| TaskController | `/task` | 任务创建、发布、分配、提交、审核、列表 |
| MarkController | `/mark` | 标注保存(增量)、模型列表、SAM调用、几何操作 |
| ModelController | `/model` | 模型上传、列表、详情、删除、更新 |
| DatasetController | `/dataset` | 数据集 CRUD、缩略图 |
| DatasetStoreController | `/datasetStore` | 样本集生成、下载、预览 |
| SampleSetController | `/sampleSet` | 样本集管理、导出(TDML) |
| GeoServerController | `/geoserver` | 发布图层、获取影像 |
| ServerController | `/server` | 服务管理 |
| SysFileController | `/files` | 文件分片上传/合并/删除 |
| TeamController | `/team` | 团队创建/加入/列表 |
| TypeController | `/type` | 标注类型管理 |
| AuditController | `/audit` | 审核通过/打回 |
| TaskCallbackController | `/task-callback` | FastAPI 训练/推理完成回调 |
| TaskAcceptedController | `/taskAccepted` | 任务接收状态 |
| imgController | `/img` | 影像获取 |

### FastAPI API (端口 5000)

| 端点 | 方法 | 功能 |
|------|------|------|
| `/assistFunction` | POST | SAM 交互分割、XGBoost 提取、深度学习训练 |
| `/Multi_assistFunction` | POST | 批量多影像训练 |
| `/inferenceFunction` | POST | 模型推理 (YOLO/SAM) |
| `/update_label` | POST | 更新标注标签 |
| `/docs` | GET | Swagger API 文档 |

### API 文档入口

- **SpringBoot Swagger**: http://localhost:1290/doc.html
- **FastAPI Swagger**: http://localhost:5000/docs

---

## 配置说明

### SpringBoot 多环境配置

`application.yml` 使用 Maven profile 切换环境：
```yaml
spring:
  profiles:
    active: '@environment@'
```

配置文件通过 Git 忽略 (`application-dev.yml` 在 `.gitignore` 中)，需要在本地创建。主要配置项：

| 配置项 | 说明 | 示例值 |
|--------|------|--------|
| `spring.datasource.url` | 数据库连接 | `jdbc:postgresql://localhost:5432/geolabel` |
| `spring.datasource.username/password` | 数据库认证 | `postgres` / `88888888` |
| `spring.redis.host/port/password` | Redis 连接 | `localhost:6379` / `123321` |
| `minio.endpoint/accessKey/secretKey` | MinIO 连接 | `localhost:9000` / `minioadmin` / `minioadmin` |
| `geoserver.url/user/password` | GeoServer REST API | `http://localhost:8081/geoserver` / `admin` / `geoserver` |
| `python.service.url` | FastAPI 地址 | `http://localhost:5000` |

### FastAPI 环境变量 (`.env` 文件)

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SPRING_BOOT_BASE_URL` | SpringBoot 回调地址 | `http://localhost:1290` |
| `CORS_ORIGINS` | 允许的跨域来源 | `http://localhost:3000` |
| `SAM_MODEL_ID` | SAM 模型 ID | `sam2-hiera-tiny` |
| `SAM_CHECKPOINT` | SAM 权重文件路径 | `/opt/geolabel/models/sam2_hiera_tiny.pt` |
| `AUTO_BUILDING_YOLO_PATH` | 自动标注 YOLO 权重 | `/opt/geolabel/models/best.pt` |
| `PRELOAD_SAM_ON_STARTUP` | 启动时预加载 SAM | `false` |

### 前端代理配置

开发环境下 Umi 代理规则 (`config/proxy.js`)：

| 前缀 | 目标 | 说明 |
|------|------|------|
| `/wegismarkapi/` | `http://localhost:1290` | SpringBoot 后端 |
| `/api/` | `http://localhost:5000` | FastAPI 后端 |
| `/api3/` | GeoServer REST | GeoServer 管理 |

---

## 开发指南

### 关键入口文件

**后端 (高频修改)**

| 文件 | 说明 |
|------|------|
| `Backend(SpringBoot)/.../controller/TaskController.java` | 任务相关全部接口 (2100+ 行) |
| `Backend(SpringBoot)/.../service/impl/TaskServiceImpl.java` | 任务核心业务逻辑 |
| `Backend(SpringBoot)/.../service/impl/MarkServiceImpl.java` | 标注保存核心逻辑 (增量保存) |
| `Backend(SpringBoot)/.../service/TaskExecutorService.java` | AI 任务异步执行调度 |
| `Backend(SpringBoot)/.../service/impl/GeoServerServiceImpl.java` | GeoServer 发布/管理 |
| `Backend(SpringBoot)/.../controller/MarkController.java` | 标注相关接口 (800+ 行) |
| `Backend(SpringBoot)/.../service/impl/ModelServiceImpl.java` | 模型管理业务逻辑 |
| `Backend(FastAPI)/main.py` | FastAPI 全部端点定义 |
| `Backend(FastAPI)/train.py` | 模型训练入口 |
| `Backend(FastAPI)/inference.py` | 模型推理入口 |

**前端 (高频修改)**

| 文件 | 说明 |
|------|------|
| `Frontend(React)/portal/src/pages/markPage/index.jsx` | 标注页面主组件 |
| `Frontend(React)/portal/src/pages/markPage/components/basicMap.jsx` | OpenLayers 地图封装 |
| `Frontend(React)/portal/src/pages/taskManage/index.jsx` | 任务管理页面 |
| `Frontend(React)/portal/src/pages/modelManage/index.jsx` | 模型管理页面 |
| `Frontend(React)/portal/src/services/map/api.js` | API 调用封装 |
| `Frontend(React)/portal/config/routes.js` | 前端路由定义 |

### 数据库迁移

项目根目录 `Backend(SpringBoot)/` 下有多个数据库迁移 SQL 脚本：

```
database_migration_attribute_config.sql        # 属性配置迁移
database_migration_dataset_type_and_task_batch.sql  # 数据集类型和任务批次
database_migration_file_metadata.sql            # 文件元数据
database_migration_mark_attr_json.sql           # 标注属性 JSON
database_migration_minio_file_root.sql          # MinIO 文件根路径
database_migration_task_annotation_schema.sql   # 任务标注模式
database_migration_task_item.sql                # 任务子项
database_migration_task_item_collab.sql         # 任务子项协作
database_migration_type_auto_increment.sql      # 类型自增 ID
```

### 关键技术要点

1. **标注增量保存**：`MarkServiceImpl.saveMarkInfoIncremental()` 一次请求同时处理新增/更新/删除三种操作
2. **异步任务模式**：AI 训练/推理通过 `TaskExecutorService` 异步投递，FastAPI 完成后通过回调通知 SpringBoot
3. **坐标系动态获取**：全链路 (上传→发布→标注→推理→导出) 不再依赖固定 EPSG，支持 NONE (像素坐标)
4. **双后端回调**：SpringBoot 调用 FastAPI 执行 AI 任务，FastAPI 执行完成后 POST 回 SpringBoot 的 `/task-callback/*` 接口
5. **CUDA OOM 降级**：SAM 模型在显存不足时自动降级到 CPU
6. **本地/GeoServer 双模式**：`taskSource` 字段区分 `geoserver` 和 `local` 两种影像来源

---

## 部署说明

### Docker Compose 部署 (完整环境)

```bash
# 1. 构建 SpringBoot JAR
cd Backend(SpringBoot)
mvn clean package -DskipTests
cd ..

# 2. 启动全部服务
cd depoly
docker-compose up -d

# 3. 查看日志
docker-compose logs -f app
docker-compose logs -f python-api

# 4. 停止服务
docker-compose down
```

### 数据库初始化

首次启动后，需要执行数据库迁移脚本建立表结构：

```bash
# 连接 PostgreSQL
psql -h localhost -U postgres -d geolabel

# 依次执行迁移脚本
\i Backend(SpringBoot)/database_migration_*.sql
```

### 健康检查

| 服务 | 验证方式 |
|------|----------|
| SpringBoot | `curl http://localhost:1290/doc.html` |
| FastAPI | `curl http://localhost:5000/docs` |
| PostgreSQL | `psql -h localhost -U postgres -d geolabel -c "SELECT 1"` |
| Redis | `redis-cli -a 123321 PING` |
| GeoServer | `curl http://localhost:8081/geoserver/rest/about/version.json` |
| MinIO | 浏览器访问 `http://localhost:9001` (Console) |
| 前端 | 浏览器访问 `http://localhost:8000` |

---

## 开发常用命令

```bash
# === SpringBoot ===
cd Backend(SpringBoot)
mvn clean compile                              # 编译
mvn spring-boot:run                            # 启动 (开发)
mvn clean package -DskipTests                  # 打包

# === FastAPI ===
cd Backend(FastAPI)
pip install -r requirements.txt                # 安装依赖
python -m uvicorn main:app --host 0.0.0.0 --port 5000 --reload  # 启动 (热重载)

# === 前端 ===
cd Frontend(React)/portal
npm install                                     # 安装依赖
npm run start:dev                              # 启动开发服务器
npm run build                                  # 生产构建

# === Docker ===
cd depoly
docker-compose up -d                           # 启动全部
docker-compose down                            # 停止全部
docker-compose logs -f <service>               # 查看服务日志
```
