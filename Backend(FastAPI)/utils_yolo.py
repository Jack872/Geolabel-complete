import gc
import os
import random
import shutil
from pathlib import Path
from typing import List

import cv2
import numpy as np
import rasterio
import yaml
from PIL import Image
from pyproj import Transformer
from rasterio.transform import rowcol
from rasterio.windows import Window
from shapely import box
from shapely.geometry import MultiPolygon
from shapely.geometry.base import BaseGeometry


#目标检测 yolo 模型设置
# -------------------- 图像转换函数 --------------------
def convert_tif_to_jpeg(tif_path, output_jpeg_path):
    """将 .tif 文件转换为 RGB JPEG 文件，仅保留前三个波段"""
    try:
        with rasterio.open(tif_path) as src:
            if src.count < 3:
                raise ValueError(f"图像 {tif_path} 的波段数少于 3，无法转换为 RGB JPEG")
            
            img = src.read([1, 2, 3])
            img = np.transpose(img, (1, 2, 0))

            if img.dtype != np.uint8:
                img = img.astype(np.float32)
                img_min, img_max = img.min(), img.max()
                if img_max > img_min:
                    img = (img - img_min) / (img_max - img_min) * 255
                img = img.astype(np.uint8)

            image = Image.fromarray(img, mode='RGB')
            image.save(output_jpeg_path, format='JPEG', quality=95)
            print(f"成功将 {tif_path} 转换为 {output_jpeg_path}")
            return True
    except Exception as e:
        print(f"转换 {tif_path} 到 JPEG 时出错: {e}")
        return False

