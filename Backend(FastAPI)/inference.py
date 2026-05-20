import json
import sys
import os
import rasterio
from affine import Affine
from pyproj import CRS, Transformer
from shapely import MultiPolygon, Polygon
from shapely.geometry import GeometryCollection
from shapely.ops import transform as shapely_transform
from utils import crop_image_by_scope, identify_holes_and_split, post_process_mask, prepare_data_for_sklearn
from utils_db import connect_db, delete_existing_results_db, fetch_labels_from_db, fetch_map_server_from_db, fetch_model_from_db, insert_segmentation_results_db
from utils_storage import ensure_model_local, ensure_task_image_local
from utils_yolo import process_yolo_results, filter_original_labels_with_type
# from utils_yolo import filter_original_labels_with_type
import torch
from torch.utils.data import DataLoader
from dataset import RemoteSensingSegmentationDataset
# from utils import (
#     connect_db, crop_image_by_scope, fetch_labels_from_db, delete_existing_results_db,
#     insert_segmentation_results_db,
#     post_process_mask, identify_holes_and_split,
#     process_yolo_results, draw_boxes_on_image,
#     fetch_map_server_from_db, fetch_typeid_from_db, create_original_label_mask,fetch_model_from_db
# )
import numpy as np
from PIL import Image
import cv2
import math
from model_runtime.model_meta import (
    parse_model_metadata as parse_runtime_model_metadata,
)
from model_runtime.model_load_utils import (
    load_checkpoint,
    extract_state_dict,
    normalize_state_dict_keys,
    safe_load_model_weights,
)
from model_runtime.model_builders import build_model_from_spec

LOCAL_CRS_ALIAS_MAP = {
    "Estonian Coordinate System of 1997": "EPSG:3301",
    "WGS 84 / Pseudo-Mercator": "EPSG:3857",
    "WGS_1984_Web_Mercator_Auxiliary_Sphere": "EPSG:3857",
}


def _safe_json_load(raw, default):
    if raw is None:
        return default
    if isinstance(raw, (dict, list)):
        return raw
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return default
        try:
            return json.loads(text)
        except Exception:
            return default


def _parse_scope_polygons(model_scope_raw):
    scope_data = _safe_json_load(model_scope_raw, [])
    polygons = []
    if not isinstance(scope_data, list):
        return polygons

    for coords in scope_data:
        if not isinstance(coords, list) or len(coords) == 0:
            continue
        try:
            shell = coords[0]
            holes = coords[1:] if len(coords) > 1 else []
            polygon = Polygon(shell, holes)
            if polygon.is_valid and not polygon.is_empty:
                polygons.append(polygon)
        except Exception as exc:
            print(f"解析 modelScope 失败，已跳过一个范围: {exc}")
    return polygons


def _clip_polygon_dict_by_scope(polygons_by_type, scope_polygons):
    if not scope_polygons:
        return polygons_by_type

    clipped = {}
    for type_id, polygons in polygons_by_type.items():
        clipped_items = []
        for polygon in polygons:
            if polygon is None or polygon.is_empty:
                continue
            for scope_polygon in scope_polygons:
                try:
                    if not polygon.intersects(scope_polygon):
                        continue
                    intersection = polygon.intersection(scope_polygon)
                    if intersection.is_empty:
                        continue
                    if isinstance(intersection, Polygon):
                        clipped_items.append(intersection)
                    elif isinstance(intersection, MultiPolygon):
                        clipped_items.extend([geom for geom in intersection.geoms if not geom.is_empty])
                    elif isinstance(intersection, GeometryCollection):
                        clipped_items.extend([
                            geom for geom in intersection.geoms
                            if isinstance(geom, Polygon) and not geom.is_empty
                        ])
                except Exception as exc:
                    print(f"裁剪 modelScope 时失败，已跳过一个面: {exc}")
        if clipped_items:
            clipped[type_id] = clipped_items
    return clipped


def _override_type_id(polygons_by_type, current_type_id):
    if current_type_id in (None, "", "None"):
        return polygons_by_type
    try:
        resolved_type_id = int(current_type_id)
    except Exception:
        return polygons_by_type

    merged = []
    for polygons in polygons_by_type.values():
        merged.extend(polygons)
    return {resolved_type_id: merged} if merged else {}


def _transform_polygon_dict_to_3857(polygons_by_type, transformer):
    if transformer is None:
        return polygons_by_type

    transformed = {}
    for type_id, polygons in polygons_by_type.items():
        next_polygons = []
        for polygon in polygons:
            try:
                transformed_polygon = shapely_transform(transformer.transform, polygon)
                if transformed_polygon is not None and not transformed_polygon.is_empty:
                    next_polygons.append(transformed_polygon)
            except Exception as exc:
                print(f"坐标转换到 EPSG:3857 失败，已跳过一个面: {exc}")
        if next_polygons:
            transformed[type_id] = next_polygons
    return transformed


def normalize_crs(crs_like):
    if crs_like is None:
        return None

    if isinstance(crs_like, CRS):
        return crs_like

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

    for alias, target_epsg in LOCAL_CRS_ALIAS_MAP.items():
        if alias.lower() in raw.lower():
            return CRS.from_user_input(target_epsg)

    try:
        return CRS.from_user_input(raw)
    except Exception:
        pass

    try:
        return CRS.from_wkt(raw)
    except Exception as exc:
        raise ValueError(f"无法识别坐标系: {raw}") from exc


