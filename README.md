# AI辅助的遥感样本协作标注平台

## 项目简介

随着对地观测技术的飞速发展，海量遥感数据为各行业提供了关键信息源，但从中高效、准确地提取有价值信息仍面临巨大挑战。传统人工解译方式成本高昂且效率低下，难以满足大规模动态监测需求。以深度学习为代表的AI技术为此带来了新契机，但在高质量样本标注、高效协同作业、AI模型集成应用以及一体化流程构建等方面仍存在瓶颈。

为应对上述挑战，本项目设计并开发实现了一个**AI辅助的遥感样本协作标注平台**。平台的核心目标是整合人机交互技术、人工智能算法以及在线协作方法，为用户提供一个从原始遥感影像接入到样本标注成果智能化生成、输出的一体化、高效能解决方案。

本系统采用 **React + Spring Boot + FastAPI** 异构技术栈，集成了 **YOLO、SAM** 等AI辅助算法，建立团队管理与基于积分的数据社区共享激励机制。系统主要功能涵盖用户团队管理、遥感影像数据上传与服务发布、在线协同标注、AI辅助标注、在线模型训练与推理、标准化样本集生成与管理等。

---

## 技术栈

### 后端主业务（Java）
| 技术 | 版本 |
|---|---|
| Spring Boot | 2.7.6 |
| Java | 17 |
| MyBatis-Plus | 3.4.3.4 |
| Spring Security + JWT | - |
| Knife4j / Swagger | API文档 |
| GeoTools / JTS | 地理空间计算 |
| MinIO SDK (S3兼容) | 对象存储 |

### AI后端（Python）
| 技术 | 用途 |
|---|---|
| FastAPI | REST服务框架 |
| PyTorch | 深度学习引擎 |
| Ultralytics YOLO | 目标检测模型 |
| SAM (segment-anything) | 语义分割模型 |
| rasterio + pyproj | 遥感影像处理与坐标系投影 |
| shapely | 地理几何运算 |

### 前端（React）
| 技术 | 用途 |
|---|---|
| React 17 + Umi 3 | 前端框架 |
| Ant Design Pro 5 | UI组件库 |
| OpenLayers | 地图渲染与交互标注 |
| @ant-design/charts | 数据可视化 |

### 基础设施
| 组件 | 用途 | 端口映射 |
|---|---|---|
| PostgreSQL 10 | 业务数据库 | 5432 |
| Redis 7 | 缓存 | 6379 |
| GeoServer | GIS地图服务 | 8081 → 8080 |
| MinIO | 对象存储 | 9000 (API) / 9001 (控制台) |

---

## 系统架构

<div align="center"> <img src="images/架构图.png" alt="系统架构" width="80%"> </div>

平台采用**双后端 + 前端 + 基础设施**的分层架构：

```
┌─────────────────────────────────────────────────┐
│                  React 前端                       │
│   标注页面 · 任务管理 · 模型管理 · 质量评估 · 溯源  │
└──────────────┬──────────────────────┬───────────┘
               │ HTTP/API             │ WebSocket
┌──────────────▼──────────────────────▼───────────┐
│           SpringBoot 后端（业务中台）              │
│   用户 · 任务 · 标注 · 模型 · 数据集 · 质量 · 溯源 │
│   端口 1290                                      │
└──────────────┬──────────────────────────────────┘
               │ 异步调用 + 回调
┌──────────────▼──────────────────────────────────┐
│           FastAPI 后端（AI执行引擎）               │
│   SAM/YOLO推理 · 模型训练 · 质量评估 · 标注更新    │
│   端口 5000                                      │
└──────────────┬──────────────────────────────────┘
               │
┌──────────────┴───────────┬───────────┬──────────┐
│     PostgreSQL           │  Redis    │ MinIO    │
│     业务数据              │  缓存      │ 对象存储  │
└──────────────────────────┴───────────┴──────────┘
```

---

## 功能概览

<div align="center"> <img src="images/功能概览.png" alt="功能概览" width="80%"> </div>

### 核心功能模块

