/*

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { history, useModel } from 'umi';
import moment from 'moment';
import {
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  message,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  DatabaseOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
  LeftOutlined,
  PartitionOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  PrinterOutlined,
  ProfileOutlined,
  RightOutlined,
  RobotOutlined,
  SaveOutlined,
  SettingOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { reqGetAttributeDefs } from '@/services/taskManage/api';
import {
  reqGetQualityDimensionTemplate,
  reqGetQualityEvaluationJob,
  reqGetQualityEvaluationJobResult,
  reqGetQualityModels,
  reqGetQualityProfileTemplates,
  reqGetQualityReferencePreviewDetail,
  reqGetQualityReferencePreviewList,
  reqGetQualityReport,
  reqGetQualityReportHtml,
  reqGetQualitySampleSetProv,
  reqGetQualitySampleSets,
  reqRunQualityReference,
  reqSaveQualityProfileDraft,
  reqSubmitQualityEvaluation,
} from '@/services/quality/api';
import {
  ANNOTATION_FORMAT_OPTIONS,
  ATTRIBUTE_AUDIT_MODE_OPTIONS,
  DEFAULT_QUALITY_DIMENSIONS,
  DIMENSION_STATUS_LABELS,
  EXPORT_FORMAT_OPTIONS,
  METRIC_STATUS_LABELS,
  QUALITY_SOURCE_COLORS,
  QUALITY_SOURCE_LABELS,
  TOPOLOGY_RULE_OPTIONS,
} from './config';
import { currentState, getUserByUsername } from '@/services/login/api';
import './style.less';

const { Paragraph, Text } = Typography;

const parseTaskIds = (taskIds) => {
  if (!taskIds) return [];
  if (Array.isArray(taskIds)) return taskIds;
  if (typeof taskIds === 'string') {
    return taskIds
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
};

const inferExportFormat = (sampleSet) => {
  const labelUrl = String(sampleSet?.labelUrl || '').toLowerCase();
  if (!labelUrl) return '未记录';
  if (labelUrl.endsWith('annotations.json')) return 'COCO';
  if (labelUrl.endsWith('.xml')) return 'VOC';
  if (labelUrl.endsWith('.txt')) return 'YOLO';
  if (labelUrl.endsWith('.json')) return '项目内部格式';
  return '未记录';
};

const buildSampleSetSummary = (sampleSet, provData) => {
  const taskIds = parseTaskIds(sampleSet?.taskIds);
  const hasProv =
    (provData?.activities || []).length > 0 || (provData?.entities || []).length > 0;
  return { sourceTaskCount: taskIds.length, exportFormat: inferExportFormat(sampleSet), hasProv };
};

const resolveCurrentUserId = (currentUser) => {
  if (currentUser && typeof currentUser === 'object') {
    return currentUser.userId || currentUser.userid || currentUser.id;
  }
  const storageUserId =
    window.sessionStorage.getItem('userId') || window.sessionStorage.getItem('userid');
  return storageUserId ? Number(storageUserId) : undefined;
};

const parseModelMeta = (raw) => {
  if (!raw) return { inferParams: {} };
  if (typeof raw === 'object') {
    return { inferParams: {}, ...raw };
  }
  if (typeof raw !== 'string') return { inferParams: {} };
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { inferParams: {} };
  } catch (e) {
    return { inferParams: {} };
  }
};

const pickArray = (candidate) => {
  if (Array.isArray(candidate?.records)) return candidate.records;
  if (Array.isArray(candidate?.list)) return candidate.list;
  if (Array.isArray(candidate)) return candidate;
  return null;
};

const pickResponseRecords = (res) => {
  const fromData = pickArray(res?.data);
  if (Array.isArray(fromData)) return fromData;
  const fromRoot = pickArray(res);
  if (Array.isArray(fromRoot)) return fromRoot;
  return [];
};

const normalizeSources = (indicator, fallback = {}) => {
  const sourceList = Array.isArray(indicator?.sources)
    ? indicator.sources
    : indicator?.sourceType
      ? [indicator.sourceType]
      : Array.isArray(fallback?.sources)
        ? fallback.sources
        : [];
  return sourceList.filter(Boolean);
};

const buildMetricRuleKey = (dimensionKey, metricKey) => `${dimensionKey}.${metricKey}`;

const deriveThresholdRuleText = (rule, fallback = '') => {
  if (!rule || typeof rule !== 'object') {
    return fallback || '';
  }
  if (rule.mode === 'signal') {
    return fallback || '仅作为过程信号';
  }
  if (rule.direction === 'high') {
    const passText = rule.passMin !== undefined ? `>=${rule.passMin}%通过` : '';
    const warnText = rule.warnMin !== undefined ? `${rule.warnMin}%-${rule.passMin}%预警` : '';
    const failText = rule.warnMin !== undefined ? `<${rule.warnMin}%失败` : '';
    return [passText, warnText, failText].filter(Boolean).join('，') || fallback || '';
  }
  if (rule.direction === 'low') {
    const passText = rule.passMax !== undefined ? `<=${rule.passMax}%通过` : '';
    const warnText = rule.warnMax !== undefined ? `${rule.passMax}%-${rule.warnMax}%预警` : '';
    const failText = rule.warnMax !== undefined ? `>${rule.warnMax}%失败` : '';
    return [passText, warnText, failText].filter(Boolean).join('，') || fallback || '';
  }
  return fallback || '';
};

const normalizeMetricRule = (rule, fallbackThresholdRule = '') => {
  if (!rule || typeof rule !== 'object') {
    return {
      direction: 'high',
      passValue: undefined,
      warnValue: undefined,
      hard: true,
      optional: false,
      mode: 'threshold',
      thresholdRule: fallbackThresholdRule || '',
    };
  }
  if (rule.mode === 'signal') {
    return {
      mode: 'signal',
      direction: 'signal',
      passValue: undefined,
      warnValue: undefined,
      hard: false,
      optional: !!rule.optional,
      thresholdRule: deriveThresholdRuleText(rule, fallbackThresholdRule),
    };
  }
  const direction = rule.direction === 'low' ? 'low' : 'high';
  return {
    mode: 'threshold',
    direction,
    passValue: direction === 'low' ? rule.passMax : rule.passMin,
    warnValue: direction === 'low' ? rule.warnMax : rule.warnMin,
    hard: rule.hard !== undefined ? !!rule.hard : true,
    optional: !!rule.optional,
    thresholdRule: deriveThresholdRuleText(rule, fallbackThresholdRule),
  };
};

const toMetricRulePayload = (ruleConfig = {}) => {
  if (ruleConfig.mode === 'signal' || ruleConfig.direction === 'signal') {
    return {
      mode: 'signal',
      hard: false,
      optional: !!ruleConfig.optional,
    };
  }
  const direction = ruleConfig.direction === 'low' ? 'low' : 'high';
  const payload = {
    direction,
    hard: ruleConfig.hard !== undefined ? !!ruleConfig.hard : true,
    optional: !!ruleConfig.optional,
  };
  if (direction === 'low') {
    if (ruleConfig.passValue !== undefined && ruleConfig.passValue !== null && ruleConfig.passValue !== '') {
      payload.passMax = Number(ruleConfig.passValue);
    }
    if (ruleConfig.warnValue !== undefined && ruleConfig.warnValue !== null && ruleConfig.warnValue !== '') {
      payload.warnMax = Number(ruleConfig.warnValue);
    }
  } else {
    if (ruleConfig.passValue !== undefined && ruleConfig.passValue !== null && ruleConfig.passValue !== '') {
      payload.passMin = Number(ruleConfig.passValue);
    }
    if (ruleConfig.warnValue !== undefined && ruleConfig.warnValue !== null && ruleConfig.warnValue !== '') {
      payload.warnMin = Number(ruleConfig.warnValue);
    }
  }
  return payload;
};

const applyMetricRulesToDimensionConfigs = (configs, metricRules = {}) => {
  return (configs || []).map((dimension) => ({
    ...dimension,
    indicators: (dimension.indicators || []).map((indicator) => {
      const scopedRule = metricRules?.[buildMetricRuleKey(dimension.key, indicator.key)];
      const normalizedRule = normalizeMetricRule(scopedRule, indicator.thresholdRule || indicator.rule?.thresholdRule || '');
      return {
        ...indicator,
        rule: normalizedRule,
        thresholdRule: normalizedRule.thresholdRule,
      };
    }),
  }));
};

const collectMetricRulesFromDimensionConfigs = (configs = []) => {
  const metricRules = {};
  (configs || []).forEach((dimension) => {
    (dimension.indicators || []).forEach((indicator) => {
      metricRules[buildMetricRuleKey(dimension.key, indicator.key)] = toMetricRulePayload(indicator.rule || {});
    });
  });
  return metricRules;
};

const buildFrontendFallbackProfile = (selectedSet) => ({
  name: '默认规则型模板',
  taskType: selectedSet?.taskType || '',
  expectedBands: [],
  expectedExportFormat: inferExportFormat(selectedSet),
  expectedAnnotationFormat: 'Polygon',
  requiredFields: [],
  topologyRules: ['polygon_no_self_intersection'],
  attributeAuditMode: 'optional',
});

const METRIC_PRECONDITION_HINTS = {
  requiredAttributeMissingRate: '依赖任务类别属性约束中的必填字段',
  categoryAttributeCompletionRate: '依赖任务类别属性约束中的全部属性字段',
  bandConsistencyRate: '优先使用 expectedBands；未填时回退到首个影像的 bands_json',
  annotationFormatMatch: '依赖 expectedAnnotationFormat',
  exportFormatMatch: '依赖 expectedExportFormat',
  topologyPassRate: '依赖 topologyRules',
};

const getMetricPreconditionHint = (metricKey) => METRIC_PRECONDITION_HINTS[metricKey] || '按当前模板配置和元数据自动计算';

const normalizeDimensionConfigs = (configs, metricRules = {}) => {
  const auditDim = 'usabilityQuality';
  const stripAudit = (dimKey, indicators = []) =>
    indicators.filter((indicator) => !(dimKey !== auditDim && normalizeSources(indicator).includes('audit')));
  const fallbackList = DEFAULT_QUALITY_DIMENSIONS.map((item) => ({
    ...item,
    indicators: stripAudit(item.key, item.indicators || []),
  }));
  const source = Array.isArray(configs) && configs.length > 0 ? configs : fallbackList;
  const mapFallback = new Map(fallbackList.map((item) => [item.key, item]));
  const normalized = source.map((item) => {
    const fb = mapFallback.get(item.key) || {};
    const mergedIndicators = (item.indicators || fb.indicators || []).map((indicator, idx) => {
      const fallbackIndicator = (fb.indicators || [])[idx] || {};
      const key = indicator?.key || fallbackIndicator?.key || `metric_${idx}`;
      return {
        ...fallbackIndicator,
        ...indicator,
        key,
        thresholdRule:
          indicator?.thresholdRule ||
          indicator?.rule?.thresholdRule ||
          fallbackIndicator?.thresholdRule ||
          '',
        sources: normalizeSources(indicator, fallbackIndicator),
      };
    });
    return {
      ...fb,
      ...item,
      enabled: item?.enabled !== undefined ? !!item.enabled : fb?.enabled !== false,
      indicators: stripAudit(item.key, mergedIndicators),
    };
  });
  return applyMetricRulesToDimensionConfigs(normalized, metricRules);
};

const getMetricStatusColor = (status) => {
  if (status === 'pass' || status === 'good') return 'success';
  if (status === 'warning') return 'warning';
  if (status === 'fail' || status === 'risk') return 'error';
  return 'default';
};

const getConclusionColor = (status) => {
  if (status === 'pass' || status === 'good') return 'green';
  if (status === 'warning' || status === 'signal_only') return 'gold';
  if (status === 'fail' || status === 'risk') return 'red';
  return 'default';
};

const formatPercent = (value) => {
  if (value === null || value === undefined || value === '') return '--';
  const n = Number(value);
  if (Number.isNaN(n)) return '--';
  return `${n.toFixed(2)}%`;
};

const mergeResultWithDimensionConfigs = (evaluationResult, dimensionConfigs) => {
  const resultDimensions = Array.isArray(evaluationResult?.dimensions) ? evaluationResult.dimensions : [];
  const resultMap = new Map(resultDimensions.map((item) => [item.key, item]));
  return (dimensionConfigs || []).map((cfg) => {
    const dimension = resultMap.get(cfg.key);
    const metricMap = new Map((dimension?.indicators || []).map((item) => [item.key, item]));
    const indicators = (cfg.indicators || []).map((indicatorCfg) => {
      const metric = metricMap.get(indicatorCfg.key);
      if (!metric) {
        return {
          key: indicatorCfg.key,
          label: indicatorCfg.label,
          sourceType: (indicatorCfg.sources || [])[0] || 'rule',
          sources: indicatorCfg.sources || [],
          score: null,
          value: (indicatorCfg.sources || []).includes('model') ? '待模型参考' : '待规则校验',
          status: 'pending',
          thresholdRule: indicatorCfg.thresholdRule || '',
        };
      }
      return {
        ...indicatorCfg,
        ...metric,
        thresholdRule: indicatorCfg.thresholdRule || metric.thresholdRule || '',
        sources:
          Array.isArray(metric.sources) && metric.sources.length > 0
            ? metric.sources
            : metric.sourceType
              ? [metric.sourceType]
              : indicatorCfg.sources || [],
      };
    });
    return {
      ...cfg,
      ...dimension,
      enabled: cfg.enabled,
      status: dimension?.status || (cfg.enabled ? 'pending' : 'disabled'),
      indicators,
    };
  });
};

const parsePolygonPoints = (raw) => {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (Array.isArray(raw[0])) {
    return raw
      .map((point) => (Array.isArray(point) && point.length >= 2 ? [Number(point[0]), Number(point[1])] : null))
      .filter(Boolean);
  }
  if (typeof raw[0] === 'number') {
    const points = [];
    for (let i = 0; i < raw.length - 1; i += 2) {
      points.push([Number(raw[i]), Number(raw[i + 1])]);
    }
    return points;
  }
  return [];
};

const parseBox = (raw) => {
  if (!raw) return null;
  if (Array.isArray(raw) && raw.length >= 4) {
    const [x1, y1, x2, y2] = raw.map((v) => Number(v));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, confidence: null, label: '' };
  }
  if (raw.x1 !== undefined && raw.y1 !== undefined && raw.x2 !== undefined && raw.y2 !== undefined) {
    return {
      x: Number(raw.x1),
      y: Number(raw.y1),
      w: Number(raw.x2) - Number(raw.x1),
      h: Number(raw.y2) - Number(raw.y1),
      confidence: raw.confidence,
      label: raw.label,
    };
  }
  return null;
};

const normalizeOverlayType = (overlayType) => {
  const type = String(overlayType || '').toLowerCase();
  if (!type) return '';
  if (type === 'poly' || type === 'polygons') return 'polygon';
  if (type === 'box' || type === 'rect' || type === 'rectangle') return 'bbox';
  if (type === 'heatmap' || type === 'probability' || type === 'probability_heatmap') return 'mask';
  return type;
};

const isFiniteNumber = (value) => Number.isFinite(Number(value));

const statusFromReferenceMetric = (metricKey, rawValue) => {
  if (!isFiniteNumber(rawValue)) return 'pending';
  const value = Number(rawValue);
  const higherBetter = (passMin, warnMin) => (value >= passMin ? 'pass' : value >= warnMin ? 'warning' : 'fail');
  const lowerBetter = (passMax, warnMax) => (value <= passMax ? 'pass' : value <= warnMax ? 'warning' : 'fail');
  switch (metricKey) {
    case 'referenceFeatureMissingRate':
    case 'referenceFeatureRedundancyRate':
      return lowerBetter(10, 25);
    case 'referenceBoundaryDeviation':
      return lowerBetter(15, 30);
    case 'referenceClassificationAccuracy':
      return higherBetter(90, 75);
    case 'referenceObjectOverlap':
    case 'referenceBoundaryPassRate':
      return higherBetter(85, 70);
    case 'referenceReliabilityLevel':
      return higherBetter(75, 55);
    default:
      return 'pending';
  }
};

const mergeReferenceMetricsToResult = (prevResult, dimensionConfigs, referenceModel) => {
  if (!referenceModel || typeof referenceModel !== 'object') return prevResult;
  const indicators = referenceModel?.indicators || {};
  const keyValueMap = {
    referenceFeatureMissingRate:
      indicators.referenceFeatureMissingRate ?? indicators.missingFeatureRate,
    referenceFeatureRedundancyRate:
      indicators.referenceFeatureRedundancyRate ?? indicators.redundantFeatureRate,
    referenceClassificationAccuracy:
      indicators.referenceClassificationAccuracy ?? indicators.classificationAccuracy,
    referenceObjectOverlap:
      indicators.referenceObjectOverlap ?? indicators.objectOverlap,
    referenceBoundaryDeviation:
      indicators.referenceBoundaryDeviation ?? indicators.boundaryDeviation,
    referenceBoundaryPassRate:
      indicators.referenceBoundaryPassRate ?? indicators.boundaryPassRate,
    referenceReliabilityLevel:
      referenceModel.confidenceScore ??
      (isFiniteNumber(referenceModel.referenceReliability)
        ? Number(referenceModel.referenceReliability) * 100
        : undefined),
  };
  const baseDimensions =
    Array.isArray(prevResult?.dimensions) && prevResult.dimensions.length > 0
      ? prevResult.dimensions
      : (dimensionConfigs || []).map((dim) => ({
          key: dim.key,
          label: dim.label,
          status: dim.enabled ? 'pending' : 'disabled',
          indicators: (dim.indicators || []).map((metric) => ({
            key: metric.key,
            label: metric.label,
            status: 'pending',
            sourceType: (metric.sources || [])[0] || 'rule',
          })),
        }));

  const patchedDimensions = baseDimensions.map((dim) => {
    const indicatorsList = Array.isArray(dim?.indicators) ? dim.indicators : [];
    const nextIndicators = indicatorsList.map((metric) => {
      const key = metric?.key;
      if (!key || keyValueMap[key] === undefined || keyValueMap[key] === null) return metric;
      const rawValue = keyValueMap[key];
      const value = isFiniteNumber(rawValue) ? `${Number(rawValue).toFixed(2)}%` : rawValue;
      return {
        ...metric,
        value,
        score: isFiniteNumber(rawValue) ? Number(rawValue) : metric?.score ?? null,
        sourceType: 'model',
        sources: ['model'],
        status: statusFromReferenceMetric(key, rawValue),
      };
    });
    const hasFail = nextIndicators.some((m) => m?.status === 'fail');
    const hasWarning = nextIndicators.some((m) => m?.status === 'warning');
    const hasPass = nextIndicators.some((m) => m?.status === 'pass');
    const nextStatus = hasFail ? 'fail' : hasWarning ? 'warning' : hasPass ? 'pass' : dim?.status || 'pending';
    return {
      ...dim,
      indicators: nextIndicators,
      status: nextStatus,
    };
  });

  return {
    ...(prevResult || {}),
    referenceModel,
    dimensions: patchedDimensions,
    dimensionResults: patchedDimensions,
  };
};

const normalizePreviewItem = (item, index = 0) => {
  const id = item?.id ?? item?.previewId ?? item?.sampleId ?? `sample_${index}`;
  const previewType = normalizeOverlayType(item?.overlayType || item?.previewType || '');
  const overlayMaskUrl = item?.overlayMaskUrl || item?.overlayMaskImageUrl || item?.overlayData?.maskImageUrl || '';
  const overlayPolygons = item?.overlayPolygons || [];
  const overlayBoxes = item?.overlayBoxes || [];
  const overlayData = item?.overlayData || {
    polygons: overlayPolygons,
    boxes: overlayBoxes,
    maskImageUrl: overlayMaskUrl,
    width: item?.width,
    height: item?.height,
  };
  return {
    ...item,
    id,
    name: item?.name || item?.sliceFileName || `样本 ${index + 1}`,
    originalImageUrl: item?.originalImageUrl || item?.sourceImageUrl || '',
    sourceImageUrl: item?.sourceImageUrl || item?.originalImageUrl || '',
    resultImageUrl: item?.resultImageUrl || overlayMaskUrl || item?.sourceImageUrl || '',
    previewType,
    overlayType: previewType,
    overlayMaskUrl,
    overlayPolygons,
    overlayBoxes,
    overlayData,
  };
};

const PreviewImageWithOverlay = ({ imageUrl, overlayType, overlayData, showOverlay }) => {
  if (!imageUrl) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无图像" />;
  const viewWidth = Number(overlayData?.width || 1000);
  const viewHeight = Number(overlayData?.height || 1000);
  const polygons = Array.isArray(overlayData?.polygons) ? overlayData.polygons : [];
  const boxes = Array.isArray(overlayData?.boxes) ? overlayData.boxes : [];
  const maskImageUrl = overlayData?.maskImageUrl || '';
  const showHeatmapLegend = showOverlay && overlayType === 'mask' && !!maskImageUrl;
  const legendId = `heatmapLegend_${String(maskImageUrl || imageUrl || 'default').replace(/[^a-zA-Z0-9]/g, '_')}`;
  return (
    <div className="preview-image-shell">
      <svg
        className="preview-svg-stage"
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <image href={imageUrl} x="0" y="0" width={viewWidth} height={viewHeight} preserveAspectRatio="xMidYMid meet" />
        {showOverlay && overlayType === 'mask' && maskImageUrl ? (
          <image
            href={maskImageUrl}
            x="0"
            y="0"
            width={viewWidth}
            height={viewHeight}
            preserveAspectRatio="xMidYMid meet"
            opacity="0.92"
          />
        ) : null}
        {showOverlay && !showHeatmapLegend && overlayType === 'polygon'
          ? polygons.map((poly) => {
              const points = parsePolygonPoints(poly?.points || poly?.segmentation || poly);
              if (points.length < 3) return null;
              const first = points[0] || [];
              const polyKey = `poly_${points.length}_${first[0] || 0}_${first[1] || 0}`;
              return (
                <polygon
                  key={polyKey}
                  points={points.map((p) => `${p[0]},${p[1]}`).join(' ')}
                  fill="rgba(24,144,255,0.24)"
                  stroke="#1677ff"
                  strokeWidth="2"
                />
              );
            })
          : null}
        {showOverlay && !showHeatmapLegend && overlayType === 'bbox'
          ? boxes.map((raw) => {
              const box = parseBox(raw);
              if (!box) return null;
              const boxKey = `box_${box.x}_${box.y}_${box.w}_${box.h}`;
              return (
                <rect
                  key={boxKey}
                  x={box.x}
                  y={box.y}
                  width={box.w}
                  height={box.h}
                  fill="rgba(250,84,28,0.12)"
                  stroke="#fa541c"
                  strokeWidth="2"
                />
              );
            })
          : null}
      </svg>
      {showHeatmapLegend ? (
        <div
          className="heatmap-legend"
          style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 2, minWidth: 92, padding: '10px 10px 8px', borderRadius: 10, background: 'rgba(255,255,255,0.92)', border: '1px solid rgba(31,31,31,0.08)', boxShadow: '0 6px 20px rgba(0,0,0,0.12)' }}
        >
          <div className="heatmap-legend-title" style={{ marginBottom: 6, fontSize: 12, fontWeight: 600, color: '#262626' }}>概率图例</div>
          <div className="heatmap-legend-scale" style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
            <svg width="14" height="112" viewBox="0 0 14 112" aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
              <defs>
                <linearGradient id={legendId} x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor="#1d4ed8" />
                  <stop offset="25%" stopColor="#06b6d4" />
                  <stop offset="50%" stopColor="#22c55e" />
                  <stop offset="75%" stopColor="#facc15" />
                  <stop offset="100%" stopColor="#ef4444" />
                </linearGradient>
              </defs>
              <rect x="0.5" y="0.5" width="13" height="111" rx="7" fill={`url(#${legendId})`} stroke="rgba(0,0,0,0.08)" />
            </svg>
            <div className="heatmap-legend-labels" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: 112, fontSize: 11, color: '#595959' }}>
              <span>1.0</span>
              <span>0.5</span>
              <span>0.0</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const DimensionConfigCard = ({ dimension, onToggle, onRuleChange, onRuleConfigChange }) => {
  const columns = [
    { title: '指标名称', dataIndex: 'label', key: 'label', width: 220 },
    {
      title: '数据来源',
      dataIndex: 'sources',
      key: 'sources',
      width: 220,
      render: (sources = []) => (
        <Space wrap size={[4, 4]}>
          {(sources || []).map((source) => (
            <Tag key={source} color={QUALITY_SOURCE_COLORS[source] || 'default'}>
              {QUALITY_SOURCE_LABELS[source] || source}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '计算前置',
      dataIndex: 'key',
      key: 'precondition',
      width: 260,
      render: (key) => <Text type="secondary">{getMetricPreconditionHint(key)}</Text>,
    },
    {
      title: '判定方式',
      dataIndex: 'rule',
      key: 'direction',
      width: 140,
      render: (_, record) => (
        <Select
          value={record?.rule?.direction || 'high'}
          style={{ width: '100%' }}
          onChange={(value) => onRuleConfigChange(dimension.key, record.key, { direction: value, mode: value === 'signal' ? 'signal' : 'threshold' })}
          options={[
            { label: '高值优', value: 'high' },
            { label: '低值优', value: 'low' },
            { label: '信号项', value: 'signal' },
          ]}
        />
      ),
    },
    {
      title: '通过阈值',
      dataIndex: 'rule',
      key: 'passValue',
      width: 120,
      render: (_, record) => (
        <InputNumber
          value={record?.rule?.passValue}
          min={0}
          max={100}
          disabled={record?.rule?.direction === 'signal'}
          style={{ width: '100%' }}
          onChange={(value) => onRuleConfigChange(dimension.key, record.key, { passValue: value })}
        />
      ),
    },
    {
      title: '预警阈值',
      dataIndex: 'rule',
      key: 'warnValue',
      width: 120,
      render: (_, record) => (
        <InputNumber
          value={record?.rule?.warnValue}
          min={0}
          max={100}
          disabled={record?.rule?.direction === 'signal'}
          style={{ width: '100%' }}
          onChange={(value) => onRuleConfigChange(dimension.key, record.key, { warnValue: value })}
        />
      ),
    },
    {
      title: '阈值/规则',
      dataIndex: 'thresholdRule',
      key: 'thresholdRule',
      render: (_, record) => (
        <Input value={record.thresholdRule} onChange={(e) => onRuleChange(dimension.key, record.key, e.target.value)} />
      ),
    },
  ];
  return (
    <Card
      size="small"
      bordered
      className={`dimension-config-card ${dimension.enabled ? 'enabled' : 'disabled'}`}
      title={
        <div className="dimension-config-title">
          <span>{dimension.label}</span>
          <Switch checked={dimension.enabled} onChange={(checked) => onToggle(dimension.key, checked)} />
        </div>
      }
    >
      <Table rowKey="key" size="small" pagination={false} columns={columns} dataSource={dimension.indicators || []} />
    </Card>
  );
};

const DimensionResultCard = ({ dimension }) => {
  const columns = [
    { title: '指标名称', dataIndex: 'label', key: 'label', width: 180 },
    { title: '计算值', dataIndex: 'value', key: 'value', width: 180, render: (value, row) => (value ?? row?.score ?? '--') },
    { title: '阈值/规则', dataIndex: 'thresholdRule', key: 'thresholdRule', width: 220, render: (value) => value || '未配置' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 120, render: (status) => <Tag color={getMetricStatusColor(status)}>{METRIC_STATUS_LABELS[status] || '未评价'}</Tag> },
    {
      title: '数据来源',
      dataIndex: 'sources',
      key: 'sources',
      width: 200,
      render: (sources = [], row) => {
        const list = sources.length > 0 ? sources : row?.sourceType ? [row.sourceType] : [];
        return (
          <Space wrap size={[4, 4]}>
            {list.map((source) => (
              <Tag key={`${row.key}_${source}`} color={QUALITY_SOURCE_COLORS[source] || 'default'}>{QUALITY_SOURCE_LABELS[source] || source}</Tag>
            ))}
          </Space>
        );
      },
    },
  ];
  return (
    <Card size="small" bordered className="dimension-result-card">
      <div className="dimension-result-head">
        <div className="dimension-result-title">{dimension?.label}</div>
        <Space size={8} style={{ marginTop: 6 }}>
          <Tag color={getConclusionColor(dimension?.status)}>{DIMENSION_STATUS_LABELS[dimension?.status] || '未评价'}</Tag>
          <Text type="secondary">维度状态: {dimension?.status || 'pending'}</Text>
        </Space>
      </div>
      <Table rowKey="key" size="small" pagination={false} columns={columns} dataSource={dimension?.indicators || []} scroll={{ x: 900 }} />
    </Card>
  );
};

const QualityPage = () => {
  const { initialState } = useModel('@@initialState');
  const currentUser = initialState?.currentState?.currentUser;
  const [templateForm] = Form.useForm();

  const [currentUserId, setCurrentUserId] = useState(() => resolveCurrentUserId(currentUser));
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [runningEvaluation, setRunningEvaluation] = useState(false);
  const [runningReference, setRunningReference] = useState(false);
  const [loadingPreviewList, setLoadingPreviewList] = useState(false);
  const [loadingPreviewDetail, setLoadingPreviewDetail] = useState(false);

  const [datasetList, setDatasetList] = useState([]);
  const [selectedSet, setSelectedSet] = useState(null);
  const [selectedSetProv, setSelectedSetProv] = useState(null);
  const [profileOptions, setProfileOptions] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(undefined);
  const [dimensionConfigs, setDimensionConfigs] = useState([]);
  const [attributeDefs, setAttributeDefs] = useState([]);
  const [modelOptions, setModelOptions] = useState([]);
  const [evaluationResult, setEvaluationResult] = useState(null);
  const [evaluationJob, setEvaluationJob] = useState(null);
  const [latestReport, setLatestReport] = useState(null);
  const [previewList, setPreviewList] = useState([]);
  const [selectedPreviewId, setSelectedPreviewId] = useState(undefined);
  const [previewDetail, setPreviewDetail] = useState(null);
  const [referenceEvidence, setReferenceEvidence] = useState(null);
  const [reportPreviewVisible, setReportPreviewVisible] = useState(false);
  const [reportPreviewHtml, setReportPreviewHtml] = useState('');
  const defaultMetricRulesRef = useRef({});
  const hasInitializedRef = useRef(false);

  const selectedModelId = Form.useWatch('referenceModelId', templateForm);
  const selectedModel = useMemo(
    () => modelOptions.find((item) => String(item.modelId) === String(selectedModelId)),
    [modelOptions, selectedModelId],
  );

  const attributeOptions = useMemo(
    () => (attributeDefs || []).map((item) => ({ label: item?.attrName || item?.attr_name || item?.attrKey || item?.attr_key, value: item?.attrKey || item?.attr_key })),
    [attributeDefs],
  );
  const sampleSetSummary = useMemo(() => buildSampleSetSummary(selectedSet, selectedSetProv), [selectedSet, selectedSetProv]);
  const displayDimensions = useMemo(() => mergeResultWithDimensionConfigs(evaluationResult, dimensionConfigs), [evaluationResult, dimensionConfigs]);
  const activeReportId = latestReport?.id || latestReport?.reportId || evaluationResult?.reportId || evaluationJob?.reportId;
  const isJobRunning = ['QUEUED', 'RUNNING'].includes(evaluationJob?.status);
  const activeReferenceEvidence = referenceEvidence || evaluationResult?.referenceModel;

  const fetchDatasetList = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await reqGetQualitySampleSets({ pageNum: 1, pageSize: 100 });
      setDatasetList(res.records || []);
    } catch (e) {
      message.error('获取样本集列表失败');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const resolveUser = async () => {
      const directId = resolveCurrentUserId(currentUser);
      if (directId) {
        if (active) setCurrentUserId(Number(directId));
        return;
      }
      try {
        if (typeof currentUser === 'string' && currentUser.trim()) {
          const userByName = await getUserByUsername(currentUser.trim());
          const lookedUpId = userByName?.userId || userByName?.userid || userByName?.id;
          if (lookedUpId && active) {
            setCurrentUserId(Number(lookedUpId));
            return;
          }
        }
      } catch (e) {}
      try {
        const state = await currentState();
        const stateUser = state?.currentUser;
        const stateId = stateUser?.userId || stateUser?.userid || stateUser?.id;
        if (stateId && active) setCurrentUserId(Number(stateId));
      } catch (e) {
        if (active) setCurrentUserId(undefined);
      }
    };
    resolveUser();
    return () => {
      active = false;
    };
  }, [currentUser]);

  const fetchDimensionTemplate = useCallback(async () => {
    try {
      const res = await reqGetQualityDimensionTemplate();
      const metricRules = res?.data?.metricRules || res?.data?.weights || {};
      setDefaultWeights(metricRules);
      return normalizeDimensionConfigs(res?.data?.dimensionConfigs || [], metricRules);
    } catch (e) {
      setDefaultWeights({});
      return normalizeDimensionConfigs([], {});
    }
  }, []);

  const applyProfileToForm = useCallback((profile, fallbackDimensions = []) => {
    const metricRules = profile?.metricRules || profile?.weights || defaultWeights || {};
    const dimensions =
      Array.isArray(profile?.dimensionConfigs) && profile.dimensionConfigs.length > 0
        ? normalizeDimensionConfigs(profile.dimensionConfigs, metricRules)
        : normalizeDimensionConfigs(fallbackDimensions, metricRules);
    setDimensionConfigs(dimensions);
    templateForm.setFieldsValue({
      name: profile?.name || '默认质量模板',
      taskType: profile?.taskType || selectedSet?.taskType || '',
      expectedBands: profile?.expectedBands || [],
      expectedExportFormat: profile?.expectedExportFormat || '',
      expectedAnnotationFormat: profile?.expectedAnnotationFormat || '',
      requiredFields: profile?.requiredFields || [],
      topologyRules: profile?.topologyRules || [],
      attributeAuditMode: profile?.attributeAuditMode || 'optional',
      referenceModelIds: [],
      confidenceThreshold: 0.3,
      iouThreshold: 0.5,
      batchSize: 16,
      scopeMode: 'all',
      sampleRatio: 0.3,
    });
  }, [defaultWeights, selectedSet?.taskType, templateForm]);

  const fetchProfileOptions = useCallback(async (fallbackDimensions = []) => {
    try {
      const res = await reqGetQualityProfileTemplates();
      const profiles = Array.isArray(res?.data) ? res.data : [];
      setProfileOptions(profiles);
      if (profiles.length > 0) {
        setSelectedProfileId(profiles[0].id);
        applyProfileToForm(profiles[0], fallbackDimensions);
      } else {
        setSelectedProfileId(undefined);
        applyProfileToForm(buildFrontendFallbackProfile(selectedSet), fallbackDimensions);
      }
    } catch (e) {
      setProfileOptions([]);
      applyProfileToForm(buildFrontendFallbackProfile(selectedSet), fallbackDimensions);
    }
  }, [applyProfileToForm, selectedSet]);

  const fetchAttributeDefs = useCallback(async () => {
    try {
      const res = await reqGetAttributeDefs();
      setAttributeDefs(res?.code === 200 && Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      setAttributeDefs([]);
    }
  }, []);

  const fetchModelOptions = useCallback(async () => {
    if (!currentUserId) {
      setModelOptions([]);
      return;
    }
    setLoadingModels(true);
    try {
      let models = [];
      if (selectedSet?.taskType) {
        models = pickResponseRecords(await reqGetQualityModels(currentUserId, selectedSet.taskType));
      }
      if (!Array.isArray(models) || models.length === 0) {
        models = pickResponseRecords(await reqGetQualityModels(currentUserId));
      }
      setModelOptions((models || []).map((item) => ({
        ...item,
        modelId: item.modelId || item.id,
        modelMeta: parseModelMeta(item.modelDes || item.model_des),
      })));
    } catch (e) {
      setModelOptions([]);
      message.warning('参考模型列表加载失败');
    } finally {
      setLoadingModels(false);
    }
  }, [currentUserId, selectedSet?.taskType]);

  const fetchReferencePreviewList = useCallback(async (sampleSetId, modelId) => {
    if (!sampleSetId || !modelId) {
      setPreviewList([]);
      setSelectedPreviewId(undefined);
      setPreviewDetail(null);
      return;
    }
    setLoadingPreviewList(true);
    try {
      const res = await reqGetQualityReferencePreviewList({ sampleSetId, modelId });
      const records = pickResponseRecords(res).map((item, idx) => normalizePreviewItem(item, idx));
      setPreviewList(records);
      setSelectedPreviewId(records[0]?.id);
      if (!records[0]) setPreviewDetail(null);
    } catch (e) {
      setPreviewList([]);
      setSelectedPreviewId(undefined);
      setPreviewDetail(null);
    } finally {
      setLoadingPreviewList(false);
    }
  }, []);

  const fetchReferencePreviewDetail = useCallback(async (previewId) => {
    if (!previewId || !selectedSet?.id || !selectedModelId) {
      setPreviewDetail(null);
      return;
    }
    const fallback = previewList.find((item) => String(item.id) === String(previewId)) || null;
    if (fallback) setPreviewDetail(fallback);
    setLoadingPreviewDetail(true);
    try {
      const res = await reqGetQualityReferencePreviewDetail(previewId, { sampleSetId: selectedSet.id, modelId: selectedModelId });
      const detail = normalizePreviewItem(res?.data || {}, 0);
      if (detail?.sourceImageUrl || detail?.resultImageUrl) setPreviewDetail(detail);
      else setPreviewDetail(fallback);
    } catch (e) {
      setPreviewDetail(fallback);
    } finally {
      setLoadingPreviewDetail(false);
    }
  }, [previewList, selectedModelId, selectedSet?.id]);

  const handleSelectDataset = async (item) => {
    setSelectedSet(item);
    setSelectedSetProv(null);
    setEvaluationResult(null);
    setEvaluationJob(null);
    setLatestReport(null);
    setReferenceEvidence(null);
    setPreviewList([]);
    setSelectedPreviewId(undefined);
    setPreviewDetail(null);
    templateForm.setFieldsValue({ taskType: item?.taskType || '' });
    setLoadingDetail(true);
    try {
      const provRes = await reqGetQualitySampleSetProv(item.id);
      setSelectedSetProv(provRes?.data || { activities: [], entities: [], relations: [], agents: [] });
    } catch (e) {
      setSelectedSetProv({ activities: [], entities: [], relations: [], agents: [] });
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleToggleDimension = (dimensionKey, enabled) => setDimensionConfigs((prev) => prev.map((item) => (item.key === dimensionKey ? { ...item, enabled } : item)));
  const handleChangeMetricRule = (dimensionKey, metricKey, thresholdRule) => setDimensionConfigs((prev) => prev.map((dim) => dim.key !== dimensionKey ? dim : { ...dim, indicators: (dim.indicators || []).map((i) => (i.key === metricKey ? { ...i, thresholdRule, rule: { ...(i.rule || {}), thresholdRule } } : i)) }));
  const handleChangeMetricRuleConfig = (dimensionKey, metricKey, patch) => setDimensionConfigs((prev) => prev.map((dim) => dim.key !== dimensionKey ? dim : {
    ...dim,
    indicators: (dim.indicators || []).map((i) => {
      if (i.key !== metricKey) return i;
      const nextRule = { ...(i.rule || {}), ...patch };
      const nextThresholdRule = patch?.direction || patch?.passValue !== undefined || patch?.warnValue !== undefined
        ? deriveThresholdRuleText(toMetricRulePayload(nextRule), nextRule.thresholdRule || i.thresholdRule || '')
        : (patch?.thresholdRule || i.thresholdRule || '');
      return {
        ...i,
        thresholdRule: nextThresholdRule,
        rule: { ...nextRule, thresholdRule: nextThresholdRule },
      };
    }),
  }));

  const handleRunReferenceEvaluation = async () => {
    if (!selectedSet?.id) return message.warning('请先选择样本集');
    if (!selectedModelId) return message.warning('请先选择参考模型');
    try {
      const values = await templateForm.validateFields();
      setRunningReference(true);
      const payload = {
        sampleSetId: selectedSet.id,
        modelId: selectedModelId,
        confidenceThreshold: values.confidenceThreshold,
        iouThreshold: values.iouThreshold,
        batchSize: values.batchSize,
        referenceScope: values.scopeMode || 'all',
        sampleRatio: values.sampleRatio,
        previewLimit: 8,
        inferParams: selectedModel?.modelMeta?.inferParams || {},
      };
      const res = await reqRunQualityReference(payload);
      const data = res?.data || {};
      setReferenceEvidence(data.referenceModel || null);
      if (data.referenceModel) {
        setEvaluationResult((prev) =>
          mergeReferenceMetricsToResult(prev, dimensionConfigs, data.referenceModel),
        );
      }
      if (Array.isArray(data.previewItems) && data.previewItems.length > 0) {
        const records = data.previewItems.map((item, idx) => normalizePreviewItem(item, idx));
        setPreviewList(records);
        setSelectedPreviewId(records[0]?.id);
      } else {
        await fetchReferencePreviewList(selectedSet.id, selectedModelId);
      }
      if (data?.referenceModel?.suitable === false) message.warning(data?.referenceModel?.reason || '参考评估未通过适配校验');
      else message.success(data?.message || '参考评估执行完成');
    } catch (e) {
      if (!e?.errorFields) message.error('执行参考评估失败');
    } finally {
      setRunningReference(false);
    }
  };

  const handleRunEvaluation = async () => {
    if (!selectedSet?.id) return message.warning('请先选择样本集');
    if (isJobRunning) return message.info('当前已有评价任务在执行中');
    try {
      const values = await templateForm.validateFields();
      setRunningEvaluation(true);
      const metricRules = collectMetricRulesFromDimensionConfigs(dimensionConfigs);
      const payload = {
        sampleSetId: selectedSet.id,
        qualityProfileId: selectedProfileId,
        selectedDimensions: dimensionConfigs.filter((item) => item.enabled).map((item) => item.key),
        overrides: {
          name: values.name,
          taskType: values.taskType || selectedSet?.taskType || '',
          expectedBands: values.expectedBands || [],
          expectedExportFormat: values.expectedExportFormat || '',
          expectedAnnotationFormat: values.expectedAnnotationFormat || '',
          requiredFields: values.requiredFields || [],
          topologyRules: values.topologyRules || [],
          attributeAuditMode: values.attributeAuditMode || 'optional',
          dimensionConfigs,
          metricRules,
          weights: metricRules,
        },
        referenceModel: values.referenceModelId ? {
          modelId: values.referenceModelId,
          confidenceThreshold: values.confidenceThreshold,
          iouThreshold: values.iouThreshold,
          batchSize: values.batchSize,
          scopeMode: values.scopeMode,
          sampleRatio: values.sampleRatio,
          inferParams: selectedModel?.modelMeta?.inferParams || {},
        } : null,
      };
      const res = await reqSubmitQualityEvaluation(payload);
      setEvaluationJob(res?.data || null);
      setEvaluationResult(null);
      message.success('质量评价任务已提交');
    } catch (e) {
      if (!e?.errorFields) message.error('质量评价任务提交失败');
    } finally {
      setRunningEvaluation(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      const dimensions = await fetchDimensionTemplate();
      await Promise.all([fetchDatasetList(), fetchAttributeDefs(), fetchProfileOptions(dimensions)]);
    };
    init();
  }, [fetchAttributeDefs, fetchDatasetList, fetchDimensionTemplate, fetchProfileOptions]);

  useEffect(() => { fetchModelOptions(); }, [fetchModelOptions]);

  useEffect(() => {
    if (!selectedSet?.id || !selectedModelId) {
      setPreviewList([]);
      setSelectedPreviewId(undefined);
      setPreviewDetail(null);
      return;
    }
    fetchReferencePreviewList(selectedSet.id, selectedModelId);
  }, [fetchReferencePreviewList, selectedModelId, selectedSet?.id]);

  useEffect(() => {
    if (!selectedPreviewId) {
      setPreviewDetail(null);
      return;
    }
    fetchReferencePreviewDetail(selectedPreviewId);
  }, [fetchReferencePreviewDetail, selectedPreviewId]);

  useEffect(() => {
    if (!evaluationJob?.id || !['QUEUED', 'RUNNING'].includes(evaluationJob?.status)) return () => {};
    let active = true;
    const poll = async () => {
      try {
        const res = await reqGetQualityEvaluationJob(evaluationJob.id);
        const nextJob = res?.data;
        if (!active || !nextJob) return;
        setEvaluationJob(nextJob);
        if (nextJob.status === 'SUCCESS') {
          const resultRes = await reqGetQualityEvaluationJobResult(nextJob.id);
          if (!active) return;
          const resultData = resultRes?.data?.result || null;
          setEvaluationResult(resultData);
          setReferenceEvidence(resultData?.referenceModel || null);
          if (resultData?.reportId || nextJob?.reportId) {
            try {
              const reportRes = await reqGetQualityReport(resultData?.reportId || nextJob?.reportId);
              setLatestReport(reportRes?.data || null);
            } catch (e) {
              setLatestReport(null);
            }
          }
          message.success('质量评价已完成');
        } else if (nextJob.status === 'FAILED') {
          message.error(nextJob.message || '质量评价执行失败');
        }
      } catch (e) {
        if (active) message.warning('质量评价进度获取失败，正在重试');
      }
    };
    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [evaluationJob?.id, evaluationJob?.status]);

  return (
    <div className="quality-container">
      <Row gutter={16}>
        <Col span={5}>
          <Card title={<span><DatabaseOutlined /> 样本集列表<Tooltip title="选择样本集后，在右侧配置模板、维度规则与参考模型"><InfoCircleOutlined style={{ marginLeft: 8, color: '#999' }} /></Tooltip></span>} bordered={false} className="dataset-list">
            <Spin spinning={loadingList}>
              <List
                dataSource={datasetList}
                locale={{ emptyText: '暂无样本集' }}
                renderItem={(item) => (
                  <List.Item className={`dataset-item ${selectedSet?.id === item.id ? 'selected' : ''}`} onClick={() => handleSelectDataset(item)}>
                    <List.Item.Meta className="dataset-meta" title={<Text strong>{item.name}</Text>} description={`${item.taskType || '-'} | ${item.num || 0} 切片`} />
                  </List.Item>
                )}
              />
            </Spin>
          </Card>
        </Col>

        <Col span={19}>
          {!selectedSet ? (
            <Card className="empty-state" bordered={false}><Empty description="请从左侧选择一个样本集以开始质量评价" /></Card>
          ) : (
            <Spin spinning={loadingDetail}>
              <div className="quality-workspace">
                <Card bordered={false} className="workspace-card" title={<span><DatabaseOutlined /> 样本集基础信息</span>}>
                  <Descriptions column={3} size="small">
                    <Descriptions.Item label="样本集名称">{selectedSet.name || '-'}</Descriptions.Item>
                    <Descriptions.Item label="任务类型">{selectedSet.taskType || '-'}</Descriptions.Item>
                    <Descriptions.Item label="样本量">{selectedSet.num || 0}</Descriptions.Item>
                    <Descriptions.Item label="创建时间">{selectedSet.createDate ? moment(selectedSet.createDate).format('YYYY-MM-DD HH:mm') : '-'}</Descriptions.Item>
                    <Descriptions.Item label="来源任务数">{sampleSetSummary.sourceTaskCount}</Descriptions.Item>
                    <Descriptions.Item label="导出格式">{sampleSetSummary.exportFormat}</Descriptions.Item>
                    <Descriptions.Item label="是否带 provenance"><Badge status={sampleSetSummary.hasProv ? 'success' : 'default'} text={sampleSetSummary.hasProv ? '是' : '否'} /></Descriptions.Item>
                  </Descriptions>
                </Card>

                <Card
                  bordered={false}
                  className="workspace-card"
                  title={
                    <div className="card-title-with-action">
                      <span><SettingOutlined /> 评价模板配置</span>
                      <Space>
                        <Select
                          value={selectedProfileId}
                          style={{ width: 220 }}
                          placeholder="选择质量评价模板"
                          allowClear
                          onChange={(profileId) => {
                            setSelectedProfileId(profileId);
                            const profile = profileOptions.find((item) => item.id === profileId);
                            if (profile) applyProfileToForm(profile, dimensionConfigs);
                          }}
                          options={profileOptions.map((item) => ({ label: item.name, value: item.id }))}
                        />
                        <Button
                          type="primary"
                          icon={<SaveOutlined />}
                          loading={savingProfile}
                          onClick={async () => {
                            try {
                              const values = await templateForm.validateFields();
                              const metricRules = collectMetricRulesFromDimensionConfigs(dimensionConfigs);
                              await reqSaveQualityProfileDraft({
                                id: selectedProfileId,
                                name: values.name,
                                taskType: values.taskType || selectedSet?.taskType || '',
                                expectedBands: values.expectedBands || [],
                                expectedExportFormat: values.expectedExportFormat || '',
                                expectedAnnotationFormat: values.expectedAnnotationFormat || '',
                                requiredFields: values.requiredFields || [],
                                topologyRules: values.topologyRules || [],
                                attributeAuditMode: values.attributeAuditMode || 'optional',
                                dimensionConfigs,
                                metricRules,
                                weights: metricRules,
                                isActive: true,
                                version: 1,
                              });
                              message.success('模板配置已保存');
                            } catch (e) {
                              if (!e?.errorFields) message.error('模板配置保存失败');
                            }
                          }}
                        >
                          保存模板
                        </Button>
                        <Button
                          icon={<PlayCircleOutlined />}
                          loading={runningEvaluation}
                          disabled={isJobRunning}
                          onClick={handleRunEvaluation}
                        >
                          {isJobRunning ? '评价进行中' : '执行评价'}
                        </Button>
                      </Space>
                    </div>
                  }
                >
                  <Form layout="vertical" form={templateForm} className="profile-form">
                    <Row gutter={16}>
                      <Col span={8}><Form.Item label="模板名称" name="name" rules={[{ required: true, message: '请输入模板名称' }]}><Input /></Form.Item></Col>
                      <Col span={8}><Form.Item label="任务类型" name="taskType"><Input /></Form.Item></Col>
                      <Col span={8}><Form.Item label="期望波段" name="expectedBands"><Select mode="tags" /></Form.Item></Col>
                      <Col span={8}><Form.Item label="期望导出格式" name="expectedExportFormat"><Select options={EXPORT_FORMAT_OPTIONS.map((v) => ({ label: v, value: v }))} /></Form.Item></Col>
                      <Col span={8}><Form.Item label="期望标注格式" name="expectedAnnotationFormat"><Select options={ANNOTATION_FORMAT_OPTIONS.map((v) => ({ label: v, value: v }))} /></Form.Item></Col>
                      <Col span={8}><Form.Item label="属性审核模式" name="attributeAuditMode"><Select options={ATTRIBUTE_AUDIT_MODE_OPTIONS} /></Form.Item></Col>
                      <Col span={12}><Form.Item label="必填字段" name="requiredFields"><Select mode="multiple" options={attributeOptions} /></Form.Item></Col>
                      <Col span={12}><Form.Item label="拓扑规则" name="topologyRules"><Select mode="multiple" options={TOPOLOGY_RULE_OPTIONS} /></Form.Item></Col>
                    </Row>
                  </Form>
                  <div className="template-metric-editor">
                    <div className="editor-title">维度启用与指标阈值/规则</div>
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      {dimensionConfigs.map((dim) => (
                        <DimensionConfigCard
                          key={dim.key}
                          dimension={dim}
                          onToggle={handleToggleDimension}
                          onRuleChange={handleChangeMetricRule}
                          onRuleConfigChange={handleChangeMetricRuleConfig}
                        />
                      ))}
                    </Space>
                  </div>
                </Card>

                <Card bordered={false} className="workspace-card" title={<span><PartitionOutlined /> 质量维度配置与结果</span>}>
                  <Row gutter={[16, 16]}>{displayDimensions.map((dim) => <Col span={24} key={dim.key}><DimensionResultCard dimension={dim} /></Col>)}</Row>
                </Card>

                <Card bordered={false} className="workspace-card" title={<div className="card-title-with-action"><span><RobotOutlined /> 参考模型配置</span><Button type="primary" icon={<PlayCircleOutlined />} loading={runningReference} onClick={handleRunReferenceEvaluation}>执行参考评估</Button></div>}>
                  <Form form={templateForm} layout="vertical" component={false}><Row gutter={16}><Col span={8}><Form.Item label="参考模型" name="referenceModelId"><Select loading={loadingModels} allowClear options={modelOptions.map((m) => ({ label: m.modelName || m.model_name || m.modelId, value: m.modelId }))} /></Form.Item></Col><Col span={4}><Form.Item label="confidenceThreshold" name="confidenceThreshold"><InputNumber min={0} max={1} step={0.05} style={{ width: '100%' }} /></Form.Item></Col><Col span={4}><Form.Item label="iouThreshold" name="iouThreshold"><InputNumber min={0} max={1} step={0.05} style={{ width: '100%' }} /></Form.Item></Col><Col span={4}><Form.Item label="batchSize" name="batchSize"><InputNumber min={1} max={256} style={{ width: '100%' }} /></Form.Item></Col><Col span={4}><Form.Item label="referenceScope" name="scopeMode"><Select options={[{ label: '全量', value: 'all' }, { label: '抽样', value: 'sample' }]} /></Form.Item></Col></Row></Form>
                  <div className="reference-disclaimer"><WarningOutlined style={{ color: '#faad14' }} /><span>参考模型结果不是严格真值，仅作为辅助证据用于定位风险样本。</span></div>
                  {selectedModel ? (
                    <Descriptions column={3} size="small" className="reference-model-info">
                      <Descriptions.Item label="模型名称">{selectedModel?.modelName || selectedModel?.model_name || '--'}</Descriptions.Item>
                      <Descriptions.Item label="模型类型">{selectedModel?.modelMeta?.arch || selectedModel?.modelType || '--'}</Descriptions.Item>
                      <Descriptions.Item label="模型版本">{selectedModel?.modelMeta?.versionTag || '--'}</Descriptions.Item>
                      <Descriptions.Item label="适用任务类型">{selectedModel?.taskType || selectedModel?.modelMeta?.taskType || '--'}</Descriptions.Item>
                      <Descriptions.Item label="输入通道">{selectedModel?.modelMeta?.inputChannels || selectedModel?.inputNum || '--'}</Descriptions.Item>
                      <Descriptions.Item label="默认参数">{JSON.stringify(selectedModel?.modelMeta?.inferParams || {})}</Descriptions.Item>
                    </Descriptions>
                  ) : null}
                  {activeReferenceEvidence ? <Descriptions column={3} size="small" className="reference-model-info"><Descriptions.Item label="评估状态"><Tag color={activeReferenceEvidence?.suitable === false ? 'red' : 'green'}>{activeReferenceEvidence?.suitable === false ? '不适用' : '已完成'}</Tag></Descriptions.Item><Descriptions.Item label="coverageRate">{formatPercent(activeReferenceEvidence?.coverageRate)}</Descriptions.Item><Descriptions.Item label="confidenceMean">{formatPercent(activeReferenceEvidence?.confidenceMean)}</Descriptions.Item><Descriptions.Item label="lowConfidenceRatio">{formatPercent(activeReferenceEvidence?.lowConfidenceRatio)}</Descriptions.Item><Descriptions.Item label="sampleCoverageRate">{formatPercent(activeReferenceEvidence?.sampleCoverageRate)}</Descriptions.Item><Descriptions.Item label="classCoverageRate">{formatPercent(activeReferenceEvidence?.classCoverageRate)}</Descriptions.Item><Descriptions.Item label="可靠性等级">{activeReferenceEvidence?.referenceReliabilityLevel || '--'}</Descriptions.Item></Descriptions> : null}
                </Card>

                <Card bordered={false} className="workspace-card" title={<span><PictureOutlined /> 参考模型推理样本预览</span>}>
                  <div className="preview-toolbar"><Space wrap><Select style={{ width: 280 }} placeholder="选择预览样本" loading={loadingPreviewList} value={selectedPreviewId} onChange={setSelectedPreviewId} options={previewList.map((item) => ({ label: item.name || String(item.id), value: item.id }))} /><Button icon={<LeftOutlined />} onClick={() => { const idx = previewList.findIndex((i) => String(i.id) === String(selectedPreviewId)); if (idx > 0) setSelectedPreviewId(previewList[idx - 1].id); }} disabled={!previewList.length} /><Button icon={<RightOutlined />} onClick={() => { const idx = previewList.findIndex((i) => String(i.id) === String(selectedPreviewId)); if (idx >= 0 && idx < previewList.length - 1) setSelectedPreviewId(previewList[idx + 1].id); }} disabled={!previewList.length} /></Space></div>
                  <div className="preview-legend">
                    <Space wrap size={[6, 6]}>
                      <Tag color="default">原始影像</Tag>
                      <Tag color="blue">多边形叠加</Tag>
                      <Tag color="orange">矩形框叠加</Tag>
                      <Tag color="green">掩膜叠加</Tag>
                    </Space>
                    <Text type="secondary">说明：推理结果为参考证据，不作为严格真值。</Text>
                  </div>
                  <Spin spinning={loadingPreviewDetail}>{previewDetail ? <><Row gutter={16}><Col span={12}><div className="preview-block-title">原图</div><PreviewImageWithOverlay imageUrl={previewDetail.originalImageUrl || previewDetail.sourceImageUrl} overlayType={previewDetail.overlayType} overlayData={previewDetail.overlayData} showOverlay={false} /></Col><Col span={12}><div className="preview-block-title">概率真值热力图</div><PreviewImageWithOverlay imageUrl={previewDetail.resultImageUrl || previewDetail.originalImageUrl || previewDetail.sourceImageUrl} overlayType={previewDetail.overlayType} overlayData={previewDetail.overlayData} showOverlay /></Col></Row><Descriptions size="small" column={2} style={{ marginTop: 12 }}><Descriptions.Item label="平均置信度">{previewDetail?.confidenceSummary?.mean ?? '--'}</Descriptions.Item><Descriptions.Item label="类别覆盖率">{previewDetail?.classSummary?.classCoverageRate ?? '--'}%</Descriptions.Item></Descriptions></> : <Empty description="暂无预览样本" />}</Spin>
                </Card>

                {evaluationJob ? (
                  <Card bordered={false} className="workspace-card" title="执行进度">
                    <div className="job-progress-header">
                      <div>
                        <div className="job-stage">{evaluationJob.stage || '等待中'}</div>
                        <div className="job-message">{evaluationJob.message || '质量评价任务已提交'}</div>
                      </div>
                      <Tag color={evaluationJob.status === 'SUCCESS' ? 'green' : evaluationJob.status === 'FAILED' ? 'red' : 'blue'}>
                        {evaluationJob.status || 'UNKNOWN'}
                      </Tag>
                    </div>
                    <Progress
                      percent={evaluationJob.progress || 0}
                      status={evaluationJob.status === 'FAILED' ? 'exception' : evaluationJob.status === 'SUCCESS' ? 'success' : 'active'}
                    />
                  </Card>
                ) : null}

                <Card bordered={false} className="workspace-card" title="报告输出"><Space><Button onClick={() => activeReportId ? history.push(`/quality/report/${activeReportId}`) : message.warning('当前暂无可查看的质量报告')}>查看报告详情</Button><Button icon={<DownloadOutlined />} onClick={async () => { if (!activeReportId) return message.warning('当前暂无可导出的质量报告'); const res = await reqGetQualityReport(activeReportId); const blob = new Blob([JSON.stringify(res?.data || {}, null, 2)], { type: 'application/json;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `quality-report-${activeReportId}.json`; link.click(); URL.revokeObjectURL(link.href); }}>下载 JSON</Button><Button icon={<PrinterOutlined />} onClick={async () => { if (!activeReportId) return message.warning('当前暂无可打印的质量报告'); const html = await reqGetQualityReportHtml(activeReportId); setReportPreviewHtml(html); setReportPreviewVisible(true); }}>预览 / 打印 HTML</Button></Space></Card>
              </div>
            </Spin>
          )}
        </Col>
      </Row>
      <Modal open={reportPreviewVisible} title="质量评价 HTML 报告预览" width={1080} onCancel={() => setReportPreviewVisible(false)} footer={[<Button key="close" onClick={() => setReportPreviewVisible(false)}>关闭</Button>, <Button key="print" type="primary" icon={<PrinterOutlined />} onClick={() => { const win = window.open('', '_blank', 'width=1200,height=900'); if (!win) return; win.document.write(reportPreviewHtml); win.document.close(); win.focus(); win.print(); }}>打印</Button>]}><iframe title="quality-report-preview" className="report-preview-frame" srcDoc={reportPreviewHtml} /></Modal>
    </div>
  );
};

export default QualityPage;
*/
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { history, useModel } from 'umi';
import moment from 'moment';
import {
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  message,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  Tabs,
  Collapse,
} from 'antd';
import {
  DatabaseOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
  LeftOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  PrinterOutlined,
  RightOutlined,
  SaveOutlined,
  SettingOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { reqGetAttributeDefs } from '@/services/taskManage/api';
import {
  reqGetQualityDimensionTemplate,
  reqGetQualityEvaluationJob,
  reqGetQualityEvaluationJobResult,
  reqGetQualityModels,
  reqGetQualityProfileTemplates,
  reqGetQualityReferencePreviewDetail,
  reqGetQualityReferencePreviewList,
  reqGetQualityReport,
  reqGetQualityReportHtml,
  reqGetQualitySampleSetProv,
  reqGetQualitySampleSets,
  reqRunQualityReference,
  reqSaveQualityProfileDraft,
  reqSubmitQualityEvaluation,
} from '@/services/quality/api';
import {
  ANNOTATION_FORMAT_OPTIONS,
  ATTRIBUTE_AUDIT_MODE_OPTIONS,
  DEFAULT_QUALITY_DIMENSIONS,
  EXPORT_FORMAT_OPTIONS,
  METRIC_STATUS_LABELS,
  QUALITY_SOURCE_COLORS,
  QUALITY_SOURCE_LABELS,
  TOPOLOGY_RULE_OPTIONS,
} from './config';
import { currentState, getUserByUsername } from '@/services/login/api';
import './style.less';

const { Text } = Typography;

// ================= Utils =================
const parseTaskIds = (taskIds) => {
  if (!taskIds) return [];
  if (Array.isArray(taskIds)) return taskIds;
  if (typeof taskIds === 'string') {
    return taskIds.replace(/^\[/, '').replace(/\]$/, '').split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
};

const inferExportFormat = (sampleSet) => {
  const labelUrl = String(sampleSet?.labelUrl || '').toLowerCase();
  if (!labelUrl) return '未记录';
  if (labelUrl.endsWith('annotations.json')) return 'COCO';
  if (labelUrl.endsWith('.xml')) return 'VOC';
  if (labelUrl.endsWith('.txt')) return 'YOLO';
  if (labelUrl.endsWith('.json')) return '项目内部格式';
  return '未记录';
};

const buildSampleSetSummary = (sampleSet, provData) => {
  const taskIds = parseTaskIds(sampleSet?.taskIds);
  const hasProv = (provData?.activities || []).length > 0 || (provData?.entities || []).length > 0;
  return { sourceTaskCount: taskIds.length, exportFormat: inferExportFormat(sampleSet), hasProv };
};

const resolveCurrentUserId = (currentUser) => {
  if (currentUser && typeof currentUser === 'object') return currentUser.userId || currentUser.userid || currentUser.id;
  const storageUserId = window.sessionStorage.getItem('userId') || window.sessionStorage.getItem('userid');
  return storageUserId ? Number(storageUserId) : undefined;
};

const parseModelMeta = (raw) => {
  if (!raw) return { inferParams: {} };
  if (typeof raw === 'object') return { inferParams: {}, ...raw };
  if (typeof raw !== 'string') return { inferParams: {} };
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { inferParams: {} };
  } catch (e) {
    return { inferParams: {} };
  }
};

const clampNumber = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

const resolveAutoThreshold = (inferParams, keyCandidates, fallback) => {
  if (!inferParams || typeof inferParams !== 'object') return fallback;
  for (let i = 0; i < keyCandidates.length; i += 1) {
    const key = keyCandidates[i];
    if (inferParams[key] !== undefined && inferParams[key] !== null && inferParams[key] !== '') {
      return clampNumber(inferParams[key], 0.01, 0.99, fallback);
    }
  }
  return fallback;
};

const buildAutoReferenceConfig = (selectedModels = []) => {
  const validModels = Array.isArray(selectedModels) ? selectedModels.filter((item) => item?.modelId !== undefined && item?.modelId !== null) : [];
  if (validModels.length === 0) {
    return {
      modelId: undefined,
      confidenceThreshold: 0.3,
      iouThreshold: 0.5,
      inferParams: {},
      referenceSources: [],
      fusionConfig: {
        method: 'staple',
        maxIter: 50,
        eps: 1e-4,
        probThreshold: 0.5,
        minAgreement: 0.2,
      },
    };
  }

  const confValues = [];
  const iouValues = [];
  validModels.forEach((model) => {
    const inferParams = model?.modelMeta?.inferParams || {};
    confValues.push(resolveAutoThreshold(inferParams, ['conf_threshold', 'confidenceThreshold', 'confidence', 'conf'], 0.3));
    iouValues.push(resolveAutoThreshold(inferParams, ['iou_threshold', 'iouThreshold', 'iou'], 0.5));
  });

  const avg = (list, fallback) => (list.length ? list.reduce((sum, n) => sum + Number(n), 0) / list.length : fallback);
  const confidenceThreshold = Number(avg(confValues, 0.3).toFixed(2));
  const iouThreshold = Number(avg(iouValues, 0.5).toFixed(2));
  const sourceWeight = Number((1 / validModels.length).toFixed(4));
  const inferParams = validModels[0]?.modelMeta?.inferParams || {};

  return {
    modelId: validModels[0].modelId,
    confidenceThreshold,
    iouThreshold,
    inferParams,
    referenceSources: validModels.map((model, idx) => ({
      sourceId: `model-${model.modelId || idx + 1}`,
      sourceType: 'model',
      modelId: model.modelId,
      weight: sourceWeight,
      confidenceCalib: { type: 'temperature', value: 1.0 },
    })),
    fusionConfig: {
      method: 'staple',
      maxIter: 50,
      eps: 1e-4,
      probThreshold: 0.5,
      minAgreement: 0.2,
    },
  };
};

const pickArray = (candidate) => {
  if (Array.isArray(candidate?.records)) return candidate.records;
  if (Array.isArray(candidate?.list)) return candidate.list;
  if (Array.isArray(candidate)) return candidate;
  return null;
};

const pickResponseRecords = (res) => {
  const fromData = pickArray(res?.data);
  if (Array.isArray(fromData)) return fromData;
  const fromRoot = pickArray(res);
  if (Array.isArray(fromRoot)) return fromRoot;
  return [];
};

const normalizeSources = (indicator, fallback = {}) => {
  const sourceList = Array.isArray(indicator?.sources) ? indicator.sources : indicator?.sourceType ? [indicator.sourceType] : Array.isArray(fallback?.sources) ? fallback.sources : [];
  return sourceList.filter(Boolean);
};

const buildMetricRuleKey = (dimensionKey, metricKey) => `${dimensionKey}.${metricKey}`;

const deriveThresholdRuleText = (rule, fallback = '') => {
  if (!rule || typeof rule !== 'object') return fallback || '';
  if (rule.mode === 'signal') return fallback || '仅作为过程信号';
  if (rule.direction === 'high') {
    const passText = rule.passMin !== undefined ? `>=${rule.passMin}%通过` : '';
    const warnText = rule.warnMin !== undefined ? `${rule.warnMin}%-${rule.passMin}%预警` : '';
    const failText = rule.warnMin !== undefined ? `<${rule.warnMin}%失败` : '';
    return [passText, warnText, failText].filter(Boolean).join('，') || fallback || '';
  }
  if (rule.direction === 'low') {
    const passText = rule.passMax !== undefined ? `<=${rule.passMax}%通过` : '';
    const warnText = rule.warnMax !== undefined ? `${rule.passMax}%-${rule.warnMax}%预警` : '';
    const failText = rule.warnMax !== undefined ? `>${rule.warnMax}%失败` : '';
    return [passText, warnText, failText].filter(Boolean).join('，') || fallback || '';
  }
  return fallback || '';
};

const normalizeMetricRule = (rule, fallbackThresholdRule = '') => {
  if (!rule || typeof rule !== 'object') {
    return { direction: 'high', passValue: undefined, warnValue: undefined, hard: true, optional: false, mode: 'threshold', thresholdRule: fallbackThresholdRule || '' };
  }
  if (rule.mode === 'signal') {
    return { mode: 'signal', direction: 'signal', passValue: undefined, warnValue: undefined, hard: false, optional: !!rule.optional, thresholdRule: deriveThresholdRuleText(rule, fallbackThresholdRule) };
  }
  const direction = rule.direction === 'low' ? 'low' : 'high';
  return {
    mode: 'threshold', direction,
    passValue: direction === 'low' ? rule.passMax : rule.passMin,
    warnValue: direction === 'low' ? rule.warnMax : rule.warnMin,
    hard: rule.hard !== undefined ? !!rule.hard : true,
    optional: !!rule.optional,
    thresholdRule: deriveThresholdRuleText(rule, fallbackThresholdRule),
  };
};

const toMetricRulePayload = (ruleConfig = {}) => {
  if (ruleConfig.mode === 'signal' || ruleConfig.direction === 'signal') return { mode: 'signal', hard: false, optional: !!ruleConfig.optional };
  const direction = ruleConfig.direction === 'low' ? 'low' : 'high';
  const payload = { direction, hard: ruleConfig.hard !== undefined ? !!ruleConfig.hard : true, optional: !!ruleConfig.optional };
  if (direction === 'low') {
    if (ruleConfig.passValue !== undefined && ruleConfig.passValue !== null && ruleConfig.passValue !== '') payload.passMax = Number(ruleConfig.passValue);
    if (ruleConfig.warnValue !== undefined && ruleConfig.warnValue !== null && ruleConfig.warnValue !== '') payload.warnMax = Number(ruleConfig.warnValue);
  } else {
    if (ruleConfig.passValue !== undefined && ruleConfig.passValue !== null && ruleConfig.passValue !== '') payload.passMin = Number(ruleConfig.passValue);
    if (ruleConfig.warnValue !== undefined && ruleConfig.warnValue !== null && ruleConfig.warnValue !== '') payload.warnMin = Number(ruleConfig.warnValue);
  }
  return payload;
};

const applyMetricRulesToDimensionConfigs = (configs, metricRules = {}) => {
  return (configs || []).map((dimension) => ({
    ...dimension,
    indicators: (dimension.indicators || []).map((indicator) => {
      const scopedRule = metricRules?.[buildMetricRuleKey(dimension.key, indicator.key)];
      const normalizedRule = normalizeMetricRule(scopedRule, indicator.thresholdRule || indicator.rule?.thresholdRule || '');
      return { ...indicator, rule: normalizedRule, thresholdRule: normalizedRule.thresholdRule };
    }),
  }));
};

const collectMetricRulesFromDimensionConfigs = (configs = []) => {
  const metricRules = {};
  (configs || []).forEach((dimension) => {
    (dimension.indicators || []).forEach((indicator) => {
      metricRules[buildMetricRuleKey(dimension.key, indicator.key)] = toMetricRulePayload(indicator.rule || {});
    });
  });
  return metricRules;
};

const buildFrontendFallbackProfile = (selectedSet) => ({
  name: '默认规则型模板',
  taskType: selectedSet?.taskType || '',
  expectedBands: [],
  expectedExportFormat: inferExportFormat(selectedSet),
  expectedAnnotationFormat: 'Polygon',
  requiredFields: [],
  topologyRules: ['polygon_no_self_intersection'],
  attributeAuditMode: 'optional',
});

const normalizeDimensionConfigs = (configs, metricRules = {}) => {
  const auditDim = 'usabilityQuality';
  const stripAudit = (dimKey, indicators = []) => indicators.filter((indicator) => !(dimKey !== auditDim && normalizeSources(indicator).includes('audit')));
  const fallbackList = DEFAULT_QUALITY_DIMENSIONS.map((item) => ({ ...item, indicators: stripAudit(item.key, item.indicators || []) }));
  const source = Array.isArray(configs) && configs.length > 0 ? configs : fallbackList;
  const mapFallback = new Map(fallbackList.map((item) => [item.key, item]));
  const normalized = source.map((item) => {
    const fb = mapFallback.get(item.key) || {};
    const mergedIndicators = (item.indicators || fb.indicators || []).map((indicator, idx) => {
      const fallbackIndicator = (fb.indicators || [])[idx] || {};
      const key = indicator?.key || fallbackIndicator?.key || `metric_${idx}`;
      return { ...fallbackIndicator, ...indicator, key, thresholdRule: indicator?.thresholdRule || indicator?.rule?.thresholdRule || fallbackIndicator?.thresholdRule || '', sources: normalizeSources(indicator, fallbackIndicator) };
    });
    return { ...fb, ...item, enabled: item?.enabled !== undefined ? !!item.enabled : fb?.enabled !== false, indicators: stripAudit(item.key, mergedIndicators) };
  });
  return applyMetricRulesToDimensionConfigs(normalized, metricRules);
};

const getMetricStatusColor = (status) => {
  if (status === 'pass' || status === 'good') return 'success';
  if (status === 'warning') return 'warning';
  if (status === 'fail' || status === 'risk') return 'error';
  return 'default';
};

const formatPercent = (value) => {
  if (value === null || value === undefined || value === '') return '--';
  const n = Number(value);
  if (Number.isNaN(n)) return '--';
  return `${n.toFixed(2)}%`;
};

const mergeResultWithDimensionConfigs = (evaluationResult, dimensionConfigs) => {
  const resultDimensions = Array.isArray(evaluationResult?.dimensions) ? evaluationResult.dimensions : [];
  const resultMap = new Map(resultDimensions.map((item) => [item.key, item]));
  return (dimensionConfigs || []).map((cfg) => {
    const dimension = resultMap.get(cfg.key);
    const metricMap = new Map((dimension?.indicators || []).map((item) => [item.key, item]));
    const indicators = (cfg.indicators || []).map((indicatorCfg) => {
      const metric = metricMap.get(indicatorCfg.key);
      if (!metric) return { key: indicatorCfg.key, label: indicatorCfg.label, sourceType: (indicatorCfg.sources || [])[0] || 'rule', sources: indicatorCfg.sources || [], score: null, value: null, status: 'pending', thresholdRule: indicatorCfg.thresholdRule || '' };
      return { ...indicatorCfg, ...metric, thresholdRule: indicatorCfg.thresholdRule || metric.thresholdRule || '', sources: Array.isArray(metric.sources) && metric.sources.length > 0 ? metric.sources : metric.sourceType ? [metric.sourceType] : indicatorCfg.sources || [] };
    });
    return { ...cfg, ...dimension, enabled: cfg.enabled, status: dimension?.status || (cfg.enabled ? 'pending' : 'disabled'), indicators };
  });
};

const parsePolygonPoints = (raw) => {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (Array.isArray(raw[0])) return raw.map((point) => (Array.isArray(point) && point.length >= 2 ? [Number(point[0]), Number(point[1])] : null)).filter(Boolean);
  if (typeof raw[0] === 'number') {
    const points = [];
    for (let i = 0; i < raw.length - 1; i += 2) points.push([Number(raw[i]), Number(raw[i + 1])]);
    return points;
  }
  return [];
};

const parseBox = (raw) => {
  if (!raw) return null;
  if (Array.isArray(raw) && raw.length >= 4) {
    const [x1, y1, x2, y2] = raw.map((v) => Number(v));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, confidence: null, label: '' };
  }
  if (raw.x1 !== undefined && raw.y1 !== undefined && raw.x2 !== undefined && raw.y2 !== undefined) {
    return { x: Number(raw.x1), y: Number(raw.y1), w: Number(raw.x2) - Number(raw.x1), h: Number(raw.y2) - Number(raw.y1), confidence: raw.confidence, label: raw.label };
  }
  return null;
};

