import request from '@/utils/request';
import { reqGetDatasetList, reqGetDatasetProv } from '@/services/prov/api';
import { getModels } from '@/pages/modelManage/service';

export async function reqGetQualitySampleSets(params = { pageNum: 1, pageSize: 100 }) {
  const res = await reqGetDatasetList(params);
  const records = Array.isArray(res?.data?.records)
    ? res.data.records
    : Array.isArray(res?.data?.list)
      ? res.data.list
      : [];
  return {
    ...res,
    records,
    total: res?.data?.total || records.length || 0,
  };
}

export async function reqGetQualitySampleSetProv(sampleSetId) {
  const res = await reqGetDatasetProv(sampleSetId);
  return {
    ...res,
    data: {
      activities: res?.data?.activities || [],
      entities: res?.data?.entities || [],
      relations: res?.data?.relations || [],
      agents: res?.data?.agents || [],
    },
  };
}

export async function reqGetQualityProfileTemplates(params = {}) {
  return request('/wegismarkapi/quality/profile/list', {
    method: 'GET',
    params,
    skipErrorHandler: true,
  });
}

export async function listQualityProfiles(params = {}) {
  return request('/wegismarkapi/quality/profiles', {
    method: 'GET',
    params,
    skipErrorHandler: true,
  });
}

export async function reqGetQualityProfileDetail(id) {
  return request(`/wegismarkapi/quality/profile/${id}`, {
    method: 'GET',
    skipErrorHandler: true,
  });
}

export async function getQualityProfileDetail(id) {
  return request(`/wegismarkapi/quality/profiles/${id}`, {
    method: 'GET',
    skipErrorHandler: true,
  });
}

export async function reqSaveQualityProfileDraft(data) {
  return request('/wegismarkapi/quality/profile/save', {
    method: 'POST',
    data,
    skipErrorHandler: true,
  });
}

export async function saveQualityProfile(data) {
  return request('/wegismarkapi/quality/profile', {
    method: 'POST',
    data,
    skipErrorHandler: true,
  });
}

export async function updateQualityProfile(id, data) {
  return request(`/wegismarkapi/quality/profile/${id}`, {
    method: 'PUT',
    data,
    skipErrorHandler: true,
  });
}

export async function reqGetQualityDimensionTemplate() {
  return request('/wegismarkapi/quality/dimension-template', {
    method: 'GET',
    skipErrorHandler: true,
  });
}

export async function reqRunQualityEvaluation(data) {
  return request('/wegismarkapi/quality/evaluate', {
    method: 'POST',
    data,
    skipErrorHandler: true,
  });
}

export async function reqSubmitQualityEvaluation(data) {
  return request('/wegismarkapi/quality/evaluate/submit', {
    method: 'POST',
    data,
    skipErrorHandler: true,
  });
}

export async function runQualityEvaluation(data) {
  return request('/wegismarkapi/quality/evaluation/run', {
    method: 'POST',
    data,
    skipErrorHandler: true,
  });
}

export async function submitQualityEvaluation(data) {
  return request('/wegismarkapi/quality/evaluation/submit', {
    method: 'POST',
    data,
    skipErrorHandler: true,
  });
}

export async function reqGetQualityEvaluationJob(jobId) {
  return request(`/wegismarkapi/quality/evaluate/job/${jobId}`, {
    method: 'GET',
    skipErrorHandler: true,
  });
}

export async function reqGetQualityEvaluationJobResult(jobId) {
  return request(`/wegismarkapi/quality/evaluate/job/${jobId}/result`, {
    method: 'GET',
    skipErrorHandler: true,
  });
}

export async function getQualityEvaluationDetail(jobId) {
  return request(`/wegismarkapi/quality/evaluation/${jobId}`, {
    method: 'GET',
    skipErrorHandler: true,
  });
}

export async function reqGetQualityModels(userId, taskType) {
  return getModels(userId, taskType);
}

export async function reqGetQualityReport(reportId) {
  return request(`/wegismarkapi/quality/report/${reportId}`, {
    method: 'GET',
    skipErrorHandler: true,
  });
}

export async function reqGetQualityReportHtml(reportId) {
  const response = await fetch(`/wegismarkapi/quality/report/${reportId}/html`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('获取HTML报告失败');
  }
  return response.text();
}

/**
 * 参考模型预览样本列表（接口预留）
 * 约定返回 data.records:
 * [{ id, name, sourceImageUrl, resultImageUrl, overlayType, overlayData, confidenceMean }]
 */
export async function reqGetQualityReferencePreviewList(params) {
  return request('/wegismarkapi/quality/reference/preview/list', {
    method: 'GET',
    params,
    skipErrorHandler: true,
  });
}

/**
 * 参考模型预览样本详情（接口预留）
 * 约定返回 data:
 * { id, name, sourceImageUrl, resultImageUrl, overlayType, overlayData, confidenceMean }
 */
export async function reqGetQualityReferencePreviewDetail(previewId, params) {
  return request(`/wegismarkapi/quality/reference/preview/${previewId}`, {
    method: 'GET',
    params,
    skipErrorHandler: true,
  });
}

export async function reqRunQualityReference(data) {
  return request('/wegismarkapi/quality/reference/run', {
    method: 'POST',
    data,
    skipErrorHandler: true,
  });
}
