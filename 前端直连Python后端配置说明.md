# 前端直连Python后端配置说明

## 📋 架构说明

### 原架构（已废弃）
```
前端 → Spring Boot → Python FastAPI → 数据库
```

### 新架构（当前使用）
```
前端 → Python FastAPI → 数据库
     ↓
Spring Boot（其他功能）
```

**优势**：
- 减少中间层，提高响应速度
- 降低系统复杂度
- 减少数据转换开销
- 更容易调试和维护

---

## 🔧 配置步骤

### 1. Python FastAPI配置

#### 添加CORS支持
在 `Backend(FastAPI)/main.py` 中已添加：

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # React开发服务器
        "http://localhost:8000",  # Umi开发服务器
        "http://localhost:8001",  # 其他可能的前端端口
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:8001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

#### 启动服务
```bash
cd Backend(FastAPI)
python -m uvicorn main:app --host 0.0.0.0 --port 5000 --reload
```

**验证**：
- 访问 http://localhost:5000/docs
- 确认 `/getModelTrainDetails` 接口存在

---

### 2. 前端配置

#### API调用配置
在 `Frontend(React)/portal/src/services/map/api.js` 中：

```javascript
// 直接调用Python后端
export async function reqGetModelTrainDetails(params) {
  return request('http://localhost:5000/getModelTrainDetails', {
    method: 'POST',
    data: params,
    skipErrorHandler: true,
  });
}
```

#### 使用示例
```javascript
import { reqGetModelTrainDetails } from '@/services/map/api';

const fetchDetails = async () => {
  const response = await reqGetModelTrainDetails({
    model_id: 123,
    user_id: 10
  });
  
  if (response && response.code === 200) {
    console.log('模型详情:', response.data);
  }
};
```

---

### 3. Spring Boot配置（可选）

Spring Boot中已移除 `/mark/getModelTrainDetails` 接口，因为前端直接调用Python后端。

如果需要通过Spring Boot转发（不推荐），可以保留该接口。

---

## 🌐 网络配置

### 开发环境

#### 端口分配
- **前端**: http://localhost:8000 (Umi)
- **Spring Boot**: http://localhost:1290
- **Python FastAPI**: http://localhost:5000

#### 防火墙规则
确保以下端口可访问：
- 8000 (前端)
- 1290 (Spring Boot)
- 5000 (Python FastAPI)

### 生产环境

#### 使用Nginx反向代理
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /path/to/frontend/build;
        try_files $uri /index.html;
    }

    # Spring Boot API
    location /wegismarkapi/ {
        proxy_pass http://localhost:1290;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Python FastAPI API
    location /api/python/ {
        proxy_pass http://localhost:5000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

#### 前端API配置（生产环境）
```javascript
// 根据环境变量选择API地址
const PYTHON_API_BASE = process.env.NODE_ENV === 'production' 
  ? '/api/python'  // 生产环境通过Nginx代理
  : 'http://localhost:5000';  // 开发环境直连

export async function reqGetModelTrainDetails(params) {
  return request(`${PYTHON_API_BASE}/getModelTrainDetails`, {
    method: 'POST',
    data: params,
    skipErrorHandler: true,
  });
}
```

---

## 🔒 安全配置

### 1. CORS安全
生产环境应限制允许的源：

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://your-domain.com",  # 只允许你的域名
    ],
    allow_credentials=True,
    allow_methods=["POST"],  # 只允许需要的方法
    allow_headers=["Content-Type"],  # 只允许需要的头
)
```

### 2. 请求验证
添加身份验证中间件：

```python
from fastapi import Header, HTTPException

