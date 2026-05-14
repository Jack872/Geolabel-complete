/**
 * 在生产环境 代理是无法生效的，所以这里没有生产环境的配置
 * -------------------------------
 * The agent cannot take effect in the production environment
 * so there is no configuration of the production environment
 * For details, please see
 * https://pro.ant.design/docs/deploy
 */

const GEOSERVER_HOST = process.env.REACT_APP_GEOSERVER_HOST || 'localhost';
const GEOSERVER_PORT = process.env.REACT_APP_GEOSERVER_PORT || '8080';
const GEOSERVER_PROTOCOL = process.env.REACT_APP_GEOSERVER_PROTOCOL || 'http';

export default {
  dev: {
    // 配置代理
    '/api/': {
      target: 'http://localhost:5000',
      changeOrigin: true,
      pathRewrite: {
        '^/api': ' ',
      },
    },
    '/api1/': {
      target: 'http://localhost:5001',
      changeOrigin: true,
      pathRewrite: {
        '^/api1': ' ',
      },
    },
    // 后端接口 - Java后端
    '/wegismarkapi/': {
      target: 'http://localhost:1290',
      changeOrigin: true,
      pathRewrite: {
        '^/wegismarkapi': '',
      },
    },
    // Node.js后端接口
    '/nodeapi/': {
      target: 'http://localhost:3000',
      changeOrigin: true,
      pathRewrite: {
        '^/nodeapi': '',
      },
    },
    // geoserver接口 — 与 src/config.js 统一用环境变量
    '/api3/': {
      target: `${GEOSERVER_PROTOCOL}://${GEOSERVER_HOST}:${GEOSERVER_PORT}/geoserver/rest`,
      changeOrigin: true,
      pathRewrite: {
        '^/api3': ' ',
      },
    },
  },
  test: {
    '/api/': {
      target: 'https://preview.pro.ant.design',
      changeOrigin: true,
      pathRewrite: {
        '^': '',
      },
    },
  },
  pre: {
    '/api/': {
      target: 'your pre url',
      changeOrigin: true,
      pathRewrite: {
        '^': '',
      },
    },
  },
};