const normalizeOverlayType = (overlayType) => {
  const type = String(overlayType || '').toLowerCase();
  if (type === 'poly' || type === 'polygons') return 'polygon';
  if (type === 'box' || type === 'rect' || type === 'rectangle') return 'bbox';
  if (type === 'heatmap' || type === 'probability' || type === 'probability_heatmap') return 'mask';
  return type || '';
};

const isFiniteNumber = (value) => Number.isFinite(Number(value));

const statusFromReferenceMetric = (metricKey, rawValue) => {
  if (!isFiniteNumber(rawValue)) return 'pending';
  const value = Number(rawValue);
  const higherBetter = (passMin, warnMin) => (value >= passMin ? 'pass' : value >= warnMin ? 'warning' : 'fail');
  const lowerBetter = (passMax, warnMax) => (value <= passMax ? 'pass' : value <= warnMax ? 'warning' : 'fail');
  switch (metricKey) {
    case 'referenceFeatureMissingRate':
    case 'referenceFeatureRedundancyRate': return lowerBetter(10, 25);
    case 'referenceBoundaryDeviation': return lowerBetter(15, 30);
    case 'referenceClassificationAccuracy': return higherBetter(90, 75);
    case 'referenceObjectOverlap':
    case 'referenceBoundaryPassRate': return higherBetter(85, 70);
    case 'referenceReliabilityLevel': return higherBetter(75, 55);
    default: return 'pending';
  }
};

