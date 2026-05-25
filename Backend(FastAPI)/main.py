import gc
import io
import json
import os
import sys
import tempfile
import traceback
from collections import OrderedDict
from pathlib import Path

from dotenv import load_dotenv

# 加载 .env 配置文件
env_path = Path(__file__).resolve().parent / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)

from affine import Affine

# 强制设置标准输出为 UTF-8
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
# 1. 顶部导入
from ultralytics import YOLO
import numpy as np
import rasterio
import warnings; warnings.filterwarnings("ignore", category=rasterio.errors.NotGeoreferencedWarning)
from shapely.geometry import LineString, Polygon
from shapely.ops import transform as shapely_transform, unary_union
from pyproj import CRS, Transformer

from utils_db import (connect_db, delete_latest_prompt_db, fetch_labels_from_db,
                      fetch_model_by_id, fetch_model_from_db)
from utils_storage import ensure_model_local, ensure_task_image_local
from utils_sam import (identify_holes_and_split_SAM,
                       post_process_mask_sam, discretize_line)
from update_label import insert_segmentation_results_db, update_label_function
from inference import inference
from model_runtime.model_meta import parse_model_metadata, validate_model_metadata
from model_runtime.model_builders import build_model_from_spec
from model_runtime.model_load_utils import (
    load_checkpoint,
    extract_state_dict,
    normalize_state_dict_keys,
    safe_load_model_weights,
)
from train import train_function
from train_mult import train_Multi_function
from utils_prov import (prov_sam_annotate, prov_auto_building,
                        prov_train, prov_inference, prov_update_label)

import torch
import torch.multiprocessing as mp
import requests
import cv2

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from pydantic import BaseModel, ConfigDict, Field
from typing import List, Optional, Any

# ── 多进程启动方式 ──────────────────────────────────────────────────────────────
mp.set_start_method('spawn', force=True)

# ── 全局变量 ────────────────────────────────────────────────────────────────────
global_sam = None
global_sam_device = None
current_feature_cache: dict = {}
SPRING_BOOT_BASE_URL = os.getenv("SPRING_BOOT_BASE_URL", "http://localhost:1290").rstrip("/")
# 2. 全局变量增加
global_yolo = None
global_yolo_device = None
MODEL_REFERENCE_CACHE = OrderedDict()
GT_INDEX_CACHE = OrderedDict()
MAX_MODEL_REFERENCE_CACHE = 2
MAX_GT_INDEX_CACHE = 4

LOCAL_CRS_ALIAS_MAP = {
    "Estonian Coordinate System of 1997": "EPSG:3301",
    "WGS 84 / Pseudo-Mercator": "EPSG:3857",
    "WGS_1984_Web_Mercator_Auxiliary_Sphere": "EPSG:3857",
}

SAM_MODEL_ID = os.getenv("SAM_MODEL_ID", "sam2-hiera-tiny")
SAM_CHECKPOINT = os.getenv("SAM_CHECKPOINT", "/opt/geolabel/models/sam2_hiera_tiny.pt")
AUTO_BUILDING_YOLO_PATH = os.getenv("AUTO_BUILDING_YOLO_PATH", "/opt/geolabel/models/best.pt")
PRELOAD_SAM_ON_STARTUP = os.getenv("PRELOAD_SAM_ON_STARTUP", "false").lower() == "true"
PRELOAD_AUTO_YOLO_ON_STARTUP = os.getenv("PRELOAD_AUTO_YOLO_ON_STARTUP", "false").lower() == "true"


def parse_cors_origins(raw_value: str):
    if not raw_value or not raw_value.strip():
        return ["http://localhost:3000"]
    parsed = [item.strip() for item in raw_value.split(",") if item.strip()]
    return parsed or ["http://localhost:3000"]


CORS_ORIGINS = parse_cors_origins(os.getenv("CORS_ORIGINS", ""))


def clear_cuda_cache():
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def is_cuda_oom(exc: Exception) -> bool:
    return "out of memory" in str(exc).lower() or "cuda error" in str(exc).lower()


def build_sam(device: str):
    from samgeo import SamGeo

    sam_model = SamGeo(
        model_id=SAM_MODEL_ID,
        checkpoint=SAM_CHECKPOINT,
        automatic=False,
        device=device,
    )
    if device.startswith("cuda") and hasattr(sam_model, "model"):
        sam_model.model.to(dtype=torch.bfloat16)
    return sam_model


def get_or_create_sam():
    global global_sam, global_sam_device
    if global_sam is not None:
        return global_sam

    gc.collect()
    clear_cuda_cache()

    preferred_device = "cuda" if torch.cuda.is_available() else "cpu"
    try:
        global_sam = build_sam(preferred_device)
        global_sam_device = preferred_device
        print(f"SamGeo 已加载，device={preferred_device}")
        return global_sam
    except RuntimeError as exc:
        if preferred_device.startswith("cuda") and is_cuda_oom(exc):
            print(f"SamGeo GPU 加载失败，改为 CPU 模式: {exc}")
            clear_cuda_cache()
            gc.collect()
            global_sam = build_sam("cpu")
            global_sam_device = "cpu"
            print("SamGeo 已降级到 CPU 模式")
            return global_sam
        raise


def build_auto_yolo(device: str):
    yolo_model = YOLO(AUTO_BUILDING_YOLO_PATH)
    try:
        yolo_model.to(device)
    except Exception:
        # ultralytics 某些版本不要求/不支持显式 to()，predict 时传 device 即可
        pass
    return yolo_model


def get_or_create_auto_yolo():
    global global_yolo, global_yolo_device
    if global_yolo is not None:
        return global_yolo

    preferred_device = "cuda" if torch.cuda.is_available() else "cpu"
    try:
        global_yolo = build_auto_yolo(preferred_device)
        global_yolo_device = preferred_device
        print(f"专用建筑分割模型已加载，device={preferred_device}")
        return global_yolo
    except RuntimeError as exc:
        if preferred_device.startswith("cuda") and is_cuda_oom(exc):
            print(f"专用建筑分割模型 GPU 加载失败，改为 CPU 模式: {exc}")
            clear_cuda_cache()
            gc.collect()
            global_yolo = build_auto_yolo("cpu")
            global_yolo_device = "cpu"
            print("专用建筑分割模型已降级到 CPU 模式")
            return global_yolo
        raise


def resolve_preannotation_yolo(params: dict):
    model_id = params.get("model_id")
    model_name = params.get("modelName")
    preferred_device = "cuda" if torch.cuda.is_available() else "cpu"

    if model_id in (None, "", "None") and not model_name:
        raise ValueError("YOLO+SAM 预标注必须使用当前选中的 YOLO 模型，未收到 model_id/modelName")

    conn = connect_db()
    try:
        model_info = None
        if model_id not in (None, "", "None"):
            try:
                model_info = fetch_model_by_id(conn, int(model_id))
            except Exception:
                model_info = None
        if not model_info and model_name:
            model_info = fetch_model_from_db(conn, str(model_name).split(".")[0])
        if not model_info:
            raise ValueError(f"未找到可用于 YOLO+SAM 预标注的模型: id={model_id}, name={model_name}")

        model_meta = parse_model_metadata(model_info)
        validate_model_metadata(model_meta)
        runtime_meta = dict(model_meta)
        local_model_path = ensure_model_local(model_info)
        runtime_meta["modelPath"] = local_model_path
        runtime_meta["path"] = local_model_path
        runtime_meta["modelName"] = model_info.get("model_name")

        built = build_model_from_spec(runtime_meta, torch.device(preferred_device))
        if built.get("runtime_type") != "yolo":
            raise ValueError(f"当前模型不是 YOLO，无法走 YOLO+SAM 联合预标注: {runtime_meta.get('modelName')}")
        print(f"[Auto] 已解析选中的 YOLO 模型: id={model_info.get('model_id')}, name={runtime_meta.get('modelName')}")
        return built["model"], preferred_device, runtime_meta.get("modelName") or "selected_yolo"
    finally:
        if conn:
            conn.close()


def _coerce_int_param(value, default_value: int) -> int:
    try:
        if value is None or value == "":
            return int(default_value)
        return int(float(value))
    except Exception:
        return int(default_value)


def resolve_image_path(base_path: str) -> str:
    """兼容本地绝对路径、去后缀路径和 MinIO 本地挂载目录。"""
    if not base_path:
        return base_path
    candidates = []
    if base_path.lower().endswith(('.tif', '.tiff')):
        candidates.append(base_path)
    else:
        candidates.append(base_path + ".tif")
        candidates.append(base_path + ".tiff")
    candidates.append(base_path)

    minio_dir = os.getenv("MINIO_UPLOAD_DIR", "").strip()
    if minio_dir:
        file_key = os.path.basename(base_path)
        if not file_key.lower().endswith((".tif", ".tiff")):
            candidates.append(os.path.join(minio_dir, file_key + ".tif"))
            candidates.append(os.path.join(minio_dir, file_key + ".tiff"))
        candidates.append(os.path.join(minio_dir, file_key))

    # 兜底：GeoServer 本地覆盖目录（用于 map_server 存了绝对目录路径时按 basename 回退）
    coverage_dir = os.getenv("GEOSERVER_LOCAL_COVERAGE_DIR", "/opt/geolabel/geoserver/coverages").strip()
    if coverage_dir:
        file_key = os.path.basename(base_path)
        stem, ext = os.path.splitext(file_key)
        if ext.lower() in (".tif", ".tiff"):
            candidates.append(os.path.join(coverage_dir, file_key))
        else:
            candidates.append(os.path.join(coverage_dir, file_key + ".tif"))
            candidates.append(os.path.join(coverage_dir, file_key + ".tiff"))
            candidates.append(os.path.join(coverage_dir, file_key))
        if stem:
            candidates.append(os.path.join(coverage_dir, stem + ".tif"))
            candidates.append(os.path.join(coverage_dir, stem + ".tiff"))

    # 仅返回“可读文件”，避免把 MinIO 对象目录误判为栅格文件
    dedup_candidates = list(dict.fromkeys([p for p in candidates if p]))
    for path in dedup_candidates:
        if os.path.isfile(path) and os.access(path, os.R_OK):
            return path

    raise FileNotFoundError(f"未找到可读取影像文件，候选路径: {dedup_candidates}")


def normalize_crs(crs_like):
    """把 EPSG、数字代码、rasterio CRS 和常见 LOCAL_CS 统一成 pyproj.CRS。"""
    if crs_like is None:
        return None

    if isinstance(crs_like, CRS):
        return crs_like

    # rasterio CRS 对象优先用 to_epsg()，避免 LOCAL_CS 直接参与转换失败
    if hasattr(crs_like, "to_epsg"):
        try:
            epsg = crs_like.to_epsg()
            if epsg:
                return CRS.from_epsg(epsg)
        except Exception:
            pass

    raw = crs_like.to_string() if hasattr(crs_like, "to_string") else str(crs_like)
    raw = raw.strip()
    if not raw:
        return None

    upper_raw = raw.upper()
    if upper_raw in {"NONE", "UNKNOWN", "PIXEL"}:
        return None

    if raw.isdigit():
        raw = f"EPSG:{raw}"
        upper_raw = raw.upper()

    # 对 GeoTIFF 中常见的 LOCAL_CS 名称做显式映射
    for alias, target_epsg in LOCAL_CRS_ALIAS_MAP.items():
        if alias.lower() in raw.lower():
            return CRS.from_user_input(target_epsg)

    # 标准 EPSG / PROJ / WKT 优先直接解析
    try:
        return CRS.from_user_input(raw)
    except Exception:
        pass

    # 最后再尝试从 WKT 解析
    try:
        return CRS.from_wkt(raw)
    except Exception as exc:
        raise ValueError(f"无法识别坐标系: {raw}") from exc


