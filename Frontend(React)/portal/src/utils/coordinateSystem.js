/**
 * 坐标系管理工具
 * 提供坐标系的动态获取和转换功能
 */

// 常用坐标系配置
export const COORDINATE_SYSTEMS = {
  'NONE': {
    label: '无坐标系 (NONE)',
    description: '像素坐标模式，不包含地理参考信息',
    type: 'pixel'
  },
  'EPSG:4326': {
    label: 'WGS84 (EPSG:4326)',
    description: '世界大地坐标系，GPS常用',
    type: 'geographic'
  },
  'EPSG:3857': {
    label: 'Web Mercator (EPSG:3857)',
    description: '网络墨卡托投影，Web地图常用',
    type: 'projected'
  },
  'EPSG:3301': {
    label: 'Estonian Coordinate System (EPSG:3301)',
    description: '爱沙尼亚坐标系',
    type: 'projected'
  },
  'EPSG:2154': {
    label: 'RGF93 / Lambert-93 (EPSG:2154)',
    description: '法国Lambert-93投影',
    type: 'projected'
  },
  'EPSG:32633': {
    label: 'WGS84 / UTM zone 33N (EPSG:32633)',
    description: 'UTM 33N投影',
    type: 'projected'
  },
  'EPSG:32634': {
    label: 'WGS84 / UTM zone 34N (EPSG:32634)',
    description: 'UTM 34N投影',
    type: 'projected'
  },
  'EPSG:25832': {
    label: 'ETRS89 / UTM zone 32N (EPSG:25832)',
    description: 'ETRS89 UTM 32N',
    type: 'projected'
  },
  'EPSG:25833': {
    label: 'ETRS89 / UTM zone 33N (EPSG:25833)',
    description: 'ETRS89 UTM 33N',
    type: 'projected'
  }
};

// 默认坐标系
export const DEFAULT_CRS = 'EPSG:3857';

/**
 * 获取坐标系信息
 * @param {string} crs 坐标系代码
 * @returns {object} 坐标系信息
 */
export const getCoordinateSystemInfo = (crs) => {
  return COORDINATE_SYSTEMS[crs] || {
    label: crs,
    description: '自定义坐标系',
    type: 'unknown'
  };
};

/**
 * 验证坐标系代码格式
 * @param {string} crs 坐标系代码
 * @returns {boolean} 是否有效
 */
export const isValidCoordinateSystem = (crs) => {
  if (!crs || typeof crs !== 'string') return false;
  if (crs === 'NONE' || crs === 'UNKNOWN') return true;
  
  // 支持 EPSG:XXXX 和 ESRI:XXXX 格式
  const pattern = /^(EPSG|ESRI):\d+$/i;
  return pattern.test(crs);
};

/**
 * 从任务信息中获取坐标系
 * @param {object} taskInfo 任务信息
 * @returns {string} 坐标系代码
 */
export const getCoordinateSystemFromTask = (taskInfo) => {
  if (!taskInfo) return DEFAULT_CRS;
  
  // 优先从任务信息中获取
  if (taskInfo.coordinateSystem && isValidCoordinateSystem(taskInfo.coordinateSystem)) {
    return taskInfo.coordinateSystem;
  }
  
  // 从服务器信息中获取
  if (taskInfo.server && taskInfo.server.coordinateSystem) {
    return taskInfo.server.coordinateSystem;
  }
  
  // 从数据集信息中获取
  if (taskInfo.dataset && taskInfo.dataset.crs) {
    return taskInfo.dataset.crs;
  }
  
  return DEFAULT_CRS;
};

/**
 * 获取坐标系选项列表（用于下拉框）
 * @returns {array} 选项列表
 */
export const getCoordinateSystemOptions = () => {
  return Object.entries(COORDINATE_SYSTEMS).map(([value, info]) => ({
    value,
    label: info.label,
    description: info.description,
    type: info.type
  }));
};

/**
 * 根据地区推荐坐标系
 * @param {string} region 地区代码
 * @returns {string} 推荐的坐标系
 */
export const getRecommendedCRS = (region) => {
  const recommendations = {
    'CN': 'EPSG:4326',     // 中国
    'US': 'EPSG:4326',     // 美国
    'EU': 'EPSG:3857',     // 欧洲
    'EE': 'EPSG:3301',     // 爱沙尼亚
    'FR': 'EPSG:2154',     // 法国
    'DE': 'EPSG:25832',    // 德国
  };
  
  return recommendations[region] || DEFAULT_CRS;
};

/**
 * 格式化坐标系显示文本
 * @param {string} crs 坐标系代码
 * @param {boolean} showDescription 是否显示描述
 * @returns {string} 格式化后的文本
 */
export const formatCoordinateSystem = (crs, showDescription = false) => {
  const info = getCoordinateSystemInfo(crs);
  
  if (showDescription) {
    return `${info.label} - ${info.description}`;
  }
  
  return info.label;
};

/**
 * 检查两个坐标系是否兼容
 * @param {string} sourceCrs 源坐标系
 * @param {string} targetCrs 目标坐标系
 * @returns {boolean} 是否兼容
 */
export const areCoordinateSystemsCompatible = (sourceCrs, targetCrs) => {
  if (!sourceCrs || !targetCrs) return false;
  if (sourceCrs === targetCrs) return true;
  
  // 检查是否都是有效的坐标系
  return isValidCoordinateSystem(sourceCrs) && isValidCoordinateSystem(targetCrs);
};

/**
 * 获取坐标系转换参数
 * @param {string} sourceCrs 源坐标系
 * @param {string} targetCrs 目标坐标系
 * @returns {object} 转换参数
 */
export const getTransformationParams = (sourceCrs, targetCrs) => {
  return {
    dataProjection: sourceCrs || DEFAULT_CRS,
    featureProjection: targetCrs || 'EPSG:3857' // 地图显示坐标系
  };
};