async def verify_token(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未授权")
    # 验证token逻辑
    return True

@app.post("/getModelTrainDetails", dependencies=[Depends(verify_token)])
async def get_model_train_details_endpoint(request: GetModelTrainDetailsRequest):
    # ...
```

### 3. 速率限制
使用slowapi限制请求频率：

```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.post("/getModelTrainDetails")
@limiter.limit("10/minute")  # 每分钟最多10次请求
async def get_model_train_details_endpoint(request: Request, ...):
    # ...
```

---

## 🧪 测试验证

### 1. 跨域测试
在浏览器控制台执行：

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
.then(r => r.json())
.then(d => console.log(d))
.catch(e => console.error(e));
```

**预期结果**：
- 无CORS错误
- 返回模型详情数据

### 2. 性能测试
使用Apache Bench测试：

```bash
# 测试并发性能
ab -n 100 -c 10 -p request.json -T application/json \
  http://localhost:5000/getModelTrainDetails
```

request.json内容：
```json
{
  "model_id": 1,
  "user_id": 10
}
```

### 3. 错误处理测试
测试各种错误情况：

```javascript
// 测试1：无效的model_id
fetch('http://localhost:5000/getModelTrainDetails', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({model_id: 99999, user_id: 10})
});

// 测试2：缺少参数
fetch('http://localhost:5000/getModelTrainDetails', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({model_id: 1})
});

// 测试3：无权访问
fetch('http://localhost:5000/getModelTrainDetails', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({model_id: 1, user_id: 999})
});
```

---

## 📊 监控和日志

### Python FastAPI日志配置

```python
import logging

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('fastapi.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)

@app.post("/getModelTrainDetails")
async def get_model_train_details_endpoint(request: GetModelTrainDetailsRequest):
    logger.info(f"收到请求: model_id={request.model_id}, user_id={request.user_id}")
    try:
        result = get_model_train_details(request.model_id, request.user_id)
        logger.info(f"请求成功: model_id={request.model_id}")
        return result
    except Exception as e:
        logger.error(f"请求失败: {str(e)}", exc_info=True)
        raise
```

### 前端错误监控

```javascript
export async function reqGetModelTrainDetails(params) {
  const startTime = Date.now();
  
  try {
    const response = await request('http://localhost:5000/getModelTrainDetails', {
      method: 'POST',
      data: params,
      skipErrorHandler: true,
    });
    
    const duration = Date.now() - startTime;
    console.log(`API调用成功，耗时: ${duration}ms`);
    
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`API调用失败，耗时: ${duration}ms`, error);
    
    // 发送错误到监控系统
    // sendErrorToMonitoring(error);
    
    throw error;
  }
}
```

---

## 🔄 回滚方案

如果直连方案出现问题，可以快速回滚到通过Spring Boot转发的方案：

### 1. 恢复前端配置
```javascript
// 改回通过Spring Boot
export async function reqGetModelTrainDetails(params) {
  return request('/wegismarkapi/mark/getModelTrainDetails', {
    method: 'POST',
    data: params,
    skipErrorHandler: true,
  });
}
```

### 2. 恢复Spring Boot接口
在MarkController中添加转发接口（代码已在之前版本中）

### 3. 重启服务
```bash
# 重启前端
npm start

# 重启Spring Boot
./mvnw spring-boot:run
```

---

## ❓ 常见问题

### Q1: CORS错误怎么办？
**A**: 检查Python FastAPI的CORS配置，确保前端地址在允许列表中。

### Q2: 连接超时怎么办？
**A**: 
1. 检查Python服务是否启动
2. 检查防火墙设置
3. 增加请求超时时间

### Q3: 生产环境如何配置？
**A**: 使用Nginx反向代理，统一通过域名访问，避免跨域问题。

### Q4: 如何调试网络请求？
**A**: 
1. 使用浏览器开发者工具的Network标签
2. 查看Python FastAPI日志
3. 使用Postman测试接口

---

## 📚 相关文档

- [API接口测试指南.md](./API接口测试指南.md)
- [模型管理和训练页面优化总结.md](./模型管理和训练页面优化总结.md)
- [部署检查清单.md](./部署检查清单.md)

---

**更新时间**：2024年
**版本**：v2.0
