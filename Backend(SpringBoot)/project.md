# 项目总览文档（PROJECT.md）

## 1. 项目一句话描述
这是一个用于遥感影像样本生产与协作标注的系统，核心功能是“任务分发 + 在线标注 + AI辅助预标注/训练/推理 + 质量评估 + 溯源管理”，主要面向遥感数据标注团队、项目管理员与模型训练使用者。

## 2. 技术栈
- 后端主业务：Spring Boot 2.7.6 + MyBatis-Plus 3.4.3.4
- AI后端：FastAPI + PyTorch + Ultralytics YOLO + SAM
- 缓存与消息：Redis（Spring Data Redis）
- 数据库：PostgreSQL
- 前端：React 17 + Umi 3 + Ant Design Pro + OpenLayers
- 地理服务与数据：GeoServer + GeoTools + JTS
- 对象存储：MinIO（兼容 S3 SDK）
- 认证与文档：Spring Security + JWT + Knife4j/Swagger

## 3. 核心业务流程（非常关键）
用户登录 -> 管理员创建/发布任务 -> 任务分配给成员（按团队/用户/类型） -> 标注员在 `markPage` 在线标注（点线面、切分并集、框选删除） -> `saveMarkInfoIncremental` 增量保存（新增/更新/删除） -> 可选设定唯一提交者并清理其他执行人 -> 异步调用 FastAPI 执行 SAM/YOLO 预标注、训练或推理 -> FastAPI 回调 SpringBoot 任务状态与通知 -> 生成样本与数据集 -> 质量评估与报告输出 -> 全链路 PROV 溯源记录

补充流程（坐标系）：
影像上传/发布 -> 动态检测坐标系（文件元数据/业务参数） -> GeoServer 发布时写入对应 SRS -> 前端按任务坐标系渲染与转换 -> 标注/推理结果统一坐标语义

## 4. 模块划分
- `Backend(SpringBoot)`：业务中台
- `controller`：任务、标注、数据集、模型、质量、GeoServer、文件、团队、审核等接口
- `service/impl`：核心业务实现（任务发布、标注保存、模型管理、质量评估、溯源、任务回调/通知）
- `mapper` + `resources/mapper`：MyBatis SQL 映射
- `Backend(FastAPI)`：AI执行引擎
- `main.py`：SAM/YOLO 推理、训练、批量训练、质量参考评估、回调
- `train.py` / `train_mult.py` / `inference.py` / `update_label.py`：训练与推理流水线
- `Frontend(React)/portal`：前端门户
- `src/pages/markPage`：核心标注页面（OpenLayers）
- `src/pages/modelManage`、`personalTaskList`、`quality`、`prov`：模型管理、任务管理、质量与溯源页面

## 5. 关键数据结构
Task（`domain/Task.java`）：
- `taskId`
- `taskName`
- `taskType`
- `mapServer`
- `taskSource`（`geoserver` / `local`）
- `status`（审核/提交状态）
- `userId`（创建者）
- `submitterId`（提交者）
- `score`（任务积分）
- `annotationSchema`（兼容字段）

Mark（`domain/Mark.java`）：
- `id`
- `taskId`
- `userId`
- `typeId`
- `geom`（GeoJSON，JSONB）
- `attrJson`（业务属性，JSONB）
- `status`
- `feedback`

Model（`domain/Model.java` + `ModelServiceImpl`使用）：
- `modelId`
- `modelName`
- `modelType`
- `taskType`
- `inputNum` / `outputNum`
- `modelDes`（包含 classMapping、inferParams 等元信息）
- `status`

## 6. 关键技术点（重点给模型提示）
- 标注采用“增量保存”模式：一次请求同时处理新增/更新/删除，核心方法 `saveMarkInfoIncremental()`
- 任务执行采用异步线程池 + FastAPI 回调：`TaskExecutorService` 将训练/推理请求异步投递到 Python 服务
- SAM/YOLO 模型采用懒加载与缓存策略，支持 CUDA OOM 降级到 CPU
- 多任务流程支持：单任务训练、批量训练、单任务推理、质量参考评估
- 坐标系动态获取已全链路实现：上传发布、渲染、推理、导出均不依赖固定 EPSG
- 质量评估包含覆盖率、低置信度占比、分类准确率、IoU 等指标，支持进度回调
- PROV 溯源已接入关键动作（任务创建/分配、标注提交、训练、推理、更新标签）

## 7. 已知约束 / 设计决策
- 系统是“SpringBoot 业务 + FastAPI AI”双后端架构，AI任务不在 Java 进程内执行
- 训练/推理依赖本地 GPU 环境；若 CUDA 不可用，部分能力会失败或降级
- 标注几何与属性字段使用 JSON 存储（`geom` / `attr_json`），前后端需保持 GeoJSON 协议一致
- 本地任务与 GeoServer 任务并存，`taskSource` 分支逻辑较多，改动需兼容两类来源
- 坐标系处理优先动态检测，不再依赖硬编码坐标系
- 异步任务状态以回调和通知为准，前端需按异步语义处理“已提交/执行中/完成/失败”

## 8. 常见开发入口（给 Codex 用）
入口类（高频）：
- `Backend(SpringBoot)/src/main/java/com/example/labelMark/controller/TaskController.java`
- `Backend(SpringBoot)/src/main/java/com/example/labelMark/service/impl/TaskServiceImpl.java`
- `Backend(SpringBoot)/src/main/java/com/example/labelMark/service/impl/MarkServiceImpl.java`
- `Backend(SpringBoot)/src/main/java/com/example/labelMark/service/TaskExecutorService.java`
- `Backend(FastAPI)/main.py`
- `Frontend(React)/portal/src/pages/markPage/index.jsx`

核心方法（高频）：
- `TaskServiceImpl.createTask()`
- `TaskController.publishTask()`
- `MarkServiceImpl.saveMarkInfoIncremental()`
- `TaskExecutorService.executeAssistFunctionAsync()`
- `TaskExecutorService.executeInferenceFunctionAsync()`
- `POST /assistFunction`（FastAPI）
- `POST /inferenceFunction`（FastAPI）
- `POST /quality/reference-evaluate`（FastAPI）

## 9. TODO / 当前开发阶段
当前正在做（从现有文档与代码状态归纳）：
- 坐标系动态获取与跨模块一致性收尾（已基本完成，持续验证上传->发布->标注->推理链路）
- 多图片/批量任务训练与推理流程优化（任务队列、回调、前端交互）
- 模型管理与训练详情可视化优化（参数、指标、状态展示）
- 标注页高级编辑能力持续打磨（切分/并集/框选删除/属性面板联动）
- 质量评估与参考模型评估流程完善（进度、指标解释、报告体验）

