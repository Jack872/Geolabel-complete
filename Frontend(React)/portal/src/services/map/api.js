import request from '@/utils/request';

// 保存地图服务
export async function reqSaveService(data) {
  return request('/wegismarkapi/mark/saveMarkInfo', {
    method: 'POST',
    data,
  });
}
// 导出服务
export async function reqExportService(data) {
  return request('/wegismarkapi/maps/export', {
    method: 'POST',
    data,
  });
}
// 审核任务
export async function reqAuditTask(data) {
  return request('/wegismarkapi/task/auditTask', {
    method: 'POST',
    data,
  });
}
// 辅助功能
export async function reqAssistFunction(params) {
  return request('/wegismarkapi/mark/assistFunction', {
    method: 'POST',
    data: params,
  });
}
// 模型推理
export async function reqInferenceFunction(params) {
  return request('/wegismarkapi/mark/inferenceFunction', {
    method: 'POST',
    data: params,
  });
}
export async function reqGetModelList(params) {
  return request('/wegismarkapi/mark/getModelList', {
    method: 'POST',
    data: params,
  });
}
//更新样本
export async function reqUqdateLabel(params) {
  return request('/wegismarkapi/mark/update_label', {
    method: 'POST',
    data: params,
  });
}

// 多边形切分
export async function reqSplitPolygon(params) {
  return request('/wegismarkapi/mark/geometry/split', {
    method: 'POST',
    data: params,
  });
}

// 两多边形并集
export async function reqUnionPolygons(params) {
  return request('/wegismarkapi/mark/geometry/union', {
    method: 'POST',
    data: params,
  });
}
// 上传SHP文件
export async function reqUploadShp(body) {
  return request('/wegismarkapi/maps/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    data: body,
  });
}
// 获取模型训练详情
export async function reqGetModelTrainDetails(params) {
  return request('/wegismarkapi/model/getModelTrainDetails', {
    method: 'GET',
    params,
  });
}

// 上传本地图片到Python后端（无坐标系任务）
export async function reqUploadLocalImage(formData) {
  return request('/pythonapi/uploadLocalImage', {
    method: 'POST',
    data: formData,
    requestType: 'form',
  });
}