const mergeReferenceMetricsToResult = (prevResult, dimensionConfigs, referenceModel) => {
  if (!referenceModel || typeof referenceModel !== 'object') return prevResult;
  const indicators = referenceModel?.indicators || {};
  const keyValueMap = {
    referenceFeatureMissingRate: indicators.referenceFeatureMissingRate ?? indicators.missingFeatureRate,
    referenceFeatureRedundancyRate: indicators.referenceFeatureRedundancyRate ?? indicators.redundantFeatureRate,
    referenceClassificationAccuracy: indicators.referenceClassificationAccuracy ?? indicators.classificationAccuracy,
    referenceObjectOverlap: indicators.referenceObjectOverlap ?? indicators.objectOverlap,
    referenceBoundaryDeviation: indicators.referenceBoundaryDeviation ?? indicators.boundaryDeviation,
    referenceBoundaryPassRate: indicators.referenceBoundaryPassRate ?? indicators.boundaryPassRate,
    referenceReliabilityLevel: referenceModel.confidenceScore ?? (isFiniteNumber(referenceModel.referenceReliability) ? Number(referenceModel.referenceReliability) * 100 : undefined),
  };
  const baseDimensions = Array.isArray(prevResult?.dimensions) && prevResult.dimensions.length > 0 ? prevResult.dimensions : (dimensionConfigs || []).map((dim) => ({ key: dim.key, label: dim.label, status: dim.enabled ? 'pending' : 'disabled', indicators: (dim.indicators || []).map((metric) => ({ key: metric.key, label: metric.label, status: 'pending', sourceType: (metric.sources || [])[0] || 'rule' })) }));
  const patchedDimensions = baseDimensions.map((dim) => {
    const nextIndicators = (Array.isArray(dim?.indicators) ? dim.indicators : []).map((metric) => {
      const key = metric?.key;
      if (!key || keyValueMap[key] === undefined || keyValueMap[key] === null) return metric;
      const rawValue = keyValueMap[key];
      const value = isFiniteNumber(rawValue) ? `${Number(rawValue).toFixed(2)}%` : rawValue;
      return { ...metric, value, score: isFiniteNumber(rawValue) ? Number(rawValue) : metric?.score ?? null, sourceType: 'model', sources: ['model'], status: statusFromReferenceMetric(key, rawValue) };
    });
    const hasFail = nextIndicators.some((m) => m?.status === 'fail');
    const hasWarning = nextIndicators.some((m) => m?.status === 'warning');
    const hasPass = nextIndicators.some((m) => m?.status === 'pass');
    return { ...dim, indicators: nextIndicators, status: hasFail ? 'fail' : hasWarning ? 'warning' : hasPass ? 'pass' : dim?.status || 'pending' };
  });
  return { ...(prevResult || {}), referenceModel, dimensions: patchedDimensions, dimensionResults: patchedDimensions };
};