def _build_spatial_context(image_path, db_crs_raw="EPSG:3857"):
    with rasterio.open(image_path) as src:
        tif_crs = normalize_crs(src.crs)
        image_transform = src.transform
        image_width = src.width
        image_height = src.height

    has_crs = tif_crs is not None
    db_crs = normalize_crs(db_crs_raw) if has_crs else None
    tif_to_db = None

    if has_crs:
        if db_crs is None:
            raise ValueError(f"输出坐标系无效: {db_crs_raw}")
        tif_to_db = Transformer.from_crs(tif_crs, db_crs, always_xy=True)
        print(f"推理坐标模式: TIF={tif_crs.to_string()} -> DB={db_crs.to_string()}")
        vectorize_transform = image_transform
    else:
        print("推理坐标模式: 无坐标系影像，使用像素投影翻转坐标")
        vectorize_transform = Affine(1.0, 0.0, 0.0, 0.0, -1.0, float(image_height))

    return {
        "has_crs": has_crs,
        "image_transform": image_transform,
        "image_width": image_width,
        "image_height": image_height,
        "vectorize_transform": vectorize_transform,
        "tif_to_db": tif_to_db,
    }


def _finalize_polygon_dict(polygons_by_type, spatial_context, model_scope_polygons=None, current_type_id=None,
                           simplify_tolerance=0.0):
    finalized = {}
    tif_to_db = spatial_context.get("tif_to_db")
    for type_id, polygons in (polygons_by_type or {}).items():
        next_polygons = []
        for polygon in polygons:
            if polygon is None or polygon.is_empty:
                continue
            current_polygon = polygon
            if simplify_tolerance and simplify_tolerance > 0:
                current_polygon = current_polygon.simplify(simplify_tolerance, preserve_topology=True)
            if tif_to_db is not None:
                current_polygon = shapely_transform(tif_to_db.transform, current_polygon)
            if current_polygon is not None and not current_polygon.is_empty:
                next_polygons.append(current_polygon)
        if next_polygons:
            finalized[type_id] = next_polygons

    finalized = _clip_polygon_dict_by_scope(finalized, model_scope_polygons or [])
    finalized = _override_type_id(finalized, current_type_id)
    return finalized


def _vectorize_mask_to_output_polygons(mask, class_index_to_type_id, background_class_index, spatial_context,
                                       model_scope_polygons=None, current_type_id=None, simplify_tolerance=0.0):
    polygons_by_type = identify_holes_and_split(
        mask,
        spatial_context["vectorize_transform"],
        class_index_to_type_id,
        background_class_index
    )
    return _finalize_polygon_dict(
        polygons_by_type,
        spatial_context,
        model_scope_polygons=model_scope_polygons,
        current_type_id=current_type_id,
        simplify_tolerance=simplify_tolerance,
    )


def _pixel_point_to_native_coords(px, py, spatial_context):
    if spatial_context.get("has_crs"):
        return spatial_context["image_transform"] * (px, py)

    image_height = spatial_context["image_height"]
    return float(px), float(image_height - py)


def _build_detection_polygon_from_slice(box, offset_x, offset_y, spatial_context):
    output_corners = []
    for i in range(4):
        px = float(box[i][0] + offset_x)
        py = float(box[i][1] + offset_y)
        x_out, y_out = _pixel_point_to_native_coords(px, py, spatial_context)
        output_corners.append((x_out, y_out))
    return Polygon(output_corners)


def _assert_weight_compatibility(load_info, model_path, runtime_meta, runtime_type):
    if not load_info.get("ok"):
        return

    matched_key_count = int(load_info.get("matched_key_count") or 0)
    matched_key_ratio = float(load_info.get("matched_key_ratio") or 0.0)
    missing_count = len(load_info.get("missing_keys", []) or [])
    unexpected_count = len(load_info.get("unexpected_keys", []) or [])

    severe_mismatch = (
        matched_key_count == 0
        or matched_key_ratio < 0.35
        or (missing_count > matched_key_count and unexpected_count > matched_key_count)
    )
    if not severe_mismatch:
        return

    raise ValueError(
        "模型权重与当前网络结构严重不匹配，已停止本次预标注，避免整图错误覆盖。"
        f" model_path={model_path}, runtime_type={runtime_type}, "
        f"framework={runtime_meta.get('framework')}, arch={runtime_meta.get('arch')}, "
        f"matched={matched_key_count}/{load_info.get('model_key_count')}, "
        f"missing_keys={missing_count}, unexpected_keys={unexpected_count}, "
        f"sample_keys={load_info.get('sample_keys')}"
    )


def parse_model_metadata(model_inf: dict):
    """从 model_des 读取并校验 modelSpec。"""
    return parse_runtime_model_metadata(model_inf)

def resolve_image_path(base_path: str) -> str:
    """兼容本地绝对路径、去后缀路径和 MinIO 本地挂载目录。"""
    if not base_path:
        return base_path
    candidates = []
    if base_path.lower().endswith((".tif", ".tiff")):
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

    for path in candidates:
        if path and os.path.exists(path):
            return path
    return candidates[0]