# -------------------- 可视化函数 --------------------
def draw_boxes_on_image(image_path, boxes, labels, output_path, color=(0, 255, 0)):
    """在图像上绘制 bounding boxes"""
    img = cv2.imread(image_path)
    if img is None:
        print(f"无法加载图像 {image_path}")
        return

    for box, label in zip(boxes, labels):
        if len(box) == 4:  # Regular bounding box
            x1, y1, x2, y2 = box
            x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
            cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
        elif len(box) == 8:  # OBB (x1, y1, x2, y2, x3, y3, x4, y4)
            points = np.array(box, dtype=np.int32).reshape((-1, 1, 2))
            cv2.polylines(img, [points], isClosed=True, color=color, thickness=2)
        cv2.putText(img, str(label), (int(box[0]), int(box[1]) - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

    cv2.imwrite(output_path, img)
    print(f"已保存可视化图像到 {output_path}")

# -------------------- YOLO 数据集生成函数 --------------------
def create_yolo_dataset(labels_data, image_path, output_dir, model_scope_str=None):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    images_dir = os.path.join(output_dir, "images")
    labels_dir = os.path.join(output_dir, "labels")
    # os.makedirs(images_dir, exist_ok=True)
    # os.makedirs(labels_dir, exist_ok=True)
    # 修改点1: 创建train和val子目录
    os.makedirs(os.path.join(images_dir, "train"), exist_ok=True)
    os.makedirs(os.path.join(labels_dir, "train"), exist_ok=True)
    os.makedirs(os.path.join(images_dir, "val"), exist_ok=True)
    os.makedirs(os.path.join(labels_dir, "val"), exist_ok=True)

    # 解析模型作用范围
    # model_scope_polygons = parse_model_scope(model_scope_str) if model_scope_str else None
    # 过滤标注
    # filtered_labels = filter_labels_by_scope(labels_data, model_scope_polygons)

    image_name = os.path.basename(image_path)
    jpeg_name = image_name.replace(".tif", ".jpg")
    jpeg_path = os.path.join(images_dir, jpeg_name)
    if not convert_tif_to_jpeg(image_path, jpeg_path):
        raise ValueError(f"无法将 {image_path} 转换为 JPEG，程序退出。")

    with Image.open(jpeg_path) as img:
        img_width, img_height = img.size

    with rasterio.open(image_path) as src:
        inverse_transform = ~src.transform
        srcTransform = src.transform
        tif_width, tif_height = src.width, src.height
        tif_crs = src.crs
        # 动态坐标系检测和警告
        if tif_crs:
            print(f"检测到图像坐标系: {tif_crs}")
            # 可以根据需要添加坐标系验证逻辑
        else:
            print("警告: 无法检测图像坐标系！")

    width_ratio = img_width / tif_width
    height_ratio = img_height / tif_height

    label_file_path = os.path.join(labels_dir, jpeg_name.replace(".jpg", ".txt"))
    type_id_to_class_id = {}
    class_id_counter = 0
    original_boxes = []
    original_labels = []

    with open(label_file_path, "w") as f:
        for _, geom_str, type_id, *_ in labels_data:
            try:
                if type_id not in type_id_to_class_id:
                    type_id_to_class_id[type_id] = class_id_counter
                    class_id_counter += 1
                class_id = type_id_to_class_id[type_id]

                coords_str_list = geom_str.split(',')
                coords_list = [(float(coords_str_list[i].strip()), float(coords_str_list[i+1].strip())) 
                               for i in range(0, len(coords_str_list), 2)]
                polygon = Polygon(coords_list)
                coords = list(polygon.exterior.coords)[:-1]  # 移除闭合点
                # 修改点2: 对于非四边形多边形，考虑使用最小外接矩形代替
                if len(coords) != 4:
                    print("警告: 多边形不是四边形，尝试拟合最小外接矩形...")
                    coords = polygon_to_obb(coords)  # 实现polygon_to_obb函数

                pixel_coords = [inverse_transform * (x, y) for x, y in coords]
                pixel_coords = [(x * width_ratio, y * height_ratio) for x, y in pixel_coords]

                if len(pixel_coords) < 4:
                    print(f"警告: 多边形点数少于4，跳过: {geom_str}")
                    continue

                norm_coords = [(x / img_width, y / img_height) for x, y in pixel_coords[:4]]
                norm_coords = [max(0, min(1, coord)) for sublist in norm_coords for coord in sublist]

                f.write(f"{class_id} {' '.join(map(str, norm_coords))}\n")

                obb_box = [coord for point in pixel_coords[:4] for coord in point]
                original_boxes.append(obb_box)
                original_labels.append(f"Class {class_id}")
            except Exception as e:
                print(f"处理几何字符串时出错: {e}, geom_str: {geom_str}")
                continue

    return images_dir, labels_dir, type_id_to_class_id, jpeg_path, original_boxes, original_labels


from shapely.geometry import Polygon


def polygon_to_obb(coords):
    """
    将给定的多边形坐标转换为最小外接矩形(OBB)的坐标。

    :param coords: 输入多边形的顶点坐标列表 [(x1, y1), (x2, y2), ...]
    :return: 最小外接矩形的顶点坐标列表 [(x1, y1), (x2, y2), (x3, y3), (x4, y4)]
    """
    # 创建一个多边形实例
    polygon = Polygon(coords)

    # 计算最小外接矩形
    min_bounding_rect = polygon.minimum_rotated_rectangle

    # 获取OBB的坐标
    obb_coords = list(min_bounding_rect.exterior.coords)

    # 移除闭合点，并且只返回前四个点作为OBB的坐标
    if len(obb_coords) > 4:
        obb_coords = obb_coords[:4]

    return obb_coords
def create_yolo_data_yaml(output_dir, images_dir, labels_dir, type_ids):
    """生成 YOLO 数据集的 data.yaml 文件"""
    data_yaml_path = os.path.join(output_dir, "data.yaml")
    with open(data_yaml_path, "w") as f:
        f.write("train: {}\n".format(os.path.join(images_dir, "train")))
        f.write("val: {}\n".format(os.path.join(images_dir, "val")))
        f.write("nc: {}\n".format(len(type_ids)))
        # f.write("names: {}\n".format([str(i) for i in range(len(type_ids))]))
        # 修改点3: 使用type_id而不是简单的数字索引作为类别名称
        f.write("names: {}\n".format([str(id) for id in type_ids]))  # 这里应该是type_id_to_class_id.values()
    return data_yaml_path

# -------------------- 处理 YOLO 检测结果 --------------------
def process_yolo_results(results, transform, task_id, user_id, status, conn, class_id_to_type_id, output_image_path,IMAGE_PATH):
    """处理 YOLO OBB 检测结果，将检测框转换为地理坐标并插入数据库"""
    if not results or len(results) == 0:
        print("YOLO 检测未返回有效结果！")
        return {}, [], []

    detection_polygons = {}
    detection_boxes = []
    detection_labels = []

    for result in results:
        if result.obb is None or len(result.obb.xyxyxyxy) == 0:
            print("无 OBB 检测结果！")
            continue

        boxes = result.obb.xyxyxyxy.cpu().numpy()  # OBB coordinates (x1, y1, x2, y2, x3, y3, x4, y4)
        class_ids = result.obb.cls.cpu().numpy()
        confidences = result.obb.conf.cpu().numpy()

        print(f"检测到 {len(boxes)} 个 OBB 目标框:")
        print(f"所有检测框置信度: {confidences}")
        for i, (box, class_id, conf) in enumerate(zip(boxes, class_ids, confidences)):
            print(f"目标 {i+1}: class_id={int(class_id)}, conf={conf:.3f}, box={box}")

            # 修改类别映射处理方式，兼容新的映射方法
            type_id = class_id_to_type_id.get(int(class_id))
            if type_id is None:
                print(f"警告: class_id {class_id} 未找到对应的 type_id，跳过。")
                continue

            with Image.open(result.path) as img:
                img_width, img_height = img.size
            with rasterio.open(IMAGE_PATH) as src:
                tif_width, tif_height = src.width, src.height
            width_ratio = tif_width / img_width
            height_ratio = tif_height / img_height

            # Convert to tif coordinates
            tif_coords = [(x * width_ratio, y * height_ratio) for x, y in box.reshape(4, 2)]
            geo_corners = [(transform * (x, y)) for x, y in tif_coords]
            geo_corners = [(float(x), float(y)) for x, y in geo_corners]

            if type_id not in detection_polygons:
                detection_polygons[type_id] = []
            polygon = Polygon(geo_corners)
            detection_polygons[type_id].append(polygon)

            detection_boxes.append(box.flatten().tolist())  # Flatten to [x1, y1, x2, y2, x3, y3, x4, y4]
            detection_labels.append(f"Class {class_id} (conf: {conf:.2f})")

    return detection_polygons, detection_boxes, detection_labels

# 处理重叠标注


# -------------------- 清理函数 --------------------
def cleanup_training_files(output_dir):
    """删除生成的训练文件目录"""
    try:
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir)
            print(f"已删除训练目录: {output_dir}")
        else:
            print(f"训练目录 {output_dir} 不存在，无需删除。")
    except Exception as e:
        print(f"删除训练目录 {output_dir} 时出错: {e}")

def filter_original_labels_with_type(original_polygons_with_type, predicted_polygons, distance_threshold=15):
    filtered = []
    all_predicted = [poly for polys in predicted_polygons.values() for poly in polys]
    predicted_multipoly = MultiPolygon(all_predicted) if all_predicted else MultiPolygon()
    for orig_poly, type_id in original_polygons_with_type:
        orig_centroid = orig_poly.centroid
        keep = True
        for pred_poly in predicted_multipoly.geoms:
            pred_centroid = pred_poly.centroid
            if orig_centroid.distance(pred_centroid) < distance_threshold:
                keep = False
                break
        if keep:
            filtered.append((orig_poly, type_id))
    return filtered

def filter_original_labels(original_polygons, predicted_polygons, distance_threshold=15):

    filtered_original = []
    # Flatten predicted_polygons into a list of Polygon objects and create MultiPolygon
    all_predicted = [poly for polys in predicted_polygons.values() for poly in polys]
    predicted_multipoly = MultiPolygon(all_predicted) if all_predicted else MultiPolygon()
    
    for orig_poly in original_polygons:
        orig_centroid = orig_poly.centroid
        keep = True
        # Iterate over individual Polygon objects in MultiPolygon using .geoms
        for pred_poly in predicted_multipoly.geoms:
            pred_centroid = pred_poly.centroid
            if orig_centroid.distance(pred_centroid) < distance_threshold:
                keep = False
                break
        if keep:
            filtered_original.append(orig_poly)
    return filtered_original


def convert_tif_to_jpeg(tif_path: str, output_jpeg_path: str) -> bool:
    """将 .tif 文件转换为 RGB JPEG 文件，仅保留前三个波段并归一化到 uint8"""
    try:
        import rasterio
        with rasterio.open(tif_path) as src:
            if src.count < 3:
                raise ValueError(f"图像 {tif_path} 的波段数少于 3，无法转换为 RGB JPEG")
            img = src.read([1, 2, 3])  # shape (3, H, W)
            img = np.transpose(img, (1, 2, 0))  # H,W,3

            # 归一化到 0-255
            if img.dtype != np.uint8:
                img = img.astype(np.float32)
                img_min, img_max = img.min(), img.max()
                if img_max > img_min:
                    img = (img - img_min) / (img_max - img_min) * 255.0
                img = np.clip(img, 0, 255).astype(np.uint8)

            image = Image.fromarray(img, mode='RGB')
            os.makedirs(os.path.dirname(output_jpeg_path), exist_ok=True)
            image.save(output_jpeg_path, format='JPEG', quality=95)
        return True
    except Exception as e:
        print(f"[convert_tif_to_jpeg] 错误: {e}")
        return False

def _poly_to_minarea_rect_norm(poly: BaseGeometry, tile_w: int, tile_h: int):
    """
    输入：shapely polygon（局部坐标，像素，已相对于 tile 左上角）
    输出：8 个归一化坐标 [x1,y1,...,x4,y4] (顺序依 cv2.boxPoints)
    """
    try:
        coords = np.array(poly.exterior.coords)
        if coords.shape[0] < 3:
            return None
        rect = cv2.minAreaRect(coords.astype(np.float32))  # ((cx,cy),(w,h),angle)
        box_pts = cv2.boxPoints(rect)  # 4 x 2
        # 归一化
        norm = []
        for x, y in box_pts:
            nx = float(x / tile_w)
            ny = float(y / tile_h)
            # 保证在 [0,1]
            nx = max(0.0, min(1.0, nx))
            ny = max(0.0, min(1.0, ny))
            norm.extend([nx, ny])

        return norm
    except Exception as e:
        print(f"[poly_to_minarea_rect_norm] 错误: {e}")
        return None

# TODO 老版YOLO训练数据准备代码
# def create_multi_image_yolo_dataset(
#     all_image_paths: List[str],
#     all_labels_data: List[List[Tuple]],
#     output_dir: str,
#     type_id_to_class_id: Dict[Any, int],
#     tile_size: int = 640,
#     stride: int = 640,
#     train_ratio: float = 0.8,
#     label_crs: str = "EPSG:3857",   # 标注坐标系：通常是 3857（Web Mercator）或 3301，按实际传入
#     verbose: bool = True
# ):
#     """
#     主要入口函数。参数说明：
#       - all_image_paths: 每个 item 是 tif 路径
#       - all_labels_data: 与 image_paths 等长，每个元素是该影像所有标注记录的列表，
#                          每个记录的结构: (featureId, geom_str, type_id, ... ) 其中 geom_str = 'x1,y1,x2,y2,...'
#       - output_dir: 输出根目录（会在下创建 images/labels 子目录）
#       - type_id_to_class_id: 全局 type_id -> classId 映射
#       - tile_size, stride: 切片尺寸与步长
#       - train_ratio: 训练集占比 (rest -> val)
#       - label_crs: 标注坐标系字符串（pyproj 支持），如果不确知可尝试 "EPSG:3857"
#     返回: images_base_dir, labels_base_dir, all_original_boxes, all_original_labels, data_yaml_path
#     """
#
#     random.seed(42)
#
#     images_base_dir = os.path.join(output_dir, "images")
#     labels_base_dir = os.path.join(output_dir, "labels")
#     for split in ["train", "val"]:
#         os.makedirs(os.path.join(images_base_dir, split), exist_ok=True)
#         os.makedirs(os.path.join(labels_base_dir, split), exist_ok=True)
#
#     all_original_boxes = []
#     all_original_labels = []
#     processed_tiles = []  # 用于 data.yaml 的 train/val 列表
#
#     for i, tif_path in enumerate(all_image_paths):
#         if verbose:
#             print(f"\n=== 处理影像 {i}: {tif_path} ===")
#         if not os.path.exists(tif_path):
#             print(f"影像不存在，跳过: {tif_path}")
#             continue
#
#         # 1) 转为 JPEG（放到临时目录 images/train 下的唯一名字）
#         original_basename = os.path.splitext(os.path.basename(tif_path))[0]
#         unique_base = f"img_{i}_{original_basename}"
#         full_jpeg_path = os.path.join(images_base_dir, "train", f"{unique_base}.jpg")
#         ok = convert_tif_to_jpeg(tif_path, full_jpeg_path)
#         if not ok:
#             print(f"无法转换 {tif_path}，跳过")
#             continue
#
#         # 读取影像元信息
#         with rasterio.open(tif_path) as src:
#             src_crs = src.crs
#             src_transform = src.transform
#             tif_width, tif_height = src.width, src.height
#
#         # 准备坐标转换：label_crs -> image_crs（src_crs）
#         transformer = None
#         try:
#             # 若 src_crs 是 None or local, Transformer 可能失败 -> 捕获
#             transformer = Transformer.from_crs(label_crs, "EPSG:3301", always_xy=True)
#         except Exception as e:
#             print(f"[WARN] 创建 Transformer 失败: {e}. 尝试跳过坐标转换（假设标注与影像 CRS 相同）")
#             transformer = None
#
#         # 打开 JPEG 用于切片（PIL）
#         with Image.open(full_jpeg_path) as pil_img:
#             img_w, img_h = pil_img.size
#
#             # width_ratio/height_ratio: tif像素 -> jpeg像素 缩放
#             width_ratio = img_w / tif_width
#             height_ratio = img_h / tif_height
#
#             # 将 labels_data_for_image 中每个 geom -> 一组 geo coords（float list）
#             labels_data_for_image = all_labels_data[i]
#
#             # 预先把每条标注转换为图片像素（JPEG像素）坐标数组，放到 list 中以加速复用
#             ann_pixel_coords = []  # list of tuples: (class_id, list of (x_jpg,y_jpg) )
#             for rec in labels_data_for_image:
#                 # 期待结构： (featureId, geom_str, type_id, ...)
#                 try:
#                     geom_str = rec[1]
#                     type_id = rec[2]
#                 except Exception:
#                     print(f"[WARN] 标注记录结构不是期望格式: {rec}, 跳过")
#                     continue
#
#                 coords_str_list = geom_str.split(',')
#                 if len(coords_str_list) < 6:
#                     # 少于 3 点
#                     continue
#                 geo_coords = []
#                 try:
#                     for j in range(0, len(coords_str_list), 2):
#                         gx = float(coords_str_list[j].strip())
#                         gy = float(coords_str_list[j + 1].strip())
#                         geo_coords.append((gx, gy))
#                 except Exception as e:
#                     print(f"[WARN] 解析 geom_str 出错: {geom_str} -> {e}")
#                     continue
#
#                 # 1) 如果有 transformer，先把标注坐标从 label_crs 转为 image CRS（src_crs）
#                 transformed_geo = []
#                 if transformer is not None:
#                     try:
#                         xs, ys = zip(*geo_coords)
#                         txs, tys = transformer.transform(xs, ys)
#                         transformed_geo = list(zip(txs, tys))
#                     except Exception as e:
#                         # 转换失败 -> 跳过或当作相同 CRS
#                         print(f"[WARN] 单条标注坐标转换失败: {e}. 将尝试当作已在影像 CRS 中")
#                         transformed_geo = geo_coords
#                 else:
#                     transformed_geo = geo_coords
#
#                 # 2) 把地理坐标 -> tif 像素坐标 (col,row)
#                 pixel_coords_tif = []
#                 for gx, gy in transformed_geo:
#                     try:
#                         r, c = rowcol(src_transform, gx, gy)
#                         # rowcol 返回 (row, col)。我们希望 (x=col, y=row)
#                         if 0 <= c < tif_width and 0 <= r < tif_height:
#                             pixel_coords_tif.append((float(c), float(r)))
#                         else:
#                             # 标注点超出 tif 矩形范围也可以保留（之后裁剪切片时会过滤）
#                             pixel_coords_tif.append((float(c), float(r)))
#                     except Exception as e:
#                         print(f"[WARN] rowcol 转换失败: {e}, ({gx},{gy})")
#                         continue
#
#                 if len(pixel_coords_tif) < 3:
#                     continue
#
#                 # 3) tif 像素 -> jpeg 像素（考虑缩放）
#                 pixel_coords_jpg = [(c * width_ratio, r * height_ratio) for (c, r) in pixel_coords_tif]
#
#                 class_id = type_id_to_class_id.get(type_id)
#                 if class_id is None:
#                     # 没有映射就跳过
#                     continue
#
#                 ann_pixel_coords.append((class_id, pixel_coords_jpg))
#
#             # 如果没有任何标注，则仍然可以切片（但不会产生标签）
#             # 4) sliding window 切片
#             xs = list(range(0, max(1, img_w - tile_size + 1), stride))
#             ys = list(range(0, max(1, img_h - tile_size + 1), stride))
#             # 如果最后边界没有覆盖完整图像则补上最后一个窗口以覆盖右/下边缘
#             if xs[-1] + tile_size < img_w:
#                 xs.append(img_w - tile_size)
#             if ys[-1] + tile_size < img_h:
#                 ys.append(img_h - tile_size)
#
#             tile_idx = 0
#             for ty in ys:
#                 for tx in xs:
#                     tile_idx += 1
#                     tile_name = f"{unique_base}_tile_{tx}_{ty}"
#                     tile_jpeg_train = os.path.join(images_base_dir, "train", f"{tile_name}.jpg")
#                     tile_jpeg_val = os.path.join(images_base_dir, "val", f"{tile_name}.jpg")
#                     tile_label_train = os.path.join(labels_base_dir, "train", f"{tile_name}.txt")
#                     tile_label_val = os.path.join(labels_base_dir, "val", f"{tile_name}.txt")
#
#                     # 裁剪并保存 tile（先保存 train 文件，之后可能复制到 val）
#                     tile_box = (tx, ty, tx + tile_size, ty + tile_size)  # left,top,right,bottom
#                     tile_im = pil_img.crop(tile_box)
#                     tile_im.save(tile_jpeg_train, format="JPEG", quality=95)
#
#                     # 准备写标签（先写 train）
#                     labels_for_tile = []
#                     tile_shapely_box = box(0, 0, tile_size, tile_size)  # tile 局部坐标（0,0 ...）
#
#                     for class_id, pts in ann_pixel_coords:
#                         # 将当前标注 polygon 转为 shapely（全图像坐标），然后与 tile 求交
#                         poly = Polygon(pts)
#                         if not poly.is_valid:
#                             poly = poly.buffer(0)
#                             if not poly.is_valid:
#                                 continue
#
#                         # shift polygon 到 tile 局部坐标（通过平移）
#                         # 先判断 bbox 是否与 tile 相交（快速筛）
#                         if poly.bounds[2] < tx or poly.bounds[0] > tx + tile_size or poly.bounds[3] < ty or poly.bounds[1] > ty + tile_size:
#                             # 完全不相交
#                             continue
#                         from shapely.ops import transform as shapely_transform
#                         # 把 poly 平移到 tile 局部坐标
#                         poly_local = shapely_transform(lambda x, y: (x - tx, y - ty), poly)
#                         # 交集（裁剪到 tile 内）
#                         inter = poly_local.intersection(tile_shapely_box)
#                         if inter.is_empty:
#                             continue
#                         # 保证 polygon（可能变为 MultiPolygon -> 取每个部分）
#                         parts = []
#                         if inter.geom_type == "Polygon":
#                             parts = [inter]
#                         else:
#                             try:
#                                 parts = list(inter.geoms)
#                             except Exception:
#                                 continue
#
#                         # 对每个部分计算 minAreaRect，并写一行 label
#                         for part in parts:
#                             if not isinstance(part, Polygon):
#                                 continue
#                             if part.area <= 0.5:  # 面积过小阈值可调整
#                                 continue
#                             norm_coords = _poly_to_minarea_rect_norm(part, tile_size, tile_size)
#                             if norm_coords is None:
#                                 continue
#                             labels_for_tile.append((class_id, norm_coords))
#                             # 可选：记录原始框供可视化
#                             # compute bbox in tile coords (minx,miny,maxx,maxy)
#                             minx, miny, maxx, maxy = part.bounds
#                             all_original_boxes.append([tx + minx, ty + miny, tx + maxx, ty + maxy])
#                             all_original_labels.append(f"{unique_base}_tile{tile_idx}_cls{class_id}")
#
#                     # 决定此 tile 是 train 还是 val（随机）
#                     is_train = random.random() < train_ratio
#
#                     # 写标签到对应 split
#                     if labels_for_tile:
#                         if is_train:
#                             with open(tile_label_train, "w", encoding="utf-8") as fw:
#                                 for class_id, norm_coords in labels_for_tile:
#                                     fw.write(f"{class_id} {' '.join(map(str, norm_coords))}\n")
#                             # copy to val if chosen val later will be handled by copying train->val below
#                         else:
#                             # 如果是 val，需要把 train jpeg 复制到 val 下，然后写 val 标签
#                             shutil.copy(tile_jpeg_train, tile_jpeg_val)
#                             with open(tile_label_val, "w", encoding="utf-8") as fw:
#                                 for class_id, norm_coords in labels_for_tile:
#                                     fw.write(f"{class_id} {' '.join(map(str, norm_coords))}\n")
#
#                     else:
#                         # 没有标签：仍然需要决定是否保留图片（通常训练集不需要无标签图，可根据需求修改）
#                         # 此处我们保留少量无标签样本到 train 以增加背景样本（可改）
#                         if is_train:
#                             # 如果不希望保存无标签 tile，可以删除刚保存的 tile_jpeg_train
#                             # os.remove(tile_jpeg_train)
#                             pass
#                         else:
#                             # remove val duplicate if exists
#                             if os.path.exists(tile_jpeg_val):
#                                 os.remove(tile_jpeg_val)
#
#                     # 如果标为 train 且也需要 val 的 copy（常见做法：train/val 独立划分 tile，不是复制）
#                     # 这里采用随机分配：若 is_train==True，则保证 val 没有该 tile（不复制）
#                     # 若 is_train==False，已经复制过 val
#                     # 记录用于 data.yaml
#                     if is_train:
#                         processed_tiles.append(os.path.relpath(tile_jpeg_train, start=output_dir))
#                     else:
#                         processed_tiles.append(os.path.relpath(tile_jpeg_val, start=output_dir))
#
#     # 构造 data.yaml
#     data_yaml = {
#         "path": str(Path(output_dir).resolve()),
#         "train": "images/train",
#         "val": "images/val",
#         "nc": len(set(type_id_to_class_id.values())),
#         "names": [str(v) for k, v in sorted({v:k for k, v in type_id_to_class_id.items()}.items())]  # 反转映射但保持顺序不重要
#     }
#     data_yaml_path = os.path.join(output_dir, "data.yaml")
#     with open(data_yaml_path, "w", encoding="utf-8") as fy:
#         yaml.safe_dump(data_yaml, fy, allow_unicode=True)
#
#     print(f"\n生成完成: images under {images_base_dir}, labels under {labels_base_dir}, data.yaml: {data_yaml_path}")
#
#     return images_base_dir, labels_base_dir, all_original_boxes, all_original_labels, data_yaml_path





def create_multi_image_yolo_dataset(
        all_image_paths, all_labels_data, output_dir, type_id_to_class_id,
        tile_size=640, stride=640, train_ratio=0.8, label_crs="EPSG:3857", verbose=True
):
    """
    创建多图像YOLO数据集
    
    Args:
        label_crs: 标注坐标系，默认为EPSG:3857，可以动态传入
    """
    random.seed(42)

    images_base_dir = os.path.join(output_dir, "images")
    labels_base_dir = os.path.join(output_dir, "labels")
    for split in ["train", "val"]:
        os.makedirs(os.path.join(images_base_dir, split), exist_ok=True)
        os.makedirs(os.path.join(labels_base_dir, split), exist_ok=True)

    all_original_boxes = []
    all_original_labels = []
    processed_tiles = []

    for i, tif_path in enumerate(all_image_paths):
        if verbose:
            print(f"\n=== 处理影像 {i}: {tif_path} ===")
        if not os.path.exists(tif_path):
            continue

        original_basename = os.path.splitext(os.path.basename(tif_path))[0]
        unique_base = f"img_{i}_{original_basename}"

        # ---------------------------------------------------------
        # 核心优化：直接打开 TIF，获取元数据，不进行全图转换
        # ---------------------------------------------------------
        with rasterio.open(tif_path) as src:
            src_crs = src.crs
            src_transform = src.transform
            tif_width, tif_height = src.width, src.height
            # 确定要读取的波段（通常遥感图前三通道是 RGB）
            bands_to_read = [1, 2, 3] if src.count >= 3 else [1]

            transformer = None
            try:
                # 动态坐标系转换：从标注坐标系转换到影像坐标系
                target_crs = src_crs.to_string() if src_crs else "EPSG:3301"
                if target_crs and target_crs != "UNKNOWN":
                    transformer = Transformer.from_crs(label_crs, target_crs, always_xy=True)
                    if verbose:
                        print(f"坐标系转换: {label_crs} -> {target_crs}")
                else:
                    # 如果无法检测影像坐标系，使用默认转换
                    transformer = Transformer.from_crs(label_crs, "EPSG:3301", always_xy=True)
                    if verbose:
                        print(f"使用默认坐标系转换: {label_crs} -> EPSG:3301")
            except Exception as e:
                transformer = None

            labels_data_for_image = all_labels_data[i]
            ann_pixel_coords = []

            # 解析地理坐标到像素坐标 (因为直接读 TIF，不需要算 JPEG 的缩放比例了，1:1 映射)
            for rec in labels_data_for_image:
                try:
                    geom_str, type_id = rec[1], rec[2]
                except:
                    continue

                coords_str_list = geom_str.split(',')
                if len(coords_str_list) < 6: continue

                geo_coords = [(float(coords_str_list[j]), float(coords_str_list[j + 1])) for j in
                              range(0, len(coords_str_list), 2)]

                transformed_geo = geo_coords
                if transformer is not None:
                    try:
                        xs, ys = zip(*geo_coords)
                        txs, tys = transformer.transform(xs, ys)
                        transformed_geo = list(zip(txs, tys))
                    except:
                        pass

                pixel_coords_tif = []
                for gx, gy in transformed_geo:
                    try:
                        # 你外部如果有 rowcol 方法这里继续用，或者用 src.index(gx, gy)
                        # r, c = rasterio.transform.rowcol(src_transform, gx, gy)
                        r, c = rowcol(src_transform, gx, gy)
                        pixel_coords_tif.append((float(c), float(r)))
                    except:
                        continue

                if len(pixel_coords_tif) < 3: continue

                class_id = type_id_to_class_id.get(type_id)
                if class_id is not None:
                    ann_pixel_coords.append((class_id, pixel_coords_tif))

            # 滑动窗口切片
            xs = list(range(0, max(1, tif_width - tile_size + 1), stride))
            ys = list(range(0, max(1, tif_height - tile_size + 1), stride))
            if xs[-1] + tile_size < tif_width: xs.append(tif_width - tile_size)
            if ys[-1] + tile_size < tif_height: ys.append(tif_height - tile_size)

            tile_idx = 0
            for ty in ys:
                for tx in xs:
                    tile_idx += 1
                    tile_name = f"{unique_base}_tile_{tx}_{ty}"

                    # 决定属于 train 还是 val
                    is_train = random.random() < train_ratio
                    split_dir = "train" if is_train else "val"

                    tile_jpeg_path = os.path.join(images_base_dir, split_dir, f"{tile_name}.jpg")
                    tile_label_path = os.path.join(labels_base_dir, split_dir, f"{tile_name}.txt")

                    # ---------------------------------------------------------
                    # 核心优化：使用 Window 直接从 TIF 读取 640x640 像素块
                    # ---------------------------------------------------------
                    window = Window(tx, ty, tile_size, tile_size)
                    try:
                        tile_arr = src.read(bands_to_read, window=window)
                        # 转换通道从 (C, H, W) 到 (H, W, C) 以便 PIL 保存
                        if tile_arr.shape[0] == 3:
                            tile_img_np = np.transpose(tile_arr, (1, 2, 0))
                        else:
                            tile_img_np = tile_arr[0]  # 单通道
                    except Exception as e:
                        print(f"读取窗口失败 tx={tx}, ty={ty}: {e}")
                        continue

                    labels_for_tile = []
                    tile_shapely_box = box(0, 0, tile_size, tile_size)

                    for class_id, pts in ann_pixel_coords:
                        poly = Polygon(pts)
                        if not poly.is_valid:
                            poly = poly.buffer(0)
                            if not poly.is_valid: continue

                        if poly.bounds[2] < tx or poly.bounds[0] > tx + tile_size or poly.bounds[3] < ty or poly.bounds[
                            1] > ty + tile_size:
                            continue

                        from shapely.ops import transform as shapely_transform
                        poly_local = shapely_transform(lambda x, y: (x - tx, y - ty), poly)
                        inter = poly_local.intersection(tile_shapely_box)
                        if inter.is_empty: continue

                        parts = [inter] if inter.geom_type == "Polygon" else list(getattr(inter, 'geoms', []))

                        for part in parts:
                            if not isinstance(part, Polygon) or part.area <= 0.5: continue

                            norm_coords = _poly_to_minarea_rect_norm(part, tile_size, tile_size)
                            if norm_coords is None: continue

                            labels_for_tile.append((class_id, norm_coords))
                            minx, miny, maxx, maxy = part.bounds
                            all_original_boxes.append([tx + minx, ty + miny, tx + maxx, ty + maxy])
                            all_original_labels.append(f"{unique_base}_tile{tile_idx}_cls{class_id}")

                    # 如果没有标签，我们直接跳过（如果你想保留纯背景图，可以去掉这个判断）
                    if not labels_for_tile:
                        continue

                        # 只有在有标签时，我们才将这 640x640 的数组转成 JPEG 保存
                    Image.fromarray(tile_img_np).save(tile_jpeg_path, format="JPEG", quality=95)

                    with open(tile_label_path, "w", encoding="utf-8") as fw:
                        for class_id, norm_coords in labels_for_tile:
                            fw.write(f"{class_id} {' '.join(map(str, norm_coords))}\n")

                    processed_tiles.append(os.path.relpath(tile_jpeg_path, start=output_dir))

        # 每处理完一张完整的影像，强制回收一次垃圾内存
        gc.collect()

    # 构造 data.yaml
    data_yaml = {
        "path": str(Path(output_dir).resolve()),
        "train": "images/train",
        "val": "images/val",
        "nc": len(set(type_id_to_class_id.values())),
        "names": [str(v) for k, v in sorted({v: k for k, v in type_id_to_class_id.items()}.items())]
    }
    data_yaml_path = os.path.join(output_dir, "data.yaml")
    with open(data_yaml_path, "w", encoding="utf-8") as fy:
        yaml.safe_dump(data_yaml, fy, allow_unicode=True)

    print(f"\n生成完成: data.yaml: {data_yaml_path}")
    return images_base_dir, labels_base_dir, all_original_boxes, all_original_labels, data_yaml_path

def create_Multi_yolo_data_yaml(output_dir, images_base_dir, labels_base_dir, class_names: List[str]):
    """生成 YOLO 数据集的 data.yaml 文件"""
    data_yaml_path = os.path.join(output_dir, "data.yaml")
    with open(data_yaml_path, "w") as f:
        f.write(f"train: {os.path.join(images_base_dir, 'train')}\n")
        f.write(f"val: {os.path.join(images_base_dir, 'val')}\n")
        f.write(f"nc: {len(class_names)}\n")
        f.write(f"names: {class_names}\n") # class_names 应该是 [ 'name0', 'name1', ...]
    return data_yaml_path
