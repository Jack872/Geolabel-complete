// A highlighted block
/**
 * request 网络请求工具
 * 更详细的 api 文档: https://github.com/umijs/umi-request
 */
import { extend } from 'umi-request';
import { notification, message } from 'antd';
import { getLocale, formatMessage } from 'umi';
import { getCookie,setCookie,removeCookie } from '@/utils/cookie'
import {boolean} from "mockjs/src/mock/random/basic";

const codeMessage = {
  200: 'app.request.error.200',
  201: 'app.request.error.201',
  202: 'app.request.error.202',
  204: 'app.request.error.204',
  400: 'app.request.error.400',
  401: 'app.request.error.401',
  403: 'app.request.error.403',
  404: 'app.request.error.404',
  405: 'app.request.error.405',
  406: 'app.request.error.406',
  410: 'app.request.error.410',
  422: 'app.request.error.422',
  500: 'app.request.error.500',
  502: 'app.request.error.502',
  503: 'app.request.error.503',
  504: 'app.request.error.504',
};

const t = (id, values) => formatMessage({ id, defaultMessage: id }, values);

/**
 * 异常处理程序
 */
const errorHandler = error => {
  const { response } = error;

  if (response && response.status) {
    // 鉴权探测接口失败时跳过通知，由调用方静默处理
    if (response.url && response.url.includes('/user/currentState')) {
      return response;
    }
    const errorText = codeMessage[response.status] ? t(codeMessage[response.status]) : response.statusText;
    const { status, url } = response;
    notification.error({
      message: t('app.request.error.title', { status, url }),
      description: errorText,
    });
  }

  return response;
};
const request = extend({
  errorHandler,
  // 默认错误处理
  credentials: 'include', // 默认请求是否带上cookie

});

// 请求拦截器
request.interceptors.request.use((url, options) => {
  try {
    const localeHeader = getLocale() || 'zh-CN';
    const withLanguage = {
      ...(options.headers || {}),
      'Accept-Language': localeHeader,
    };
    // 如果接口是登录和注册放行
    if (url === '/wegismarkapi/user/login'||url === '/wegismarkapi/user/register') {
      return {
        url: `${url}`,
        options: { ...options, headers: withLanguage, interceptors: true },
      };
    } else {
      if (getCookie('TOKEN') == '' || getCookie('TOKEN') == null) {
        // 鉴权探测接口无 token 属正常，静默放行
        if (!url.includes('/user/currentState')) {
          message.error(t('app.request.token.missing'));
        }
        return {
          url: `${url}`,
          options: { ...options, headers: withLanguage, interceptors: true },
        };
      } else {
        //请求geoserver服务，header不需要token，避免被覆盖
        if (url.includes("api3")){
          return (
            {
              url: `${url}`,
              options: { ...options, headers: withLanguage, interceptors: true },
            }
          );
        }
        // 后端请求头添加token
        let TOKEN = getCookie('TOKEN');

        let headers = {
          ...withLanguage,
          'token': TOKEN
        };
        return (
          {
            url: `${url}`,
            options: { ...options, headers: headers,  interceptors: true },
          }
        );
      }
    }
  }catch (e){
    console.log("请求拦截报错"+e)
    return {
      url: `${url}`,
      options: { ...options, interceptors: true },
    };
  }
});

// 响应拦截器
request.interceptors.response.use(async response => {
  try {
    // 检查Content-Type是否为JSON
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await response.clone().json();
      if (data.message==="token过期"){
        removeCookie("TOKEN")
      }
      //登录响应
      if (data.data && data.data.token !== undefined){
        setCookie("TOKEN",data.data.token)
      }
    }
  }catch (e) {
    console.log("响应拦截报错"+e)
    // 不要阻止非JSON响应继续处理
  }finally {
    return response;
  }
});


export default request;