def _decode_segmentation_logits(logits, num_classes, background_class_index, conf_threshold):
    if logits is None or not torch.is_tensor(logits):
        raise ValueError(f"无法解析分割模型输出 logits，输出类型={type(logits)}")

    if logits.dim() != 4:
        raise ValueError(f"分割 logits 维度异常，期望 4 维 [B,C,H,W]，实际为 {tuple(logits.shape)}")

    logits_channels = int(logits.shape[1])
    is_single_channel = logits_channels == 1 or int(num_classes or 0) == 1

    if is_single_channel:
        prob = torch.sigmoid(logits)[0, 0]
        binary_mask = (prob >= float(conf_threshold)).to(torch.uint8).cpu().numpy()
        background_idx = int(background_class_index if background_class_index is not None else 1)
        predicted_mask = np.where(binary_mask == 1, 0, background_idx).astype(np.uint8)
        prob_np = prob.detach().cpu().numpy()
        debug_binary_mask = binary_mask
    else:
        probabilities = torch.softmax(logits, dim=1)
        predicted_mask = torch.argmax(probabilities, dim=1).squeeze().cpu().numpy().astype(np.uint8)
        prob_np = torch.max(probabilities[0], dim=0).values.detach().cpu().numpy()
        debug_binary_mask = (predicted_mask != int(background_class_index)).astype(np.uint8)

    foreground_ratio = float(np.mean(debug_binary_mask))
    print(
        f"[seg_debug] logits_shape={tuple(logits.shape)} "
        f"prob_min={float(prob_np.min()):.6f} prob_max={float(prob_np.max()):.6f} "
        f"prob_mean={float(prob_np.mean()):.6f} threshold={float(conf_threshold):.6f} "
        f"foreground_ratio={foreground_ratio:.6f} mask_unique={np.unique(debug_binary_mask).tolist()} "
        f"binary_mask_mean={float(debug_binary_mask.mean()):.6f}"
    )
    return predicted_mask


def _log_input_debug(image_tensor):
    tensor_cpu = image_tensor.detach().float().cpu()
    if tensor_cpu.dim() == 4:
        sample = tensor_cpu[0]
    elif tensor_cpu.dim() == 3:
        sample = tensor_cpu
    else:
        sample = tensor_cpu.reshape(1, -1)

    if sample.dim() >= 3:
        channel_mean = sample.view(sample.shape[0], -1).mean(dim=1).numpy().tolist()
    else:
        channel_mean = [float(sample.mean().item())]

    print(
        f"[input_debug] shape={tuple(tensor_cpu.shape)} "
        f"min={float(tensor_cpu.min().item()):.6f} max={float(tensor_cpu.max().item()):.6f} "
        f"mean={float(tensor_cpu.mean().item()):.6f} channel_mean={channel_mean}"
    )


def _pad_segmentation_input(image_tensor, multiple=32):
    if image_tensor.dim() != 4:
        raise ValueError(f"分割模型输入维度异常，期望 [B,C,H,W]，实际为 {tuple(image_tensor.shape)}")

    _, _, original_h, original_w = image_tensor.shape
    pad_h = (multiple - original_h % multiple) % multiple
    pad_w = (multiple - original_w % multiple) % multiple

    if pad_h == 0 and pad_w == 0:
        return image_tensor, original_h, original_w

    padded_tensor = torch.nn.functional.pad(image_tensor, (0, pad_w, 0, pad_h), mode='constant', value=0.0)
    print(
        f"[pad_debug] original_shape=({original_h},{original_w}), "
        f"padded_shape=({original_h + pad_h},{original_w + pad_w}), multiple={multiple}"
    )
    return padded_tensor, original_h, original_w


def _crop_segmentation_output(logits, original_h, original_w):
    cropped_logits = logits[..., :original_h, :original_w]
    print(f"[pad_debug] output_cropped_shape=({original_h},{original_w})")
    return cropped_logits


def predict_torch_model(model, image_tensor, device, num_classes, background_class_index, conf_threshold, pad_multiple=None):
    """使用 PyTorch 模型进行预测"""
    model.eval()
    with torch.no_grad():
        image_tensor = image_tensor.unsqueeze(0).to(device)
        _log_input_debug(image_tensor)
        model_input = image_tensor
        original_h = image_tensor.shape[2]
        original_w = image_tensor.shape[3]
        if pad_multiple:
            model_input, original_h, original_w = _pad_segmentation_input(image_tensor, multiple=pad_multiple)
        outputs = model(model_input)
        if isinstance(outputs, dict):
            outputs = outputs.get("logits", outputs.get("out"))
        elif isinstance(outputs, (list, tuple)):
            outputs = next((item for item in outputs if torch.is_tensor(item)), None)
        elif hasattr(outputs, "logits"):
            outputs = outputs.logits
        if outputs.shape[2:] != model_input.shape[2:]:
            outputs = torch.nn.functional.interpolate(outputs, size=model_input.shape[2:], mode='bilinear',
                                                      align_corners=False)
        if pad_multiple:
            outputs = _crop_segmentation_output(outputs, original_h, original_w)
        predicted_mask = _decode_segmentation_logits(
            outputs,
            num_classes=num_classes,
            background_class_index=background_class_index,
            conf_threshold=conf_threshold,
        )
    return predicted_mask.astype(np.uint8)

def predict_sklearn_model(model, X, image_shape):
    """使用 scikit-learn 模型进行预测"""
    predictions = model.predict(X)
    return predictions.reshape(image_shape[1], image_shape[2]).astype(np.uint8)

def predict_large_image_with_overlap(model, image, block_size, overlap, predict_func, device=None):
    C, H, W = image.shape
    block_h, block_w = block_size
    overlap_h, overlap_w = overlap
    step_h = block_h - overlap_h
    step_w = block_w - overlap_w

    pad_h = (step_h - H % step_h) % step_h
    pad_w = (step_w - W % step_w) % step_w
    padded_image = np.pad(image, ((0, 0), (0, pad_h), (0, pad_w)), mode='constant')
    padded_H, padded_W = padded_image.shape[1], padded_image.shape[2]

    predicted_mask = np.zeros((padded_H, padded_W), dtype=np.float32)
    count_mask = np.zeros((padded_H, padded_W), dtype=np.float32)

    for i in range(0, padded_H - overlap_h, step_h):
        for j in range(0, padded_W - overlap_w, step_w):
            block = padded_image[:, i:i + block_h, j:j + block_w]
            if device is not None:
                block_tensor = torch.from_numpy(block).float().to(device)
                block_pred = predict_func(model, block_tensor, device)
            else:  # predict_sklearn_model
                X_block = block.transpose(1, 2, 0).reshape(-1, block.shape[0])
                block_pred = predict_func(model, X_block, (None, block_h, block_w))
            predicted_mask[i:i + block_h, j:j + block_w] += block_pred
            count_mask[i:i + block_h, j:j + block_w] += 1

    predicted_mask /= count_mask
    predicted_mask = np.round(predicted_mask).astype(np.uint8)
    return predicted_mask[:H, :W]

