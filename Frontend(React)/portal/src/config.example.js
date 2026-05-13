/**
 * 应用配置文件（示例）
 *
 * 首次使用请复制此文件为 config.js，然后根据本地环境修改：
 *   cp config.example.js config.js
 *
 * 也支持通过环境变量覆盖：
 *   REACT_APP_GEOSERVER_PORT=8081 npm start
 */

// GeoServer 地址（协议 + 主机 + 端口）
// 根据本地 GeoServer 端口修改: 默认为 8080，部分队友为 8081
const GEOSERVER_HOST = process.env.REACT_APP_GEOSERVER_HOST || 'localhost';
const GEOSERVER_PORT = process.env.REACT_APP_GEOSERVER_PORT || '8080';
const GEOSERVER_PROTOCOL = process.env.REACT_APP_GEOSERVER_PROTOCOL || 'http';

export const GEOSERVER_URL = `${GEOSERVER_PROTOCOL}://${GEOSERVER_HOST}:${GEOSERVER_PORT}`;

// GeoServer TMS 基础 URL（瓦片服务）
export const GEOSERVER_TMS_BASE = `${GEOSERVER_URL}/geoserver/gwc/service/tms`;
