const STORAGE_PREFIX = 'task_annotation_schema_';
const schemaMemoryCache = new Map();

export const ANNOTATION_CATEGORY_OPTIONS = [
  { label: '建筑物', value: 'building' },
  { label: '道路', value: 'road' },
  { label: '汽车', value: 'car' },
];

export const CATEGORY_FIELD_TEMPLATES = {
  building: {
    categoryKey: 'building',
    displayName: '建筑物',
    fields: [
      { key: 'buildingType', label: '建筑类型', type: 'enum', required: true, options: ['住宅', '商业', '工业', '公共'] },
      { key: 'floors', label: '层数', type: 'number', required: false, min: 1, max: 300 },
      { key: 'heightMeter', label: '高度(m)', type: 'number', required: false, min: 0, max: 1000 },
      { key: 'material', label: '主要材质', type: 'enum', required: false, options: ['钢筋混凝土', '钢结构', '砖混', '其他'] },
      { key: 'occlusion', label: '遮挡程度', type: 'enum', required: false, options: ['无', '轻微', '中等', '严重'] },
    ],
  },
  road: {
    categoryKey: 'road',
    displayName: '道路',
    fields: [
      { key: 'roadType', label: '道路类型', type: 'enum', required: true, options: ['主干道', '次干道', '支路', '乡村道路', '匝道'] },
      { key: 'laneCount', label: '车道数', type: 'number', required: false, min: 1, max: 20 },
      { key: 'surface', label: '路面材质', type: 'enum', required: false, options: ['沥青', '水泥', '砂石', '土路', '其他'] },
      { key: 'roadWidth', label: '道路宽度(m)', type: 'number', required: false, min: 0, max: 200 },
      { key: 'direction', label: '通行方向', type: 'enum', required: false, options: ['双向', '单向', '未知'] },
    ],
  },
  car: {
    categoryKey: 'car',
    displayName: '汽车',
    fields: [
      { key: 'vehicleType', label: '车辆类型', type: 'enum', required: true, options: ['轿车', 'SUV', '货车', '客车', '工程车', '其他'] },
      { key: 'color', label: '车辆颜色', type: 'string', required: false, maxLength: 30 },
      { key: 'parkingState', label: '停靠状态', type: 'enum', required: false, options: ['行驶', '停放', '未知'] },
      { key: 'occlusion', label: '遮挡程度', type: 'enum', required: false, options: ['无', '轻微', '中等', '严重'] },
      { key: 'heading', label: '航向角(°)', type: 'number', required: false, min: 0, max: 359 },
    ],
  },
};

const deepClone = (value) => JSON.parse(JSON.stringify(value));

export const buildAnnotationSchema = (categoryKeys = []) => {
  const categories = {};
  categoryKeys.forEach((key) => {
    const template = CATEGORY_FIELD_TEMPLATES[key];
    if (template) {
      categories[key] = deepClone(template);
    }
  });
  return {
    version: 1,
    categories,
  };
};

export const inferCategoryByTypeName = (typeName = '') => {
  const name = String(typeName || '').toLowerCase();
  if (name.includes('建筑') || name.includes('building')) return 'building';
  if (name.includes('道路') || name.includes('road')) return 'road';
  if (name.includes('汽车') || name.includes('车辆') || name.includes('car') || name.includes('vehicle')) return 'car';
  return null;
};

export const getCategoryConfigForType = (schema, typeName) => {
  if (!schema || typeof schema !== 'object') return null;
  const categories = schema.categories || {};
  const inferred = inferCategoryByTypeName(typeName);
  if (!inferred) return null;
  return categories[inferred] || null;
};

const parseMaybeJson = (raw) => {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
};

export const getTaskSchemaCache = (taskId) => {
  if (!taskId) return null;
  if (schemaMemoryCache.has(taskId)) {
    return schemaMemoryCache.get(taskId);
  }
  const fromStorage = parseMaybeJson(window.sessionStorage.getItem(`${STORAGE_PREFIX}${taskId}`));
  if (fromStorage) {
    schemaMemoryCache.set(taskId, fromStorage);
  }
  return fromStorage;
};

export const setTaskSchemaCache = (taskId, schema) => {
  if (!taskId) return;
  if (!schema) {
    schemaMemoryCache.delete(taskId);
    window.sessionStorage.removeItem(`${STORAGE_PREFIX}${taskId}`);
    return;
  }
  schemaMemoryCache.set(taskId, schema);
  try {
    window.sessionStorage.setItem(`${STORAGE_PREFIX}${taskId}`, JSON.stringify(schema));
  } catch (error) {
    // ignore storage exceptions
  }
};

