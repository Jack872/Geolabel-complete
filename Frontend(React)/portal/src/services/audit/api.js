// 引入 umi 封装的请求库
import request from '@/utils/request';

export async function submitAuditFail(params) {
  return request('/wegismarkapi/audit/submitAuditFail', {
    method: 'post',
    data: params,
  });
}

export async function submitAuditPass(params) {
  return request('/wegismarkapi/audit/submitAuditPass', {
    method: 'post',
    data: params,
  });
}
export async function getAuditInfo(taskId) {
  return request('/wegismarkapi/audit/getAuditInfo', {
    method: 'get',
    params: { taskId },
  });
}