# ── Lifespan（替代已废弃的 on_event）──────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global global_sam, global_sam_device, global_yolo, global_yolo_device
    print(
        "FastAPI 模型启动策略: "
        f"SAM={'预加载' if PRELOAD_SAM_ON_STARTUP else '懒加载'}, "
        f"AutoYOLO={'预加载' if PRELOAD_AUTO_YOLO_ON_STARTUP else '懒加载'}"
    )
    if PRELOAD_SAM_ON_STARTUP:
        try:
            get_or_create_sam()
        except Exception as exc:
            print(f"SamGeo 预加载失败，服务继续启动，首次调用时再重试: {exc}")
    else:
        print("SamGeo 采用懒加载，首次调用 SAM 相关功能时初始化")

    if PRELOAD_AUTO_YOLO_ON_STARTUP:
        try:
            get_or_create_auto_yolo()
        except Exception as exc:
            print(f"专用建筑分割模型预加载失败，服务继续启动，首次调用时再重试: {exc}")
    else:
        print("专用建筑分割模型采用懒加载，首次调用自动建筑分割时初始化")
    yield
    global_sam = None
    global_sam_device = None
    global_yolo = None
    global_yolo_device = None
    clear_cuda_cache()
    print("模型资源已清理")


# ── FastAPI 应用 ────────────────────────────────────────────────────────────────
app = FastAPI(debug=True, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 回调 & 异步包装 ─────────────────────────────────────────────────────────────
def send_callback(endpoint: str, data: dict):
    try:
        url = f"{SPRING_BOOT_BASE_URL}/task-callback/{endpoint}"
        resp = requests.post(url, json=data, timeout=10)
        print(f"回调成功: {endpoint}, status={resp.status_code}")
    except Exception as e:
        print(f"回调失败: {endpoint}, err={e}")


def send_quality_progress(job_id, stage: str, progress: int, processed_count=None, total_count=None, message: str = ""):
    if not job_id:
        return
    payload = {
        "jobId": job_id,
        "status": "RUNNING",
        "stage": stage,
        "progress": progress,
        "processedCount": processed_count,
        "totalCount": total_count,
        "message": message,
    }
    send_callback("quality-progress", payload)


def train_with_callback(argv):
    task_id = argv[1]
    user_id = argv[9] if len(argv) > 9 else None
    model_name = argv[11] if len(argv) > 11 else ""
    success, msg = True, "训练完成"
    try:
        train_function(argv)
        if user_id:
            send_callback("train-complete", {"taskId": task_id, "userId": user_id,
                                             "modelName": model_name, "success": True, "message": msg})
    except Exception as e:
        success, msg = False, str(e)
        if user_id:
            send_callback("train-complete", {"taskId": task_id, "userId": user_id,
                                             "modelName": model_name, "success": False, "message": msg})
        print(f"训练失败: {e}")
    finally:
        prov_train(str(task_id), str(user_id or ""), model_name, success, msg)


def train_multi_with_callback(argv):
    task_ids = argv[1]
    user_id = argv[9] if len(argv) > 9 else None
    model_name = argv[11] if len(argv) > 11 else ""
    success, msg = True, "批量训练完成"
    try:
        train_Multi_function(argv)
        if user_id:
            send_callback("batch-train-complete", {"taskIds": task_ids, "userId": user_id,
                                                   "modelName": model_name, "success": True, "message": msg})
    except Exception as e:
        success, msg = False, str(e)
        if user_id:
            send_callback("batch-train-complete", {"taskIds": task_ids, "userId": user_id,
                                                   "modelName": model_name, "success": False, "message": msg})
        print(f"批量训练失败: {e}")
    finally:
        # 批量训练：为每个 task_id 记录一条 prov
        for tid in (task_ids if isinstance(task_ids, list) else [task_ids]):
            prov_train(str(tid), str(user_id or ""), model_name, success, msg)


def inference_with_callback(argv):
    task_id = argv[1]
    user_id = argv[3] if len(argv) > 3 else None
    model_name = argv[4] if len(argv) > 4 else ""
    success, msg = True, "推理完成"
    try:
        inference(argv)
        if user_id:
            send_callback("inference-complete", {"taskId": task_id, "userId": user_id,
                                                 "modelName": model_name, "success": True, "message": msg})
    except Exception as e:
        success, msg = False, str(e)
        if user_id:
            send_callback("inference-complete", {"taskId": task_id, "userId": user_id,
                                                 "modelName": model_name, "success": False, "message": msg})
        print(f"推理失败: {e}")
    finally:
        prov_inference(str(task_id), str(user_id or ""), model_name, success, msg)


# ── Pydantic 请求模型 ───────────────────────────────────────────────────────────
class AssistFunctionRequest(BaseModel):
    model_config = ConfigDict(extra='allow')
    taskid: str
    mapfile_path: str
    functionName: str
    assistInput: str = ""
    modelName: str = ""
    param1: str = "10"
    param2: str = "50"
    param3: str = "10"
    param4: str = "1"
    user_id: Optional[str] = None
    modelScopeStr: str = ""
    tasktype: str = ""
    promptType: Optional[str] = None
    coordinates: Optional[Any] = None
    currentTypeId: Optional[Any] = None
    taskItemId: Optional[int] = None
    model_id: Optional[int] = None
    db_crs: str = "EPSG:3857"


class AssistMultFunctionRequest(BaseModel):
    taskid: List[str] = Field(..., description="任务ID列表")
    mapfile_path: List[str] = Field(..., description="地图文件路径列表")
    functionName: str
    assistInput: str = ""
    modelName: str = ""
    param1: str = ""
    param2: str = ""
    param3: str = ""
    param4: str = ""
    user_id: Optional[str] = None
    tasktype: str = ""


class InferenceFunctionRequest(BaseModel):
    model_config = ConfigDict(extra='allow')
    taskid: str
    mapfile_path: str
    user_id: str
    model: str = ""
    model_id: Optional[int] = None
    param1: str = ""
    param2: str = ""
    param3: str = ""
    param4: str = ""
    categoryMapping: Any = "{}"
    inferParams: Optional[dict] = None
    modelScopeStr: str = ""
    taskItemId: Optional[int] = None
    currentTypeId: Optional[Any] = None
    db_crs: str = "EPSG:3857"


class ReferenceSource(BaseModel):
    sourceId: str = "source"
    sourceType: str = "model"
    modelId: Optional[int] = None
    weight: float = 1.0
    confidenceCalib: Optional[dict] = None


class FusionConfig(BaseModel):
    method: str = "staple"
    fusionMode: str = "soft_staple"
    maxIter: int = 50
    eps: float = 1e-4
    probThreshold: float = 0.5
    minAgreement: float = 0.2


class QualityReferenceRequest(BaseModel):
    sampleSetId: int
    taskType: str = ""
    imageDir: str
    labelPath: str
    modelId: Optional[int] = None
    operator: str = "system"
    confidenceThreshold: float = 0.3
    iouThreshold: float = 0.5
    batchSize: int = 16
    scopeMode: str = "all"
    sampleRatio: float = 0.3
    previewLimit: int = 8
    inferParams: Optional[dict] = None
    referenceSources: Optional[List[ReferenceSource]] = None
    fusionConfig: Optional[FusionConfig] = None
    jobId: Optional[int] = None


class UpdateLabelRequest(BaseModel):
    taskid: str
    mapfile_path: str
    taskItemId: Optional[int] = None


# ── SAM 核心推理函数 ────────────────────────────────────────────────────────────
def inference_sam_v1(params: dict, is_batch: bool = False):
    """
    统一 SAM 推理：支持点/线/框交互。
    自动检测坐标系：有坐标系做地理转换，无坐标系直接用像素坐标。
    """
    global current_feature_cache
    # 如果是批量模式且不是预热，我们不在函数内部管理数据库连接
    conn = None if is_batch else connect_db()

    mask_path = None
    try:
        sam_model = get_or_create_sam()
        TASK_ID = int(params['taskid'])
        TASK_ITEM_ID = params.get('taskItemId')
        raw_path = params['mapfile_path']
        IMAGE_PATH = ensure_task_image_local(conn, TASK_ID, TASK_ITEM_ID, fallback_path=raw_path)
        USER_ID = params.get('user_id')
        PROMPT_TYPE = params.get('promptType', 'point')
        INTERACTIVE_COORDS = params.get('coordinates')
        TARGET_TYPE_ID = params.get('currentTypeId')

        # 如果前端没传 currentTypeId，从数据库最新提示记录中获取
        if TARGET_TYPE_ID is None:
            try:
                labels = fetch_labels_from_db(conn, TASK_ID, USER_ID, TASK_ITEM_ID)
                if labels:
                    TARGET_TYPE_ID = labels[-1][2]
                    print(f"[SAM] currentTypeId 未传，从DB获取: {TARGET_TYPE_ID}")
                else:
                    TARGET_TYPE_ID = 2
                    print(f"[SAM] currentTypeId 未传，默认值")
            except Exception:
                pass

        # ── 1. Encoder 缓存（只在图片切换时重跑）──────────────────────
        if current_feature_cache.get("image_path") != IMAGE_PATH:
            with rasterio.open(IMAGE_PATH) as src:
                _crs = src.crs
                _transform = src.transform
                _width = src.width
                _height = src.height
                _normalized_tif_crs = normalize_crs(_crs)
            current_feature_cache.update({
                "image_path": IMAGE_PATH,
                "transform": _transform,
                "width": _width,
                "height": _height,
                "has_crs": _crs is not None,
                "tif_crs": _normalized_tif_crs,
                "raw_tif_crs": _crs.to_string() if _crs else None,
            })
            print(f"[SAM] 新影像，执行 Encoder: {IMAGE_PATH}", flush=True)
            try:
                sam_model.set_image(IMAGE_PATH)
                print(f"[SAM] Encoder 完成", flush=True)
                sys.stdout.flush()
            except Exception as enc_err:
                print(f"[SAM] Encoder 异常: {enc_err}", flush=True)
                raise
        else:
            print("[SAM] 命中缓存，跳过 Encoder", flush=True)

        # 后面取值建议加上默认值保护，虽然上面的逻辑已经保证了它们存在
        img_transform = current_feature_cache.get("transform")
        has_crs = current_feature_cache.get("has_crs")
        img_width = current_feature_cache.get("width", 512)  # 默认 512
        img_height = current_feature_cache.get("height", 512)

        # ── 2. 坐标转换器 ──────────────────────────────────────────────
        if has_crs:
            db_crs = normalize_crs(params.get("db_crs", "EPSG:3857"))
            tif_crs = current_feature_cache.get("tif_crs")
            raw_tif_crs = current_feature_cache.get("raw_tif_crs")
            if db_crs is None or tif_crs is None:
                raise ValueError(f"坐标系无效: db_crs={db_crs}, tif_crs={raw_tif_crs}")
            db_to_tif = Transformer.from_crs(db_crs, tif_crs, always_xy=True)
            tif_to_db = Transformer.from_crs(tif_crs, db_crs, always_xy=True)
            print(f"[SAM] 地理坐标模式: DB={db_crs.to_string()}, TIF={tif_crs.to_string()} (raw={raw_tif_crs})")
        else:
            db_to_tif = tif_to_db = None
            print("[SAM] 像素坐标模式（无坐标系 TIF）")

        # ── 3. 坐标转像素辅助函数 ──────────────────────────────────────
        def geo_to_pixel(x, y):
            tx, ty = db_to_tif.transform(x, y)
            row, col = rasterio.transform.rowcol(img_transform, tx, ty)
            return max(0, min(int(col), img_width - 1)), max(0, min(int(row), img_height - 1))

        def px_direct(x, y, is_yolo=False):
            col = max(0, min(int(round(x)), img_width - 1))
            if is_yolo:
                # YOLO 坐标原点在左上角，row 直接就是像素行号
                row = max(0, min(int(round(y)), img_height - 1))
            else:
                # OpenLayers pixel 投影：Y轴向上，图片顶部 Y=img_height，底部 Y=0
                # TIF 像素坐标：row=0 在顶部，row=img_height 在底部
                # 转换：row = img_height - y
                row = max(0, min(int(round(img_height - y)), img_height - 1))
            return col, row

        coord_fn = geo_to_pixel if has_crs else px_direct

        # ── 4. 构建 predict_args ───────────────────────────────────────
        predict_args: dict = {"multimask_output": False, "dtype": "uint8"}

        print(f"[SAM] 原始坐标(前端传入): type={PROMPT_TYPE}, coords={INTERACTIVE_COORDS}, img_size={img_width}x{img_height}")

        # --- 点分支 ---
        if PROMPT_TYPE == 'point' and INTERACTIVE_COORDS:
            col, row = coord_fn(INTERACTIVE_COORDS[0], INTERACTIVE_COORDS[1])
            predict_args["point_coords"] = [[col, row]]
            predict_args["point_labels"] = [1]
            print(f"[SAM] 点提示 原始=({INTERACTIVE_COORDS[0]:.1f},{INTERACTIVE_COORDS[1]:.1f}) → pixel=({col},{row})")

        elif PROMPT_TYPE == 'line' and INTERACTIVE_COORDS:
            pixel_coords = []
            for i in range(len(INTERACTIVE_COORDS) - 1):
                x0, y0 = INTERACTIVE_COORDS[i]
                x1, y1 = INTERACTIVE_COORDS[i + 1]
                dist = max(1, int(((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5))
                for t in range(dist + 1):
                    curr_x = x0 + (x1 - x0) * t / dist
                    curr_y = y0 + (y1 - y0) * t / dist
                    c, r = coord_fn(curr_x, curr_y)
                    pixel_coords.append([c, r])
            predict_args["point_coords"] = pixel_coords[::5] or pixel_coords[:1]
            predict_args["point_labels"] = np.ones(len(predict_args["point_coords"]), dtype=int).tolist()
            print(f"[SAM] 线提示 采样点数量: {len(predict_args['point_coords'])}, 首点={predict_args['point_coords'][0]}")

        elif PROMPT_TYPE == 'bbox' and INTERACTIVE_COORDS:
            is_from_yolo = params.get('_pixel_bbox', False)
            print(f"[SAM] 框原始坐标: {INTERACTIVE_COORDS}, is_yolo={is_from_yolo}")
            if has_crs and not is_from_yolo:
                c1, r1 = geo_to_pixel(INTERACTIVE_COORDS[0], INTERACTIVE_COORDS[1])
                c2, r2 = geo_to_pixel(INTERACTIVE_COORDS[2], INTERACTIVE_COORDS[3])
            else:
                c1, r1 = px_direct(INTERACTIVE_COORDS[0], INTERACTIVE_COORDS[1], is_yolo=is_from_yolo)
                c2, r2 = px_direct(INTERACTIVE_COORDS[2], INTERACTIVE_COORDS[3], is_yolo=is_from_yolo)
            predict_args["boxes"] = [float(min(c1, c2)), float(min(r1, r2)), float(max(c1, c2)), float(max(r1, r2))]
            print(f"[SAM] 框提示 角点1=({c1},{r1}) 角点2=({c2},{r2}) → boxes={predict_args['boxes']}")

        elif PROMPT_TYPE == '_warmup_skip_':
            # 仅触发 encoder 缓存，不执行预测
            print("[SAM] Encoder 预热完成")
            return

        else:
            print(f"[SAM] 未知提示类型或坐标为空: {PROMPT_TYPE}")
            return

        # ── 5. 执行预测 ────────────────────────────────────────────────
        tmp = tempfile.NamedTemporaryFile(suffix='.tif', delete=False)
        mask_path = tmp.name
        tmp.close()  # 关键：立即关闭句柄

        predict_args["output"] = mask_path
        with torch.no_grad():  # 增加：防止梯度累积导致显存溢出
            sam_model.predict(**predict_args)

        # ── 6. 后处理与矢量化 ──────────────────────────────────────────
        with rasterio.open(mask_path) as m_src:
            raw_mask = m_src.read(1)

        print(
            f"[SAM] 原始mask: shape={raw_mask.shape}, dtype={raw_mask.dtype}, unique={np.unique(raw_mask)}, nonzero={np.count_nonzero(raw_mask)}")

        quality_threshold = float(params.get('param1') or 0.85)
        quality_threshold = max(0.0, min(1.0, quality_threshold))
        mask_threshold = quality_threshold * 255.0

        # samgeo 输出通常是 0-255 掩膜，这里按质量阈值二值化
        binary_mask = (raw_mask >= mask_threshold).astype(np.uint8)
        print(f"[SAM] 质量阈值: {quality_threshold:.3f}, mask_threshold={mask_threshold:.2f}, binary_nonzero={np.count_nonzero(binary_mask)}")

        processed_mask = post_process_mask_sam(
            binary_mask, # 修正：传入 binary_mask,
            min_object_size=_coerce_int_param(params.get('param2'), 100),  # 提高最小面积，过滤草地上的噪点
            hole_size_threshold=_coerce_int_param(params.get('param3'), 20),  # 建筑通常没孔洞，设置小一点
            boundary_smoothing=_coerce_int_param(params.get('param4'), 3)  # 适当增加平滑度，减少锯齿
        )
        print(f"[SAM] 后处理mask: nonzero={np.count_nonzero(processed_mask)}")

        # ── 矢量化阶段 ──────────────────────────────────────────────────
        if has_crs:
            # 有坐标系：用 TIF 自带的仿射变换（像素→地理坐标）
            vec_transform = img_transform
        else:
            # 无坐标系：SAM mask 的 row=0 在顶部，OpenLayers Y轴向上（顶部=img_height）
            # 映射公式：x' = col, y' = img_height - row
            # 对应 Affine(a, b, c, d, e, f)：x'=a*col+b*row+c, y'=d*col+e*row+f
            # => a=1, b=0, c=0, d=0, e=-1, f=img_height
            vec_transform = Affine(1.0, 0.0, 0.0, 0.0, -1.0, float(img_height))
            print(f"[SAM] 无坐标系翻转矩阵: row=0→y={img_height}, row={img_height}→y=0")

        seg_polys = identify_holes_and_split_SAM(processed_mask, vec_transform, TARGET_TYPE_ID)
        print(f"[SAM] 矢量化结果: {sum(len(v) for v in seg_polys.values())} 个多边形")

        # ── 7. 坐标还原与简化 ──────────────────────────────────────────
        final_polygons = {}
        for tid, polys in seg_polys.items():
            processed_polys = []
            for p in polys:
                p_simple = p.simplify(0.8, preserve_topology=True)
                if has_crs:
                    p_simple = shapely_transform(tif_to_db.transform, p_simple)
                processed_polys.append(p_simple)
            final_polygons[tid] = processed_polys

        # --- 核心逻辑调整 ---
        if is_batch:
            return final_polygons  # 批量模式：只返回数据，不操作数据库

        # 单次点击模式：直接入库
        if final_polygons and conn:
            delete_latest_prompt_db(conn, TASK_ID, USER_ID, TASK_ITEM_ID)
            insert_segmentation_results_db(conn, TASK_ID, final_polygons, USER_ID, status=1, task_item_id=TASK_ITEM_ID)
            poly_count = sum(len(v) for v in final_polygons.values())
            print(f"[SAM] 单个目标已入库")
            # 异步记录 prov（不阻塞）
            prov_sam_annotate(str(TASK_ID), str(USER_ID or ""), PROMPT_TYPE, poly_count)

    except Exception as e:
        traceback.print_exc()
        return {}
    finally:
        if mask_path and os.path.exists(mask_path):
            os.remove(mask_path)
        if conn: conn.close()


def auto_building_segmentation(params: dict):
    """一键识别全图建筑并利用 SAM 分割"""
    yolo_model, yolo_device, yolo_label = resolve_preannotation_yolo(params)
    TASK_ITEM_ID = params.get('taskItemId')
    raw_path = params['mapfile_path']
    conn = connect_db()
    try:
        IMAGE_PATH = ensure_task_image_local(conn, int(params['taskid']), TASK_ITEM_ID, fallback_path=raw_path)
    finally:
        if conn:
            conn.close()
    with rasterio.open(IMAGE_PATH) as src:
        raw_read = src.read([1, 2, 3])
        img_array = raw_read.transpose(1, 2, 0)
        max_val = img_array.max()
        if max_val > 255:
            print(f"归一化: 检测到 16-bit ({max_val})，执行线性缩放...")
            img_array = (img_array / max_val * 255).astype(np.uint8)
        else:
            img_array = img_array.astype(np.uint8)

    # 1. YOLO 推理，ultralytics 会自动将 boxes 坐标缩放回原图尺寸
    conf_threshold = float(params.get("param1") or 0.25)
    iou_threshold = float(params.get("param3") or 0.7)
    image_size = int(params.get("param2") or 640)

    print(f"[Auto] 使用 YOLO+SAM 预标注模型: {yolo_label}, conf={conf_threshold}, iou={iou_threshold}, imgsz={image_size}")
    results = yolo_model.predict(
        img_array,
        conf=conf_threshold,
        iou=iou_threshold,
        imgsz=image_size,
        retina_masks=True,
        max_det=500,
        half=(yolo_device or "").startswith("cuda"),
        device=yolo_device or ("cuda" if torch.cuda.is_available() else "cpu")
    )
    det_boxes = results[0].boxes.xyxy.cpu().numpy()
    print(f"[Auto] 检测到 {len(det_boxes)} 个潜在建筑目标")
    if len(det_boxes) > 0:
        print(f"DEBUG - YOLO 原始像素框示例: {det_boxes[0]}")
    else:
        print("DEBUG - YOLO 未检测到任何建筑")
        return

    # 2. 预热 SAM encoder，同时填充 current_feature_cache（含真实宽高）
    inference_sam_v1({**params, "promptType": "_warmup_skip_"})

    # 3. 从缓存读取真实图片尺寸（encoder 预热后已写入）
    real_w = current_feature_cache.get("width", img_array.shape[1])
    real_h = current_feature_cache.get("height", img_array.shape[0])
    print(f"[Auto] 真实图片尺寸: {real_w}x{real_h}")

    # 4. 循环收集所有多边形（不连数据库）
    raw_polygons_dict = {}  # 用于存储所有类别无关的原始多边形 {tid: [poly, ...]}
    padding = 2
    print(f"[Auto] 开始批量处理 {len(det_boxes)} 个建筑...")
    for box in det_boxes:
        x1, y1, x2, y2 = box
        padded_box = [
            max(0, x1 - padding),
            max(0, y1 - padding),
            min(real_w - 1, x2 + padding),
            min(real_h - 1, y2 + padding)
        ]

        task_params = params.copy()
        task_params['promptType'] = 'bbox'
        task_params['coordinates'] = padded_box
        task_params['_pixel_bbox'] = True
        # YOLO 参数与 SAM 后处理参数语义不同，这里显式切换成 SAM 所需参数。
        task_params['param2'] = "100"
        task_params['param3'] = "20"
        task_params['param4'] = "3"
        task_params['is_pre_annotation'] = True

        res = inference_sam_v1(task_params, is_batch=True)
        if res:
            for tid, polys in res.items():
                if tid not in raw_polygons_dict:
                    raw_polygons_dict[tid] = []
                raw_polygons_dict[tid].extend(polys)

    # --- 关键改进：处理重叠与孔洞 ---
    all_batch_polygons = {}
    if raw_polygons_dict:
        print(f"[Auto] 正在合并重叠区域并填充孔洞...", flush=True)

        # 收集所有多边形（跨类别合并后再按目标类别写入）
        all_raw_polys = [p for polys in raw_polygons_dict.values() for p in polys]
        # 1. 空间并集：将所有重叠的多边形合并为一个大的多边形集
        merged_geom = unary_union(all_raw_polys)

        final_processed_polys = []

        # 2. 遍历合并后的几何体（处理 MultiPolygon）
        if merged_geom.geom_type == 'Polygon':
            geoms = [merged_geom]
        else:
            geoms = list(merged_geom.geoms)

        for poly in geoms:
            # 3. 填平所有内孔 (Holes)
            # 只保留外轮廓 (Exterior)，舍弃所有内轮廓
            no_holes_poly = Polygon(poly.exterior)

            # 4. 建筑直角化/简化 (Regularization)
            # 使用之前定义的 regularize_building_poly 或 simplify
            simplified_poly = no_holes_poly.simplify(0.5, preserve_topology=True)

            # 5. 过滤掉过小的碎片（可能是误检）
            if simplified_poly.area > 50:
                final_processed_polys.append(simplified_poly)

        # 重新构建存储格式
        target_tid = params.get('currentTypeId') or 2
        all_batch_polygons = {target_tid: final_processed_polys}

    # 5. 统一一次性写入数据库
    if all_batch_polygons:
        conn = connect_db()
        if conn:
            try:
                with conn.cursor() as cur:
                    if TASK_ITEM_ID is not None:
                        cur.execute("DELETE FROM mark WHERE task_id = %s AND task_item_id = %s AND user_id = %s AND status = 2",
                                    (int(params['taskid']), TASK_ITEM_ID, params.get('user_id')))
                    else:
                        cur.execute("DELETE FROM mark WHERE task_id = %s AND user_id = %s AND status = 2",
                                    (int(params['taskid']), params.get('user_id')))
                insert_segmentation_results_db(conn, int(params['taskid']), all_batch_polygons,
                                               params.get('user_id'), status=2, task_item_id=TASK_ITEM_ID)
                conn.commit()
                poly_count = sum(len(v) for v in all_batch_polygons.values())
                print(f"[Auto] 批量标注成功：共 {poly_count} 个多边形")
                # 异步记录 prov（不阻塞）
                prov_auto_building(params['taskid'], str(params.get('user_id') or ""),
                                   len(det_boxes), poly_count)
            finally:
                conn.close()


def regularize_building_poly(poly: Polygon, tolerance=0.5):
    """
    对建筑多边形进行直角简化处理
    """
    # 1. 基础简化：减少多余节点
    simplified = poly.simplify(tolerance, preserve_topology=True)

    # 2. 如果建筑比较规整，可以考虑直接转为最小外接矩形（可选）
    # 但为了支持 L 型建筑，通常使用多边形简化即可
    return simplified


def inference_sam(argv):
    """兼容旧调用方式，委托给 inference_sam_v1"""
    inference_sam_v1({
        "taskid": argv[1],
        "mapfile_path": argv[2],
        "user_id": argv[3] if len(argv) > 3 else None,
        "promptType": "batch",
        "param2": argv[5] if len(argv) > 5 else "50",
        "param3": argv[6] if len(argv) > 6 else "10",
        "param4": argv[7] if len(argv) > 7 else "1",
    })


def _safe_mean(values):
    return float(sum(values) / len(values)) if values else None


def _bbox_to_polygon(bbox):
    if not bbox or len(bbox) < 4:
        return None
    x, y, w, h = bbox[:4]
    return Polygon([(x, y), (x + w, y), (x + w, y + h), (x, y + h)])


def _segmentation_to_polygon(segmentation):
    if not segmentation:
        return None
    if isinstance(segmentation[0], list):
        points = segmentation
    else:
        points = list(zip(segmentation[0::2], segmentation[1::2]))
    if len(points) < 3:
        return None
    poly = Polygon(points)
    return poly.buffer(0) if not poly.is_valid else poly


def _build_gt_index(label_path):
    with open(label_path, "r", encoding="utf-8") as f:
        meta = json.load(f)
    gt_by_slice = {}
    for image in meta.get("images", []):
        for obj in image.get("objects", []):
            slice_name = obj.get("sliceFileName")
            if not slice_name:
                continue
            poly = _segmentation_to_polygon(obj.get("segmentation")) or _bbox_to_polygon(obj.get("bbox"))
            if poly is None or poly.is_empty:
                continue
            gt_by_slice.setdefault(slice_name, []).append({
                "type_id": int(obj.get("categoryId")) if obj.get("categoryId") is not None else None,
                "shape": poly,
            })
    return gt_by_slice


def _remember_cache(cache_store, key, value, max_size):
    cache_store[key] = value
    cache_store.move_to_end(key)
    while len(cache_store) > max_size:
        cache_store.popitem(last=False)


def _get_cached_gt_index(label_path):
    mtime = os.path.getmtime(label_path)
    cache_key = (label_path, mtime)
    cached = GT_INDEX_CACHE.get(cache_key)
    if cached is not None:
        GT_INDEX_CACHE.move_to_end(cache_key)
        return cached, True
    gt_index = _build_gt_index(label_path)
    _remember_cache(GT_INDEX_CACHE, cache_key, gt_index, MAX_GT_INDEX_CACHE)
    return gt_index, False


def _prepare_quality_image(image_path, expected_channels=3, target_size=None):
    image_bgr = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if image_bgr is None:
        raise FileNotFoundError(f"无法读取样本切片: {image_path}")
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    if expected_channels not in (None, 3):
        raise ValueError(f"当前参考评估仅支持 3 通道切片推理，模型输入通道为 {expected_channels}")
    original_h, original_w = image_rgb.shape[:2]
    resized_rgb = image_rgb
    if target_size is not None:
        try:
            target_size = int(target_size)
        except Exception:
            target_size = None
        if target_size is not None and target_size > 0 and (original_h != target_size or original_w != target_size):
            resized_rgb = cv2.resize(image_rgb, (target_size, target_size), interpolation=cv2.INTER_LINEAR)
    resized_h, resized_w = resized_rgb.shape[:2]
    tensor = resized_rgb.transpose(2, 0, 1).astype(np.float32) / 255.0
    resize_meta = {
        "original_width": int(original_w),
        "original_height": int(original_h),
        "resized_width": int(resized_w),
        "resized_height": int(resized_h),
        "scale_x": float(original_w / resized_w) if resized_w > 0 else 1.0,
        "scale_y": float(original_h / resized_h) if resized_h > 0 else 1.0,
    }
    return image_bgr, tensor, resize_meta


def _fill_small_holes_binary(mask, hole_size_threshold):
    if hole_size_threshold is None or int(hole_size_threshold) <= 0:
        return mask
    working = (mask > 0).astype(np.uint8)
    contours, hierarchy = cv2.findContours(working.copy(), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return working
    filled = working.copy()
    for idx, contour in enumerate(contours):
        parent_idx = hierarchy[0][idx][3]
        if parent_idx == -1:
            continue
        if cv2.contourArea(contour) <= float(hole_size_threshold):
            cv2.drawContours(filled, [contour], -1, 1, thickness=-1)
    return filled


def _smooth_contour(contour, boundary_smoothing):
    if contour is None or len(contour) < 3:
        return contour
    if boundary_smoothing is None:
        return contour
    try:
        epsilon = float(boundary_smoothing)
    except Exception:
        return contour
    if epsilon <= 0:
        return contour
    return cv2.approxPolyDP(contour, epsilon, True)


def _scale_contour_points(contour, resize_meta):
    if contour is None or len(contour) == 0:
        return []
    scale_x = float((resize_meta or {}).get("scale_x", 1.0))
    scale_y = float((resize_meta or {}).get("scale_y", 1.0))
    return [
        (float(pt[0][0]) * scale_x, float(pt[0][1]) * scale_y)
        for pt in contour
    ]


def _infer_checkpoint_architecture(keys):
    if not isinstance(keys, list):
        return "unknown"
    if any(key.startswith("encoder._conv_stem") for key in keys) and any(key.startswith("decoder.blocks.") for key in keys):
        return "smp_unetpp_like"
    if any(key.startswith("inc.") for key in keys) and any(key.startswith("downs.") for key in keys):
        return "native_unet_like"
    if any(key.startswith("learning_to_downsample") for key in keys):
        return "fast_scnn_like"
    if any("classifier.4" in key or "backbone." in key for key in keys):
        return "deeplab_like"
    if any(key.startswith("segformer.encoder.") or key.startswith("decode_head.") for key in keys):
        return "segformer_like"
    return "unknown"


def _raise_weight_mismatch(model_type, model_path, load_info, framework="", arch="", exc=None):
    keys = load_info.get("all_keys") or load_info.get("sample_keys") or []
    inferred_arch = _infer_checkpoint_architecture(keys)
    readable_type = {
        "unet": "UNet",
        "light_unet": "LightUNet",
        "fast_scnn": "FastSCNN",
        "deeplab": "DeepLab",
        "segformer": "SegFormer",
    }.get(model_type, model_type)
    missing_count = len(load_info.get("missing_keys", []))
    unexpected_count = len(load_info.get("unexpected_keys", []))
    sample_keys = load_info.get("sample_keys", [])
    base_msg = (
        f"参考评估模型加载失败: model_path={model_path}, framework={framework or 'unknown'}, "
        f"arch={arch or 'unknown'}, model_type={readable_type}, "
        f"missing_keys={missing_count}, unexpected_keys={unexpected_count}, "
        f"sample_keys={sample_keys}, message={load_info.get('message', '')}"
    )
    if inferred_arch == "smp_unetpp_like":
        base_msg += (
            "。诊断：权重键看起来更像 segmentation_models_pytorch 的 Unet++/EfficientNet 系列，"
            f"请补充正确 arch 或上传本系统原生 {readable_type} 权重。"
        )
    if inferred_arch == "segformer_like" and model_type != "segformer":
        base_msg += "。诊断：权重键看起来更像 SegFormer，请将 arch/model_type 配置为 segformer。"
    if exc:
        raise ValueError(base_msg) from exc
    raise ValueError(base_msg)


def _load_quality_model(model_info):
    model_meta = parse_model_metadata(model_info)
    validate_model_metadata(model_meta)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    class_mapping = model_meta.get("classMapping", {}) if isinstance(model_meta.get("classMapping"), dict) else {}
    class_mapping = {int(k): int(v) for k, v in class_mapping.items()}
    if not class_mapping:
        raise ValueError("模型缺少类别映射，无法执行参考评估")

    model_path = ensure_model_local(model_info)
    if not model_path or not os.path.exists(model_path):
        raise FileNotFoundError(f"模型文件不存在: {model_path}")

    cache_key = (model_info.get("model_id"), model_path, os.path.getmtime(model_path))
    cached = MODEL_REFERENCE_CACHE.get(cache_key)
    if cached is not None:
        MODEL_REFERENCE_CACHE.move_to_end(cache_key)
        return cached, True

    runtime_meta = dict(model_meta)
    runtime_meta["modelPath"] = model_path
    runtime_meta["path"] = model_path
    runtime_meta["modelName"] = model_info.get("model_name")
    runtime_meta["inputChannels"] = int(model_meta.get("inputChannels") or model_info.get("input_num") or 3)
    runtime_meta["numClasses"] = int(model_meta.get("numClasses") or model_info.get("output_num") or (len(class_mapping) + 1))

    try:
        built = build_model_from_spec(runtime_meta, device)
    except Exception as exc:
        framework = str(model_meta.get("framework") or "")
        arch = str(model_meta.get("arch") or "")
        raise ValueError(
            f"参考评估模型构造失败: model_path={model_path}, framework={framework}, arch={arch}, error={exc}"
        ) from exc

    loaded_model = built["model"]
    model_type = built["runtime_type"]
    input_channels = runtime_meta["inputChannels"]

    if built.get("requires_weight_load"):
        loaded_model, load_info = safe_load_model_weights(loaded_model, model_path, strict=False)
        if not load_info.get("ok"):
            try:
                # 显式复用公共工具链，保障诊断路径一致。
                checkpoint = load_checkpoint(model_path)
                state_dict = extract_state_dict(checkpoint)
                normalized_state = normalize_state_dict_keys(state_dict)
                load_info["all_keys"] = list(normalized_state.keys())
                if not load_info.get("sample_keys"):
                    load_info["sample_keys"] = load_info["all_keys"][:10]
                if not load_info.get("key_count"):
                    load_info["key_count"] = len(load_info["all_keys"])
            except Exception:
                pass
            _raise_weight_mismatch(
                model_type,
                model_path,
                load_info,
                framework=str(model_meta.get("framework") or ""),
                arch=str(model_meta.get("arch") or ""),
            )
        if load_info.get("missing_keys") or load_info.get("unexpected_keys"):
            print(
                f"[model_load][warn] model_path={model_path}, framework={model_meta.get('framework')}, "
                f"arch={model_meta.get('arch')}, missing_keys={len(load_info.get('missing_keys', []))}, "
                f"unexpected_keys={len(load_info.get('unexpected_keys', []))}, "
                f"sample_keys={load_info.get('sample_keys')}, message={load_info.get('message')}"
            )
        else:
            print(
                f"[model_load][ok] model_path={model_path}, framework={model_meta.get('framework')}, "
                f"arch={model_meta.get('arch')}, key_count={load_info.get('key_count')}, "
                f"sample_keys={load_info.get('sample_keys')}"
            )
        loaded_model.eval()
    elif model_type == "yolo":
        # YOLO 仍使用其官方加载方式；后续可统一纳入公共加载工具。
        pass
    else:
        raise ValueError(f"当前参考评估暂不支持模型类型: {model_type}")

    loaded = {
        "model": loaded_model,
        "meta": model_meta,
        "type": model_type,
        "device": device,
        "class_mapping": class_mapping,
        "background_class_index": 0,
        "input_channels": input_channels,
    }
    _remember_cache(MODEL_REFERENCE_CACHE, cache_key, loaded, MAX_MODEL_REFERENCE_CACHE)
    return loaded, False


def _resolve_segmentation_logits(raw_outputs):
    if isinstance(raw_outputs, dict):
        if "logits" in raw_outputs:
            return raw_outputs["logits"]
        if "out" in raw_outputs:
            return raw_outputs["out"]
    if isinstance(raw_outputs, (list, tuple)):
        for candidate in raw_outputs:
            if torch.is_tensor(candidate):
                return candidate
    if hasattr(raw_outputs, "logits"):
        return raw_outputs.logits
    if torch.is_tensor(raw_outputs):
        return raw_outputs
    raise ValueError(f"无法解析分割模型输出 logits，输出类型={type(raw_outputs)}")


def _predict_segmentation_with_confidence(model, image_tensor, device, class_mapping=None, background_class_index=0):
    with torch.no_grad():
        image_tensor = torch.from_numpy(image_tensor).float().unsqueeze(0).to(device)
        outputs = model(image_tensor)
        outputs = _resolve_segmentation_logits(outputs)
        if outputs.shape[2:] != image_tensor.shape[2:]:
            outputs = torch.nn.functional.interpolate(outputs, size=image_tensor.shape[2:], mode='bilinear', align_corners=False)
        channel_count = int(outputs.shape[1]) if outputs.ndim >= 4 else 0
        if channel_count <= 1:
            prob_map = torch.sigmoid(outputs).squeeze().detach().cpu().numpy().astype(np.float32)
            prob_map = np.clip(prob_map, 0.0, 1.0)
            predicted_mask = (prob_map >= 0.5).astype(np.uint8)
            confidence_map = np.maximum(prob_map, 1.0 - prob_map).astype(np.float32)
        else:
            probabilities = torch.softmax(outputs, dim=1).squeeze(0).detach().cpu().numpy().astype(np.float32)
            predicted_mask = np.argmax(probabilities, axis=0).astype(np.uint8)
            confidence_map = np.max(probabilities, axis=0).astype(np.float32)
            available_classes = sorted(int(idx) for idx in (class_mapping or {}).keys())
            foreground_classes = [idx for idx in available_classes if idx != int(background_class_index)]
            target_class_index = foreground_classes[0] if foreground_classes else (available_classes[0] if available_classes else 1)
            if target_class_index >= probabilities.shape[0]:
                target_class_index = min(max(probabilities.shape[0] - 1, 0), int(background_class_index) + 1)
            prob_map = probabilities[int(target_class_index)].astype(np.float32)
    return predicted_mask, confidence_map, np.clip(prob_map, 0.0, 1.0).astype(np.float32)


def _extract_predictions_for_slice(loaded, image_path, confidence_threshold, iou_threshold, infer_params):
    model_type = loaded["type"]
    class_mapping = loaded["class_mapping"]
    predictions = []
    prob_map = None
    target_size = (infer_params or {}).get("slice_size")
    image_bgr, image_tensor, resize_meta = _prepare_quality_image(
        image_path,
        loaded.get("input_channels"),
        target_size=target_size,
    )

    if model_type == "yolo":
        imgsz = int((infer_params or {}).get("slice_size", 640))
        results = loaded["model"](image_bgr, conf=confidence_threshold, iou=iou_threshold, imgsz=imgsz, verbose=False)
        for result in results:
            if getattr(result, "obb", None) is not None and len(result.obb) > 0:
                boxes = result.obb.xyxyxyxy.cpu().numpy()
                class_ids = result.obb.cls.cpu().numpy()
                confidences = result.obb.conf.cpu().numpy()
                for box, class_id, conf in zip(boxes, class_ids, confidences):
                    type_id = class_mapping.get(int(class_id))
                    if type_id is None:
                        continue
                    poly = Polygon([(float(pt[0]), float(pt[1])) for pt in box])
                    if not poly.is_valid:
                        poly = poly.buffer(0)
                    if poly.is_empty:
                        continue
                    predictions.append({
                        "type_id": type_id,
                        "shape": poly,
                        "confidence": float(conf),
                        "preview_type": "polygon",
                    })
            elif getattr(result, "boxes", None) is not None and len(result.boxes) > 0:
                boxes = result.boxes.xyxy.cpu().numpy()
                class_ids = result.boxes.cls.cpu().numpy()
                confidences = result.boxes.conf.cpu().numpy()
                for box, class_id, conf in zip(boxes, class_ids, confidences):
                    type_id = class_mapping.get(int(class_id))
                    if type_id is None:
                        continue
                    x1, y1, x2, y2 = [float(v) for v in box]
                    poly = Polygon([(x1, y1), (x2, y1), (x2, y2), (x1, y2)])
                    predictions.append({
                        "type_id": type_id,
                        "shape": poly,
                        "confidence": float(conf),
                        "preview_type": "bbox",
                        "box": [x1, y1, x2, y2],
                    })
    else:
        min_object_size = int((infer_params or {}).get("min_object_size", 50))
        hole_size_threshold = int((infer_params or {}).get("hole_size_threshold", 0) or 0)
        boundary_smoothing = float((infer_params or {}).get("boundary_smoothing", 0) or 0)
        predicted_mask, confidence_map, prob_map = _predict_segmentation_with_confidence(
            loaded["model"],
            image_tensor,
            loaded["device"],
            class_mapping=class_mapping,
            background_class_index=loaded.get("background_class_index", 0),
        )
        original_width = int((resize_meta or {}).get("original_width", 0))
        original_height = int((resize_meta or {}).get("original_height", 0))
        if original_width > 0 and original_height > 0 and (
            predicted_mask.shape[1] != original_width or predicted_mask.shape[0] != original_height
        ):
            predicted_mask = cv2.resize(predicted_mask, (original_width, original_height), interpolation=cv2.INTER_NEAREST)
            confidence_map = cv2.resize(confidence_map, (original_width, original_height), interpolation=cv2.INTER_LINEAR)
            prob_map = cv2.resize(prob_map, (original_width, original_height), interpolation=cv2.INTER_LINEAR)
        for class_index, type_id in class_mapping.items():
            class_mask = (predicted_mask == int(class_index)).astype(np.uint8)
            class_mask = _fill_small_holes_binary(class_mask, hole_size_threshold)
            if class_mask.sum() < min_object_size:
                continue
            contours, _ = cv2.findContours(class_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for contour in contours:
                contour = _smooth_contour(contour, boundary_smoothing)
                area = cv2.contourArea(contour)
                if area < min_object_size:
                    continue
                contour_mask = np.zeros_like(class_mask, dtype=np.uint8)
                cv2.drawContours(contour_mask, [contour], -1, 1, thickness=-1)
                contour_region = contour_mask.astype(bool)
                conf = float(confidence_map[contour_region].mean()) if contour_region.any() else 0.0
                if conf < float(confidence_threshold):
                    continue
                points = [(float(pt[0][0]), float(pt[0][1])) for pt in contour]
                if len(points) < 3:
                    continue
                poly = Polygon(points)
                if not poly.is_valid:
                    poly = poly.buffer(0)
                if poly.is_empty:
                    continue
                predictions.append({
                    "type_id": type_id,
                    "shape": poly,
                    "confidence": conf,
                    "preview_type": "polygon",
                })
    return {
        "predictions": predictions,
        "prob_map": np.clip(prob_map.astype(np.float32), 0.0, 1.0) if prob_map is not None else None,
    }


def _polygon_to_points(shape, max_points=200):
    if shape is None or shape.is_empty:
        return []
    geom = shape
    if geom.geom_type == "MultiPolygon":
        # 取面积最大的面做预览
        geom = max(list(geom.geoms), key=lambda g: g.area) if len(geom.geoms) > 0 else None
    if geom is None or geom.is_empty or geom.geom_type != "Polygon":
        return []
    coords = list(geom.exterior.coords)
    if len(coords) > max_points:
        step = max(1, len(coords) // max_points)
        coords = coords[::step]
    return [[round(float(x), 2), round(float(y), 2)] for x, y in coords]


def _safe_preview_mask_filename(slice_name, suffix="_tdml_prob_heatmap.png"):
    base_name = os.path.splitext(os.path.basename(str(slice_name or "preview")))[0]
    sanitized = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in base_name).strip("_")
    return f"{sanitized or 'preview'}{suffix}"


def _write_probability_heatmap(image_dir, slice_name, posterior):
    if posterior is None or image_dir is None:
        return None
    try:
        masks_dir = os.path.join(os.path.dirname(image_dir), "masks")
        os.makedirs(masks_dir, exist_ok=True)
        normalized = np.clip(np.asarray(posterior, dtype=np.float32), 0.0, 1.0)
        finite_values = normalized[np.isfinite(normalized)]
        preview_normalized = normalized
        if finite_values.size > 0:
            lo = float(np.percentile(finite_values, 2))
            hi = float(np.percentile(finite_values, 98))
            if hi - lo > 1e-6:
                preview_normalized = np.clip((normalized - lo) / (hi - lo), 0.0, 1.0)
        grayscale = (preview_normalized * 255.0).astype(np.uint8)
        colormap = getattr(cv2, "COLORMAP_TURBO", cv2.COLORMAP_JET)
        heatmap = cv2.applyColorMap(grayscale, colormap)
        alpha = np.clip(np.maximum(np.sqrt(preview_normalized), normalized) * 255.0, 0.0, 255.0).astype(np.uint8)
        heatmap_bgra = cv2.cvtColor(heatmap, cv2.COLOR_BGR2BGRA)
        heatmap_bgra[:, :, 3] = alpha
        output_name = _safe_preview_mask_filename(slice_name)
        output_path = os.path.join(masks_dir, output_name)
        cv2.imwrite(output_path, heatmap_bgra)
        return output_name if os.path.exists(output_path) else None
    except Exception as exc:
        print(f"[quality_preview][warn] failed to write heatmap for {slice_name}: {exc}")
        return None


def _build_preview_item(slice_name, image_bgr, gt_items, predictions, fallback_preview_type="polygon", image_dir=None, posterior=None):
    height = int(image_bgr.shape[0]) if image_bgr is not None else None
    width = int(image_bgr.shape[1]) if image_bgr is not None else None
    preview_type = fallback_preview_type
    overlay_polygons = []
    overlay_boxes = []
    overlay_mask_file = _write_probability_heatmap(image_dir, slice_name, posterior)

    for pred in predictions:
        pred_type = pred.get("preview_type")
        if pred_type == "bbox" and pred.get("box"):
            preview_type = "bbox"
            x1, y1, x2, y2 = pred.get("box")
            overlay_boxes.append({
                "x1": round(float(x1), 2),
                "y1": round(float(y1), 2),
                "x2": round(float(x2), 2),
                "y2": round(float(y2), 2),
                "confidence": round(float(pred.get("confidence", 0.0)), 4),
                "typeId": pred.get("type_id"),
            })
        else:
            pts = _polygon_to_points(pred.get("shape"))
            if len(pts) >= 3:
                overlay_polygons.append({
                    "points": pts,
                    "confidence": round(float(pred.get("confidence", 0.0)), 4),
                    "typeId": pred.get("type_id"),
                })

    if overlay_mask_file:
        preview_type = "heatmap"
        overlay_polygons = []
        overlay_boxes = []
    elif preview_type != "bbox" and overlay_polygons:
        preview_type = "polygon"

    conf_values = [float(pred.get("confidence", 0.0)) for pred in predictions if pred.get("confidence") is not None]
    pred_classes = sorted({int(pred.get("type_id")) for pred in predictions if pred.get("type_id") is not None})
    gt_classes = sorted({int(gt.get("type_id")) for gt in gt_items if gt.get("type_id") is not None})
    class_intersection = len(set(pred_classes).intersection(set(gt_classes)))
    class_coverage = (class_intersection / len(gt_classes) * 100.0) if gt_classes else 0.0

    return {
        "sampleId": slice_name,
        "sliceFileName": slice_name,
        "width": width,
        "height": height,
        "previewType": preview_type,
        "overlayMaskFile": overlay_mask_file,
        "overlayPolygons": overlay_polygons,
        "overlayBoxes": overlay_boxes,
        "confidenceSummary": {
            "mean": round(float(_safe_mean(conf_values) or 0.0), 4),
            "min": round(float(min(conf_values) if conf_values else 0.0), 4),
            "max": round(float(max(conf_values) if conf_values else 0.0), 4),
        },
        "classSummary": {
            "predTypeIds": pred_classes,
            "gtTypeIds": gt_classes,
            "classCoverageRate": round(class_coverage, 2),
        },
    }


def _shape_iou(shape_a, shape_b):
    if shape_a is None or shape_b is None or shape_a.is_empty or shape_b.is_empty:
        return 0.0
    inter = shape_a.intersection(shape_b).area
    union = shape_a.union(shape_b).area
    return float(inter / union) if union > 0 else 0.0


def _match_items(gt_items, pred_items, iou_threshold):
    used_gt = set()
    used_pred = set()
    same_class_candidates = []
    all_candidates = []
    for gt_idx, gt in enumerate(gt_items):
        for pred_idx, pred in enumerate(pred_items):
            iou = _shape_iou(gt["shape"], pred["shape"])
            if iou <= 0:
                continue
            all_candidates.append((iou, gt_idx, pred_idx, gt["type_id"] == pred["type_id"]))
            if gt["type_id"] == pred["type_id"]:
                same_class_candidates.append((iou, gt_idx, pred_idx))

    matched_ious = []
    for iou, gt_idx, pred_idx in sorted(same_class_candidates, key=lambda item: item[0], reverse=True):
        if iou < iou_threshold or gt_idx in used_gt or pred_idx in used_pred:
            continue
        used_gt.add(gt_idx)
        used_pred.add(pred_idx)
        matched_ious.append(iou)

    agnostic_gt = set()
    agnostic_pred = set()
    agnostic_match = 0
    agnostic_same_class = 0
    for iou, gt_idx, pred_idx, same_class in sorted(all_candidates, key=lambda item: item[0], reverse=True):
        if iou < iou_threshold or gt_idx in agnostic_gt or pred_idx in agnostic_pred:
            continue
        agnostic_gt.add(gt_idx)
        agnostic_pred.add(pred_idx)
        agnostic_match += 1
        if same_class:
            agnostic_same_class += 1

    return {
        "matched": len(matched_ious),
        "missed": max(len(gt_items) - len(used_gt), 0),
        "redundant": max(len(pred_items) - len(used_pred), 0),
        "mean_iou": _safe_mean(matched_ious),
        "classification_accuracy": (agnostic_same_class / agnostic_match * 100.0) if agnostic_match > 0 else None,
    }


def _build_reference_notes(result_payload):
    notes = ["参考模型评估属于参考评价，不可替代人工真值。"]
    if not result_payload.get("suitable", False):
        notes.append(result_payload.get("reason", "当前模型不适合本次参考评估。"))
    elif result_payload.get("coverageRate", 0) < 60:
        notes.append("参考模型覆盖率偏低，建议结合人工抽检解释结果。")
    if result_payload.get("lowConfidenceRatio", 0) > 40:
        notes.append("低置信度预测占比较高，模型参考可信度受限。")
    return notes


def _safe_confidence_adjust(confidence, confidence_calib):
    conf = float(max(min(confidence, 1.0), 0.0))
    if not confidence_calib:
        return conf
    calib_type = str(confidence_calib.get("type", "")).strip().lower()
    value = confidence_calib.get("value")
    try:
        factor = float(value)
    except Exception:
        factor = None
    if calib_type == "temperature" and factor is not None and factor > 0:
        # 温度缩放的简单概率近似：T>1 降低自信，T<1 增强自信。
        return float(max(min(pow(conf, 1.0 / factor), 1.0), 0.0))
    if calib_type == "scale" and factor is not None and factor > 0:
        return float(max(min(conf * factor, 1.0), 0.0))
    return conf


def _normalize_reference_sources(request: QualityReferenceRequest):
    normalized = []
    if request.referenceSources:
        for idx, source in enumerate(request.referenceSources):
            source_id = source.sourceId or f"source-{idx + 1}"
            source_type = (source.sourceType or "model").strip().lower()
            weight = float(source.weight if source.weight is not None else 1.0)
            normalized.append({
                "sourceId": source_id,
                "sourceType": source_type,
                "modelId": source.modelId,
                "weight": max(weight, 0.0),
                "confidenceCalib": source.confidenceCalib or {},
            })
    if not normalized and request.modelId is not None:
        normalized.append({
            "sourceId": f"model-{request.modelId}",
            "sourceType": "model",
            "modelId": request.modelId,
            "weight": 1.0,
            "confidenceCalib": {},
        })
    return normalized


def _normalize_fusion_config(fusion_cfg: Optional[FusionConfig]):
    cfg = {
        "method": "staple",
        "fusionMode": "soft_staple",
        "maxIter": 50,
        "eps": 1e-4,
        "probThreshold": 0.5,
        "minAgreement": 0.2,
    }
    if fusion_cfg is None:
        return cfg
    cfg["method"] = (fusion_cfg.method or "staple").strip().lower()
    fusion_mode = str(getattr(fusion_cfg, "fusionMode", "soft_staple") or "soft_staple").strip().lower()
    cfg["fusionMode"] = fusion_mode if fusion_mode in {"soft_staple", "soft_average", "hard_staple"} else "soft_staple"
    cfg["maxIter"] = max(int(fusion_cfg.maxIter or 50), 1)
    cfg["eps"] = max(float(fusion_cfg.eps or 1e-4), 1e-8)
    cfg["probThreshold"] = min(max(float(fusion_cfg.probThreshold if fusion_cfg.probThreshold is not None else 0.5), 0.01), 0.99)
    cfg["minAgreement"] = min(max(float(fusion_cfg.minAgreement if fusion_cfg.minAgreement is not None else 0.2), 0.0), 1.0)
    return cfg


def _load_reference_sources(conn, source_specs, request_task_type):
    loaded_sources = []
    source_summaries = []
    cache_hits = 0
    primary_model_info = None
    for spec in source_specs:
        if spec.get("sourceType") != "model":
            source_summaries.append({
                "sourceId": spec.get("sourceId"),
                "sourceType": spec.get("sourceType"),
                "status": "SKIPPED",
                "reason": "当前版本仅支持 model 来源",
            })
            continue
        model_id = spec.get("modelId")
        if model_id is None:
            raise ValueError(f"参考来源缺少 modelId: {spec.get('sourceId')}")
        model_info = fetch_model_by_id(conn, model_id)
        if not model_info:
            raise ValueError(f"参考来源模型不存在: {model_id}")
        if request_task_type and model_info.get("task_type") and request_task_type != model_info.get("task_type"):
            raise ValueError(f"参考来源模型任务类型不一致: modelId={model_id}")
        loaded, model_cache_hit = _load_quality_model(model_info)
        if model_cache_hit:
            cache_hits += 1
        if primary_model_info is None:
            primary_model_info = model_info
        loaded_sources.append({
            "sourceId": spec.get("sourceId"),
            "sourceType": "model",
            "modelId": model_id,
            "weight": max(float(spec.get("weight", 1.0)), 0.0),
            "confidenceCalib": spec.get("confidenceCalib") or {},
            "loaded": loaded,
            "modelInfo": model_info,
        })
        source_summaries.append({
            "sourceId": spec.get("sourceId"),
            "sourceType": "model",
            "modelId": model_id,
            "modelName": model_info.get("model_name"),
            "weight": round(float(spec.get("weight", 1.0)), 4),
            "cacheHit": bool(model_cache_hit),
            "status": "READY",
        })
    if not loaded_sources:
        raise ValueError("没有可用的模型参考来源")
    return loaded_sources, source_summaries, cache_hits, primary_model_info


def _shape_to_mask(shape, height, width):
    if shape is None or shape.is_empty or height <= 0 or width <= 0:
        return np.zeros((height, width), dtype=np.uint8)
    mask = np.zeros((height, width), dtype=np.uint8)
    geoms = [shape]
    if shape.geom_type == "MultiPolygon":
        geoms = list(shape.geoms)
    for geom in geoms:
        if geom is None or geom.is_empty or geom.geom_type != "Polygon":
            continue
        pts = np.array([[int(round(x)), int(round(y))] for x, y in geom.exterior.coords], dtype=np.int32)
        if pts.shape[0] < 3:
            continue
        pts[:, 0] = np.clip(pts[:, 0], 0, width - 1)
        pts[:, 1] = np.clip(pts[:, 1], 0, height - 1)
        cv2.fillPoly(mask, [pts], 1)
    return mask


def _build_source_maps(predictions, height, width, weight, confidence_calib):
    presence = np.zeros((height, width), dtype=np.float32)
    score_map = np.zeros((height, width), dtype=np.float32)
    class_map = np.full((height, width), -1, dtype=np.int32)
    for pred in predictions:
        shape = pred.get("shape")
        if shape is None or shape.is_empty:
            continue
        mask = _shape_to_mask(shape, height, width).astype(bool)
        if not mask.any():
            continue
        conf = _safe_confidence_adjust(pred.get("confidence", 0.0), confidence_calib)
        weighted_conf = float(max(conf * max(weight, 0.0), 0.0))
        if weighted_conf <= 0:
            continue
        presence[mask] = np.maximum(presence[mask], conf)
        update = mask & (weighted_conf > score_map)
        if update.any():
            score_map[update] = weighted_conf
            class_map[update] = int(pred.get("type_id")) if pred.get("type_id") is not None else -1
    return presence, score_map, class_map


def _run_weighted_staple(binary_masks, weights, max_iter=50, eps=1e-4):
    mask_stack = [m.astype(np.float32) for m in binary_masks if m is not None]
    if not mask_stack:
        return None, [], []
    weights = [max(float(w), 1e-3) for w in weights]
    p = np.mean(mask_stack, axis=0).astype(np.float32)
    alpha = np.full(len(mask_stack), 0.95, dtype=np.float32)
    beta = np.full(len(mask_stack), 0.95, dtype=np.float32)

    for _ in range(max_iter):
        prev = p.copy()
        pos_like = np.ones_like(p, dtype=np.float32)
        neg_like = np.ones_like(p, dtype=np.float32)
        for idx, s in enumerate(mask_stack):
            w = weights[idx]
            a = float(np.clip(alpha[idx], 1e-3, 1 - 1e-3))
            b = float(np.clip(beta[idx], 1e-3, 1 - 1e-3))
            pos_like *= np.power(a, w * s) * np.power(1.0 - a, w * (1.0 - s))
            neg_like *= np.power(1.0 - b, w * s) * np.power(b, w * (1.0 - s))
        denom = pos_like + neg_like + 1e-12
        p = pos_like / denom

        for idx, s in enumerate(mask_stack):
            w = weights[idx]
            denom_pos = float(np.sum(w * p) + 1e-12)
            denom_neg = float(np.sum(w * (1.0 - p)) + 1e-12)
            alpha[idx] = float(np.sum(w * p * s) / denom_pos)
            beta[idx] = float(np.sum(w * (1.0 - p) * (1.0 - s)) / denom_neg)
            alpha[idx] = float(np.clip(alpha[idx], 1e-3, 1 - 1e-3))
            beta[idx] = float(np.clip(beta[idx], 1e-3, 1 - 1e-3))

        if float(np.mean(np.abs(p - prev))) <= eps:
            break
    return p.astype(np.float32), alpha.tolist(), beta.tolist()


def _run_weighted_soft_fusion(source_soft_maps, weights):
    soft_stack = [m.astype(np.float32) for m in source_soft_maps if m is not None]
    if not soft_stack:
        return None
    safe_weights = np.array([max(float(w), 1e-3) for w in weights[:len(soft_stack)]], dtype=np.float32)
    fused = np.average(np.stack(soft_stack, axis=0), axis=0, weights=safe_weights)
    return np.clip(fused.astype(np.float32), 0.0, 1.0)


def _run_weighted_soft_staple(source_prob_maps, weights, max_iter=50, eps=1e-4):
    prob_stack = [np.clip(np.asarray(m, dtype=np.float32), 0.0, 1.0) for m in source_prob_maps if m is not None]
    if not prob_stack:
        return None
    safe_weights = np.array([max(float(w), 1e-3) for w in weights[:len(prob_stack)]], dtype=np.float32)
    if safe_weights.size == 0:
        safe_weights = np.ones(len(prob_stack), dtype=np.float32)
    p = np.average(np.stack(prob_stack, axis=0), axis=0, weights=safe_weights).astype(np.float32)
    alpha = np.full(len(prob_stack), 0.95, dtype=np.float32)
    beta = np.full(len(prob_stack), 0.95, dtype=np.float32)

    for _ in range(max(int(max_iter), 1)):
        prev = p.copy()
        pos_like = np.ones_like(p, dtype=np.float32)
        neg_like = np.ones_like(p, dtype=np.float32)
        for idx, s in enumerate(prob_stack):
            w = float(safe_weights[idx])
            a = float(np.clip(alpha[idx], 1e-3, 1.0 - 1e-3))
            b = float(np.clip(beta[idx], 1e-3, 1.0 - 1e-3))
            pos_like *= np.power(a, w * s) * np.power(1.0 - a, w * (1.0 - s))
            neg_like *= np.power(1.0 - b, w * s) * np.power(b, w * (1.0 - s))
        denom = pos_like + neg_like + 1e-12
        p = np.clip(pos_like / denom, 0.0, 1.0)

        for idx, s in enumerate(prob_stack):
            w = float(safe_weights[idx])
            denom_pos = float(np.sum(w * p) + 1e-12)
            denom_neg = float(np.sum(w * (1.0 - p)) + 1e-12)
            alpha[idx] = float(np.sum(w * p * s) / denom_pos)
            beta[idx] = float(np.sum(w * (1.0 - p) * (1.0 - s)) / denom_neg)
            alpha[idx] = float(np.clip(alpha[idx], 1e-3, 1.0 - 1e-3))
            beta[idx] = float(np.clip(beta[idx], 1e-3, 1.0 - 1e-3))

        if float(np.mean(np.abs(p - prev))) <= float(max(eps, 1e-8)):
            break

    return np.clip(p.astype(np.float32), 0.0, 1.0)


def _build_fused_predictions(posterior, class_map, min_object_size=50, prob_threshold=0.5):
    binary = (posterior >= float(prob_threshold)).astype(np.uint8)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    fused = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < float(max(min_object_size, 1)):
            continue
        points = [(float(pt[0][0]), float(pt[0][1])) for pt in contour]
        if len(points) < 3:
            continue
        poly = Polygon(points)
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty:
            continue
        contour_mask = np.zeros_like(binary, dtype=np.uint8)
        cv2.drawContours(contour_mask, [contour], -1, 1, thickness=-1)
        region = contour_mask.astype(bool)
        conf = float(posterior[region].mean()) if region.any() else 0.0
        cls_values = class_map[region] if region.any() else np.array([], dtype=np.int32)
        cls_values = cls_values[cls_values >= 0]
        if cls_values.size > 0:
            unique, counts = np.unique(cls_values, return_counts=True)
            type_id = int(unique[np.argmax(counts)])
        else:
            type_id = None
        fused.append({
            "type_id": type_id,
            "shape": poly,
            "confidence": conf,
            "preview_type": "polygon",
        })
    return fused


def _posterior_uncertainty_stats(posterior):
    p = np.clip(posterior, 1e-6, 1.0 - 1e-6)
    entropy = -(p * np.log2(p) + (1.0 - p) * np.log2(1.0 - p))
    high_uncertain_ratio = float(np.mean(np.abs(posterior - 0.5) <= 0.1) * 100.0)
    return {
        "posteriorMean": float(np.mean(posterior)),
        "posteriorEntropyMean": float(np.mean(entropy)),
        "highUncertaintyRatio": high_uncertain_ratio,
    }


def _source_agreement(binary_masks):
    if not binary_masks:
        return 0.0
    stacked = np.stack(binary_masks, axis=0).astype(np.float32)
    vote = np.mean(stacked, axis=0)
    agreement = np.mean(np.abs(vote - 0.5) * 2.0) * 100.0
    return float(agreement)


# ── API 路由 ────────────────────────────────────────────────────────────────────
_sam_semaphore = __import__('threading').Semaphore(1)


@app.post("/assistFunction")
async def assist_function(request: AssistFunctionRequest):
    """SAM 交互标注 / XGBoost 提取 / 深度学习训练"""
    try:
        params = request.model_dump()
        print(f"===== 收到请求: 功能={request.functionName}, 任务ID={request.taskid} =====", flush=True)
        # 新增的分支
        if request.functionName == "auto_building_sam":
            auto_building_segmentation(params)
            return {"code": 200, "message": "全图建筑自动标注完成"}
        if request.functionName == "sam_inference":
            if not torch.cuda.is_available():
                raise RuntimeError("CUDA 不可用")
            inference_sam_v1(params)
            return {"code": 200, "message": "SAM处理完成"}

        elif request.functionName == "xgboost":
            argv = ["", request.taskid, request.mapfile_path, request.functionName,
                    request.assistInput, request.param1, request.param2,
                    request.param3, request.param4, request.user_id,
                    request.modelScopeStr, request.modelName, request.tasktype]
            train_function(argv)
            return {"code": 200, "message": "提取目标完成"}

        else:
            argv = ["", request.taskid, request.mapfile_path, request.functionName,
                    request.assistInput, request.param1, request.param2,
                    request.param3, request.param4, request.user_id,
                    request.modelScopeStr, request.modelName, request.tasktype]
            process = mp.Process(target=train_with_callback, args=(argv,), daemon=True)
            process.start()
            return {"code": 200, "message": "训练任务已启动"}

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"任务执行失败: {str(e)}")


@app.post("/Multi_assistFunction")
async def assist_multi_function(request: AssistMultFunctionRequest):
    """批量多影像训练"""
    try:
        argv = ["", request.taskid, request.mapfile_path, request.functionName,
                request.assistInput, request.param1, request.param2,
                request.param3, request.param4, request.user_id,
                "", request.modelName, request.tasktype]
        print(f"收到批量训练请求: {argv}")
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA 不可用")
        process = mp.Process(target=train_multi_with_callback, args=(argv,), daemon=True)
        process.start()
        return {"code": 200, "message": "批量训练任务已启动"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"批量训练启动失败: {str(e)}")


@app.post("/inferenceFunction")
async def inference_function(request: InferenceFunctionRequest):
    """模型推理"""
    try:
        model_identifier = str(request.model_id) if request.model_id else request.model
        if not model_identifier:
            raise ValueError("必须提供 model_id 或 model 参数")

        model_info = None
        conn = connect_db()
        if conn:
            try:
                model_info = (fetch_model_by_id(conn, request.model_id)
                              if request.model_id else fetch_model_from_db(conn, request.model))
                if not model_info:
                    raise HTTPException(status_code=404, detail=f"模型不存在: {model_identifier}")
            finally:
                conn.close()

        if isinstance(request.categoryMapping, dict):
            class_mapping = request.categoryMapping
        elif isinstance(request.categoryMapping, str):
            class_mapping = json.loads(request.categoryMapping or "{}")
        else:
            class_mapping = {}

        if not isinstance(class_mapping, dict):
            raise ValueError("categoryMapping must be a dict")
        class_mapping = {int(k): int(v) for k, v in class_mapping.items()}

        infer_params = request.inferParams or {}
        # 兼容旧 argv 参数位：优先显式 param，其次 inferParams 命名参数
        param1 = request.param1 or str(infer_params.get("conf_threshold", infer_params.get("min_object_size", "")))
        param2 = request.param2 or str(infer_params.get("slice_size", infer_params.get("hole_size_threshold", "")))
        param3 = request.param3 or str(infer_params.get("iou_threshold", infer_params.get("boundary_smoothing", "")))
        param4 = request.param4 or str(infer_params.get("overlap_ratio", infer_params.get("mask_threshold", "")))

        argv = ["", request.taskid, request.mapfile_path, request.user_id, model_identifier,
                param1, param2, param3, param4,
                request.modelScopeStr, class_mapping, request.taskItemId, request.currentTypeId, request.db_crs]
        print(f"收到推理请求: {argv}")

        if not torch.cuda.is_available():
            raise RuntimeError("CUDA 不可用")

        if request.model == "SAM" or (model_info and model_info.get('model_type') == 'SAM'):
            inference_sam(argv)
            return {"code": 200, "message": "SAM推理完成"}
        else:
            process = mp.Process(target=inference_with_callback, args=(argv,), daemon=True)
            process.start()
            return {"code": 200, "message": "推理任务已启动"}

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"categoryMapping JSON 解析失败: {e}")
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"推理启动失败: {str(e)}")


@app.post("/quality/reference-evaluate")
async def quality_reference_evaluate(request: QualityReferenceRequest):
    """质量评价专用：使用多来源融合（默认 STAPLE）生成参考概率真值并输出指标。"""
    conn = connect_db()
    if conn is None:
        raise HTTPException(status_code=500, detail="数据库连接失败")
    try:
        send_quality_progress(request.jobId, "参考模型信息校验", 46, 0, 0, "正在校验参考模型和样本路径")
        source_specs = _normalize_reference_sources(request)
        if not source_specs:
            raise HTTPException(status_code=400, detail="未提供可用参考来源（modelId/referenceSources）")
        fusion_cfg = _normalize_fusion_config(request.fusionConfig)
        loaded_sources, source_summaries, cache_hit_count, primary_model_info = _load_reference_sources(
            conn,
            source_specs,
            request.taskType,
        )
        if primary_model_info is None:
            raise HTTPException(status_code=400, detail="没有可用的模型来源")

        result_payload = {
            "suitable": False,
            "reason": "",
            "modelId": primary_model_info.get("model_id"),
            "modelName": primary_model_info.get("model_name"),
            "modelVersion": "",
            "modelType": primary_model_info.get("model_type"),
            "taskType": primary_model_info.get("task_type"),
            "fusionMethod": fusion_cfg.get("method", "staple"),
            "fusionMode": fusion_cfg.get("fusionMode", "soft_staple"),
            "evaluatedSamples": 0,
            "totalSamples": 0,
            "confidenceMean": 0.0,
            "coverageRate": 0.0,
            "lowConfidenceRatio": 0.0,
            "sampleCoverageRate": 0.0,
            "classCoverageRate": 0.0,
            "referenceReliability": 0.0,
            "referenceReliabilityLevel": "低",
            "confidenceScore": 0.0,
            "indicators": {},
            "sourceSummaries": source_summaries,
            "probabilityStats": {},
            "uncertaintyStats": {},
            "fusionConfigUsed": fusion_cfg,
            "previewItems": [],
            "notes": [],
        }

        if not os.path.isdir(request.imageDir):
            result_payload["reason"] = f"样本切片目录不存在: {request.imageDir}"
            result_payload["notes"] = _build_reference_notes(result_payload)
            return {"code": 200, "data": result_payload}
        if not os.path.isfile(request.labelPath):
            result_payload["reason"] = f"样本标签元数据不存在: {request.labelPath}"
            result_payload["notes"] = _build_reference_notes(result_payload)
            return {"code": 200, "data": result_payload}

        send_quality_progress(request.jobId, "解析样本标注索引", 52, 0, 0, "正在构建样本 GT 索引")
        gt_by_slice, gt_cache_hit = _get_cached_gt_index(request.labelPath)
        slice_files = sorted(gt_by_slice.keys())
        total_samples = len(slice_files)
        result_payload["totalSamples"] = total_samples
        if total_samples == 0:
            result_payload["reason"] = "样本集元数据中没有可评估切片"
            result_payload["notes"] = _build_reference_notes(result_payload)
            return {"code": 200, "data": result_payload}

        send_quality_progress(
            request.jobId,
            "加载参考模型",
            58,
            0,
            total_samples,
            "正在加载参考来源" + ("（命中GT缓存）" if gt_cache_hit else "")
        )
        model_meta = parse_model_metadata(primary_model_info)
        result_payload["modelVersion"] = model_meta.get("versionTag", "") if isinstance(model_meta, dict) else ""

        if request.scopeMode == "sample":
            sample_count = max(1, int(round(total_samples * max(min(request.sampleRatio, 1.0), 0.0))))
            if request.batchSize > 0:
                sample_count = min(sample_count, request.batchSize)
            slice_files = slice_files[:sample_count]
            total_samples = len(slice_files)
            result_payload["totalSamples"] = total_samples

        send_quality_progress(
            request.jobId,
            "参考推理中",
            62,
            0,
            total_samples,
            (f"已加载 {len(loaded_sources)} 个参考来源，开始逐样本融合推理（缓存命中 {cache_hit_count}）")
        )

        match_count = 0
        miss_count = 0
        redundant_count = 0
        gt_total = 0
        pred_total = 0
        mean_ious = []
        classification_scores = []
        confidence_values = []
        low_conf_count = 0
        evaluated_samples = 0
        class_gt_union = set()
        class_pred_union = set()
        preview_items = []
        preview_limit = max(int(request.previewLimit or 0), 0)
        progress_step = max(total_samples // 20, 1) if total_samples > 0 else 1
        posterior_means = []
        posterior_entropy_means = []
        high_uncertain_ratios = []
        source_agreements = []

        for slice_name in slice_files:
            image_path = os.path.join(request.imageDir, slice_name)
            if not os.path.isfile(image_path):
                continue
            gt_items = gt_by_slice.get(slice_name, [])
            image_bgr, _, _ = _prepare_quality_image(image_path, loaded_sources[0]["loaded"].get("input_channels"))
            height = int(image_bgr.shape[0]) if image_bgr is not None else 0
            width = int(image_bgr.shape[1]) if image_bgr is not None else 0
            if height <= 0 or width <= 0:
                continue

            source_predictions = []
            source_presence_maps = []
            source_prob_maps = []
            source_binary_masks = []
            source_weights = []
            global_score_map = np.zeros((height, width), dtype=np.float32)
            global_class_map = np.full((height, width), -1, dtype=np.int32)
            min_object_size = int((request.inferParams or {}).get("min_object_size", 50))
            min_agreement = float(fusion_cfg.get("minAgreement", 0.2))
            fusion_mode = str(fusion_cfg.get("fusionMode", "soft_staple") or "soft_staple").strip().lower()
            alpha_list = []
            beta_list = []

            for source in loaded_sources:
                source_result = _extract_predictions_for_slice(
                    source["loaded"],
                    image_path,
                    request.confidenceThreshold,
                    request.iouThreshold,
                    request.inferParams or {},
                )
                preds = source_result.get("predictions", []) if isinstance(source_result, dict) else (source_result or [])
                source_prob_map = source_result.get("prob_map") if isinstance(source_result, dict) else None
                source_predictions.append(preds)
                weight = max(float(source.get("weight", 1.0)), 0.0)
                presence, score_map, class_map = _build_source_maps(
                    preds,
                    height,
                    width,
                    weight,
                    source.get("confidenceCalib") or {},
                )
                source_presence_maps.append(presence)
                if source_prob_map is None:
                    source_prob_map = np.clip(presence.astype(np.float32), 0.0, 1.0)
                else:
                    source_prob_map = np.clip(np.asarray(source_prob_map, dtype=np.float32), 0.0, 1.0)
                source_prob_maps.append(source_prob_map)
                source_binary_masks.append((presence >= min_agreement).astype(np.uint8))
                source_weights.append(max(weight, 1e-3))
                update = score_map > global_score_map
                if update.any():
                    global_score_map[update] = score_map[update]
                    global_class_map[update] = class_map[update]

            if fusion_mode == "hard_staple":
                posterior, alpha_list, beta_list = _run_weighted_staple(
                    source_binary_masks,
                    source_weights,
                    max_iter=int(fusion_cfg.get("maxIter", 50)),
                    eps=float(fusion_cfg.get("eps", 1e-4)),
                )
            elif fusion_mode == "soft_average":
                posterior = _run_weighted_soft_fusion(source_prob_maps, source_weights)
            else:
                posterior = _run_weighted_soft_staple(
                    source_prob_maps,
                    source_weights,
                    max_iter=int(fusion_cfg.get("maxIter", 50)),
                    eps=float(fusion_cfg.get("eps", 1e-4)),
                )
            if posterior is None:
                continue

            uncertainty = _posterior_uncertainty_stats(posterior)
            posterior_means.append(uncertainty["posteriorMean"] * 100.0)
            posterior_entropy_means.append(uncertainty["posteriorEntropyMean"])
            high_uncertain_ratios.append(uncertainty["highUncertaintyRatio"])
            source_agreements.append(
                _source_agreement(source_binary_masks if fusion_mode == "hard_staple" else [
                    (np.asarray(prob_map, dtype=np.float32) >= float(fusion_cfg.get("probThreshold", 0.5))).astype(np.uint8)
                    for prob_map in source_prob_maps
                ])
            )

            predictions = _build_fused_predictions(
                posterior,
                global_class_map,
                min_object_size=min_object_size,
                prob_threshold=float(fusion_cfg.get("probThreshold", 0.5)),
            )
            evaluated_samples += 1
            gt_total += len(gt_items)
            pred_total += len(predictions)
            confidence_values.extend([pred.get("confidence", 0.0) * 100.0 for pred in predictions])
            low_conf_count += sum(1 for pred in predictions if pred.get("confidence", 0.0) < request.confidenceThreshold)
            class_gt_union.update({int(item.get("type_id")) for item in gt_items if item.get("type_id") is not None})
            class_pred_union.update({int(item.get("type_id")) for item in predictions if item.get("type_id") is not None})

            if preview_limit > 0 and len(preview_items) < preview_limit:
                preview_items.append(
                    _build_preview_item(
                        slice_name,
                        image_bgr,
                        gt_items,
                        predictions,
                        fallback_preview_type="polygon",
                        image_dir=request.imageDir,
                        posterior=posterior,
                    )
                )

            metrics = _match_items(gt_items, predictions, request.iouThreshold)
            match_count += metrics["matched"]
            miss_count += metrics["missed"]
            redundant_count += metrics["redundant"]
            if metrics["mean_iou"] is not None:
                mean_ious.append(metrics["mean_iou"] * 100.0)
            if metrics["classification_accuracy"] is not None:
                classification_scores.append(metrics["classification_accuracy"])
            if evaluated_samples == 1 or evaluated_samples % progress_step == 0 or evaluated_samples == total_samples:
                current_progress = 62 + int((evaluated_samples / max(total_samples, 1)) * 14)
                send_quality_progress(
                    request.jobId,
                    "参考推理中",
                    min(current_progress, 76),
                    evaluated_samples,
                    total_samples,
                    f"正在处理参考样本 {evaluated_samples}/{total_samples}"
                )

        result_payload["evaluatedSamples"] = evaluated_samples
        if evaluated_samples == 0:
            result_payload["reason"] = "未找到可读取的样本切片"
            result_payload["notes"] = _build_reference_notes(result_payload)
            return {"code": 200, "data": result_payload}

        confidence_mean = _safe_mean(confidence_values) or 0.0
        coverage_rate = (match_count / gt_total * 100.0) if gt_total > 0 else 0.0
        low_conf_ratio = (low_conf_count / pred_total * 100.0) if pred_total > 0 else 0.0
        mean_iou = _safe_mean(mean_ious) or 0.0
        classification_accuracy = _safe_mean(classification_scores) or 0.0
        sample_coverage = evaluated_samples / total_samples * 100.0 if total_samples > 0 else 0.0
        class_coverage = (len(class_gt_union.intersection(class_pred_union)) / len(class_gt_union) * 100.0) if class_gt_union else 0.0
        agreement_score = _safe_mean(source_agreements) or 0.0
        uncertainty_penalty = _safe_mean(high_uncertain_ratios) or 0.0
        reliability_score = max(min(
            coverage_rate * 0.35
            + confidence_mean * 0.2
            + (100.0 - low_conf_ratio) * 0.15
            + agreement_score * 0.2
            + (100.0 - uncertainty_penalty) * 0.1,
            100.0
        ), 0.0)
        reliability_level = "高" if reliability_score >= 80 else ("中" if reliability_score >= 60 else "低")
        boundary_deviation = max(0.0, 100.0 - mean_iou)
        boundary_pass_rate = mean_iou

        result_payload["suitable"] = True
        result_payload["confidenceMean"] = round(confidence_mean, 2)
        result_payload["coverageRate"] = round(coverage_rate, 2)
        result_payload["lowConfidenceRatio"] = round(low_conf_ratio, 2)
        result_payload["sampleCoverageRate"] = round(sample_coverage, 2)
        result_payload["classCoverageRate"] = round(class_coverage, 2)
        result_payload["referenceReliability"] = round(reliability_score / 100.0, 2)
        result_payload["referenceReliabilityLevel"] = reliability_level
        result_payload["confidenceScore"] = round(reliability_score, 1)
        result_payload["probabilityStats"] = {
            "posteriorMean": round(float((_safe_mean(posterior_means) or 0.0) / 100.0), 4),
            "sourceAgreement": round(float(_safe_mean(source_agreements) or 0.0), 2),
        }
        result_payload["uncertaintyStats"] = {
            "posteriorEntropyMean": round(float(_safe_mean(posterior_entropy_means) or 0.0), 4),
            "highUncertaintyRatio": round(float(_safe_mean(high_uncertain_ratios) or 0.0), 2),
        }
        for idx, summary in enumerate(result_payload.get("sourceSummaries", [])):
            if idx < len(loaded_sources):
                summary["estimatedSensitivity"] = round(float(alpha_list[idx]) if idx < len(alpha_list) else 0.0, 4)
                summary["estimatedSpecificity"] = round(float(beta_list[idx]) if idx < len(beta_list) else 0.0, 4)
        result_payload["indicators"] = {
            "missingFeatureRate": round((miss_count / gt_total * 100.0) if gt_total > 0 else 0.0, 2),
            "redundantFeatureRate": round((redundant_count / pred_total * 100.0) if pred_total > 0 else 0.0, 2),
            "classificationAccuracy": round(classification_accuracy, 2),
            "objectOverlap": round(mean_iou, 2),
            "boundaryDeviation": round(boundary_deviation, 2),
            "boundaryPassRate": round(boundary_pass_rate, 2),
            "matchedCount": match_count,
            "missCount": miss_count,
            "redundantCount": redundant_count,
            "sourceAgreement": round(float(_safe_mean(source_agreements) or 0.0), 2),
        }
        result_payload["previewItems"] = preview_items
        result_payload["notes"] = _build_reference_notes(result_payload)
        send_quality_progress(request.jobId, "参考结果汇总完成", 78, evaluated_samples, total_samples, "参考模型评估已完成，正在返回结果")
        return {"code": 200, "data": result_payload}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"参考模型评估失败: {str(e)}")
    finally:
        conn.close()


@app.post("/update_label")
async def update_label(request: UpdateLabelRequest):
    """更新样本标签"""
    try:
        argv = ["", request.taskid, request.mapfile_path, request.taskItemId]
        print(f"收到 update_label 请求: {argv}")
        update_label_function(argv)
        prov_update_label(request.taskid, "system")
        return {"code": 200, "message": "更新样本完成"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"更新样本失败: {str(e)}")