const normalizePreviewItem = (item, index = 0) => {
  const id = item?.id ?? item?.previewId ?? item?.sampleId ?? `sample_${index}`;
  const previewType = normalizeOverlayType(item?.overlayType || item?.previewType || '');
  const overlayMaskUrl = item?.overlayMaskUrl || item?.overlayMaskImageUrl || item?.overlayData?.maskImageUrl || '';
  const overlayPolygons = item?.overlayPolygons || [];
  const overlayBoxes = item?.overlayBoxes || [];
  return {
    ...item, id, name: item?.name || item?.sliceFileName || `样本 ${index + 1}`,
    originalImageUrl: item?.originalImageUrl || item?.sourceImageUrl || '',
    sourceImageUrl: item?.sourceImageUrl || item?.originalImageUrl || '',
    resultImageUrl: item?.resultImageUrl || overlayMaskUrl || item?.sourceImageUrl || '',
    previewType, overlayType: previewType, overlayMaskUrl, overlayPolygons, overlayBoxes,
    overlayData: item?.overlayData || { polygons: overlayPolygons, boxes: overlayBoxes, maskImageUrl: overlayMaskUrl, width: item?.width, height: item?.height },
  };
};

// ================= Sub Components =================

const PreviewImageWithOverlay = ({ imageUrl, overlayType, overlayData, showOverlay }) => {
  if (!imageUrl) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无图像" />;
  const viewWidth = Number(overlayData?.width || 1000);
  const viewHeight = Number(overlayData?.height || 1000);
  const polygons = Array.isArray(overlayData?.polygons) ? overlayData.polygons : [];
  const boxes = Array.isArray(overlayData?.boxes) ? overlayData.boxes : [];
  const maskImageUrl = overlayData?.maskImageUrl || '';
  const showHeatmapLegend = showOverlay && overlayType === 'mask' && !!maskImageUrl;
  const legendId = `heatmapLegend_${String(maskImageUrl || imageUrl || 'default').replace(/[^a-zA-Z0-9]/g, '_')}`;
  return (
    <div className="preview-image-shell">
      <svg className="preview-svg-stage" viewBox={`0 0 ${viewWidth} ${viewHeight}`} preserveAspectRatio="xMidYMid meet">
        <image href={imageUrl} x="0" y="0" width={viewWidth} height={viewHeight} preserveAspectRatio="xMidYMid meet" />
        {showOverlay && overlayType === 'mask' && maskImageUrl ? <image href={maskImageUrl} x="0" y="0" width={viewWidth} height={viewHeight} preserveAspectRatio="xMidYMid meet" opacity="0.92" /> : null}
        {showOverlay && !showHeatmapLegend && overlayType === 'polygon' ? polygons.map((poly) => {
          const points = parsePolygonPoints(poly?.points || poly?.segmentation || poly);
          if (points.length < 3) return null;
          const first = points[0] || [];
          return <polygon key={`poly_${points.length}_${first[0] || 0}_${first[1] || 0}`} points={points.map((p) => `${p[0]},${p[1]}`).join(' ')} fill="rgba(24,144,255,0.24)" stroke="#1677ff" strokeWidth="2" />;
        }) : null}
        {showOverlay && !showHeatmapLegend && overlayType === 'bbox' ? boxes.map((raw) => {
          const box = parseBox(raw);
          if (!box) return null;
          return <rect key={`box_${box.x}_${box.y}_${box.w}_${box.h}`} x={box.x} y={box.y} width={box.w} height={box.h} fill="rgba(250,84,28,0.12)" stroke="#fa541c" strokeWidth="2" />;
        }) : null}
      </svg>
      {showHeatmapLegend ? <div className="heatmap-legend" style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 2, minWidth: 92, padding: '10px 10px 8px', borderRadius: 10, background: 'rgba(255,255,255,0.92)', border: '1px solid rgba(31,31,31,0.08)', boxShadow: '0 6px 20px rgba(0,0,0,0.12)' }}><div className="heatmap-legend-title" style={{ marginBottom: 6, fontSize: 12, fontWeight: 600, color: '#262626' }}>概率图例</div><div className="heatmap-legend-scale" style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}><svg width="14" height="112" viewBox="0 0 14 112" aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}><defs><linearGradient id={legendId} x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor="#1d4ed8" /><stop offset="25%" stopColor="#06b6d4" /><stop offset="50%" stopColor="#22c55e" /><stop offset="75%" stopColor="#facc15" /><stop offset="100%" stopColor="#ef4444" /></linearGradient></defs><rect x="0.5" y="0.5" width="13" height="111" rx="7" fill={`url(#${legendId})`} stroke="rgba(0,0,0,0.08)" /></svg><div className="heatmap-legend-labels" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: 112, fontSize: 11, color: '#595959' }}><span>1.0</span><span>0.5</span><span>0.0</span></div></div></div> : null}
    </div>
  );
};

