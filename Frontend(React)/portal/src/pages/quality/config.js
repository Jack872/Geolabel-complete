/**
 * @typedef {'rule' | 'audit' | 'model' | 'manual' | 'prov' | 'metadata'} QualitySourceType
 */

/**
 * @typedef {'pass' | 'warning' | 'fail' | 'pending' | 'not_applicable' | 'good' | 'risk' | 'signal_only' | 'disabled'} QualityConclusion
 */

/**
 * @typedef {Object} QualityMetricRule
 * @property {string} [thresholdRule]
 * @property {number} [warnMin]
 * @property {number} [passMin]
 */

/**
 * @typedef {Object} QualityMetricConfig
 * @property {string} key
 * @property {string} label
 * @property {string} [description]
 * @property {QualitySourceType[]} sources
 * @property {QualityMetricRule} [rule]
 * @property {string} [thresholdRule]
 */

/**
 * @typedef {Object} QualityDimensionConfig
 * @property {string} key
 * @property {string} label
 * @property {boolean} enabled
 * @property {QualityMetricConfig[]} indicators
 */

/**
 * @typedef {Object} QualityMetricResult
 * @property {string} key
 * @property {string} label
 * @property {string | number | null} value
 * @property {QualityConclusion | null} status
 * @property {number | null} score
 * @property {QualitySourceType | undefined} sourceType
 * @property {boolean | undefined} contributesToScore
 * @property {string | undefined} thresholdRule
 * @property {Object<string, any> | undefined} details
 */

/**
 * @typedef {Object} QualityDimensionResult
 * @property {string} key
 * @property {string} label
 * @property {boolean} enabled
 * @property {number | null} score
 * @property {number | null} confidence
 * @property {QualityConclusion | null} status
 * @property {QualityMetricResult[]} indicators
 */

/**
 * @typedef {Object} ReferencePreviewItem
 * @property {string | number} id
 * @property {string} [name]
 * @property {string} [sourceImageUrl]
 * @property {string} [resultImageUrl]
 * @property {'mask' | 'polygon' | 'bbox' | string} [overlayType]
 * @property {Object<string, any>} [overlayData]
 * @property {number} [confidenceMean]
 */

/**
 * @typedef {Object} QualityProfile
 * @property {string} id
 * @property {string} name
 * @property {string} [taskType]
 * @property {string[]} expectedBands
 * @property {string} expectedExportFormat
 * @property {string} expectedAnnotationFormat
 * @property {string[]} requiredFields
 * @property {string[]} topologyRules
 * @property {string} attributeAuditMode
 * @property {QualityDimensionConfig[]} [dimensionConfigs]
 * @property {Object<string, number>} [weights]
 */

export const QUALITY_SOURCE_LABELS = {
  rule: '规则校验',
  audit: '审核统计',
  model: '模型参考',
  manual: '人工抽检',
  prov: '溯源',
  metadata: '元数据',
};

export const QUALITY_SOURCE_COLORS = {
  rule: 'blue',
  audit: 'gold',
  model: 'purple',
  manual: 'cyan',
  prov: 'green',
  metadata: 'geekblue',
};

