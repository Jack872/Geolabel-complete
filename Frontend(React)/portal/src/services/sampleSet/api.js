import { request } from 'umi';

// 获取样本集列表 (查询 sample_set 表)
export async function reqGetSampleSetList(params) {
  return request('/wegismarkapi/sampleSet/list', {
    method: 'GET',
    params,
  });
}

// 删除样本集
export async function reqDeleteSampleSet(ids) {
  return request(`/wegismarkapi/sampleSet/delete`, {
    method: 'POST', // 或者是 DELETE，取决于你后端的实现
    data: ids, // 通常传入 id 数组或单个 id
  });
}

// 下载样本集 (后端需要根据 format 参数决定打包内容)
export async function reqDownloadSampleSet(params) {
  return request('/wegismarkapi/sampleSet/download', {
    method: 'POST',
    data: params,
    responseType: 'blob', // 关键：处理 zip 文件流
  });
}

// 获取详情 (可选，如果列表页数据不全)
export async function reqGetSampleSetDetail(id) {
  return request('/wegismarkapi/sampleSet/info/${id}', {
    method: 'GET',
  });
}
//生成样本
export async function reqGenerateMergedDataset(params) {
  return request('/wegismarkapi/sampleSet/generateMergedDataset', {
    method: 'POST',
    data: params,
  });
}
// 获取切片预览列表
export async function reqGetSampleSliceList(params) {
  return request('/wegismarkapi/sampleSet/preview/list', {
    method: 'GET',
    params, // { id: 1, limit: 8 }
  });
}