def predict_large_image_with_xgboost_overlap(model, image, block_size, overlap):
    """
    XGBoost 专用的分块推理函数，支持 GPU 推理和坐标修正
    
    参数:
        model: XGBoost 模型实例
        image: 输入图像 (C, H, W)
        block_size: 分块大小 (height, width)
        overlap: 重叠大小 (height, width)
    
    返回:
        predicted_mask: 预测掩码 (H, W)
    """
    C, H, W = image.shape
    block_h, block_w = block_size
    overlap_h, overlap_w = overlap
    step_h = block_h - overlap_h
    step_w = block_w - overlap_w

    # 初始化预测结果和计数掩码（使用原始图像尺寸）
    predicted_mask = np.zeros((H, W), dtype=np.float32)
    count_mask = np.zeros((H, W), dtype=np.float32)

    print(f"开始分块推理，图像大小: {H}x{W}, 分块大小: {block_h}x{block_w}, 重叠: {overlap_h}x{overlap_w}")
    
    # 计算分块的起始位置
    i_positions = list(range(0, H, step_h))
    j_positions = list(range(0, W, step_w))
    
    # 确保最后一个位置能覆盖到图像边界
    if i_positions[-1] + block_h < H:
        i_positions.append(H - block_h)
    if j_positions[-1] + block_w < W:
        j_positions.append(W - block_w)
    
    total_blocks = len(i_positions) * len(j_positions)
    current_block = 0
    
    # 分块处理
    for i in i_positions:
        for j in j_positions:
            current_block += 1
            if current_block % 10 == 0 or current_block == 1:  # 减少输出频率
                print(f"处理块 {current_block}/{total_blocks}: ({i}:{min(i+block_h, H)}, {j}:{min(j+block_w, W)})")
            
            # 计算实际的块边界
            i_end = min(i + block_h, H)
            j_end = min(j + block_w, W)
            actual_block_h = i_end - i
            actual_block_w = j_end - j
            
            # 提取当前块
            block = image[:, i:i_end, j:j_end]
            
            # 准备数据用于 XGBoost
            try:
                X_block, _ = prepare_data_for_sklearn(block, np.zeros((actual_block_h, actual_block_w)))
                
                # 使用 XGBoost 进行预测（GPU 加速）
                block_pred = model.predict(X_block)
                block_pred = block_pred.reshape(actual_block_h, actual_block_w).astype(np.float32)
                
                # 累加预测结果（使用实际块尺寸）
                predicted_mask[i:i_end, j:j_end] += block_pred
                count_mask[i:i_end, j:j_end] += 1
                
            except Exception as e:
                print(f"块 {current_block} 预测失败: {e}")
                print(f"块位置: ({i}:{i_end}, {j}:{j_end}), 块尺寸: {actual_block_h}x{actual_block_w}")
                print(f"X_block形状: {X_block.shape if 'X_block' in locals() else 'N/A'}")
                # 如果预测失败，使用背景类填充
                block_pred = np.zeros((actual_block_h, actual_block_w), dtype=np.float32)
                predicted_mask[i:i_end, j:j_end] += block_pred
                count_mask[i:i_end, j:j_end] += 1

    # 平均化重叠区域的预测结果
    predicted_mask = np.divide(predicted_mask, count_mask, 
                              out=np.zeros_like(predicted_mask), 
                              where=count_mask!=0)
    
    # 转换为整数类型
    predicted_mask = np.round(predicted_mask).astype(np.uint8)
    
    print(f"分块推理完成，输出掩码形状: {predicted_mask.shape}")
    
    return predicted_mask