const UnifiedDimensionCard = ({ dimension, onToggle, onRuleChange, onRuleConfigChange }) => {
  const columns = [
    { title: '指标名称', dataIndex: 'label', key: 'label', width: 180, fixed: 'left' },
    {
      title: '判定方式', dataIndex: 'rule', key: 'direction', width: 110,
      render: (_, record) => (
        <Select
          value={record?.rule?.direction || 'high'} style={{ width: '100%' }}
          onChange={(value) => onRuleConfigChange(dimension.key, record.key, { direction: value, mode: value === 'signal' ? 'signal' : 'threshold' })}
          options={[{ label: '高值优', value: 'high' }, { label: '低值优', value: 'low' }, { label: '信号项', value: 'signal' }]}
        />
      ),
    },
    {
      title: '通过阈值', dataIndex: 'rule', key: 'passValue', width: 100,
      render: (_, record) => <InputNumber value={record?.rule?.passValue} min={0} max={100} disabled={record?.rule?.direction === 'signal'} style={{ width: '100%' }} onChange={(value) => onRuleConfigChange(dimension.key, record.key, { passValue: value })} />
    },
    {
      title: '预警阈值', dataIndex: 'rule', key: 'warnValue', width: 100,
      render: (_, record) => <InputNumber value={record?.rule?.warnValue} min={0} max={100} disabled={record?.rule?.direction === 'signal'} style={{ width: '100%' }} onChange={(value) => onRuleConfigChange(dimension.key, record.key, { warnValue: value })} />
    },
    {
      title: '阈值/规则备注', dataIndex: 'thresholdRule', key: 'thresholdRule', width: 180,
      render: (_, record) => <Input value={record.thresholdRule} onChange={(e) => onRuleChange(dimension.key, record.key, e.target.value)} />
    },
    { title: '计算结果', dataIndex: 'value', key: 'value', width: 110, render: (value, row) => (value ?? row?.score ?? '--') },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: (status) => <Tag color={getMetricStatusColor(status)}>{METRIC_STATUS_LABELS[status] || '未评价'}</Tag> },
    {
      title: '数据来源', dataIndex: 'sources', key: 'sources', width: 150,
      render: (sources = []) => (
        <Space wrap size={[4, 4]}>
          {(sources || []).map((source) => <Tag key={source} color={QUALITY_SOURCE_COLORS[source] || 'default'}>{QUALITY_SOURCE_LABELS[source] || source}</Tag>)}
        </Space>
      ),
    },
  ];

  return (
    <Card
      size="small" bordered
      className={`dimension-config-card ${dimension.enabled ? 'enabled' : 'disabled'}`}
      title={
        <div className="dimension-config-title">
          <span>
            {dimension.label}
            {dimension.status && dimension.status !== 'pending' && <Tag style={{ marginLeft: 8 }} color={getMetricStatusColor(dimension.status)}>{METRIC_STATUS_LABELS[dimension.status]}</Tag>}
          </span>
          <Switch checked={dimension.enabled} onChange={(checked) => onToggle(dimension.key, checked)} />
        </div>
      }
    >
      <Table rowKey="key" size="small" pagination={false} columns={columns} dataSource={dimension.indicators || []} scroll={{ x: 1050 }} />
    </Card>
  );
};

