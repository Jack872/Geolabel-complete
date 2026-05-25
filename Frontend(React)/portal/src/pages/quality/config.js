import { getLocale } from 'umi';

const isEn = () => String(getLocale() || '').startsWith('en');
const label = (zh, en) => (isEn() ? en : zh);

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
  rule: label('规则校验', 'Rule Check'),
  audit: label('审核统计', 'Audit Statistics'),
  model: label('模型参考', 'Model Reference'),
  manual: label('人工抽检', 'Manual Sampling'),
  prov: label('溯源', 'Provenance'),
  metadata: label('元数据', 'Metadata'),
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
    label: label('完整性', 'Completeness'),
    enabled: true,
    indicators: [
      { key: 'requiredAttributeMissingRate', label: label('必填属性缺失率', 'Required Attribute Missing Rate'), sources: ['rule'], thresholdRule: label('<= 5% 通过，5%-20% 预警，>20% 失败', '<= 5% pass, 5%-20% warning, >20% fail') },
      { key: 'categoryAttributeCompletionRate', label: label('类别属性完整率', 'Category Attribute Completion Rate'), sources: ['rule'], thresholdRule: label('>= 90% 通过，70%-90% 预警，<70% 失败', '>= 90% pass, 70%-90% warning, <70% fail') },
      { key: 'referenceFeatureMissingRate', label: label('参考要素漏检率(可选)', 'Reference Feature Missing Rate (Optional)'), sources: ['model'], thresholdRule: label('参考模型启用时可计算', 'Calculated when reference model is enabled') },
      { key: 'referenceFeatureRedundancyRate', label: label('参考要素冗余率(可选)', 'Reference Feature Redundancy Rate (Optional)'), sources: ['model'], thresholdRule: label('参考模型启用时可计算', 'Calculated when reference model is enabled') },
    ],
  },
  {
    key: 'logicConsistency',
    label: label('逻辑一致性', 'Logical Consistency'),
    enabled: true,
    indicators: [
      { key: 'bandConsistencyRate', label: label('波段一致性', 'Band Consistency'), sources: ['rule'], thresholdRule: label('>= 90% 通过，70%-90% 预警，<70% 失败', '>= 90% pass, 70%-90% warning, <70% fail') },
      { key: 'crsCompletenessRate', label: label('坐标系完整率', 'CRS Completeness Rate'), sources: ['metadata'], thresholdRule: label('坐标系元数据非空比例', 'Non-empty CRS metadata ratio') },
      { key: 'crsConsistencyRate', label: label('坐标系一致率', 'CRS Consistency Rate'), sources: ['rule'], thresholdRule: label('一致率越高越好', 'Higher consistency is better') },
      { key: 'imageFormatConsistencyRate', label: label('影像格式一致率', 'Image Format Consistency Rate'), sources: ['metadata'], thresholdRule: label('主格式一致率', 'Dominant format consistency') },
      { key: 'annotationFormatMatch', label: label('标注格式匹配', 'Annotation Format Match'), sources: ['rule'], thresholdRule: label('与模板期望一致', 'Matches template expectation') },
      { key: 'exportFormatMatch', label: label('导出格式匹配', 'Export Format Match'), sources: ['rule'], thresholdRule: label('与模板期望一致', 'Matches template expectation') },
      { key: 'topologyPassRate', label: label('拓扑规则通过率', 'Topology Rule Pass Rate'), sources: ['rule'], thresholdRule: label('按拓扑规则校验通过比例', 'Pass ratio by topology rules') },
    ],
  },
  {
    key: 'attributeAccuracy',
    label: label('属性精度', 'Attribute Accuracy'),
    enabled: true,
    indicators: [
      { key: 'attributeValueValidityRate', label: label('属性值合法率', 'Attribute Value Validity Rate'), sources: ['rule'], thresholdRule: label('按属性类型校验合法性', 'Validate by attribute type') },
      { key: 'manualAttributeAuditAccuracyRate', label: label('人工属性审核准确率', 'Manual Attribute Audit Accuracy'), sources: ['manual'], thresholdRule: label('无人工抽检时 pending', 'Pending when no manual sampling exists') },
      { key: 'referenceClassificationAccuracy', label: label('参考分类准确率(可选)', 'Reference Classification Accuracy (Optional)'), sources: ['model'], thresholdRule: label('参考模型启用时可计算', 'Calculated when reference model is enabled') },
    ],
  },
  {
    key: 'positionalAccuracy',
    label: label('位置精度', 'Positional Accuracy'),
    enabled: true,
    indicators: [
      { key: 'referenceObjectOverlap', label: label('参考对象重叠度(可选)', 'Reference Object Overlap (Optional)'), sources: ['model'], thresholdRule: label('参考模型启用时可计算', 'Calculated when reference model is enabled') },
      { key: 'referenceBoundaryDeviation', label: label('参考边界偏差(可选)', 'Reference Boundary Deviation (Optional)'), sources: ['model'], thresholdRule: label('参考模型启用时可计算', 'Calculated when reference model is enabled') },
      { key: 'referenceBoundaryPassRate', label: label('参考边界通过率(可选)', 'Reference Boundary Pass Rate (Optional)'), sources: ['model'], thresholdRule: label('参考模型启用时可计算', 'Calculated when reference model is enabled') },
    ],
  },
  {
    key: 'temporalQuality',
    label: label('时间质量', 'Temporal Quality'),
    enabled: true,
    indicators: [
      { key: 'acquisitionTimeCompletenessRate', label: label('采集时间完整率', 'Acquisition Time Completeness'), sources: ['metadata'], thresholdRule: label('采集时间起止字段完整率', 'Start/end acquisition time completeness') },
      { key: 'timePrecisionCompletenessRate', label: label('时间精度字段完整率', 'Time Precision Completeness'), sources: ['metadata'], thresholdRule: label('time_precision 非空比例', 'Non-empty time_precision ratio') },
      { key: 'timePrecisionIndex', label: label('时间精度指数', 'Time Precision Index'), sources: ['rule'], thresholdRule: 'second > minute > hour > day' },
      { key: 'timeValidityRate', label: label('时间有效率', 'Time Validity Rate'), sources: ['rule'], thresholdRule: label('起止时间可解析且时间关系有效', 'Time range can be parsed and is valid') },
    ],
  },
  {
    key: 'usabilityQuality',
    label: label('使用质量', 'Usability Quality'),
    enabled: true,
    indicators: [
      { key: 'classBalanceRate', label: label('类别平衡度', 'Class Balance'), sources: ['rule'], thresholdRule: label('熵归一化，越高越均衡', 'Normalized entropy; higher is more balanced') },
      { key: 'provenanceCompletenessRate', label: label('溯源完整度', 'Provenance Completeness'), sources: ['prov'], thresholdRule: label('活动/实体/关系/代理完整性', 'Activity/entity/relation/agent completeness') },
      { key: 'auditCoverageRate', label: label('审核覆盖率', 'Audit Coverage'), sources: ['audit'], thresholdRule: label('有审核记录任务占比', 'Ratio of tasks with audit records') },
      { key: 'auditRecordCompletenessRate', label: label('审核记录完整率', 'Audit Record Completeness'), sources: ['audit'], thresholdRule: label('审核关键字段完整率', 'Completeness of key audit fields') },
      { key: 'auditClosureRate', label: label('审核闭环率', 'Audit Closure Rate'), sources: ['audit'], thresholdRule: label('已闭环审核占比', 'Closed audit ratio') },
      { key: 'auditIssueDiscoveryRate', label: label('审核问题发现率(信号)', 'Audit Issue Discovery Rate (Signal)'), sources: ['audit'], thresholdRule: label('仅作为过程信号', 'Process signal only') },
      { key: 'referenceReliabilityLevel', label: label('参考评估可靠性等级', 'Reference Reliability Level'), sources: ['model'], thresholdRule: label('参考模型启用时可计算', 'Calculated when reference model is enabled') },
    ],
  },
];

