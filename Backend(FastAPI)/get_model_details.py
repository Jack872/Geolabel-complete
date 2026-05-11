"""
获取模型训练详情的API模块
"""
import json
import os
from typing import Dict, Any, Optional
from utils_db import connect_db


def get_model_train_details(model_id: int, user_id: int) -> Optional[Dict[str, Any]]:
    """
    获取模型的训练详情和参数
    
    Args:
        model_id: 模型ID
        user_id: 用户ID（用于权限验证）
    
    Returns:
        包含模型训练详情的字典，如果失败则返回None
    """
    conn = connect_db()
    if conn is None:
        print("数据库连接失败")
        return None
    
    try:
        cursor = conn.cursor()
        
        # 查询模型基本信息和训练参数
        query = """
            SELECT 
                model_id,
                model_name,
                model_des,
                task_type,
                model_type,
                input_num,
                output_num,
                mapping,
                path,
                user_id,
                create_time,
                status
            FROM model
            WHERE model_id = %s AND user_id = %s
        """
        
        cursor.execute(query, (model_id, user_id))
        result = cursor.fetchone()
        
        if not result:
            print(f"未找到模型 ID={model_id} 或用户无权访问")
            return None
        
        # 解析结果
        model_info = {
            "modelId": result[0],
            "modelName": result[1],
            "modelDes": result[2],
            "taskType": result[3],
            "modelType": result[4],
            "inputNum": result[5],
            "outputNum": result[6],
            "mapping": result[7],
            "path": result[8],
            "userId": result[9],
            "createTime": str(result[10]) if result[10] else None,
            "status": result[11] if result[11] else "completed"
        }
        
        # 尝试从模型路径读取训练日志或参数文件
        train_details = extract_train_details_from_path(model_info["path"], model_info["modelType"])
        
        # 合并信息
        response = {
            "code": 200,
            "success": True,
            "data": {
                **model_info,
                "metrics": train_details.get("metrics", {}),
                "params": train_details.get("params", {})
            },
            "message": "获取模型详情成功"
        }
        
        return response
        
    except Exception as e:
        print(f"获取模型详情失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return None
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def extract_train_details_from_path(model_path: str, model_type: str) -> Dict[str, Any]:
    """
    从模型路径提取训练详情
    
    Args:
        model_path: 模型文件路径
        model_type: 模型类型
    
    Returns:
        包含训练指标和参数的字典
    """
    details = {
        "metrics": {},
        "params": {}
    }
    
    if not model_path or not os.path.exists(model_path):
        return details
    
    try:
        # 获取模型所在目录
        model_dir = os.path.dirname(model_path)
        
        # 1. 尝试读取训练日志文件
        log_file = os.path.join(model_dir, "train_log.json")
        if os.path.exists(log_file):
            with open(log_file, 'r', encoding='utf-8') as f:
                log_data = json.load(f)
                details["metrics"] = log_data.get("metrics", {})
                details["params"] = log_data.get("params", {})
        
        # 2. 对于YOLO模型，尝试读取results.json
        if model_type.lower() == "yolo":
            results_file = os.path.join(model_dir, "results.json")
            if os.path.exists(results_file):
                with open(results_file, 'r', encoding='utf-8') as f:
                    yolo_results = json.load(f)
                    # 提取YOLO特定指标
                    if "metrics" in yolo_results:
                        details["metrics"].update({
                            "precision": yolo_results["metrics"].get("precision", 0) * 100,
                            "recall": yolo_results["metrics"].get("recall", 0) * 100,
                            "mAP50": yolo_results["metrics"].get("mAP50", 0) * 100,
                            "mAP50-95": yolo_results["metrics"].get("mAP50-95", 0) * 100
                        })
        
        # 3. 对于PyTorch模型，尝试读取checkpoint信息
        elif model_type.lower() in ["unet", "light_unet", "fast_scnn", "deeplab", "segformer"]:
            import torch
            if model_path.endswith('.pth'):
                try:
                    checkpoint = torch.load(model_path, map_location='cpu')
                    if isinstance(checkpoint, dict):
                        # 提取训练参数
                        if "epoch" in checkpoint:
                            details["params"]["epochs"] = checkpoint["epoch"]
                        if "loss" in checkpoint:
                            details["metrics"]["loss"] = float(checkpoint["loss"])
                        if "accuracy" in checkpoint:
                            details["metrics"]["accuracy"] = float(checkpoint["accuracy"]) * 100
                except Exception as e:
                    print(f"读取PyTorch checkpoint失败: {e}")
        
        # 4. 如果没有找到详细信息，提供默认值
        if not details["metrics"]:
            details["metrics"] = {
                "accuracy": 0,
                "loss": 0,
                "precision": 0,
                "recall": 0,
                "f1_score": 0
            }
        
        if not details["params"]:
            details["params"] = {
                "epochs": 0,
                "batch_size": 0,
                "learning_rate": 0,
                "optimizer": "未知"
            }
            
    except Exception as e:
        print(f"提取训练详情失败: {str(e)}")
    
    return details
