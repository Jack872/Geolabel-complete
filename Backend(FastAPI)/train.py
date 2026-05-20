import json
import copy
import os
import tempfile
import numpy as np
import rasterio
from fastapi import APIRouter
from pyproj import Transformer
from shapely import MultiPolygon, Polygon
import shutil
from utils import crop_image_by_scope, identify_holes_and_split, post_process_mask, prepare_data_for_sklearn, prepare_data_for_sklearn_with_windows
from utils_db import connect_db, delete_existing_results_db, fetch_labels_from_db, fetch_map_server_from_db, insert_segmentation_results_db, match_typeid_to_name, save_model_to_db
from utils_storage import ensure_task_image_local
from utils_yolo import create_yolo_data_yaml, create_yolo_dataset, filter_original_labels, process_yolo_results
import torch
from torch.utils.data import DataLoader

from shapely import Point, buffer, coverage_union_all, envelope
from rasterio.windows import from_bounds
from rasterio.warp import transform_bounds
from ultralytics import YOLO

from inference import predict_large_image_with_overlap
from models.light_unet import LightUNet
from models.unet import UNet
from models.fast_scnn import FastSCNN
from models.deeplab import DeepLabV3Plus
from models.xgboostt import XGBoost
from dataset import RemoteSensingSegmentationDataset
from trainers import train_torch_model, predict_torch_model
import pyproj
from shapely.geometry import Polygon
from shapely.ops import transform as shapely_transform

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