| 模块 | 功能 |
|---|---|
| **用户与团队管理** | 注册/登录、团队创建与管理、角色权限控制、积分激励机制 |
| **影像数据管理** | 遥感影像上传、GeoServer服务发布、矢量数据管理、多源数据接入 |
| **协同标注** | 基于OpenLayers的在线标注（点/线/面）、增量保存、标注审核、唯一提交者机制 |
| **AI辅助标注** | SAM模型预标注（提示点驱动）、YOLO目标检测辅助、XGBoost像素级分类 |
| **在线模型训练** | 支持UNet/DeepLabv3+/FastSCNN架构、超参数配置、训练可视化监控、批量训练 |
| **模型推理** | 模型库管理、选择模型对新影像推理、结果可视化与交互式编辑 |
| **质量评估** | 覆盖率、低置信度占比、分类准确率、IoU等指标、参考模型评估、进度回调 |
| **数据集管理** | 标准化样本集生成、数据集存储与共享、社区数据集积分兑换 |
| **全链路溯源** | PROV溯源记录（任务创建/分配、标注提交、训练、推理、更新标签） |

---

## 主要功能流程

### AI辅助标注流程

<div align="center"> <img src="images/AI辅助流程图.png" alt="AI辅助流程图" width="80%"> </div>

### 辅助标注示例

<div align="center"> <img src="images/辅助标注a.png" alt="辅助标注a" width="30%"> <img src="images/辅助标注b.png" alt="辅助标注b" width="30%"> <img src="images/辅助标注c.png" alt="辅助标注c" width="30%"> </div>

在"地物分类"任务中，绘制"点"样本作为提示点，将根据提示点调用SAM模型生成预标注样本。如果影像范围过大，则以已有标注为样本训练XGBoost模型并进行推理，实现对整个影像的像素级分类。

### 模型训练及推理

<div align="center"> <img src="images/模型训练.png" alt="模型训练" width="32%"> <img src="images/模型推理.png" alt="模型推理" width="32%"> <img src="images/推理结果.png" alt="推理结果展示" width="32%"> </div>

平台提供用户友好的在线模型训练服务，支持用户基于平台内高质量标注数据，通过图形化界面选择模型架构（UNet / DeepLabv3+ / FastSCNN）、配置超参数并发起训练任务，后端自动化调度数据预处理和计算资源，并提供训练过程的可视化监控。训练完成的AI模型及其元数据纳入统一的模型库管理体系。最终，用户可从模型库选择模型对新影像执行推理，推理结果经智能化后处理后在前端可视化，并支持交互式编辑，形成模型应用与结果反馈的闭环。

---

## 快速启动

### 前置要求

- Docker & Docker Compose
- Java 17+（本地开发）
- Node.js 16+（本地开发）
- Python 3.10+（本地开发）
- NVIDIA GPU + CUDA（AI训练/推理，可选但推荐）

### Docker部署（推荐）

```bash
# 1. 进入部署目录
cd depoly

# 2. 启动所有服务
docker-compose up -d

# 3. 检查服务状态
docker-compose ps
```

服务启动后访问：

| 服务 | 地址 |
|---|---|
| 前端页面 | http://localhost:8000 |
| SpringBoot后端API | http://localhost:1290 |
| FastAPI AI服务 | http://localhost:5000 |
| GeoServer | http://localhost:8081 |
| MinIO控制台 | http://localhost:9001 |

### 本地开发

#### 1. 基础设施（Docker）

```bash
cd depoly
docker-compose up -d postgres redis geoserver minio
```

#### 2. SpringBoot后端

```bash
cd "Backend(SpringBoot)"
mvn clean install
java -jar target/*.jar
# 或使用IDE运行 LabelMarkApplication
```

#### 3. FastAPI后端

```bash
cd "Backend(FastAPI)"
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
# 编辑 .env 配置数据库等连接信息
uvicorn main:app --host 0.0.0.0 --port 5000 --reload
```

#### 4. React前端

```bash
cd "Frontend(React)/portal"
npm install
npm run start:dev
```

---

## 项目目录结构

