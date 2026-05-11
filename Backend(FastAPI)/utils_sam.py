import os
import rasterio
from rasterio.features import shapes
from shapely.geometry import Polygon, mapping
from pyproj import Transformer
import numpy as np
import cv2
from skimage.morphology import label, remove_small_objects
from rasterio.mask import mask
from utils import parse_model_scope


# SAM模型处理
# SAM_BOX
# Coordinate transformation setup - 动态坐标系转换器
def get_transformer(source_crs="EPSG:3857", target_crs="EPSG:4326"):
    """获取坐标系转换器"""
    return Transformer.from_crs(source_crs, target_crs, always_xy=True)

# 默认转换器（向后兼容）
TRANSFORMER_3857_TO_4326 = get_transformer("EPSG:3857", "EPSG:4326")
TRANSFORMER_4326_TO_3857 = get_transformer("EPSG:4326", "EPSG:3857")

def generate_bounding_boxes(labels_data, type_id, source_crs="EPSG:3857", target_crs="EPSG:4326"):
    """Generate bounding boxes for polygons of a specific type_id, transforming coordinates."""
    transformer = get_transformer(source_crs, target_crs)
    boxes_source = []
    boxes_target = []
    for _, geom_str, tid, *_ in labels_data:
        if tid != type_id:
            continue
        try:
            coords_str_list = geom_str.split(',')
            # 检查是否为有效的坐标字符串数组
            if len(coords_str_list) >= 6 and all(c.strip().replace('.', '', 1).replace('-', '', 1).isdigit() or c.strip() == '' for c in coords_str_list):
                coords_list = []
                for i in range(0, len(coords_str_list), 2):
                    if i + 1 < len(coords_str_list):  # 确保有足够的元素获取一对坐标
                        try:
                            x = float(coords_str_list[i].strip())
                            y = float(coords_str_list[i+1].strip())
                            coords_list.append((x, y))
                        except ValueError:
                            continue  # 跳过无法转换为浮点数的坐标对
                
                if len(coords_list) >= 3:  # 确保有足够的点形成多边形
                    polygon = Polygon(coords_list)
                    if polygon.is_valid:
                        minx, miny, maxx, maxy = polygon.bounds
                        boxes_source.append([minx, miny, maxx, maxy])  # Keep in source CRS for reference
                        # Transform to target CRS for SAM prediction
                        minx_target, miny_target = transformer.transform(minx, miny)
                        maxx_target, maxy_target = transformer.transform(maxx, maxy)
                        boxes_target.append([minx_target, miny_target, maxx_target, maxy_target])  # Format: [left, bottom, right, top]
        except Exception as e:
            print(f"Error processing geometry string: {e}, geom_str: {geom_str[:50]}...")
            continue
    return boxes_target  # Return target CRS boxes for SAM


def identify_holes_and_split_SAM(mask, transform, type_id, fill_holes=True):
    """
    将 Mask 转换为多边形，并根据参数决定是否填充内部孔洞。

    Parameters:
        mask: 二值掩码 (numpy array)
        transform: 坐标变换矩阵 (Affine)
        type_id: 类别 ID
        fill_holes: 是否填平多边形内部的所有孔洞
    """
    polygons = {}
    class_mask = mask.astype(np.uint8)

    # 使用 RETR_CCOMP 获取两层轮廓等级（外轮廓与内孔）
    contours, hierarchy = cv2.findContours(class_mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)

    if hierarchy is None or len(contours) == 0:
        return polygons

    class_polygons = []
    for i in range(len(contours)):
        # hierarchy[0][i][3] == -1 表示该轮廓没有父轮廓，即它是最外层的“外壳”
        if hierarchy[0][i][3] == -1:
            if len(contours[i]) < 3:
                continue

            # 1. 提取外轮廓坐标
            exterior_coords = [transform * (point[0][0], point[0][1]) for point in contours[i]]
            # 去重处理，防止退化多边形
            seen = set()
            exterior_coords = [p for p in exterior_coords if not (p in seen or seen.add(p))]

            if len(exterior_coords) < 3:
                continue

            try:
                # 2. 处理孔洞逻辑
                if not fill_holes:
                    # 如果不填充孔洞，则寻找该外轮廓下的所有子轮廓
                    interior_rings = []
                    hole_idx = hierarchy[0][i][2]  # 获取第一个子轮廓索引
                    while hole_idx != -1:
                        if len(contours[hole_idx]) >= 3:
                            int_coords = [transform * (pt[0][0], pt[0][1]) for pt in contours[hole_idx]]
                            interior_rings.append(int_coords)
                        hole_idx = hierarchy[0][hole_idx][0]  # 移动到同级的下一个孔洞

                    polygon = Polygon(exterior_coords, holes=interior_rings)
                else:
                    # 【核心修改点】：直接创建只有外边界的多边形，内部自动填平
                    polygon = Polygon(exterior_coords)

                # 3. 几何清洗与简化
                # 简化参数 0.5~0.8 可以显著减少节点数量并让线段更直
                polygon = polygon.simplify(0.5, preserve_topology=True)

                if not polygon.is_valid:
                    polygon = polygon.buffer(0)  # 尝试自动修复自交等无效几何

                if not polygon.is_empty and polygon.area > 0:
                    class_polygons.append(polygon)

            except Exception as e:
                print(f"[SAM Utils] 创建多边形失败: {e}")

    if class_polygons:
        polygons[type_id] = class_polygons
    return polygons
