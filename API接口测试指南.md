# API接口测试指南

## 🔗 新增接口：获取模型训练详情

### 接口信息
- **路径**: `http://localhost:5000/getModelTrainDetails`
- **方法**: POST
- **描述**: 获取指定模型的训练详情和参数
- **后端**: Python FastAPI (直接调用)

---

## 📝 请求示例

### 请求URL
```
POST http://localhost:5000/getModelTrainDetails
```

### 请求头
```
Content-Type: application/json
```

### 请求体
```json
{
  "model_id": 123,
  "user_id": 10
}
```

### 参数说明
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| model_id | Integer | 是 | 模型ID |
| user_id | Integer | 是 | 用户ID（用于权限验证） |

---

## ✅ 成功响应

### 响应示例
```json
{
  "code": 200,
  "success": true,
  "data": {
    "modelId": 123,
    "modelName": "YOLO目标检测模型",
    "modelDes": "用于检测遥感影像中的建筑物",
    "taskType": "目标检测",
    "modelType": "yolo",
    "inputNum": 3,
    "outputNum": 5,
    "mapping": "通道 0 对应类别 建筑物; 通道 1 对应类别 道路; 通道 2 对应类别 植被",
    "path": "/path/to/model/best.pt",
    "userId": 10,
    "createTime": "2024-01-01 12:00:00",
    "status": "completed",
    "metrics": {
      "accuracy": 95.5,
      "loss": 0.123,
      "precision": 94.2,
      "recall": 96.1,
      "f1_score": 95.1,
      "iou": 88.5,
      "mAP50": 92.3,
      "mAP50-95": 87.6
    },
    "params": {
      "epochs": 150,
      "batch_size": 32,
      "learning_rate": 0.001,
      "optimizer": "Adam",
      "img_size": 640,
      "conf_threshold": 0.3
    }
  },
  "message": "获取模型详情成功"
}
```

### 响应字段说明

#### 基本信息
| 字段名 | 类型 | 说明 |
|--------|------|------|
| modelId | Integer | 模型ID |
| modelName | String | 模型名称 |
| modelDes | String | 模型描述 |
| taskType | String | 任务类型（目标检测/地物分类） |
| modelType | String | 模型类型（yolo/unet/fast_scnn等） |
| inputNum | Integer | 输入通道数 |
| outputNum | Integer | 输出通道数 |
| mapping | String | 类别映射信息 |
| path | String | 模型文件路径 |
| userId | Integer | 所属用户ID |
| createTime | String | 创建时间 |
| status | String | 训练状态 |

#### 训练指标 (metrics)
| 字段名 | 类型 | 说明 | 单位 |
|--------|------|------|------|
| accuracy | Float | 准确率 | % |
| loss | Float | 损失值 | - |
| precision | Float | 精确率 | % |
| recall | Float | 召回率 | % |
| f1_score | Float | F1分数 | % |
| iou | Float | IoU（交并比） | % |
| mAP50 | Float | mAP@0.5（仅YOLO） | % |
| mAP50-95 | Float | mAP@0.5:0.95（仅YOLO） | % |

#### 训练参数 (params)
| 字段名 | 类型 | 说明 |
|--------|------|------|
| epochs | Integer | 训练轮数 |
| batch_size | Integer | 批次大小 |
| learning_rate | Float | 学习率 |
| optimizer | String | 优化器 |
| img_size | Integer | 图像尺寸 |
| conf_threshold | Float | 置信度阈值 |

---

## ❌ 错误响应

### 1. 参数格式错误
```json
{
  "code": 400,
  "success": false,
  "message": "无效的参数格式"
}
```

### 2. 模型不存在或无权访问
```json
{
  "code": 404,
  "success": false,
  "message": "模型不存在或无权访问"
}
```

### 3. 服务器错误
```json
{
  "code": 500,
  "success": false,
  "message": "获取模型详情失败: [错误详情]"
}
```

---

## 🧪 测试步骤

### 使用Postman测试

1. **创建新请求**
   - 方法：POST
   - URL：`http://localhost:5000/getModelTrainDetails`

2. **设置请求头**
   ```
   Content-Type: application/json
   ```

3. **设置请求体**
   ```json
   {
     "model_id": 1,
     "user_id": 10
   }
   ```
   > 注意：将 model_id 和 user_id 替换为实际的值

4. **发送请求**
   - 点击 Send 按钮
   - 查看响应结果

### 使用curl测试

```bash
curl -X POST http://localhost:5000/getModelTrainDetails \
  -H "Content-Type: application/json" \
  -d '{
    "model_id": 1,
    "user_id": 10
  }'
```

### 使用JavaScript测试

```javascript
fetch('http://localhost:5000/getModelTrainDetails', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model_id: 1,
    user_id: 10
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

---

## 🔍 前端集成示例

### React组件中使用

```javascript
import { reqGetModelTrainDetails } from '@/services/map/api';

// 在组件中调用
const fetchModelDetails = async (modelId, userId) => {
  try {
    const response = await reqGetModelTrainDetails({
      model_id: modelId,
      user_id: userId
    });
    
    if (response && response.code === 200) {
      console.log('模型详情:', response.data);
      // 处理数据...
    } else {
      console.error('获取失败:', response.message);
    }
  } catch (error) {
    console.error('请求异常:', error);
  }
};
```

---

## 📊 数据流程

```
前端 (React)
    ↓ POST http://localhost:5000/getModelTrainDetails
Python FastAPI (main.py)
    ↓ 调用 get_model_details.py
数据库查询 + 文件读取
    ↓ 返回模型详情
Python FastAPI
    ↓ 返回JSON响应
前端展示
```

> **注意**：前端直接调用Python FastAPI后端，不经过Spring Boot

---

## ⚠️ 注意事项

1. **权限验证**
   - 接口会验证用户是否有权访问该模型
   - 只能查看自己创建的模型

2. **数据完整性**
   - 如果模型没有训练日志文件，部分指标可能为0或默认值
   - 建议在训练时保存完整的训练日志

3. **性能考虑**
   - 接口会读取模型文件和日志文件
   - 对于大型模型文件，响应时间可能较长

4. **错误处理**
   - 前端应该处理所有可能的错误响应
   - 建议添加加载状态和错误提示

---

## 🔧 故障排查

### 问题1：CORS跨域错误
**原因**：前端直接调用Python后端，可能遇到跨域问题
**解决**：
- 在Python FastAPI中配置CORS
- 添加以下代码到 `main.py`：
```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://localhost:3000"],  # 前端地址
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 问题2：连接被拒绝
**原因**：Python FastAPI服务未启动
**解决**：
- 启动Python服务：`python -m uvicorn main:app --host 0.0.0.0 --port 5000`
- 确认端口5000未被占用

### 问题3：500 Internal Server Error
**原因**：数据库连接失败或文件不存在
**解决**：
- 检查数据库连接配置
- 查看Python后端日志
- 确认模型文件路径正确

### 问题3：返回空数据
**原因**：模型没有训练日志或文件不存在
**解决**：
- 检查模型文件路径是否正确
- 确认训练时是否保存了日志文件
- 查看Python后端日志

---

## 📚 相关文档

- [模型管理和训练页面优化总结.md](./模型管理和训练页面优化总结.md)
- Spring Boot API文档
- Python FastAPI文档

---

**更新时间**：2024年
**版本**：v1.0