```
Geolabel-complete/
├── Backend(SpringBoot)/        # Java后端主业务模块
│   ├── src/main/java/
│   │   └── com/example/labelMark/
│   │       ├── controller/     # 18个控制器（任务/标注/模型/用户/团队/审核/数据集/质量/GeoServer等）
│   │       ├── service/        # 业务逻辑层
│   │       ├── mapper/         # MyBatis数据访问层
│   │       └── domain/         # 实体类（Task, Mark, Model等）
│   ├── src/main/resources/
│   │   ├── mapper/             # MyBatis XML映射
│   │   ├── application.yml     # 主配置
│   │   └── application-dev.yml # 开发环境配置
│   ├── Dockerfile              # Docker构建文件
│   ├── pom.xml                 # Maven依赖管理（Spring Boot 2.7.6）
│   └── database_migration_*.sql # 数据库迁移脚本
│
├── Backend(FastAPI)/           # Python FastAPI深度学习模块
│   ├── main.py                 # 入口：SAM/YOLO推理、训练、评估、回调
│   ├── train.py / train_mult.py / inference.py / update_label.py  # 训练推理流水线
│   ├── models/                 # 模型定义（unet/deeplab/fast_scnn/xgboost/svm等）
│   ├── model_runtime/          # 模型运行时（构建/加载/元数据）
│   ├── utils.py / utils_db.py / utils_sam.py / utils_prov.py  # 工具模块
│   ├── dataset.py              # 数据集处理
│   ├── requirements.txt        # Python依赖
│   ├── Dockerfile              # Docker构建文件
│   └── .env.example            # 环境变量模板
│
├── Frontend(React)/            # React前端主项目
│   └── portal/
│       ├── src/pages/
│       │   ├── markPage/       # 核心标注页面（OpenLayers）
│       │   ├── taskManage/     # 任务管理
│       │   ├── personalTaskList/ # 个人任务列表
│       │   ├── modelManage/    # 模型管理
│       │   ├── dataManage/     # 数据管理（影像/矢量）
│       │   ├── dataCommunity/  # 数据社区
│       │   ├── datasetStore/   # 数据集商店
│       │   ├── quality/        # 质量评估
│       │   ├── prov/           # PROV溯源
│       │   ├── auditPage/      # 审核页面
│       │   ├── orgManage/      # 组织/团队管理
│       │   ├── userManage/     # 用户管理
│       │   ├── serviceManage/  # 服务管理
│       │   ├── Category/       # 类别管理
│       │   └── home/           # 首页
│       ├── config/             # 路由/代理/开发配置
│       └── package.json        # 前端依赖（Ant Design Pro 5 + Umi 3）
│
├── depoly/                     # Docker部署配置
│   └── docker-compose.yml      # 编排文件（6个服务）
│
├── images/                     # 项目文档图片
├── README.md                   # 本文档
└── PROJECT.md                  # 开发参考文档
```

---

## API文档

- **SpringBoot后端**：启动后访问 `http://localhost:1290/swagger-ui/index.html`（Knife4j/Swagger）
- **FastAPI后端**：启动后访问 `http://localhost:5000/docs`（自动生成）

---

## 环境变量配置

### FastAPI (.env)

参考 `Backend(FastAPI)/.env.example`：

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=geolabel
DB_USER=postgres
DB_PASSWORD=88888888
SPRING_BOOT_BASE_URL=http://localhost:1290
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
```

### SpringBoot (application.yml)

```yaml
server:
  port: 1290
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/geolabel
  redis:
    host: localhost
    port: 6379
```

---

## 关键设计

- **增量保存标注**：`saveMarkInfoIncremental()` 一次请求同时处理新增、更新、删除操作
- **异步AI任务**：`TaskExecutorService` 将训练/推理异步投递到FastAPI，通过回调更新状态
- **双坐标系兼容**：GeoServer任务和本地任务共存，坐标系动态获取不再硬编码
- **模型懒加载**：SAM/YOLO模型懒加载+缓存，CUDA OOM时自动降级到CPU
- **PROV溯源**：关键动作全链路溯源记录（任务、标注、训练、推理、标签更新）
- **积分激励**：数据社区基于积分的共享激励机制

---

## 开发参考

更多开发细节请参见 [PROJECT.md](./PROJECT.md)，包含：

- 核心业务流程详解
- 关键数据结构定义
- 常见开发入口
- TODO / 当前开发阶段

其他文档：

| 文档 | 说明 |
|---|---|
| [快速启动指南.md](./快速启动指南.md) | 详细本地启动步骤 |
| [API接口测试指南.md](./API接口测试指南.md) | 接口测试方法 |
| [部署检查清单.md](./部署检查清单.md) | 部署前检查项 |
| [前端直连Python后端配置说明.md](./前端直连Python后端配置说明.md) | 前端直连FastAPI配置 |