def train_function(argv=None):

    # 初始化设备
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    # 连接数据库
    # conn = db_conn
    conn = connect_db()
    if conn is None:
        print("无法连接到数据库，程序退出。")
        return

    TASK_ID = int(argv[1])
    MAPFILE_PATH = argv[2]
    MODEL_TYPE = argv[3]
    BATCH_SIZE = 32
    LEARNING_RATE = 0.001
    NUM_EPOCHS = int(argv[4])
    USER_ID = int(argv[9])

    # model_scope_str = argv[10]  # 模型作用范围
    model_name = argv[11]

    # 模型保存路径
    model_save_dir = os.getenv("MODEL_SAVE_DIR", "/opt/geolabel/cache/trained-models")
    # 修改模型保存路径，加入 task_id 文件夹
    task_model_save_dir = os.path.join(model_save_dir, str(USER_ID)) # 创建 task_id 文件夹路径
    # 检查文件夹是否存在，如果不存在则创建
    if not os.path.exists(task_model_save_dir):
        os.makedirs(task_model_save_dir, exist_ok=True) # 使用 makedirs 递归创建目录，exist_ok=True 表示目录已存在时不会报错
    detection_output_dir = os.path.join(task_model_save_dir, "detection_results")
    segmentation_output_dir = os.path.join(task_model_save_dir, "segmentation_results")
    if not os.path.exists(detection_output_dir):
        os.makedirs(detection_output_dir, exist_ok=True)
    if not os.path.exists(segmentation_output_dir):
        os.makedirs(segmentation_output_dir, exist_ok=True)

    #yolo模型参数
    CONF_THRESHOLD = float(argv[5]) if argv[5] else None # 置信度阈值
    IMG_SIZE = int(argv[6]) if argv[6] else None# 输入图像尺寸

    # 获取地图服务器路径
    IMAGE_PATH = ensure_task_image_local(conn, TASK_ID, None, fallback_path=resolve_image_path(MAPFILE_PATH))


    # 获取标签数据
    labels_data = fetch_labels_from_db(conn, TASK_ID)
    if not labels_data:
        print(f"task_id {TASK_ID} 没有找到标签数据，请检查数据库。")
        conn.close()
        return
    # ================== 坐标统一：DB(3857) -> TIF ==================
    # 动态坐标系转换 - 检测影像是否有坐标系
    db_crs = "EPSG:3857"  # 数据库坐标系（标注数据存储坐标系）
    tif_crs = None
    has_crs = False

    try:
        with rasterio.open(IMAGE_PATH) as src:
            if src.crs:
                tif_crs = src.crs.to_string()
                has_crs = True
                print(f"从影像文件检测到坐标系: {tif_crs}")
            else:
                print("影像无坐标系，使用像素坐标模式（本地任务）")
    except Exception as e:
        print(f"无法检测影像坐标系，使用像素坐标模式: {e}")

    if has_crs:
        # 有坐标系：执行坐标转换（原有逻辑）
        db_to_tif_transformer = Transformer.from_crs(db_crs, tif_crs, always_xy=True)
        transformed_labels = []
        for row in labels_data:
            geom_str = row[1]
            coords_parts = [float(x.strip()) for x in geom_str.split(',')]
            poly_3857 = Polygon([(coords_parts[i], coords_parts[i + 1]) for i in range(0, len(coords_parts), 2)])
            poly_tif = shapely_transform(db_to_tif_transformer.transform, poly_3857)
            new_geom_str = ",".join([f"{c[0]},{c[1]}" for c in list(poly_tif.exterior.coords)])
            new_row = list(row)
            new_row[1] = new_geom_str
            transformed_labels.append(tuple(new_row))
        labels_data = transformed_labels
        print(f"训练数据已从 {db_crs} 转换为 {tif_crs}，准备切片...")
    else:
        # 无坐标系：标注数据直接是像素坐标，无需转换
        print("本地任务模式：标注数据使用像素坐标，跳过坐标转换")
    # =====================================================================

    # 提取 user_id 和 status
    user_ids = set(row[3] for row in labels_data)
    if len(user_ids) > 1:
        print(f"警告: task_id {TASK_ID} 包含多个 user_id: {user_ids}，使用第一个")
    user_id = labels_data[0][3]
    status = labels_data[0][5]

    # 动态确定分类数量
    type_ids_from_db = sorted(list(set(row[2] for row in labels_data)))

    # 获取所有 type_ids
    type_ids = set(row[2] for row in labels_data)

    if MODEL_TYPE in ["light_unet", "unet","fast_scnn", "xgboost", "deeplab"]:
        # 类别映射
        num_classes = len(type_ids_from_db) + 1
        type_id_to_class_index = {type_id: idx for idx, type_id in enumerate(type_ids_from_db)}
        background_class_index = num_classes - 1
        class_index_to_type_id = {idx: type_id for type_id, idx in type_id_to_class_index.items()}


        # 创建数据集
        train_dataset = RemoteSensingSegmentationDataset(
                IMAGE_PATH, labels_data, num_classes, type_id_to_class_index, 
                background_class_index, apply_transforms=True
            )

        # 模型选择和训练
        if MODEL_TYPE in ["light_unet", "unet","fast_scnn", "deeplab"]:
            # 训练数据集（启用变换）
            dataloader = DataLoader(train_dataset, batch_size=BATCH_SIZE)

            # 加载模型
            with rasterio.open(IMAGE_PATH) as src:
                in_channels = src.count
            if MODEL_TYPE == "light_unet":
                model = LightUNet(in_channels=in_channels, num_classes=num_classes).to(device)
            elif MODEL_TYPE == "unet":
                model = UNet(in_channels=in_channels, num_classes=num_classes).to(device)
            elif MODEL_TYPE == "fast_scnn":
                model = FastSCNN(in_channels=in_channels, num_classes=num_classes).to(device)
            elif MODEL_TYPE == "deeplab":
                model = DeepLabV3Plus(in_channels=in_channels, num_classes=num_classes).to(device)
            criterion = torch.nn.CrossEntropyLoss()
            optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE)
            model_save_path = os.path.join(segmentation_output_dir, f"{model_name}.pth")
            train_torch_model(model, dataloader, criterion, optimizer, NUM_EPOCHS, device, model_save_path)

            # 预测
            with rasterio.open(IMAGE_PATH) as src:
                image = src.read().astype(np.float32) / 255.0
                window_transform = src.transform
            block_size = (1024, 1024)
            overlap = (128, 128)
            _, H, W = image.shape
            if H <= block_size[0] and W <= block_size[1]:
                image_tensor = torch.from_numpy(image).float().to(device)
                predicted_mask = predict_torch_model(model, image_tensor, device)
            else:
                predicted_mask = predict_large_image_with_overlap(
                model, image, block_size, overlap, predict_torch_model, device)

        # if MODEL_TYPE in ["light_unet", "unet","fast_scnn"]:
            #     # 训练数据集（启用变换）
        #     dataloader = DataLoader(train_dataset, batch_size=BATCH_SIZE)

        #     # 加载模型
        #     with rasterio.open(IMAGE_PATH) as src:
        #         in_channels = src.count
        #     if MODEL_TYPE == "light_unet":
        #         model = LightUNet(in_channels=in_channels, num_classes=num_classes).to(device)
        #     elif MODEL_TYPE == "unet":
        #         model = UNet(in_channels=in_channels, num_classes=num_classes).to(device)
        #     elif MODEL_TYPE == "fast_scnn":
        #         model = FastSCNN(in_channels=in_channels, num_classes=num_classes).to(device)

        #     criterion = torch.nn.CrossEntropyLoss()
        #     optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE)
        #     model_save_path = os.path.join(segmentation_output_dir, f"{MODEL_TYPE}.pth")
        #     train_torch_model(model, dataloader, criterion, optimizer, NUM_EPOCHS, device, model_save_path)

        #     # 预测时禁用变换
        #     pred_dataset = RemoteSensingSegmentationDataset(
        #         IMAGE_PATH, labels_data, num_classes, type_id_to_class_index, 
        #         background_class_index, apply_transforms=False
        #     )
        #     image_tensor, _, window_transform = pred_dataset[0]
        #     predicted_mask = predict_torch_model(model, image_tensor, device)


            # image_tensor = torch.from_numpy(pred_dataset.image).float()
            # predicted_mask = predict_torch_model(model, image_tensor, device)
            '''增加几何变换数据增强'''
            # dataloader = DataLoader(dataset, batch_size=BATCH_SIZE)
            # with rasterio.open(IMAGE_PATH) as src:
            #     in_channels = src.count
            # if MODEL_TYPE == "light_unet":
            #     model = LightUNet(in_channels=in_channels, num_classes=num_classes).to(device)
            # elif MODEL_TYPE == "unet":
            #     model = UNet(in_channels=in_channels, num_classes=num_classes).to(device)
            # elif MODEL_TYPE == "fast_scnn":
            #     model = FastSCNN(in_channels=in_channels, num_classes=num_classes).to(device)

            # criterion = torch.nn.CrossEntropyLoss()
            # optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE)
            # # 构建包含 task_id 文件夹的模型保存路径
            # model_save_path = os.path.join(segmentation_output_dir, f"{MODEL_TYPE}.pth")
            # train_torch_model(model, dataloader, criterion, optimizer, NUM_EPOCHS, device, model_save_path) # 传递保存路径
            # # train_torch_model(model, dataloader, criterion, optimizer, NUM_EPOCHS, device)
            # image_tensor = torch.from_numpy(dataset.image).float()
            # predicted_mask = predict_torch_model(model, image_tensor, device)
            
        elif MODEL_TYPE =="xgboost":
            # 使用窗口化数据准备，只处理包含标注的区域
            print("使用窗口化方法准备 XGBoost 训练数据...")
            X, y, training_window_transforms = prepare_data_for_sklearn_with_windows(
                IMAGE_PATH, labels_data, type_id_to_class_index, background_class_index
            )
            
            model = XGBoost(num_classes, num_round=NUM_EPOCHS)
            
            # 训练模型但不保存
            model.train(X, y)
            
            # 使用分块推理处理大图像
            with rasterio.open(IMAGE_PATH) as src:
                full_image = src.read().astype(np.float32) / 255.0
                full_transform = src.transform
                _, H, W = full_image.shape
            
            # 设置分块参数
            block_size = (1024, 1024)
            overlap = (128, 128)
            
            print(f"开始对完整图像进行推理，图像尺寸: {H}x{W}")
            
            # 判断是否需要分块推理
            if H <= block_size[0] and W <= block_size[1]:
                # 小图像直接推理
                print("图像较小，使用直接推理")
                X_full, _ = prepare_data_for_sklearn(full_image, np.zeros((H, W)))
                predicted_mask = model.predict(X_full).reshape(H, W).astype(np.uint8)
            else:
                # 大图像分块推理
                print("图像较大，使用分块推理")
                predicted_mask = predict_large_image_with_xgboost_overlap(
                    model, full_image, block_size, overlap
                )
            
            # 使用正确的变换矩阵
            window_transform = full_transform

        # 后处理掩膜
        # predicted_mask = post_process_mask(predicted_mask, min_object_size=500, hole_size_threshold=500, boundary_smoothing=5, mode_filter_size=15)
        predicted_mask = post_process_mask(
            predicted_mask, min_object_size=int(argv[5]), hole_size_threshold=int(argv[6]),
            boundary_smoothing=int(argv[7]))
        # 转换为多边形
        segmentation_polygons = identify_holes_and_split(predicted_mask, window_transform, class_index_to_type_id, background_class_index)

        # ================== 坐标还原：TIF -> DB ==================
        if has_crs:
            tif_to_db_transformer = Transformer.from_crs(tif_crs, db_crs, always_xy=True)
            restored_polygons = {}
            for type_id, polys in segmentation_polygons.items():
                restored_polys = [shapely_transform(tif_to_db_transformer.transform, poly) for poly in polys]
                restored_polygons[type_id] = restored_polys
            segmentation_polygons = restored_polygons
            print(f"预测结果已从 {tif_crs} 还原为 {db_crs}，准备写入数据库...")
        else:
            print("本地任务模式：预测结果使用像素坐标，直接写入数据库")
        # =====================================================================

        # 删除旧结果并写入新结果
        # TODO 新流程保留原标注
        # delete_existing_results_db(conn, TASK_ID)
        insert_segmentation_results_db(conn, TASK_ID, segmentation_polygons, user_id, status)
        torch.cuda.empty_cache()

        # 对于 XGBoost，我们不保存模型文件，只保存映射信息
        if MODEL_TYPE != "xgboost":
            type_id_to_name = match_typeid_to_name(conn, table_name="type")
            if not type_id_to_name:
                print("无法获取 type_id 到 type_name 的映射，跳过保存映射规则。")
            else:
                mapping_parts = [
                        f"通道 {idx} 对应类别 {type_id_to_name.get(type_id, '未知类别')}"
                        for idx, type_id in class_index_to_type_id.items()
                    ]
                mapping_parts.append(f"通道 {background_class_index} 对应背景")
                mapping_data = "; ".join(mapping_parts)

                # 将映射规则保存到数据库
                with rasterio.open(IMAGE_PATH) as src:
                    input_num = src.count  # 输入通道数

                tasktype = argv[12]
                print("tasktype" + tasktype)

                # 对于非 XGBoost 模型，保存模型路径
                model_save_path = os.path.join(segmentation_output_dir, f"{model_name}.pth")
                save_model_to_db(
                    conn=conn,
                    model_name=model_name,
                    user_id=user_id,
                    mapping=mapping_data,
                    model_path=model_save_path,
                    input_num=input_num,
                    output_num=num_classes,
                    model_type=MODEL_TYPE,
                    tasktype=tasktype,
                )
        else:
            # XGBoost 模型不保存文件，只记录训练完成信息
            print(f"XGBoost 模型 '{model_name}' 训练完成，未保存模型文件（使用内存推理）")


    elif MODEL_TYPE in ["yolo"]:

        # 使用临时目录创建 YOLO 数据集
        with tempfile.TemporaryDirectory() as output_dir:
            images_dir, labels_dir, type_id_to_class_id, jpeg_path, original_boxes, original_labels = create_yolo_dataset(
                labels_data, IMAGE_PATH, output_dir
            )

            class_id_to_type_id = {v: k for k, v in type_id_to_class_id.items()}
            print(f"type_id 到 class_id 映射: {type_id_to_class_id}")
            print(f"class_id 到 type_id 映射: {class_id_to_type_id}")

            # 获取 type_id 到 type_name 的映射
            type_id_to_name = match_typeid_to_name(conn, table_name="type")
            if not type_id_to_name:
                print("无法获取 type_id 到 type_name 的映射，跳过保存映射规则。")
            else:
                # 构建输出通道到类别名称的映射
                channel_to_name = {
                    str(class_id): type_id_to_name.get(type_id, "未知类别")
                    for type_id, class_id in type_id_to_class_id.items()
                }



            os.makedirs(os.path.join(images_dir, "train"), exist_ok=True)
            os.makedirs(os.path.join(images_dir, "val"), exist_ok=True)
            os.makedirs(os.path.join(labels_dir, "train"), exist_ok=True)
            os.makedirs(os.path.join(labels_dir, "val"), exist_ok=True)

            image_name = os.path.basename(jpeg_path)
            label_name = image_name.replace(".jpg", ".txt")
            for split in ["train", "val"]:
                shutil.copy(os.path.join(images_dir, image_name),
                            os.path.join(images_dir, split, image_name))
                shutil.copy(os.path.join(labels_dir, label_name),
                            os.path.join(labels_dir, split, label_name))

            data_yaml_path = create_yolo_data_yaml(output_dir, images_dir, labels_dir, type_ids_from_db)

            # 训练 YOLO 模型
            # model = copy.deepcopy(global_yolo)
            model = YOLO("yolo11m-obb.pt")
            train_results = model.train(
                workers=0,
                amp=True,
                data=data_yaml_path,
                epochs=NUM_EPOCHS,
                imgsz=IMG_SIZE,
                device=device,
                project=detection_output_dir,
                name=f"{model_name}",
                save=True,
                patience=10,
            )

            # 推理
            inference_output_path = os.path.join(output_dir, "inference_with_boxes.jpg")
            results = model(jpeg_path, conf=CONF_THRESHOLD, imgsz=IMG_SIZE, save=True, save_txt=True)

            # 使用裁剪后的变换或原始变换
            transform = rasterio.open(IMAGE_PATH).transform

            # 处理检测结果
            detection_polygons, detection_boxes, detection_labels = process_yolo_results(
                results, transform, TASK_ID, user_id, status, conn, class_id_to_type_id, inference_output_path, IMAGE_PATH
            )

            # 将原始标注转换为 Shapely 多边形
            original_polygons = []
            for _, geom_str, _, *_ in labels_data:
                coords_str_list = geom_str.split(',')
                coords_list = [(float(coords_str_list[i].strip()), float(coords_str_list[i+1].strip())) 
                            for i in range(0, len(coords_str_list), 2)]
                original_polygons.append(Polygon(coords_list))



            filtered_original_polygons = filter_original_labels(original_polygons, detection_polygons, distance_threshold=float(argv[7]))

            # 合并过滤后的原始标注和预测标注
            all_polygons = {type_id: filtered_original_polygons + detection_polygons.get(type_id, []) 
                            for type_id in type_ids}

            # 写入数据库
            delete_existing_results_db(conn, TASK_ID)
            insert_segmentation_results_db(conn, TASK_ID, all_polygons, user_id, status)

            model = None
            torch.cuda.empty_cache()

            # 将映射规则保存到数据库
            type_id_to_name = match_typeid_to_name(conn, table_name="type")
            if not type_id_to_name:
                print("无法获取 type_id 到 type_name 的映射，跳过保存映射规则。")
            else:
                # 构建自然语言的映射描述
                mapping_parts = [
                    f"通道 {class_id} 对应类别 {type_id_to_name.get(type_id, '未知类别')}"
                    for type_id, class_id in type_id_to_class_id.items()
                ]
                mapping_data = "; ".join(mapping_parts)
            with rasterio.open(IMAGE_PATH) as src:
                input_num = src.count  # 输入通道数
            
            tasktype = argv[12]
            print("tasktype: " + tasktype)
            
            # 修正模型保存路径
            model_save_path = os.path.join(detection_output_dir, f"{model_name}/weights/best.pt")
            save_model_to_db(
                conn=conn,
                model_name=model_name,
                user_id=user_id,
                mapping=mapping_data,
                model_path=model_save_path,
                input_num=input_num,
                output_num=len(type_id_to_class_id),
                model_type=MODEL_TYPE,
                tasktype=tasktype,
            )


    else:
        print(f"未知的模型类型: {MODEL_TYPE}")
        conn.close()
        return

    # 关闭数据库连接
    conn.close()
    print("任务完成!")