export const DEFAULT_QUALITY_PROFILES = [
  {
    id: 'general-rs-v1',
    name: label('通用遥感样本模板', 'General Remote Sensing Sample Template'),
    expectedBands: [],
    expectedExportFormat: '',
    expectedAnnotationFormat: '',
    requiredFields: [],
    topologyRules: ['polygon_no_self_intersection'],
    attributeAuditMode: 'optional',
  },
  {
    id: 'building-extract-v1',
    name: label('建筑物提取模板', 'Building Extraction Template'),
    expectedBands: ['R', 'G', 'B'],
    expectedExportFormat: 'COCO',
    expectedAnnotationFormat: 'Polygon',
    requiredFields: ['buildingType'],
    topologyRules: ['polygon_no_self_intersection', 'polygon_no_duplicate'],
    attributeAuditMode: 'manual',
  },
];

export const EXPORT_FORMAT_OPTIONS = [label('未记录', 'Unrecorded'), 'COCO', 'YOLO', 'VOC', 'TDML'];
export const ANNOTATION_FORMAT_OPTIONS = [label('未记录', 'Unrecorded'), 'Polygon', 'BBox', 'Mask', 'Polyline'];
export const ATTRIBUTE_AUDIT_MODE_OPTIONS = [
  { label: label('不检查', 'Disabled'), value: 'disabled' },
  { label: label('可选人工审核', 'Optional Manual Audit'), value: 'optional' },
  { label: label('人工审核', 'Manual Audit'), value: 'manual' },
];
export const TOPOLOGY_RULE_OPTIONS = [
  { label: label('面要素不得自相交', 'Polygons must not self-intersect'), value: 'polygon_no_self_intersection' },
  { label: label('面要素不得重复', 'Polygons must not be duplicated'), value: 'polygon_no_duplicate' },
  { label: label('面要素不得空洞异常', 'Polygons must not have invalid holes'), value: 'polygon_valid_holes' },
  { label: label('道路线要素保持连通', 'Road line features should stay connected'), value: 'road_should_connect' },
];

export const DIMENSION_STATUS_LABELS = {
  pass: label('满足要求', 'Pass'),
  good: label('满足要求', 'Pass'),
  warning: label('需复核', 'Review Required'),
  fail: label('不满足要求', 'Fail'),
  risk: label('不满足要求', 'Fail'),
  signal_only: label('需复核', 'Review Required'),
  pending: label('未评价', 'Pending'),
  not_applicable: label('未评价', 'Pending'),
  disabled: label('未评价', 'Pending'),
};

export const METRIC_STATUS_LABELS = {
  pass: label('通过', 'Pass'),
  good: label('通过', 'Pass'),
  warning: label('预警', 'Warning'),
  fail: label('失败', 'Fail'),
  risk: label('失败', 'Fail'),
  pending: label('未评价', 'Pending'),
  not_applicable: label('未评价', 'Pending'),
  disabled: label('未评价', 'Pending'),
};