export const DEFAULT_QUALITY_DIMENSIONS = [
  {
    key: 'completeness',
    label: '完整性',
    enabled: true,
    indicators: [
      { key: 'requiredAttributeMissingRate', label: '必填属性缺失率', sources: ['rule'], thresholdRule: '<= 5% 通过，5%-20% 预警，>20% 失败' },
      { key: 'categoryAttributeCompletionRate', label: '类别属性完整率', sources: ['rule'], thresholdRule: '>= 90% 通过，70%-90% 预警，<70% 失败' },
      { key: 'referenceFeatureMissingRate', label: '参考要素漏检率(可选)', sources: ['model'], thresholdRule: '参考模型启用时可计算' },
      { key: 'referenceFeatureRedundancyRate', label: '参考要素冗余率(可选)', sources: ['model'], thresholdRule: '参考模型启用时可计算' },
    ],
  },
  {
    key: 'logicConsistency',
    label: '逻辑一致性',
    enabled: true,
    indicators: [
      { key: 'bandConsistencyRate', label: '波段一致性', sources: ['rule'], thresholdRule: '>= 90% 通过，70%-90% 预警，<70% 失败' },
      { key: 'crsCompletenessRate', label: '坐标系完整率', sources: ['metadata'], thresholdRule: '坐标系元数据非空比例' },
      { key: 'crsConsistencyRate', label: '坐标系一致率', sources: ['rule'], thresholdRule: '一致率越高越好' },
      { key: 'imageFormatConsistencyRate', label: '影像格式一致率', sources: ['metadata'], thresholdRule: '主格式一致率' },
      { key: 'annotationFormatMatch', label: '标注格式匹配', sources: ['rule'], thresholdRule: '与模板期望一致' },
      { key: 'exportFormatMatch', label: '导出格式匹配', sources: ['rule'], thresholdRule: '与模板期望一致' },
      { key: 'topologyPassRate', label: '拓扑规则通过率', sources: ['rule'], thresholdRule: '按拓扑规则校验通过比例' },
    ],
  },
  {
    key: 'attributeAccuracy',
    label: '属性精度',
    enabled: true,
    indicators: [
      { key: 'attributeValueValidityRate', label: '属性值合法率', sources: ['rule'], thresholdRule: '按属性类型校验合法性' },
      { key: 'manualAttributeAuditAccuracyRate', label: '人工属性审核准确率', sources: ['manual'], thresholdRule: '无人工抽检时 pending' },
      { key: 'referenceClassificationAccuracy', label: '参考分类准确率(可选)', sources: ['model'], thresholdRule: '参考模型启用时可计算' },
    ],
  },
  {
    key: 'positionalAccuracy',
    label: '位置精度',
    enabled: true,
    indicators: [
      { key: 'referenceObjectOverlap', label: '参考对象重叠度(可选)', sources: ['model'], thresholdRule: '参考模型启用时可计算' },
      { key: 'referenceBoundaryDeviation', label: '参考边界偏差(可选)', sources: ['model'], thresholdRule: '参考模型启用时可计算' },
      { key: 'referenceBoundaryPassRate', label: '参考边界通过率(可选)', sources: ['model'], thresholdRule: '参考模型启用时可计算' },
    ],
  },
  {
    key: 'temporalQuality',
    label: '时间质量',
    enabled: true,
    indicators: [
      { key: 'acquisitionTimeCompletenessRate', label: '采集时间完整率', sources: ['metadata'], thresholdRule: '采集时间起止字段完整率' },
      { key: 'timePrecisionCompletenessRate', label: '时间精度字段完整率', sources: ['metadata'], thresholdRule: 'time_precision 非空比例' },
      { key: 'timePrecisionIndex', label: '时间精度指数', sources: ['rule'], thresholdRule: 'second > minute > hour > day' },
      { key: 'timeValidityRate', label: '时间有效率', sources: ['rule'], thresholdRule: '起止时间可解析且时间关系有效' },
    ],
  },
  {
    key: 'usabilityQuality',
    label: '使用质量',
    enabled: true,
    indicators: [
      { key: 'classBalanceRate', label: '类别平衡度', sources: ['rule'], thresholdRule: '熵归一化，越高越均衡' },
      { key: 'provenanceCompletenessRate', label: '溯源完整度', sources: ['prov'], thresholdRule: '活动/实体/关系/代理完整性' },
      { key: 'auditCoverageRate', label: '审核覆盖率', sources: ['audit'], thresholdRule: '有审核记录任务占比' },
      { key: 'auditRecordCompletenessRate', label: '审核记录完整率', sources: ['audit'], thresholdRule: '审核关键字段完整率' },
      { key: 'auditClosureRate', label: '审核闭环率', sources: ['audit'], thresholdRule: '已闭环审核占比' },
      { key: 'auditIssueDiscoveryRate', label: '审核问题发现率(信号)', sources: ['audit'], thresholdRule: '仅作为过程信号' },
      { key: 'referenceReliabilityLevel', label: '参考评估可靠性等级', sources: ['model'], thresholdRule: '参考模型启用时可计算' },
    ],
  },
];

export const DEFAULT_QUALITY_PROFILES = [
  {
    id: 'general-rs-v1',
    name: '通用遥感样本模板',
    expectedBands: [],
    expectedExportFormat: '',
    expectedAnnotationFormat: '',
    requiredFields: [],
    topologyRules: ['polygon_no_self_intersection'],
    attributeAuditMode: 'optional',
  },
  {
    id: 'building-extract-v1',
    name: '建筑物提取模板',
    expectedBands: ['R', 'G', 'B'],
    expectedExportFormat: 'COCO',
    expectedAnnotationFormat: 'Polygon',
    requiredFields: ['buildingType'],
    topologyRules: ['polygon_no_self_intersection', 'polygon_no_duplicate'],
    attributeAuditMode: 'manual',
  },
];

export const EXPORT_FORMAT_OPTIONS = ['未记录', 'COCO', 'YOLO', 'VOC', 'TDML'];
export const ANNOTATION_FORMAT_OPTIONS = ['未记录', 'Polygon', 'BBox', 'Mask', 'Polyline'];
export const ATTRIBUTE_AUDIT_MODE_OPTIONS = [
  { label: '不检查', value: 'disabled' },
  { label: '可选人工审核', value: 'optional' },
  { label: '人工审核', value: 'manual' },
];
export const TOPOLOGY_RULE_OPTIONS = [
  { label: '面要素不得自相交', value: 'polygon_no_self_intersection' },
  { label: '面要素不得重复', value: 'polygon_no_duplicate' },
  { label: '面要素不得空洞异常', value: 'polygon_valid_holes' },
  { label: '道路线要素保持连通', value: 'road_should_connect' },
];

export const DIMENSION_STATUS_LABELS = {
  pass: '满足要求',
  good: '满足要求',
  warning: '需复核',
  fail: '不满足要求',
  risk: '不满足要求',
  signal_only: '需复核',
  pending: '未评价',
  not_applicable: '未评价',
  disabled: '未评价',
};

export const METRIC_STATUS_LABELS = {
  pass: '通过',
  good: '通过',
  warning: '预警',
  fail: '失败',
  risk: '失败',
  pending: '未评价',
  not_applicable: '未评价',
  disabled: '未评价',
};