// ================= Main Page Component =================

const QualityPage = () => {
  const { initialState } = useModel('@@initialState');
  const currentUser = initialState?.currentState?.currentUser;
  const [templateForm] = Form.useForm();

  const [currentUserId, setCurrentUserId] = useState(() => resolveCurrentUserId(currentUser));
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [runningEvaluation, setRunningEvaluation] = useState(false);
  const [runningReference, setRunningReference] = useState(false);
  const [loadingPreviewList, setLoadingPreviewList] = useState(false);
  const [loadingPreviewDetail, setLoadingPreviewDetail] = useState(false);

  const [datasetList, setDatasetList] = useState([]);
  const [selectedSet, setSelectedSet] = useState(null);
  const [selectedSetProv, setSelectedSetProv] = useState(null);
  const [profileOptions, setProfileOptions] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(undefined);
  const [dimensionConfigs, setDimensionConfigs] = useState([]);
  const [attributeDefs, setAttributeDefs] = useState([]);
  const [modelOptions, setModelOptions] = useState([]);
  const [evaluationResult, setEvaluationResult] = useState(null);
  const [evaluationJob, setEvaluationJob] = useState(null);
  const [latestReport, setLatestReport] = useState(null);
  const [previewList, setPreviewList] = useState([]);
  const [selectedPreviewId, setSelectedPreviewId] = useState(undefined);
  const [previewDetail, setPreviewDetail] = useState(null);
  const [referenceEvidence, setReferenceEvidence] = useState(null);
  const [reportPreviewVisible, setReportPreviewVisible] = useState(false);
  const [reportPreviewHtml, setReportPreviewHtml] = useState('');
  const defaultMetricRulesRef = useRef({});
  const hasInitializedRef = useRef(false);

  const selectedModelIds = Form.useWatch('referenceModelIds', templateForm);
  const selectedModelIdList = useMemo(
    () => (Array.isArray(selectedModelIds) ? selectedModelIds.filter((id) => id !== undefined && id !== null && id !== '') : []),
    [selectedModelIds],
  );
  const selectedReferenceModels = useMemo(
    () => modelOptions.filter((item) => selectedModelIdList.some((id) => String(item.modelId) === String(id))),
    [modelOptions, selectedModelIdList],
  );
  const autoReferenceConfig = useMemo(() => buildAutoReferenceConfig(selectedReferenceModels), [selectedReferenceModels]);
  const primarySelectedModelId = autoReferenceConfig.modelId;
  const attributeOptions = useMemo(() => (attributeDefs || []).map((item) => ({ label: item?.attrName || item?.attr_name || item?.attrKey || item?.attr_key, value: item?.attrKey || item?.attr_key })), [attributeDefs]);
  const sampleSetSummary = useMemo(() => buildSampleSetSummary(selectedSet, selectedSetProv), [selectedSet, selectedSetProv]);
  const displayDimensions = useMemo(() => mergeResultWithDimensionConfigs(evaluationResult, dimensionConfigs), [evaluationResult, dimensionConfigs]);
  const activeReportId = latestReport?.id || latestReport?.reportId || evaluationResult?.reportId || evaluationJob?.reportId;
  const isJobRunning = ['QUEUED', 'RUNNING'].includes(evaluationJob?.status);
  const activeReferenceEvidence = referenceEvidence || evaluationResult?.referenceModel;

  const fetchDatasetList = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await reqGetQualitySampleSets({ pageNum: 1, pageSize: 100 });
      setDatasetList(res.records || []);
    } catch (e) {
      message.error('获取样本集列表失败');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const resolveUser = async () => {
      const directId = resolveCurrentUserId(currentUser);
      if (directId) { if (active) setCurrentUserId(Number(directId)); return; }
      try {
        if (typeof currentUser === 'string' && currentUser.trim()) {
          const userByName = await getUserByUsername(currentUser.trim());
          const lookedUpId = userByName?.userId || userByName?.userid || userByName?.id;
          if (lookedUpId && active) { setCurrentUserId(Number(lookedUpId)); return; }
        }
      } catch (e) { }
      try {
        const state = await currentState();
        const stateId = state?.currentUser?.userId || state?.currentUser?.userid || state?.currentUser?.id;
        if (stateId && active) setCurrentUserId(Number(stateId));
      } catch (e) {
        if (active) setCurrentUserId(undefined);
      }
    };
    resolveUser();
    return () => { active = false; };
  }, [currentUser]);

  const fetchDimensionTemplate = useCallback(async () => {
    try {
      const res = await reqGetQualityDimensionTemplate();
      const metricRules = res?.data?.metricRules || res?.data?.weights || {};
      defaultMetricRulesRef.current = metricRules;
      return normalizeDimensionConfigs(res?.data?.dimensionConfigs || [], metricRules);
    } catch (e) {
      defaultMetricRulesRef.current = {};
      return normalizeDimensionConfigs([], {});
    }
  }, []);

  const applyProfileToForm = useCallback((profile, fallbackDimensions = []) => {
    const metricRules = profile?.metricRules || profile?.weights || defaultMetricRulesRef.current || {};
    const dimensions = Array.isArray(profile?.dimensionConfigs) && profile.dimensionConfigs.length > 0 ? normalizeDimensionConfigs(profile.dimensionConfigs, metricRules) : normalizeDimensionConfigs(fallbackDimensions, metricRules);
    setDimensionConfigs(dimensions);
    templateForm.setFieldsValue({
      name: profile?.name || '默认质量模板',
      taskType: profile?.taskType || templateForm.getFieldValue('taskType') || '',
      expectedBands: profile?.expectedBands || [],
      expectedExportFormat: profile?.expectedExportFormat || '',
      expectedAnnotationFormat: profile?.expectedAnnotationFormat || '',
      requiredFields: profile?.requiredFields || [],
      topologyRules: profile?.topologyRules || [],
      attributeAuditMode: profile?.attributeAuditMode || 'optional',
      referenceModelIds: [],
      confidenceThreshold: 0.3,
      iouThreshold: 0.5,
      batchSize: 16,
      scopeMode: 'all',
      sampleRatio: 0.3,
    });
  }, [templateForm]);

  const fetchProfileOptions = useCallback(async (fallbackDimensions = [], fallbackProfile = buildFrontendFallbackProfile()) => {
    try {
      const res = await reqGetQualityProfileTemplates();
      const profiles = Array.isArray(res?.data) ? res.data : [];
      setProfileOptions(profiles);
      if (profiles.length > 0) {
        setSelectedProfileId(profiles[0].id);
        applyProfileToForm(profiles[0], fallbackDimensions);
      } else {
        setSelectedProfileId(undefined);
        applyProfileToForm(fallbackProfile, fallbackDimensions);
      }
    } catch (e) {
      setProfileOptions([]);
      applyProfileToForm(fallbackProfile, fallbackDimensions);
    }
  }, [applyProfileToForm]);

  const fetchAttributeDefs = useCallback(async () => {
    try {
      const res = await reqGetAttributeDefs();
      setAttributeDefs(res?.code === 200 && Array.isArray(res.data) ? res.data : []);
    } catch (e) { setAttributeDefs([]); }
  }, []);

  const fetchModelOptions = useCallback(async () => {
    if (!currentUserId) { setModelOptions([]); return; }
    setLoadingModels(true);
    try {
      let models = [];
      if (selectedSet?.taskType) models = pickResponseRecords(await reqGetQualityModels(currentUserId, selectedSet.taskType));
      if (!Array.isArray(models) || models.length === 0) models = pickResponseRecords(await reqGetQualityModels(currentUserId));
      setModelOptions((models || []).map((item) => ({ ...item, modelId: item.modelId || item.id, modelMeta: parseModelMeta(item.modelDes || item.model_des) })));
    } catch (e) {
      setModelOptions([]);
      message.warning('参考模型列表加载失败');
    } finally {
      setLoadingModels(false);
    }
  }, [currentUserId, selectedSet?.taskType]);

  const fetchReferencePreviewList = useCallback(async (sampleSetId, modelId) => {
    if (!sampleSetId || !modelId) {
      setPreviewList([]); setSelectedPreviewId(undefined); setPreviewDetail(null); return;
    }
    setLoadingPreviewList(true);
    try {
      const res = await reqGetQualityReferencePreviewList({ sampleSetId, modelId });
      const records = pickResponseRecords(res).map((item, idx) => normalizePreviewItem(item, idx));
      setPreviewList(records);
      setSelectedPreviewId(records[0]?.id);
      if (!records[0]) setPreviewDetail(null);
    } catch (e) {
      setPreviewList([]); setSelectedPreviewId(undefined); setPreviewDetail(null);
    } finally {
      setLoadingPreviewList(false);
    }
  }, []);

  const fetchReferencePreviewDetail = useCallback(async (previewId) => {
    if (!previewId || !selectedSet?.id || !primarySelectedModelId) { setPreviewDetail(null); return; }
    const fallback = previewList.find((item) => String(item.id) === String(previewId)) || null;
    if (fallback) setPreviewDetail(fallback);
    setLoadingPreviewDetail(true);
    try {
      const res = await reqGetQualityReferencePreviewDetail(previewId, { sampleSetId: selectedSet.id, modelId: primarySelectedModelId });
      const detail = normalizePreviewItem(res?.data || {}, 0);
      if (detail?.sourceImageUrl || detail?.resultImageUrl) setPreviewDetail(detail);
      else setPreviewDetail(fallback);
    } catch (e) { setPreviewDetail(fallback); } finally { setLoadingPreviewDetail(false); }
  }, [previewList, primarySelectedModelId, selectedSet?.id]);

  const handleSelectDataset = async (item) => {
    setSelectedSet(item); setSelectedSetProv(null); setEvaluationResult(null); setEvaluationJob(null); setLatestReport(null); setReferenceEvidence(null); setPreviewList([]); setSelectedPreviewId(undefined); setPreviewDetail(null);
    templateForm.setFieldsValue({ taskType: item?.taskType || '' });
    setLoadingDetail(true);
    try {
      const provRes = await reqGetQualitySampleSetProv(item.id);
      setSelectedSetProv(provRes?.data || { activities: [], entities: [], relations: [], agents: [] });
    } catch (e) { setSelectedSetProv({ activities: [], entities: [], relations: [], agents: [] }); } finally { setLoadingDetail(false); }
  };

  const handleToggleDimension = (dimensionKey, enabled) => setDimensionConfigs((prev) => prev.map((item) => (item.key === dimensionKey ? { ...item, enabled } : item)));
  const handleChangeMetricRule = (dimensionKey, metricKey, thresholdRule) => setDimensionConfigs((prev) => prev.map((dim) => dim.key !== dimensionKey ? dim : { ...dim, indicators: (dim.indicators || []).map((i) => (i.key === metricKey ? { ...i, thresholdRule, rule: { ...(i.rule || {}), thresholdRule } } : i)) }));
  const handleChangeMetricRuleConfig = (dimensionKey, metricKey, patch) => setDimensionConfigs((prev) => prev.map((dim) => dim.key !== dimensionKey ? dim : {
    ...dim, indicators: (dim.indicators || []).map((i) => {
      if (i.key !== metricKey) return i;
      const nextRule = { ...(i.rule || {}), ...patch };
      const nextThresholdRule = patch?.direction || patch?.passValue !== undefined || patch?.warnValue !== undefined ? deriveThresholdRuleText(toMetricRulePayload(nextRule), nextRule.thresholdRule || i.thresholdRule || '') : (patch?.thresholdRule || i.thresholdRule || '');
      return { ...i, thresholdRule: nextThresholdRule, rule: { ...nextRule, thresholdRule: nextThresholdRule } };
    }),
  }));

  const handleRunReferenceEvaluation = async () => {
    if (!selectedSet?.id) return message.warning('请先选择样本集');
    if (!selectedReferenceModels.length) return message.warning('请至少选择一个参考模型数据源');
    try {
      const values = await templateForm.validateFields();
      setRunningReference(true);
      const payload = {
        sampleSetId: selectedSet.id,
        modelId: autoReferenceConfig.modelId,
        confidenceThreshold: autoReferenceConfig.confidenceThreshold,
        iouThreshold: autoReferenceConfig.iouThreshold,
        batchSize: values.batchSize,
        referenceScope: values.scopeMode || 'all',
        sampleRatio: values.sampleRatio,
        previewLimit: 8,
        inferParams: autoReferenceConfig.inferParams || {},
        referenceSources: autoReferenceConfig.referenceSources || [],
        fusionConfig: autoReferenceConfig.fusionConfig,
      };
      const res = await reqRunQualityReference(payload);
      const data = res?.data || {};
      setReferenceEvidence(data.referenceModel || null);
      if (data.referenceModel) setEvaluationResult((prev) => mergeReferenceMetricsToResult(prev, dimensionConfigs, data.referenceModel));
      if (Array.isArray(data.previewItems) && data.previewItems.length > 0) {
        const records = data.previewItems.map((item, idx) => normalizePreviewItem(item, idx));
        setPreviewList(records); setSelectedPreviewId(records[0]?.id);
      } else {
        await fetchReferencePreviewList(selectedSet.id, autoReferenceConfig.modelId);
      }
      if (data?.referenceModel?.suitable === false) message.warning(data?.referenceModel?.reason || '参考评估未通过适配校验');
      else message.success(data?.message || '参考评估执行完成');
    } catch (e) { if (!e?.errorFields) message.error('执行参考评估失败'); } finally { setRunningReference(false); }
  };

  const handleRunEvaluation = async () => {
    if (!selectedSet?.id) return message.warning('请先选择样本集');
    if (isJobRunning) return message.info('当前已有评价任务在执行中');
    try {
      const values = await templateForm.validateFields();
      setRunningEvaluation(true);
      const metricRules = collectMetricRulesFromDimensionConfigs(dimensionConfigs);
      const payload = {
        sampleSetId: selectedSet.id, qualityProfileId: selectedProfileId, selectedDimensions: dimensionConfigs.filter((item) => item.enabled).map((item) => item.key),
        overrides: {
          name: values.name, taskType: values.taskType || selectedSet?.taskType || '', expectedBands: values.expectedBands || [], expectedExportFormat: values.expectedExportFormat || '', expectedAnnotationFormat: values.expectedAnnotationFormat || '', requiredFields: values.requiredFields || [], topologyRules: values.topologyRules || [], attributeAuditMode: values.attributeAuditMode || 'optional', dimensionConfigs, metricRules, weights: metricRules,
        },
        referenceModel: selectedReferenceModels.length ? {
          modelId: autoReferenceConfig.modelId,
          confidenceThreshold: autoReferenceConfig.confidenceThreshold,
          iouThreshold: autoReferenceConfig.iouThreshold,
          batchSize: values.batchSize,
          scopeMode: values.scopeMode,
          sampleRatio: values.sampleRatio,
          inferParams: autoReferenceConfig.inferParams || {},
          referenceSources: autoReferenceConfig.referenceSources || [],
          fusionConfig: autoReferenceConfig.fusionConfig,
        } : null,
      };
      const res = await reqSubmitQualityEvaluation(payload);
      setEvaluationJob(res?.data || null); setEvaluationResult(null); message.success('质量评价任务已提交');
    } catch (e) { if (!e?.errorFields) message.error('质量评价任务提交失败'); } finally { setRunningEvaluation(false); }
  };

  const handleSaveProfile = async () => {
    try {
      const values = await templateForm.validateFields();
      setSavingProfile(true);
      const metricRules = collectMetricRulesFromDimensionConfigs(dimensionConfigs);
      await reqSaveQualityProfileDraft({
        id: selectedProfileId, name: values.name, taskType: values.taskType || selectedSet?.taskType || '', expectedBands: values.expectedBands || [], expectedExportFormat: values.expectedExportFormat || '', expectedAnnotationFormat: values.expectedAnnotationFormat || '', requiredFields: values.requiredFields || [], topologyRules: values.topologyRules || [], attributeAuditMode: values.attributeAuditMode || 'optional', dimensionConfigs, metricRules, weights: metricRules, isActive: true, version: 1,
      });
      message.success('模板配置已保存');
    } catch (e) {
      if (!e?.errorFields) message.error('模板配置保存失败');
    } finally {
      setSavingProfile(false);
    }
  };

  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;
    const init = async () => {
      const dimensions = await fetchDimensionTemplate();
      await Promise.all([
        fetchDatasetList(),
        fetchAttributeDefs(),
        fetchProfileOptions(dimensions, buildFrontendFallbackProfile()),
      ]);
    };
    init();
  }, [fetchAttributeDefs, fetchDatasetList, fetchDimensionTemplate, fetchProfileOptions]);

  useEffect(() => { fetchModelOptions(); }, [fetchModelOptions]);

  useEffect(() => {
    templateForm.setFieldsValue({
      confidenceThreshold: autoReferenceConfig.confidenceThreshold,
      iouThreshold: autoReferenceConfig.iouThreshold,
    });
  }, [autoReferenceConfig.confidenceThreshold, autoReferenceConfig.iouThreshold, templateForm]);

  useEffect(() => {
    if (!selectedSet) return;
    if (selectedProfileId) {
      if (!templateForm.getFieldValue('taskType') && selectedSet?.taskType) {
        templateForm.setFieldsValue({ taskType: selectedSet.taskType });
      }
      return;
    }
    templateForm.setFieldsValue({
      taskType: selectedSet?.taskType || '',
      expectedExportFormat: inferExportFormat(selectedSet),
    });
  }, [selectedProfileId, selectedSet, templateForm]);

  useEffect(() => {
    if (!selectedSet?.id || !primarySelectedModelId) { setPreviewList([]); setSelectedPreviewId(undefined); setPreviewDetail(null); return; }
    fetchReferencePreviewList(selectedSet.id, primarySelectedModelId);
  }, [fetchReferencePreviewList, primarySelectedModelId, selectedSet?.id]);
  useEffect(() => {
    if (!selectedPreviewId) { setPreviewDetail(null); return; }
    fetchReferencePreviewDetail(selectedPreviewId);
  }, [fetchReferencePreviewDetail, selectedPreviewId]);

  useEffect(() => {
    if (!evaluationJob?.id || !['QUEUED', 'RUNNING'].includes(evaluationJob?.status)) return () => { };
    let active = true;
    const poll = async () => {
      try {
        const res = await reqGetQualityEvaluationJob(evaluationJob.id);
        const nextJob = res?.data;
        if (!active || !nextJob) return;
        setEvaluationJob(nextJob);
        if (nextJob.status === 'SUCCESS') {
          const resultRes = await reqGetQualityEvaluationJobResult(nextJob.id);
          if (!active) return;
          const resultData = resultRes?.data?.result || null;
          setEvaluationResult(resultData); setReferenceEvidence(resultData?.referenceModel || null);
          if (resultData?.reportId || nextJob?.reportId) {
            try {
              const reportRes = await reqGetQualityReport(resultData?.reportId || nextJob?.reportId);
              setLatestReport(reportRes?.data || null);
            } catch (e) { setLatestReport(null); }
          }
          message.success('质量评价已完成');
        } else if (nextJob.status === 'FAILED') {
          message.error(nextJob.message || '质量评价执行失败');
        }
      } catch (e) { if (active) message.warning('质量评价进度获取失败，正在重试'); }
    };
    poll();
    const timer = setInterval(poll, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [evaluationJob?.id, evaluationJob?.status]);

  return (
    <div className="quality-container">
      <Row gutter={16}>
        <Col span={5}>
          <Card title={<span><DatabaseOutlined /> 样本集列表<Tooltip title="选择样本集后，在右侧配置模板、维度规则与参考模型"><InfoCircleOutlined style={{ marginLeft: 8, color: '#999' }} /></Tooltip></span>} bordered={false} className="dataset-list">
            <Spin spinning={loadingList}>
              <List
                dataSource={datasetList} locale={{ emptyText: '暂无样本集' }}
                renderItem={(item) => (
                  <List.Item className={`dataset-item ${selectedSet?.id === item.id ? 'selected' : ''}`} onClick={() => handleSelectDataset(item)}>
                    <List.Item.Meta className="dataset-meta" title={<Text strong>{item.name}</Text>} description={`${item.taskType || '-'} | ${item.num || 0} 切片`} />
                  </List.Item>
                )}
              />
            </Spin>
          </Card>
        </Col>

        <Col span={19}>
          {!selectedSet ? (
            <Card className="empty-state" bordered={false}><Empty description="请从左侧选择一个样本集以开始质量评价" /></Card>
          ) : (
            <Spin spinning={loadingDetail}>
              <div className="quality-workspace">
                {/* 顶部悬浮操作区 */}
                <Card bordered={false} bodyStyle={{ padding: '12px 24px' }} className="workspace-header">
                  <div className="card-title-with-action">
                    <div className="workspace-title">当前样本集：{selectedSet.name}</div>
                    <Space wrap>
                      <Select value={selectedProfileId} style={{ width: 180 }} placeholder="选择评价模板" allowClear onChange={(profileId) => { setSelectedProfileId(profileId); const profile = profileOptions.find((item) => item.id === profileId); if (profile) applyProfileToForm(profile, dimensionConfigs); }} options={profileOptions.map((item) => ({ label: item.name, value: item.id }))} />
                      <Button icon={<SaveOutlined />} loading={savingProfile} onClick={handleSaveProfile}>保存模板</Button>
                      <Button icon={<PlayCircleOutlined />} loading={runningReference} onClick={handleRunReferenceEvaluation}>执行参考评估</Button>
                      <Button type="primary" icon={<PlayCircleOutlined />} loading={runningEvaluation} disabled={isJobRunning} onClick={handleRunEvaluation}>{isJobRunning ? '评价进行中' : '执行质量评价'}</Button>
                    </Space>
                  </div>
                </Card>

                {/* 核心工作流 Tabs */}
                <Card bordered={false} className="workspace-card" bodyStyle={{ paddingTop: 0 }}>
                  <Tabs
                    defaultActiveKey="1"
                    size="large"
                    items={[
                      {
                        key: '1',
                        label: '评价配置与结果',
                        children: (
                          <>
                            <Collapse ghost items={[{
                              key: '1', label: '样本集基础信息', children: (
                                <Descriptions column={4} size="small" bordered style={{ marginBottom: 16 }}>
                                  <Descriptions.Item label="任务类型">{selectedSet.taskType || '-'}</Descriptions.Item>
                                  <Descriptions.Item label="样本量">{selectedSet.num || 0}</Descriptions.Item>
                                  <Descriptions.Item label="来源任务数">{sampleSetSummary.sourceTaskCount}</Descriptions.Item>
                                  <Descriptions.Item label="导出格式">{sampleSetSummary.exportFormat}</Descriptions.Item>
                                  <Descriptions.Item label="Provenance"><Badge status={sampleSetSummary.hasProv ? 'success' : 'default'} text={sampleSetSummary.hasProv ? '是' : '否'} /></Descriptions.Item>
                                </Descriptions>
                              )
                            }]} />
                            <div className="template-metric-editor">
                              <div className="editor-title" style={{ marginTop: 12 }}><SettingOutlined /> 全局与模型配置</div>
                              <Form layout="vertical" form={templateForm} className="profile-form">
                                <Row gutter={16}>
                                  <Col span={6}><Form.Item label="模板名称" name="name" rules={[{ required: true, message: '请输入模板名称' }]}><Input /></Form.Item></Col>
                                  <Col span={6}><Form.Item label="期望导出格式" name="expectedExportFormat"><Select options={EXPORT_FORMAT_OPTIONS.map((v) => ({ label: v, value: v }))} /></Form.Item></Col>
                                  <Col span={6}><Form.Item label="期望标注格式" name="expectedAnnotationFormat"><Select options={ANNOTATION_FORMAT_OPTIONS.map((v) => ({ label: v, value: v }))} /></Form.Item></Col>
                                  <Col span={6}><Form.Item label="属性审核模式" name="attributeAuditMode"><Select options={ATTRIBUTE_AUDIT_MODE_OPTIONS} /></Form.Item></Col>
                                  <Col span={12}><Form.Item label="必填字段" name="requiredFields"><Select mode="multiple" options={attributeOptions} /></Form.Item></Col>
                                  <Col span={12}><Form.Item label="拓扑规则" name="topologyRules"><Select mode="multiple" options={TOPOLOGY_RULE_OPTIONS} /></Form.Item></Col>
                                  <Col span={12}><Form.Item label="参考模型数据源（多选）" name="referenceModelIds"><Select mode="multiple" loading={loadingModels} allowClear options={modelOptions.map((m) => ({ label: m.modelName || m.model_name || m.modelId, value: m.modelId }))} /></Form.Item></Col>
                                  <Col span={6}><Form.Item label="模型范围模式" name="scopeMode"><Select options={[{ label: '全量', value: 'all' }, { label: '抽样', value: 'sample' }]} /></Form.Item></Col>
                                  <Col span={3}><Form.Item label="置信度阈值(自动)" name="confidenceThreshold"><InputNumber min={0} max={1} step={0.01} style={{ width: '100%' }} disabled /></Form.Item></Col>
                                  <Col span={3}><Form.Item label="IOU阈值(自动)" name="iouThreshold"><InputNumber min={0} max={1} step={0.01} style={{ width: '100%' }} disabled /></Form.Item></Col>
                                  <Col span={24}>
                                    <Text type="secondary">
                                      系统根据已选模型的默认推理参数自动分配阈值，并自动构建 STAPLE 融合配置；当前已选 {selectedReferenceModels.length} 个来源。
                                    </Text>
                                  </Col>
                                </Row>
                              </Form>
                            </div>
                            <div className="template-metric-editor">
                              <div className="editor-title">维度规则配置与计算结果</div>
                              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                {displayDimensions.map((dim) => (
                                  <UnifiedDimensionCard key={dim.key} dimension={dim} onToggle={handleToggleDimension} onRuleChange={handleChangeMetricRule} onRuleConfigChange={handleChangeMetricRuleConfig} />
                                ))}
                              </Space>
                            </div>
                          </>
                        )
                      },
                      {
                        key: '2',
                        label: '可视化预览',
                        children: (
                          <div className="preview-container">
                            <div className="preview-toolbar"><Space wrap><Select style={{ width: 280 }} placeholder="选择预览样本" loading={loadingPreviewList} value={selectedPreviewId} onChange={setSelectedPreviewId} options={previewList.map((item) => ({ label: item.name || String(item.id), value: item.id }))} /><Button icon={<LeftOutlined />} onClick={() => { const idx = previewList.findIndex((i) => String(i.id) === String(selectedPreviewId)); if (idx > 0) setSelectedPreviewId(previewList[idx - 1].id); }} disabled={!previewList.length} /><Button icon={<RightOutlined />} onClick={() => { const idx = previewList.findIndex((i) => String(i.id) === String(selectedPreviewId)); if (idx >= 0 && idx < previewList.length - 1) setSelectedPreviewId(previewList[idx + 1].id); }} disabled={!previewList.length} /></Space></div>
                            <div className="preview-legend">
                              <Space wrap size={[6, 6]}>
                                <Tag color="default">原始影像</Tag>
                                <Tag color="blue">多边形叠加</Tag>
                                <Tag color="orange">矩形框叠加</Tag>
                                <Tag color="green">掩膜叠加</Tag>
                              </Space>
                              <Text type="secondary">说明：推理结果为参考证据，不作为严格真值。</Text>
                            </div>
                            <Spin spinning={loadingPreviewDetail}>{previewDetail ? <><Row gutter={16}><Col span={12}><div className="preview-block-title">原图</div><PreviewImageWithOverlay imageUrl={previewDetail.originalImageUrl || previewDetail.sourceImageUrl} overlayType={previewDetail.overlayType} overlayData={previewDetail.overlayData} showOverlay={false} /></Col><Col span={12}><div className="preview-block-title">概率真值热力图</div><PreviewImageWithOverlay imageUrl={previewDetail.resultImageUrl || previewDetail.originalImageUrl || previewDetail.sourceImageUrl} overlayType={previewDetail.overlayType} overlayData={previewDetail.overlayData} showOverlay /></Col></Row><Descriptions size="small" column={2} style={{ marginTop: 12 }}><Descriptions.Item label="平均置信度">{previewDetail?.confidenceSummary?.mean ?? '--'}</Descriptions.Item><Descriptions.Item label="类别覆盖率">{previewDetail?.classSummary?.classCoverageRate ?? '--'}%</Descriptions.Item></Descriptions></> : <Empty description="暂无预览样本" />}</Spin>
                          </div>
                        )
                      },
                      {
                        key: '3',
                        label: '任务监控与报告',
                        children: (
                          <>
                            {evaluationJob ? (
                              <div style={{ marginBottom: 24 }}>
                                <div className="job-progress-header">
                                  <div>
                                    <div className="job-stage">{evaluationJob.stage || '等待中'}</div>
                                    <div className="job-message">{evaluationJob.message || '质量评价任务已提交'}</div>
                                  </div>
                                  <Tag color={evaluationJob.status === 'SUCCESS' ? 'green' : evaluationJob.status === 'FAILED' ? 'red' : 'blue'}>
                                    {evaluationJob.status || 'UNKNOWN'}
                                  </Tag>
                                </div>
                                <Progress percent={evaluationJob.progress || 0} status={evaluationJob.status === 'FAILED' ? 'exception' : evaluationJob.status === 'SUCCESS' ? 'success' : 'active'} />
                              </div>
                            ) : <Empty description="暂无执行记录" />}

                            {activeReferenceEvidence && (
                              <div style={{ marginTop: 24, marginBottom: 24 }}>
                                <div className="editor-title" style={{ marginBottom: 12 }}>参考模型评估记录</div>
                                <Descriptions column={3} size="small" bordered>
                                  <Descriptions.Item label="评估状态"><Tag color={activeReferenceEvidence?.suitable === false ? 'red' : 'green'}>{activeReferenceEvidence?.suitable === false ? '不适用' : '已完成'}</Tag></Descriptions.Item>
                                  <Descriptions.Item label="coverageRate">{formatPercent(activeReferenceEvidence?.coverageRate)}</Descriptions.Item>
                                  <Descriptions.Item label="confidenceMean">{formatPercent(activeReferenceEvidence?.confidenceMean)}</Descriptions.Item>
                                  <Descriptions.Item label="lowConfidenceRatio">{formatPercent(activeReferenceEvidence?.lowConfidenceRatio)}</Descriptions.Item>
                                  <Descriptions.Item label="可靠性等级">{activeReferenceEvidence?.referenceReliabilityLevel || '--'}</Descriptions.Item>
                                </Descriptions>
                              </div>
                            )}

                            <div className="editor-title" style={{ marginTop: 24, marginBottom: 12 }}>报告输出</div>
                            <Space>
                              <Button onClick={() => activeReportId ? history.push(`/quality/report/${activeReportId}`) : message.warning('当前暂无可查看的质量报告')}>查看报告详情</Button>
                              <Button icon={<DownloadOutlined />} onClick={async () => { if (!activeReportId) return message.warning('当前暂无可导出的质量报告'); const res = await reqGetQualityReport(activeReportId); const blob = new Blob([JSON.stringify(res?.data || {}, null, 2)], { type: 'application/json;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `quality-report-${activeReportId}.json`; link.click(); URL.revokeObjectURL(link.href); }}>下载 JSON</Button>
                              <Button icon={<PrinterOutlined />} onClick={async () => { if (!activeReportId) return message.warning('当前暂无可打印的质量报告'); const html = await reqGetQualityReportHtml(activeReportId); setReportPreviewHtml(html); setReportPreviewVisible(true); }}>预览 / 打印 HTML</Button>
                            </Space>
                          </>
                        )
                      }
                    ]}
                  />
                </Card>
              </div>
            </Spin>
          )}
        </Col>
      </Row>
      <Modal open={reportPreviewVisible} title="质量评价 HTML 报告预览" width={1080} onCancel={() => setReportPreviewVisible(false)} footer={[<Button key="close" onClick={() => setReportPreviewVisible(false)}>关闭</Button>, <Button key="print" type="primary" icon={<PrinterOutlined />} onClick={() => { const win = window.open('', '_blank', 'width=1200,height=900'); if (!win) return; win.document.write(reportPreviewHtml); win.document.close(); win.focus(); win.print(); }}>打印</Button>]}><iframe title="quality-report-preview" className="report-preview-frame" srcDoc={reportPreviewHtml} /></Modal>
    </div>
  );
};

export default QualityPage;