def inference(argv=None):
    TASK_ID = int(argv[1])
    MAPFILE_PATH = argv[2]
    USER_ID = int(argv[3])
    MODEL_identifier = str(argv[4])  # 可以是 model_name 或 model_id
    TASK_ITEM_ID = int(argv[11]) if len(argv) > 11 and argv[11] not in (None, "", "None") else None
    CURRENT_TYPE_ID = argv[12] if len(argv) > 12 else None
    DB_CRS_RAW = argv[13] if len(argv) > 13 and argv[13] not in (None, "", "None") else "EPSG:3857"
    model_scope_str = argv[9]

    # 类别映射
    class_mapping = argv[10]
    model_scope_polygons = _parse_scope_polygons(model_scope_str)

    # 连接数据库
    conn = connect_db()
    if conn is None:
        print("无法连接到数据库，程序退出。")
        return

    # 尝试通过 model_id 查询，如果失败则通过 model_name 查询（向后兼容）
    model_inf = None
    if MODEL_identifier.isdigit():
        # 如果是数字，尝试作为 model_id 查询
        from utils_db import fetch_model_by_id
        model_inf = fetch_model_by_id(conn, int(MODEL_identifier))
        if model_inf:
            print(f"通过 model_id 查询到模型: {model_inf.get('model_name')}")
    
    # 如果通过 model_id 未查询到，或者不是数字，则通过 model_name 查询
    if not model_inf:
        MODEL_name = MODEL_identifier.split(".")[0]
        model_inf = fetch_model_from_db(conn, MODEL_name)
        if model_inf:
            print(f"通过 model_name 查询到模型: {MODEL_name}")
    
    # 如果仍然没有查询到模型，报错退出
    if not model_inf:
        print(f"错误：未找到模型 {MODEL_identifier}")
        conn.close()
        return

    IMAGE_PATH = ensure_task_image_local(conn, TASK_ID, TASK_ITEM_ID, fallback_path=resolve_image_path(MAPFILE_PATH))
    # 获取标签数据
    labels_data = fetch_labels_from_db(conn, TASK_ID, USER_ID, TASK_ITEM_ID)
    if not labels_data:
        print(f"task_id {TASK_ID} 没有找到标签数据，将不使用原始标签掩膜。")
        labels_data = None

    # 提取 user_id 和 status
    user_id = USER_ID
    # status=2 约定为模型预标注结果，仅与其他模型预标注结果相互覆盖
    status = 2
    # type_arr = fetch_typeid_from_db(conn, TASK_ID)

    # 定义模型保存路径
    model_save_path = ensure_model_local(model_inf)

    # 设置设备
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    try:
        model_meta = parse_model_metadata(model_inf)
    except ValueError as exc:
        print(f"模型元数据校验失败: {exc}")
        conn.close()
        return
    infer_params = model_meta.get("inferParams", {}) if isinstance(model_meta.get("inferParams"), dict) else {}

    # 解析 class_mapping：请求优先，其次使用上传模型时保存的 classMapping
    class_mapping_dict = _safe_json_load(class_mapping, {})
    if not isinstance(class_mapping_dict, dict) or len(class_mapping_dict) == 0:
        class_mapping_dict = _safe_json_load(model_meta.get("classMapping"), {})

    try:
        class_mapping_dict = {int(k): int(v) for k, v in class_mapping_dict.items()}
    except Exception as e:
        print(f"class_mapping 转换失败: {e}")
        class_mapping_dict = {}

    def _get_param(name, fallback, cast_type=float, hard_default=None):
        raw_value = infer_params.get(name, fallback)
        if raw_value is None or (isinstance(raw_value, str) and raw_value.strip() == ""):
            raw_value = hard_default if hard_default is not None else fallback
        try:
            return cast_type(raw_value)
        except Exception:
            safe_default = hard_default if hard_default is not None else (1 if cast_type is int else 0.0)
            return cast_type(safe_default)

    try:
        spatial_context = _build_spatial_context(IMAGE_PATH, DB_CRS_RAW)
    except Exception as exc:
        print(f"初始化推理坐标上下文失败: {exc}")
        conn.close()
        return

    runtime_meta = dict(model_meta)
    runtime_meta["modelPath"] = model_save_path
    runtime_meta["path"] = model_save_path
    runtime_meta["modelName"] = model_inf.get("model_name")
    model_status = model_inf.get("status", 1)
    segmentation_pad_multiple = 32 if str(runtime_meta.get("framework", "")).lower() == "smp" else None

    # 兼容历史状态：0/1 都允许推理
    if model_status in [0, 1]:
        # 统一模型构造入口（从 framework + arch 出发）

        framework_hint = str(runtime_meta.get("framework") or "").lower()
        arch_hint = str(runtime_meta.get("arch") or "").lower()
        is_yolo_like = framework_hint in ("yolo", "ultralytics") or arch_hint.startswith("yolo")
        is_xgboost_like = arch_hint == "xgboost" or framework_hint == "sklearn"

        if not is_yolo_like and not is_xgboost_like:
            with rasterio.open(IMAGE_PATH) as src:
                runtime_meta["inputChannels"] = src.count
            runtime_meta["numClasses"] = int(model_inf.get("output_num") or model_meta.get("numClasses") or 2)
        elif is_yolo_like:
            # YOLO 文件路径兜底（后续可统一抽到 builder 内）
            if not os.path.exists(model_save_path):
                print(f"错误：YOLO模型文件不存在: {model_save_path}")
                model_dir = os.path.dirname(os.path.dirname(model_save_path))
                possible_models = []
                for root, dirs, files in os.walk(model_dir):
                    for file in files:
                        if file.endswith('.pt'):
                            possible_models.append(os.path.join(root, file))
                if possible_models:
                    print(f"找到可能的模型文件: {possible_models[0]}")
                    model_save_path = possible_models[0]
                    runtime_meta["modelPath"] = model_save_path
                    runtime_meta["path"] = model_save_path
                else:
                    print("未找到任何可用的YOLO模型文件")
                    conn.close()
                    return
        elif is_xgboost_like:
            runtime_meta["framework"] = runtime_meta.get("framework") or "sklearn"
            runtime_meta["arch"] = runtime_meta.get("arch") or "xgboost"

        try:
            built = build_model_from_spec(runtime_meta, device)
        except Exception as e:
            print(
                f"模型构造失败 | model_path={model_save_path} | framework={runtime_meta.get('framework')} | "
                f"arch={runtime_meta.get('arch')} | model_name={runtime_meta.get('modelName')} | error={e}"
            )
            conn.close()
            return

        model = built["model"]
        MODEL_TYPE = built["runtime_type"]

        # 根据构造后的 runtime_type 设置类别映射
        if MODEL_TYPE in ["light_unet", "unet", "fast_scnn", "xgboost", "deeplab", "segformer"]:
            if len(class_mapping_dict) == 0:
                print("错误：分割模型缺少 class_mapping，请在模型管理上传时填写类别映射。")
                conn.close()
                return
            num_classes = len(class_mapping_dict) + 1  # 假设有一个背景类
            class_index_to_type_id = {}
            background_class_index = None
            for idx in range(num_classes):
                if idx in class_mapping_dict and class_mapping_dict[idx]:
                    class_index_to_type_id[idx] = class_mapping_dict[idx]
                else:
                    background_class_index = idx
            if background_class_index is None:
                print("No background class found in class_mapping.")
                conn.close()
                return
        elif MODEL_TYPE == "yolo":
            if len(class_mapping_dict) == 0:
                print("错误：YOLO 模型缺少 class_mapping，请在模型管理上传时填写类别映射。")
                conn.close()
                return
            num_classes = len(class_mapping_dict) + 1  # 假设有一个背景类
            class_index_to_type_id = {}
            background_class_index = None
            for idx in range(num_classes):
                if idx in class_mapping_dict and class_mapping_dict[idx]:
                    class_index_to_type_id[idx] = class_mapping_dict[idx]
                else:
                    background_class_index = idx
            if background_class_index is None:
                print("No background class found in class_mapping.")
                conn.close()
                return
            # 兼容旧代码，保留class_id_to_type_id
            class_id_to_type_id = class_index_to_type_id

        if built.get("requires_weight_load"):
            model, load_info = safe_load_model_weights(model, model_save_path, strict=False)
            if not load_info.get("ok"):
                # 显式复用公共工具链，保障诊断路径一致。
                try:
                    checkpoint = load_checkpoint(model_save_path)
                    state_dict = extract_state_dict(checkpoint)
                    normalized_state = normalize_state_dict_keys(state_dict)
                    load_info["key_count"] = len(normalized_state)
                    load_info["sample_keys"] = list(normalized_state.keys())[:10]
                except Exception:
                    pass

                print(
                    f"分割模型加载失败 | model_path={model_save_path} | "
                    f"framework={runtime_meta.get('framework')} | arch={runtime_meta.get('arch')} | "
                    f"missing_keys={len(load_info.get('missing_keys', []))} | "
                    f"unexpected_keys={len(load_info.get('unexpected_keys', []))} | "
                    f"sample_keys={load_info.get('sample_keys')} | "
                    f"message={load_info.get('message')}"
                )
                conn.close()
                return

            try:
                _assert_weight_compatibility(load_info, model_save_path, runtime_meta, MODEL_TYPE)
            except ValueError as exc:
                print(str(exc))
                conn.close()
                return

            if load_info.get("missing_keys") or load_info.get("unexpected_keys"):
                print(
                    f"[model_load][warn] model_path={model_save_path} | framework={runtime_meta.get('framework')} | "
                    f"arch={runtime_meta.get('arch')} | missing_keys={len(load_info.get('missing_keys', []))} | "
                    f"unexpected_keys={len(load_info.get('unexpected_keys', []))} | "
                    f"matched={load_info.get('matched_key_count')}/{load_info.get('model_key_count')} | "
                    f"sample_keys={load_info.get('sample_keys')} | message={load_info.get('message')}"
                )
            else:
                print(
                    f"[model_load][ok] model_path={model_save_path} | framework={runtime_meta.get('framework')} | "
                    f"arch={runtime_meta.get('arch')} | key_count={load_info.get('key_count')} | "
                    f"sample_keys={load_info.get('sample_keys')}"
                )
            model.eval()
        elif MODEL_TYPE == "yolo":
            # YOLO 仍使用其官方加载方式；后续可统一纳入公共加载工具。
            print(f"成功加载YOLO模型: {model_save_path}")
        elif MODEL_TYPE == "xgboost":
            pass
        else:
            print(f"未知的模型类型: {MODEL_TYPE}")
            conn.close()
            return

        # 进行推理
        if MODEL_TYPE in ["light_unet", "unet", "fast_scnn", "xgboost", "deeplab", "segformer"]:
            min_object_size = _get_param("min_object_size", argv[5], int, 50)
            hole_size_threshold = _get_param("hole_size_threshold", argv[6], int, 10)
            boundary_smoothing = _get_param("boundary_smoothing", argv[7], int, 1)
            seg_conf_threshold = _get_param("conf_threshold", 0.5, float, 0.5)

            # 直接加载整个图像
            with rasterio.open(IMAGE_PATH) as src:
                image = src.read().astype(np.float32) / 255.0  # (C, H, W)
                window_transform = src.transform  # 用于后续多边形转换

            block_size = (1024, 1024)
            overlap = (128, 128)
            _, H, W = image.shape

            if MODEL_TYPE in ["light_unet", "unet", "fast_scnn", "deeplab", "segformer"]:
                if H <= block_size[0] and W <= block_size[1]:
                    image_tensor = torch.from_numpy(image).float().to(device)
                    predicted_mask = predict_torch_model(
                        model,
                        image_tensor,
                        device,
                        num_classes=num_classes,
                        background_class_index=background_class_index,
                        conf_threshold=seg_conf_threshold,
                        pad_multiple=segmentation_pad_multiple,
                    )
                else:
                    predicted_mask = predict_large_image_with_overlap(
                        model,
                        image,
                        block_size,
                        overlap,
                        lambda run_model, block_tensor, run_device: predict_torch_model(
                            run_model,
                            block_tensor,
                            run_device,
                            num_classes=num_classes,
                            background_class_index=background_class_index,
                            conf_threshold=seg_conf_threshold,
                            pad_multiple=segmentation_pad_multiple,
                        ),
                        device,
                    )

            # 后处理掩膜
            predicted_mask = post_process_mask(
                predicted_mask,
                min_object_size=min_object_size,
                hole_size_threshold=hole_size_threshold,
                boundary_smoothing=boundary_smoothing
            )

            # 转换为多边形
            segmentation_polygons = _vectorize_mask_to_output_polygons(
                predicted_mask,
                class_index_to_type_id,
                background_class_index,
                spatial_context,
                model_scope_polygons=model_scope_polygons,
                current_type_id=CURRENT_TYPE_ID,
            )

            delete_existing_results_db(conn, TASK_ID, user_id=user_id, task_item_id=TASK_ITEM_ID, status=status)
            insert_segmentation_results_db(conn, TASK_ID, segmentation_polygons, user_id, status, TASK_ITEM_ID)
            torch.cuda.empty_cache()

        elif MODEL_TYPE == "yolo":
            conf_threshold = _get_param("conf_threshold", argv[5], float, 0.3)
            slice_size = _get_param("slice_size", argv[6], int, 640)
            iou_threshold = _get_param("iou_threshold", argv[7], float, 0.7)
            overlap_ratio = _get_param("overlap_ratio", argv[8], float, 0.1)

            # --- 原始代码的大图读取部分 ---
            with rasterio.open(IMAGE_PATH) as src:
                # 读取原始大图
                image = src.read()
                image = image.transpose(1, 2, 0)  # (H, W, C)
                if image.shape[2] > 3:
                    image = image[:, :, :3]  # 去掉 Alpha 通道

                # 💥 【关键修复 1：强制转换 16 位图为 8 位图】
                if image.dtype != np.uint8:
                    print(f"⚠️ 警告: 发现非 8位 图像 (当前为 {image.dtype})，正在强制拉伸为 8位 uint8...")
                    # 将像素值线性映射到 0-255
                    image = (image.astype(np.float32) / image.max() * 255).astype(np.uint8)

                # 记录原始图像尺寸和坐标转换参数
                ori_H, ori_W, _ = image.shape
                image_transform = src.transform

            # --- 定义切片参数 ---
            stride = int(slice_size * (1 - overlap_ratio))

            print(f"开始滑窗推理: 原图 {ori_W}x{ori_H}, 切片 {slice_size}, 步长 {stride}")

            detection_polygons = {}  # 存储最终结果

            # --- 开始滑窗循环 ---
            import math

            # 计算行数和列数
            n_rows = math.ceil((ori_H - slice_size) / stride) + 1
            n_cols = math.ceil((ori_W - slice_size) / stride) + 1

            if n_rows < 1: n_rows = 1
            if n_cols < 1: n_cols = 1

            for row in range(n_rows):
                for col in range(n_cols):
                    # 计算切片坐标
                    x1 = col * stride
                    y1 = row * stride
                    x2 = min(x1 + slice_size, ori_W)
                    y2 = min(y1 + slice_size, ori_H)

                    # 修正边缘切片大小
                    if x2 - x1 < slice_size and x1 > 0:
                        x1 = x2 - slice_size
                    if y2 - y1 < slice_size and y1 > 0:
                        y1 = y2 - slice_size

                    # 裁剪图像 (numpy slice)
                    img_slice = image[y1:y2, x1:x2]
                    # 关键修复：将 RGB 转换为 BGR
                    img_slice_bgr = img_slice[:, :, ::-1]

                    # --- 这里进行推理 ---
                    slice_results = model(
                        img_slice_bgr,
                        conf=conf_threshold,
                        iou=iou_threshold,
                        imgsz=slice_size,
                        verbose=False
                    )

                    # --- 处理推理结果并还原坐标 ---
                    for result in slice_results:

                        # 💥 【关键修复 2：恢复为 OBB 逻辑】
                        if result.obb is None or len(result.obb) == 0:
                            continue

                        # 获取切片内的旋转框 4 个角点坐标 (N, 4, 2)
                        boxes = result.obb.xyxyxyxy.cpu().numpy()
                        class_ids = result.obb.cls.cpu().numpy()

                        for box, class_id in zip(boxes, class_ids):
                            type_id = class_index_to_type_id.get(int(class_id))
                            if type_id is None: continue

                            # *** 关键步骤：坐标还原 ***
                            poly = _build_detection_polygon_from_slice(box, x1, y1, spatial_context)
                            if type_id not in detection_polygons:
                                detection_polygons[type_id] = []
                            detection_polygons[type_id].append(poly)

            print(f"滑窗推理完成，共检测到 {sum([len(v) for v in detection_polygons.values()])} 个目标")
            # todo 合并逻辑需要优化
            # original_polygons_with_type = []
            # if labels_data:
            #     for _, geom_str, type_id, *_ in labels_data:
            #         coords_str_list = geom_str.split(',')
            #         coords_list = [(float(coords_str_list[i].strip()), float(coords_str_list[i + 1].strip()))
            #                        for i in range(0, len(coords_str_list), 2)]
            #         poly = Polygon(coords_list)
            #         original_polygons_with_type.append((poly, type_id))
            #
            # filtered_original_with_type = filter_original_labels_with_type(original_polygons_with_type, detection_polygons,
            #                                                                distance_threshold=float(argv[7]))
            #
            # filtered_original_dict = {}
            # for poly, type_id in filtered_original_with_type:
            #     if type_id not in filtered_original_dict:
            #         filtered_original_dict[type_id] = []
            #     filtered_original_dict[type_id].append(poly)
            #
            # type_ids = set(detection_polygons.keys()) | set(filtered_original_dict.keys())
            # segmentation_polygons = {type_id: filtered_original_dict.get(type_id, []) + detection_polygons.get(type_id, [])
            #                          for type_id in type_ids}
            #
            # delete_existing_results_db(conn, TASK_ID)
            # insert_segmentation_results_db(conn, TASK_ID, segmentation_polygons, user_id, status)

            detection_polygons = _finalize_polygon_dict(
                detection_polygons,
                spatial_context,
                model_scope_polygons=model_scope_polygons,
                current_type_id=CURRENT_TYPE_ID,
            )
            delete_existing_results_db(conn, TASK_ID, user_id=user_id, task_item_id=TASK_ITEM_ID, status=status)
            insert_segmentation_results_db(conn, TASK_ID, detection_polygons, user_id, status, TASK_ITEM_ID)

            torch.cuda.empty_cache()
    else:
        # 加载TorchScript模型
        try:
            print("使用torchscript模型进行推理")
            print(f"加载模型: {model_save_path}")
            model = torch.jit.load(model_save_path).to(device)
            model.eval()
            
            # 使用相同的class_mapping解析逻辑
            try:
                if not isinstance(class_mapping_dict, dict) or len(class_mapping_dict) == 0:
                    class_mapping_dict = _safe_json_load(model_meta.get("classMapping"), {})
                class_mapping_dict = {int(k): int(v) for k, v in class_mapping_dict.items()}
                num_classes = len(class_mapping_dict) + 1
                class_index_to_type_id = {}
                background_class_index = None
                for idx in range(num_classes):
                    if idx in class_mapping_dict and class_mapping_dict[idx]:
                        class_index_to_type_id[idx] = class_mapping_dict[idx]
                    else:
                        background_class_index = idx
                if background_class_index is None:
                    print("No background class found in class_mapping.")
                    conn.close()
                    return
            except Exception as e:
                print(f"类别映射解析失败: {e}")
                conn.close()
                return
        
            # 图像加载和预处理
            with rasterio.open(IMAGE_PATH) as src:
                image = src.read().astype(np.float32) / 255.0
                window_transform = src.transform
            
            # 分块推理
            block_size = (1024, 1024)
            overlap = (128, 128)
            _, H, W = image.shape
            seg_conf_threshold = _get_param("conf_threshold", 0.5, float, 0.5)
            
            if H <= block_size[0] and W <= block_size[1]:
                image_tensor = torch.from_numpy(image).float().to(device)
                _log_input_debug(image_tensor.unsqueeze(0))
                model_input = image_tensor.unsqueeze(0)
                original_h = model_input.shape[2]
                original_w = model_input.shape[3]
                if segmentation_pad_multiple:
                    model_input, original_h, original_w = _pad_segmentation_input(model_input, multiple=segmentation_pad_multiple)
                with torch.no_grad():
                    outputs = model(model_input)
                if outputs.shape[2:] != model_input.shape[2:]:
                    outputs = torch.nn.functional.interpolate(outputs, size=model_input.shape[2:], mode='bilinear',
                                                              align_corners=False)
                if segmentation_pad_multiple:
                    outputs = _crop_segmentation_output(outputs, original_h, original_w)
                predicted_mask = _decode_segmentation_logits(
                    outputs,
                    num_classes=num_classes,
                    background_class_index=background_class_index,
                    conf_threshold=seg_conf_threshold,
                )
            else:
                def torchscript_predict(model, block_tensor, device):
                    _log_input_debug(block_tensor.unsqueeze(0))
                    model_input = block_tensor.unsqueeze(0)
                    original_h = model_input.shape[2]
                    original_w = model_input.shape[3]
                    if segmentation_pad_multiple:
                        model_input, original_h, original_w = _pad_segmentation_input(model_input, multiple=segmentation_pad_multiple)
                    with torch.no_grad():
                        outputs = model(model_input)
                    if outputs.shape[2:] != model_input.shape[2:]:
                        outputs = torch.nn.functional.interpolate(outputs, size=model_input.shape[2:], mode='bilinear',
                                                                  align_corners=False)
                    if segmentation_pad_multiple:
                        outputs = _crop_segmentation_output(outputs, original_h, original_w)
                    return _decode_segmentation_logits(
                        outputs,
                        num_classes=num_classes,
                        background_class_index=background_class_index,
                        conf_threshold=seg_conf_threshold,
                    )
                
                predicted_mask = predict_large_image_with_overlap(
                    model, image, block_size, overlap, torchscript_predict, device
                )
            
            # 后续处理与现有流程一致
            min_object_size = _get_param("min_object_size", argv[5], int, 50)
            hole_size_threshold = _get_param("hole_size_threshold", argv[6], int, 10)
            boundary_smoothing = _get_param("boundary_smoothing", argv[7], int, 1)
            predicted_mask = post_process_mask(
                predicted_mask,
                min_object_size=min_object_size,
                hole_size_threshold=hole_size_threshold,
                boundary_smoothing=boundary_smoothing
            )
            segmentation_polygons = _vectorize_mask_to_output_polygons(
                predicted_mask,
                class_index_to_type_id,
                background_class_index,
                spatial_context,
                model_scope_polygons=model_scope_polygons,
                current_type_id=CURRENT_TYPE_ID,
            )
            delete_existing_results_db(conn, TASK_ID, user_id=user_id, task_item_id=TASK_ITEM_ID, status=status)
            insert_segmentation_results_db(conn, TASK_ID, segmentation_polygons, user_id, status, TASK_ITEM_ID)
            torch.cuda.empty_cache()
        except Exception as e:
            print(f"TorchScript模型加载或推理失败: {e}")
            conn.close()
            return

    conn.close()
    print("推理任务完成!")
