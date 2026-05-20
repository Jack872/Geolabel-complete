/**
 * 应用配置文件（本地个人配置，已加入 .gitignore 不同步到仓库）
 *
 * 首次使用请复制 config.example.js 为 config.js 后修改：
 *   cp config.example.js config.js
 */

const GEOSERVER_HOST = process.env.REACT_APP_GEOSERVER_HOST || 'localhost';
const GEOSERVER_PORT = process.env.REACT_APP_GEOSERVER_PORT || '8080';
const GEOSERVER_PROTOCOL = process.env.REACT_APP_GEOSERVER_PROTOCOL || 'http';

export const GEOSERVER_URL = `${GEOSERVER_PROTOCOL}://${GEOSERVER_HOST}:${GEOSERVER_PORT}`;

export const GEOSERVER_TMS_BASE = `${GEOSERVER_URL}/geoserver/gwc/service/tms`;
