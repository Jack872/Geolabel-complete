import request from '@/utils/request';

// 获取样本集的完整溯源数据（包括活动、实体、关系）
export async function reqGetDatasetProv(id) {
  return request(`/wegismarkapi//sampleSet/getProv/${id}`, {
    method: 'get',
    skipErrorHandler: true,
  });
}

/**
 * 获取样本集分页列表 (对应左侧列表)
 * @param params { pageNum, pageSize }
 */
export async function reqGetDatasetList(params) {
  return request('/wegismarkapi/sampleSet/list', {
    method: 'get',
    params,
    skipErrorHandler: true,
  });
}
