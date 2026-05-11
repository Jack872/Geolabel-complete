import request from '@/utils/request';

// 初始化分片上传，返回 uploadId
export async function initMultipart(filename) {
  return request('/wegismarkapi/files/initMultipart', {
    method: 'get',  // 后端是 @GetMapping
    params: { filename },   // 使用 params 而不是 data
  });
}

export async function uploadChunk(filename, uploadId, partNumber, blob) {
  return request('/wegismarkapi/files/uploadChunk', {
    method: 'POST',
    params: {
      filename,
      uploadId,
      partNumber,
    },
    data: blob,                     // 二进制数据
    requestType: 'blob',            // 关键：告诉 umi 这是二进制流
    responseType: 'text',           // 后端返回 ETag 或 success 字符串
    headers: {
      'Content-Type': 'application/octet-stream',
    },
  });
}

// 完成分片上传，通知后端合并
export async function mergeMultipart(data) {
  return request('/wegismarkapi/files/mergeMultipart', {
    method: 'post',
    data: data,                        // 请求体
  });
}

//获得数据集下的影像
export async function reqGetfileData(params) {
  return request('/wegismarkapi/files/getFilesData', {
    method: 'get',
    params,
  });
}

// 删
export async function reqDeleteFileData(name) {
  return request(`/wegismarkapi/files/deleteFile/${name}`, {
    method: 'delete',
  });
}

// 按 fileId 删除（推荐，避免同名误删）
export async function reqDeleteFileDataById(fileId) {
  return request(`/wegismarkapi/files/deleteFileById/${fileId}`, {
    method: 'delete',
  });
}
//改
export async function reqEditfileData(data) {
  return request(`/wegismarkapi/files/updateFile`, {
    method: 'put',
    data,
  });
}

// 批量发布影像服务
export async function reqPublishSet(data) {
  return request('/wegismarkapi/server/publishSet', {
    method: 'post',
    data,
  });
}
