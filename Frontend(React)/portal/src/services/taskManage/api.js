//引入自定义请求库，方便权限管理
import request from '@/utils/request';
// 获取用户list
export async function reqGetTaskList(params = {}) {
  return request('/wegismarkapi/task/getTaskInfo', {
    method: 'GET',
    params,
  });
}
// 获取分配给当前用户的任务列表
export async function reqGetPersonalTaskList(params = {}) {
  return request('/wegismarkapi/task/getPersonalTaskList', {
    method: 'GET',
    params,
  });
}
// 新建任务
export async function reqNewTask(params) {
  return request('/wegismarkapi/task/publishTask', {
    method: 'post',
    data: params,
  });
}
// 删除任务
export async function reqDeleteTask(id) {
  return request(`/wegismarkapi/task/deleteTask/${id}`, {
    method: 'delete',
  });
}
// 修改任务
export async function reqEditTask(params) {
  console.log('发送编辑任务请求：', params);
  return request('/wegismarkapi/task/updateTask', {
    method: 'put',
    data: params,
    skipErrorHandler: true,
  });
}

// 开始标注请求标注地图服务地图（专用于标注页面）
export async function reqStartMark(params = {}) {
  return request(`/wegismarkapi/task/getMarkTaskDetail`, {
    method: 'get',
    params,
    skipErrorHandler: true,
    timeout: 6000,
  });
}
//用户提交任务
export async function reqSubmitTask(data) {
  return request(`/wegismarkapi/task/submitTask`, {
    method: 'post',
    data,
    skipErrorHandler: true,
    timeout: 6000,
  });
}

export async function reqFinishTaskItem(data) {
  return request('/wegismarkapi/task/item/finish', {
    method: 'post',
    data,
  });
}

export async function reqCancelFinishTaskItem(data) {
  return request('/wegismarkapi/task/item/cancelFinish', {
    method: 'post',
    data,
  });
}

export async function reqSubmitTaskItem(data) {
  return request('/wegismarkapi/task/item/submit', {
    method: 'post',
    data,
  });
}

export async function reqCancelSubmitTaskItem(data) {
  return request('/wegismarkapi/task/item/cancelSubmit', {
    method: 'post',
    data,
  });
}

export async function reqReviewTaskItem(data) {
  return request('/wegismarkapi/task/item/review', {
    method: 'post',
    data,
  });
}

// 批量训练任务
export async function reqBatchTrainTasks(params) {
  return request('/wegismarkapi/task/batchTrain', {
    method: 'POST',
    data: params,
    skipErrorHandler: true,
  });
}

// 批量推理任务
export async function reqBatchInferenceTasks(params) {
  return request('/wegismarkapi/task/batchInference', {
    method: 'POST',
    data: params,
    skipErrorHandler: true,
  });
}

// 创建本地图片任务（无坐标系）
export async function reqPublishLocalTask(params) {
  return request('/wegismarkapi/task/publishLocalTask', {
    method: 'POST',
    data: params,
  });
}

// 按影像集批量创建任务（自动识别 service/local）
export async function reqPublishTaskBySet(params) {
  return request('/wegismarkapi/task/publishTaskBySet', {
    method: 'POST',
    data: params,
  });
}

// 获取“按影像名称选择”的可选影像列表（包含服务影像和本地影像）
export async function reqGetSelectableImagesByName(params = {}) {
  return request('/wegismarkapi/task/getSelectableImagesByName', {
    method: 'GET',
    params,
  });
}

// 获取可选属性定义
export async function reqGetAttributeDefs(params = {}) {
  return request('/wegismarkapi/task/getAttributeDefs', {
    method: 'GET',
    params,
  });
}

// 获取任务类别属性配置
export async function reqGetTaskTypeAttributes(params = {}) {
  return request('/wegismarkapi/task/getTaskTypeAttributes', {
    method: 'GET',
    params,
  });
}

export class reqGetTaskInfo {
}

// 获取当前用户的任务 ID 列表（用于标注/审核页面上下任务导航）
export async function reqGetMyTaskIds(params = {}) {
  return request('/wegismarkapi/task/getPersonalTaskList', {
    method: 'GET',
    params: { pageSize: 1000, ...params },
  });
}
