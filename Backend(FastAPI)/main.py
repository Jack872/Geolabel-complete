import gc
import io
import json
import os
import sys
import tempfile
import traceback
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
        print(f"专用 YOLO 预标注模型已加载，device={preferred_device}")
        return global_yolo
    except RuntimeError as exc:
        if preferred_device.startswith("cuda") and is_cuda_oom(exc):
            print(f"专用 YOLO 预标注模型 GPU 加载失败，改为 CPU 模式: {exc}")
            clear_cuda_cache()
            gc.collect()
            global_yolo = build_auto_yolo("cpu")
            global_yolo_device = "cpu"
            print("专用 YOLO 预标注模型已降级到 CPU 模式")
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
            print(f"专用 YOLO 预标注模型预加载失败，服务继续启动，首次调用时再重试: {exc}")
    else:
        print("专用 YOLO 预标注模型采用懒加载，首次调用预标注时初始化")
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
    prompt_type_for_validation = params.get('promptType', 'point')
    if prompt_type_for_validation != '_warmup_skip_' and params.get('currentTypeId') in (None, "", "None"):
        raise ValueError("请先选择图层，再执行 SAM 标注")
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
            hole_size_threshold=_coerce_int_param(params.get('param3'), 20),
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
    """一键识别全图目标并利用 SAM 分割"""
    target_type_id = params.get('currentTypeId')
    if target_type_id in (None, "", "None"):
        raise ValueError("YOLO+SAM 预标注前请先选择图层")
    yolo_model, yolo_device, yolo_label = resolve_preannotation_yolo(params)
    TASK_ITEM_ID = params.get('taskItemId')
    raw_path = params['mapfile_path']
    conn = connect_db()
    try:
        IMAGE_PATH = ensure_task_image_local(conn, int(params['taskid']), TASK_ITEM_ID, fallback_path=raw_path)
    finally:
        if conn:
            conn.close()
    resolved_params = params.copy()
    resolved_params['mapfile_path'] = IMAGE_PATH
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
    print(f"[Auto] 检测到 {len(det_boxes)} 个潜在目标")
    if len(det_boxes) > 0:
        print(f"DEBUG - YOLO 原始像素框示例: {det_boxes[0]}")
    else:
        print("DEBUG - YOLO 未检测到任何目标")
        return

    # 2. 预热 SAM encoder，同时填充 current_feature_cache（含真实宽高）
    inference_sam_v1({**resolved_params, "promptType": "_warmup_skip_"})

    # 3. 从缓存读取真实图片尺寸（encoder 预热后已写入）
    real_w = current_feature_cache.get("width", img_array.shape[1])
    real_h = current_feature_cache.get("height", img_array.shape[0])
    print(f"[Auto] 真实图片尺寸: {real_w}x{real_h}")

    # 4. 循环收集所有多边形（不连数据库）
    raw_polygons_dict = {}  # 用于存储所有类别无关的原始多边形 {tid: [poly, ...]}
    padding = 2
    print(f"[Auto] 开始批量处理 {len(det_boxes)} 个目标...")
    for box in det_boxes:
        x1, y1, x2, y2 = box
        padded_box = [
            max(0, x1 - padding),
            max(0, y1 - padding),
            min(real_w - 1, x2 + padding),
            min(real_h - 1, y2 + padding)
        ]

        task_params = resolved_params.copy()
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

            # 4. 多边形简化 (Regularization)
            # 使用之前定义的 regularize_building_poly 或 simplify
            simplified_poly = no_holes_poly.simplify(0.5, preserve_topology=True)

            # 5. 过滤掉过小的碎片（可能是误检）
            if simplified_poly.area > 50:
                final_processed_polys.append(simplified_poly)

        # 重新构建存储格式
        all_batch_polygons = {target_type_id: final_processed_polys}

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
    对目标多边形进行简化处理
    """
    # 1. 基础简化：减少多余节点
    simplified = poly.simplify(tolerance, preserve_topology=True)

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
            return {"code": 200, "message": "全图自动预标注完成"}
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
