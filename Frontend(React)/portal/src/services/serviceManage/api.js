//引入自定义请求库，方便权限管理
import request from '@/utils/request';
// 获取服务列表
export async function reqServiceList(params) {
  return request('/wegismarkapi/server/getServers', {
    method: 'get',
    // data: params,
    skipErrorHandler: true,
  });
}

// 获取按影像集名称分组的服务列表
export async function reqServiceListBySetName() {
  return request('/wegismarkapi/server/getServersBySetName', {
    method: 'get',
    skipErrorHandler: true,
  });
}

// 删除服务
export async function reqDeleteService(id) {
  return request(`/wegismarkapi/server/deleteServer/${id}`, {
    method: 'delete',
    skipErrorHandler: true,
  });
}

// 获取服务缩略图
export async function reqGetServerThumbnail(serverName) {
  return request(`/wegismarkapi/server/thumbnail/${serverName}`, {
    method: 'get',
    responseType: 'blob', // 返回二进制数据
    skipErrorHandler: true,
  });
}

// 发布服务
export async function PublishServer(data) {
  return request('/wegismarkapi/geoserver/publish', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
    },
    data,
  });
}
/**
 * 获取栅格图层元数据
 * @param {string} name 图层名
 */
export async function reqGetGeoServerInfo(name) {
  return request(`/wegismarkapi/geoserver/coverage/${name}`, {
    method: 'GET',
    skipErrorHandler: false, // 让全局错误处理生效
    // 不需要再传 Basic 头，后端会用服务账号去调 GeoServer
  });
}


//删除服务及所在的数据存储
export async function reqDelGeoserver(sername) {
  return request(`/api3/workspaces/LUU/coveragestores/${sername}?recurse=true`, {
    method: 'delete',
    // auth: { username: 'admin', password: 'geoserver' },
    headers: {
      Authorization: 'Basic ' + Buffer.from('admin' + ':' + 'geoserver').toString('base64'),
    },
    skipErrorHandler: true,
  });
}