#   SAM
def crop_tiff_by_polygon(input_tiff_path, output_tiff_path, model_scope_str):
    """
    根据多边形范围裁剪TIFF影像
    
    参数:
    input_tiff_path: 输入TIFF文件路径
    output_tiff_path: 输出TIFF文件路径
    model_scope_str: JSON格式的多边形坐标字符串
    
    返回:
    bool: 裁剪成功返回True，否则返回False
    """
    try:
        # 解析多边形
        polygons = parse_model_scope(model_scope_str)
        if not polygons:
            print("No valid polygons found in the model scope.")
            return False
            
        # 将Shapely多边形转换为GeoJSON格式
        geoms = [mapping(polygon) for polygon in polygons]
            
        # 打开栅格数据
        with rasterio.open(input_tiff_path) as src:
            # 执行裁剪
            out_image, out_transform = mask(src, geoms, crop=True, all_touched=True)
            
            # 获取元数据
            out_meta = src.meta.copy()
            
            # 更新元数据
            out_meta.update({
                "driver": "GTiff",
                "height": out_image.shape[1],
                "width": out_image.shape[2],
                "transform": out_transform
            })
            
            # 创建输出目录(如果不存在)
            output_dir = os.path.dirname(output_tiff_path)
            if output_dir and not os.path.exists(output_dir):
                os.makedirs(output_dir)
                
            # 保存裁剪后的栅格
            with rasterio.open(output_tiff_path, "w", **out_meta) as dest:
                dest.write(out_image)
                
            print(f"Successfully cropped image to {output_tiff_path}")
            return True
            
    except Exception as e:
        print(f"Error cropping TIFF: {e}")
        return False


def post_process_mask_sam(mask, min_object_size=10, hole_size_threshold=20, boundary_smoothing=3):
    """
    对输入的二值掩码进行后处理，包括移除小对象、填充小孔洞、平滑边界和众数滤波。
    
    参数：
        mask: 输入的二值掩码，numpy 数组，uint8 类型，0 为背景，1 为前景
        min_object_size: 最小对象面积阈值，小于此值的对象将被移除
        hole_size_threshold: 小孔洞面积阈值，小于此值的孔洞将被填充
        boundary_smoothing: 形态学平滑的核大小
        mode_filter_size: 众数滤波的窗口大小
    
    返回：
        processed_mask: 处理后的二值掩码，numpy 数组，uint8 类型
    """
    # 复制原始掩码
    original_mask = mask.copy().astype(np.uint8)
    
    
    labeled_mask, num_labels = label(original_mask, return_num=True)

    # 使用Numba移除小对象
    labeled_mask = remove_small_objects(labeled_mask.astype(bool), min_object_size).astype(np.uint8)
    cleaned_mask = (labeled_mask > 0).astype(np.uint8)

    # 填充小孔
    filled_mask = cleaned_mask.copy()
    contours, hierarchy = cv2.findContours(cleaned_mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    for i, contour in enumerate(contours):
        if hierarchy[0][i][3] != -1:  # 如果有父轮廓，说明是内部孔洞
            area = cv2.contourArea(contour)
            if 0 < area < hole_size_threshold:
                cv2.drawContours(filled_mask, [contour], 0, 1, -1)
    # filled_mask = cleaned_mask.copy()
    # contours, _ = cv2.findContours(cleaned_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    # for contour in contours:
    #     temp_mask = np.zeros_like(cleaned_mask)
    #     cv2.drawContours(temp_mask, [contour], 0, 1, -1)
    #     temp_mask_inv = 1 - temp_mask
    #     holes = label(temp_mask_inv)
    #     hole_props = regionprops(holes)
    #     for hole in hole_props:
    #         if 0 < hole.area < hole_size_threshold:
    #             filled_mask[holes == hole.label] = 1

    # 形态学平滑
    kernel = np.ones((boundary_smoothing, boundary_smoothing), np.uint8)
    smoothed_mask = cv2.morphologyEx(filled_mask, cv2.MORPH_CLOSE, kernel)
    smoothed_mask = cv2.morphologyEx(smoothed_mask, cv2.MORPH_OPEN, kernel)

    return smoothed_mask

def generate_point_coordinates_sam(labels_data, type_id):
    """提取原始 3857 坐标，不进行 4326 转换"""
    point_coords = []
    for _, geom_str, tid, *_ in labels_data:
        if tid != type_id:
            continue
        try:
            coords_str_list = geom_str.split(',')
            if len(coords_str_list) == 2:
                x = float(coords_str_list[0].strip())
                y = float(coords_str_list[1].strip())
                # 直接添加原始坐标 [2777746, 7998779]
                point_coords.append([x, y])
        except Exception as e:
            print(f"处理几何字符串时出错: {e}")
            continue
    return point_coords

"""将线段离散化为一系列点阵"""
def discretize_line(line_geom, interval_meters=5):

    distances = np.arange(0, line_geom.length, interval_meters)
    points = [line_geom.interpolate(d) for d in distances]
    points.append(line_geom.interpolate(line_geom.length)) # 加上终点
    return [[p.x, p.y] for p in points]
