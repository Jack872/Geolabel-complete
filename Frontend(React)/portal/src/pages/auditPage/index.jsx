import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {message, Spin, Button, Select, Card, Space, Steps, Alert, Collapse, Checkbox, Input, Tooltip} from 'antd';
import { Vector as VectorLayer } from 'ol/layer';
import { Vector as VectorSource } from 'ol/source';
import { Style, Fill, Stroke, Circle as CircleStyle } from 'ol/style';
import { GeoJSON } from 'ol/format';
import { history, useModel } from 'umi';
import useMap from '@/hooks/map/useMap';
import BasicMap from '@/pages/markPage/components/basicMap';
import './style.less';
import { Select as OlSelect } from 'ol/interaction';
import Modify from 'ol/interaction/Modify';
import { click } from 'ol/events/condition';
import Collection from 'ol/Collection';
import Draw , { createBox }from 'ol/interaction/Draw';
import FeedbackList from './components/FeedbackList';
import {submitAuditFail, submitAuditPass} from "@/services/audit/api";
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Decrypt } from '@/utils/utils';
import { getTransformationParams, normalizeCoordinateCode, registerCommonProjections } from '@/utils/coordinateSystem';
const { TextArea } = Input;

registerCommonProjections();

const INITIAL_AUDIT_DATA = {
  deleted_feature_ids: [],
  reclassified_features: [],
  added_features: [],
  modified_features: [],
};



export default function AuditPage() {
  const [mapInstance, setMapInstance] = useState(null);
  const [loading, setLoading] = useState(true);
// 创建一个稳定的、用于修改的要素集合
  const modifyCollection = useRef(new Collection());
  const lastConflictFeatureRef = useRef(null);
  const FEATURE_BASE_STYLE_KEY = '__auditFeatureBaseStyle';
  const FEATURE_HIGHLIGHT_KEY = '__auditFeatureHighlightStyle';
  // 新增状态：交互控制
  const [modifyInteraction, setModifyInteraction] = useState(null);
  const [drawInteraction, setDrawInteraction] = useState(null);
  const [selectedDrawType, setSelectedDrawType] = useState('Polygon');
  // 在这里声明 targetDrawLayerId 状态
  const [targetDrawLayerId, setTargetDrawLayerId] = useState(null); // 用于步骤2
  const [visibleLayerIds, setVisibleLayerIds] = useState([]);

  const { taskInfo, markGeoJsonArr, setMap, mapExtent, taskItems, currentTaskItemId, mapProjectionCode, refreshMarkGeoJsonArr } = useMap();
  const {
    initialState: {
      currentState: { currentUser },
    },
  } = useModel('@@initialState');

  const getTaskId = useMemo(() => {
    const rawTaskId = Decrypt(window.sessionStorage.getItem('taskId'));
    const numericTaskId = Number(rawTaskId);
    return Number.isFinite(numericTaskId) ? numericTaskId : null;
  }, []);

  const getTaskItemId = useMemo(() => {
    const rawTaskItemId = window.sessionStorage.getItem('taskItemId');
    if (!rawTaskItemId) return currentTaskItemId;
    const numericTaskItemId = Number(rawTaskItemId);
    return Number.isFinite(numericTaskItemId) ? numericTaskItemId : currentTaskItemId;
  }, [currentTaskItemId]);

  const currentTaskItem = useMemo(() => {
    if (!Array.isArray(taskItems) || taskItems.length === 0) return null;
    return taskItems.find((item) => Number(item?.taskItemId) === Number(getTaskItemId)) || taskItems[0];
  }, [getTaskItemId, taskItems]);
  const auditProgress = useMemo(() => {
    const total = Array.isArray(taskItems) ? taskItems.length : 0;
    if (total === 0) {
      return { reviewed: 0, total: 0 };
    }
    const reviewed = taskItems.filter((item) => {
      const itemStatus = Number(item?.status);
      return itemStatus === 1 || itemStatus === 2;
    }).length;
    return { reviewed, total };
  }, [taskItems]);
  const currentAuditStatus = useMemo(() => {
    const rawStatus = taskInfo?.currentTaskItemStatus ?? currentTaskItem?.status;
    const numericStatus = Number(rawStatus);
    if (numericStatus === 1) {
      return { text: '审核通过', className: 'top-info-status-pass' };
    }
    if (numericStatus === 2) {
      return { text: '审核驳回', className: 'top-info-status-reject' };
    }
    return { text: '未审核', className: 'top-info-status-pending' };
  }, [currentTaskItem?.status, taskInfo?.currentTaskItemStatus]);

  const switchTaskItem = useCallback((nextTaskItemId) => {
    if (!nextTaskItemId || Number(nextTaskItemId) === Number(getTaskItemId)) return;
    window.sessionStorage.setItem('taskItemId', String(nextTaskItemId));
    window.location.reload();
  }, [getTaskItemId]);

  const navigateTask = useCallback((direction) => {
    if (!Array.isArray(taskItems) || taskItems.length === 0) return;
    const idx = taskItems.findIndex((item) => Number(item?.taskItemId) === Number(getTaskItemId));
    if (idx === -1) return;
    const nextIdx = direction === 'prev' ? idx - 1 : idx + 1;
    if (nextIdx < 0 || nextIdx >= taskItems.length) {
      message.info(direction === 'prev' ? '已是第一张影像' : '已是最后一张影像');
      return;
    }
    const nextTaskItemId = taskItems[nextIdx]?.taskItemId;
    if (!nextTaskItemId) return;
    switchTaskItem(nextTaskItemId);
  }, [getTaskItemId, switchTaskItem, taskItems]);

  const resolveNextTaskItemId = useCallback(() => {
    if (!Array.isArray(taskItems) || taskItems.length === 0) return null;
    const idx = taskItems.findIndex((item) => Number(item?.taskItemId) === Number(getTaskItemId));
    if (idx === -1 || idx + 1 >= taskItems.length) return null;
    return taskItems[idx + 1]?.taskItemId || null;
  }, [getTaskItemId, taskItems]);

  // 核心流程变更：审核决策状态
  const [auditDecision, setAuditDecision] = useState(null); // 'pass', 'fail', or null

  //  新增 State 用于分步审核流程，“通过”流程的状态
  const [currentStep, setCurrentStep] = useState(0); // 当前审核步骤索引
  // 扩展 auditData state 以存储详细的变更信息
  const [auditData, setAuditData] = useState(INITIAL_AUDIT_DATA);

  // 新增 State 用于UI交互
  const [targetCategoryId, setTargetCategoryId] = useState(null); // 目标类别ID

  // “不通过”流程的状态
  const [overallFeedback, setOverallFeedback] = useState('');
  const [selectedFeatures, setSelectedFeatures] = useState([]);//用于记录反馈意见的数组
  const isProgrammaticSelect = useRef(false); // 新增：同步锁
  const [featureFeedback, setFeatureFeedback] = useState({});
  const [currentFeatureFeedback, setCurrentFeatureFeedback] = useState('');
  const getUniqueFeatures = useCallback((features = []) => [...new Set(features.filter(Boolean))], []);
  const clearSelectedCollection = useCallback((selectInteraction) => {
    if (!selectInteraction) return;
    try {
      isProgrammaticSelect.current = true;
      selectInteraction.getFeatures().clear();
    } finally {
      setTimeout(() => {
        isProgrammaticSelect.current = false;
      }, 0);
    }
  }, []);
  const taskCoordinateSystem = useMemo(
    () => normalizeCoordinateCode(taskInfo?.data?.[0]?.coordinateSystem || taskInfo?.coordinateSystem || 'EPSG:3857'),
    [taskInfo],
  );
  const mapProjection = useMemo(
    () => normalizeCoordinateCode(mapProjectionCode || mapInstance?.getView?.()?.getProjection?.()?.getCode?.() || taskCoordinateSystem),
    [mapInstance, taskCoordinateSystem, mapProjectionCode],
  );
  const auditConflictSummary = taskInfo?.currentTaskItemConflictSummary || {};
  const auditConflicts = Array.isArray(auditConflictSummary?.conflicts) ? auditConflictSummary.conflicts : [];
  const auditConflictCount = Number(auditConflictSummary?.conflictCount || 0);
  const typeNameById = useMemo(() => {
    const map = {};
    (taskInfo?.data?.[0]?.userArr || []).forEach((user) => {
      (user?.typeArr || []).forEach((item) => {
        if (item?.typeId !== undefined && item?.typeId !== null) {
          map[String(item.typeId)] = item?.typeName || `类别${item.typeId}`;
        }
      });
    });
    return map;
  }, [taskInfo]);
  const userNameById = useMemo(() => {
    const map = {};
    (taskInfo?.data?.[0]?.userArr || []).forEach((item) => {
      if (item?.userid !== undefined && item?.userid !== null) {
        map[String(item.userid)] = item?.username || `用户${item.userid}`;
      }
    });
    return map;
  }, [taskInfo]);

  /** 获取透明颜色 */
  const getTransparentColor = useCallback((color, opacity = 0.2) => {
    if (!color) return `rgba(102,153,255,${opacity})`;
    if (color.startsWith('rgba'))
      return color.replace(/,\s*[\d.]+\)$/, `, ${opacity})`);
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    return `rgba(102,153,255,${opacity})`;
  }, []);

  /**  构建审核图层 */
  const auditLayers = useMemo(() => {
    if (!taskInfo || !taskInfo.data?.length || !markGeoJsonArr?.length) {
      console.warn('⚠️ 无法构建图层：taskInfo 或 markGeoJsonArr 为空');
      return [];
    }

    const allUsers = taskInfo.data[0]?.userArr ?? [];
    const typeMap = new Map();
    for (const { typeArr } of allUsers) {
      for (const typeItem of typeArr || []) {
        if (!typeMap.has(typeItem.typeId)) {
          typeMap.set(typeItem.typeId, typeItem);
        }
      }
    }
    const totalTypeIdArr = Array.from(typeMap.values());

    const layers = totalTypeIdArr.map(({ typeColor, typeName, typeId }) => {
      const src = new VectorSource({ format: new GeoJSON(), projection: mapProjection });

      for (const item of markGeoJsonArr) {
        if (typeId === item.typeId && item.markGeoJson) {
          try {
            // 动态获取坐标系信息
            const dataProjection = normalizeCoordinateCode(item.coordinateSystem || taskInfo?.coordinateSystem || 'EPSG:3857');
            const features = new GeoJSON().readFeatures(
              item.markGeoJson,
              getTransformationParams(dataProjection, mapProjection),
            );
            features.forEach((f) => {
              // 这是最关键的修正！为每个 feature 设置一个稳定的 ID ️
              f.setId(item.markId || f.ol_uid);
              f.set('markId', item.markId);
              src.addFeature(f);
            });
          } catch (err) {
            console.error(`❌ 加载 ${typeName} 的标注失败:`, err);
          }
        }
      }

        const style = (feature) => {
          const geomType = feature.getGeometry().getType();
          const fillColor = getTransparentColor(typeColor);
          return new Style({
            fill: new Fill({ color: fillColor }),
            stroke: new Stroke({ color: typeColor, width: 2 }),
            image:
              geomType === 'Point'
              ? new CircleStyle({
                radius: 6,
                fill: new Fill({ color: fillColor }),
                stroke: new Stroke({ color: typeColor, width: 2 }),
              })
              : null,
          });
        };

      const layer = new VectorLayer({
        title: typeName,
        source: src,
        style,
        visible: true,
      });
      layer.set('typeid', typeId);
      layer.set('layerGroup', 'audit');
      layer.setZIndex(99);
      return layer;
    });

    console.log('✅ 已生成审核图层:', layers);
    return layers;
  }, [taskInfo, markGeoJsonArr, getTransparentColor, mapProjection]);

  useEffect(() => {
    if (!mapInstance || !auditLayers.length) return;
    mapInstance.getLayers().getArray()
      .filter((l) => l.get('layerGroup') === 'audit')
      .forEach((l) => mapInstance.removeLayer(l));
    auditLayers.forEach((l) => mapInstance.addLayer(l));
    setVisibleLayerIds(auditLayers.map((l) => l.get('typeid')));
    // 添加优化：加载图层后，设置默认绘制图层
    if (auditLayers.length > 0) {
      setTargetDrawLayerId(auditLayers[0].get('typeid'));
    }
  }, [mapInstance, auditLayers]);


  // 修正后的交互逻辑：拆分为两个独立的 useEffect，实现单向数据流
  // --- 数据流方向 1: OpenLayers 用户交互 -> 更新 React State ---
  useEffect(() => {
    if (!mapInstance) return;
    const cleanupInteractions = () => {
      mapInstance.getInteractions().getArray().filter(
        (i) => i instanceof OlSelect || i instanceof Modify || i instanceof Draw
      ).forEach((i) => mapInstance.removeInteraction(i));
      setDrawInteraction(null);
      setModifyInteraction(null);
    };

    cleanupInteractions();
    let selectInteraction;

    // “选择”交互在多个步骤中都需要
    if (auditDecision === 'fail' || (auditDecision === 'pass' && [0, 1, 3].includes(currentStep))) {
      selectInteraction = new OlSelect({ style: createHighlightStyle(), multi: true });
      mapInstance.addInteraction(selectInteraction);
      selectInteraction.on('select', (e) => {
        if (isProgrammaticSelect.current) return;
        setSelectedFeatures(getUniqueFeatures(e.target.getFeatures().getArray()));
      });
    }

    // "通过"流程中，根据不同步骤添加特定交互
    if (auditDecision === 'pass') {
      // 步骤 2: 添加“绘制”交互
      if (currentStep === 2) {
        const targetLayer = auditLayers.find(l => l.get('typeid') === targetDrawLayerId);
        if (targetLayer) {
          const source = targetLayer.getSource();
          // --- 绘图逻辑修改开始 ---
          let drawOptions = { source };

          if (selectedDrawType === 'Box') {
            // 如果是绘制矩形
            drawOptions.type = 'Circle'; // 底层交互类型用 Circle (两次点击)
            drawOptions.geometryFunction = createBox(); // 使用内置函数生成矩形几何
          } else {
            // 否则，使用标准类型
            drawOptions.type = selectedDrawType;
          }
          const draw = new Draw(drawOptions);
          mapInstance.addInteraction(draw);
          setDrawInteraction(draw);

          draw.on('drawend', (e) => {
            const newFeature = e.feature;
            newFeature.setId(`new_${newFeature.ol_uid}`); // 给新要素一个临时唯一ID

            const geoJsonFormat = new GeoJSON();
            const featureGeoJSON = geoJsonFormat.writeFeatureObject(newFeature, {
              ...getTransformationParams(taskCoordinateSystem, mapProjection),
            });

            // 记录新增的要素
            setAuditData(prev => ({
              ...prev,
              added_features: [...prev.added_features, {
                geometry: featureGeoJSON.geometry, // 后端通常只需要几何信息和类型
                typeId: targetDrawLayerId,
              }]
            }));
            message.success('已添加一个新标注');
          });
        }
      }

      // 步骤 3: 添加“修改”交互
      if (currentStep === 3 && selectInteraction) {
        const modify = new Modify({ features: selectInteraction.getFeatures() });
        mapInstance.addInteraction(modify);
        setModifyInteraction(modify);

        // 首先，获取当前的任务类型
        // 注意：请根据您的 taskInfo 实际结构调整这里的路径
        const taskType = taskInfo?.data?.[0]?.type;
        modify.on('modifying', (event) => {
          // 检查任务类型是否为“目标检测”
          if (taskType === "目标检测") {
            // <--- 使用您实际的任务类型名称
            event.features.getArray().forEach(feature => {
              const geometry = feature.getGeometry();

              // 只要是多边形，就强制约束为矩形
              if (geometry.getType() === 'Polygon') {
                const extent = geometry.getExtent();
                const newCoords = [
                  [extent[0], extent[1]], // minX, minY
                  [extent[0], extent[3]], // minX, maxY
                  [extent[2], extent[3]], // maxX, maxY
                  [extent[2], extent[1]], // maxX, minY
                  [extent[0], extent[1]]  // close ring
                ];
                geometry.setCoordinates([newCoords]);
                mapInstance.render();
              }
            });
          }
        });

        // 监听修改结束事件，记录修改后的几何信息
        modify.on('modifyend', (e) => {
          message.success('位置已校正');
          const modifiedFeatures = e.features.getArray();
          const format = new GeoJSON();

          const shapeModifications = modifiedFeatures.map(feature => {
            const newGeometry = format.writeGeometryObject(feature.getGeometry(), {
              ...getTransformationParams(taskCoordinateSystem, mapProjection),
            });
            return {
              featureId: feature.get('markId') || feature.getId(),
              newGeometry: newGeometry,
            };
          });

          // 更新状态，替换掉对相同要素之前的修改记录，只保留最新的
          setAuditData(prev => ({
            ...prev,
            modified_features: [
              ...prev.modified_features.filter(mod => !shapeModifications.some(sm => sm.featureId === mod.featureId)),
              ...shapeModifications
            ]
          }));
        });
      }
    }

    return () => {
      cleanupInteractions();
      setSelectedFeatures([]);
    };

  }, [mapInstance, auditDecision, currentStep, auditLayers, selectedDrawType, targetDrawLayerId, getUniqueFeatures]);




  // --- 数据流方向 2: React State -> 同步到 OpenLayers 地图高亮 ---
  // 新增：这个 useEffect 是实现单向数据流的核心
  useEffect(() => {
    if (!mapInstance) return;

    const selectInteraction = mapInstance.getInteractions().getArray().find(i => i instanceof OlSelect);
    if (!selectInteraction) return;

    const olSelectedFeatures = selectInteraction.getFeatures();

    const stateFeatures = new Set(getUniqueFeatures(selectedFeatures));
    const olFeatures = new Set(getUniqueFeatures(olSelectedFeatures.getArray()));

    if (stateFeatures.size === olFeatures.size && [...stateFeatures].every(feature => olFeatures.has(feature))) {
      return;
    }

    try {
      // 1. 加锁：在执行任何可能触发事件的操作之前，设置标志位
      isProgrammaticSelect.current = true;

      // 2. 执行同步操作
      olSelectedFeatures.clear();
      [...stateFeatures].forEach(feature => olSelectedFeatures.push(feature));

    } finally {
      // 关键修正：使用 setTimeout (宏任务) 来延迟解锁
      // 这确保了在本次同步操作中触发的所有 OL 事件（也是宏任务）
      // 都有机会先被处理完毕，然后才轮到这个解锁的宏任务执行。
      setTimeout(() => {
        isProgrammaticSelect.current = false;
      }, 0);
    }

  }, [selectedFeatures, mapInstance, getUniqueFeatures]);



  // 辅助函数 (可以放在组件外部或内部)
  const createHighlightStyle = () => {
    return new Style({
      stroke: new Stroke({
        color: '#f00', // 红色边框
        width: 3,
      }),
      fill: new Fill({
        color: 'rgba(255, 0, 0, 0.2)', // 半透明红色填充
      }),
      image: new CircleStyle({
        radius: 7,
        fill: new Fill({
          color: 'rgba(255, 0, 0, 0.4)',
        }),
        stroke: new Stroke({
          color: '#f00',
          width: 2,
        }),
      }),
    });
  };

  const applyConflictHighlight = useCallback((feature) => {
    if (!feature) return;
    if (feature.get(FEATURE_BASE_STYLE_KEY) === undefined) {
      feature.set(FEATURE_BASE_STYLE_KEY, feature.getStyle() || null);
    }
    const highlightStyle = feature.get(FEATURE_HIGHLIGHT_KEY) || createHighlightStyle();
    feature.set(FEATURE_HIGHLIGHT_KEY, highlightStyle);
    feature.setStyle(highlightStyle);
  }, []);

  const restoreConflictHighlight = useCallback((feature) => {
    if (!feature) return;
    const baseStyle = feature.get(FEATURE_BASE_STYLE_KEY);
    feature.setStyle(baseStyle || undefined);
    feature.unset(FEATURE_BASE_STYLE_KEY, true);
    feature.unset(FEATURE_HIGHLIGHT_KEY, true);
  }, []);

  const focusConflictMark = useCallback((markId) => {
    if (!markId || !mapInstance || !auditLayers.length) return;
    let targetFeature = null;
    for (const layer of auditLayers) {
      const source = layer?.getSource?.();
      const matched = source?.getFeatures?.()?.find?.((feature) => Number(feature?.get?.('markId')) === Number(markId));
      if (matched) {
        targetFeature = matched;
        break;
      }
    }
    if (!targetFeature) {
      message.warning(`未找到冲突标注 ${markId}`);
      return;
    }

    if (lastConflictFeatureRef.current && lastConflictFeatureRef.current !== targetFeature) {
      restoreConflictHighlight(lastConflictFeatureRef.current);
    }
    applyConflictHighlight(targetFeature);
    lastConflictFeatureRef.current = targetFeature;

    const geometry = targetFeature?.getGeometry?.();
    if (geometry) {
      const extent = geometry.getExtent?.();
      if (extent && extent[0] !== extent[2] && extent[1] !== extent[3]) {
        mapInstance.getView().fit(extent, { padding: [80, 80, 80, 80], duration: 300, maxZoom: 21 });
      } else {
        const coordinate = geometry.getFirstCoordinate?.() || geometry.getCoordinates?.();
        if (coordinate) {
          mapInstance.getView().animate({ center: coordinate, duration: 300, zoom: Math.max(mapInstance.getView().getZoom() || 18, 18) });
        }
      }
    }
  }, [applyConflictHighlight, auditLayers, mapInstance, restoreConflictHighlight]);

  const findParentLayer = (feature, map, layers) => layers.find((layer) => {
    const source = layer.getSource?.();
    return source?.getFeatures?.().includes(feature);
  });

  // 在组件内（return 之前）添加以下函数

  // --- 步骤 0: 检测多标 ---
  const handleDeleteMultiLabel = useCallback(() => {
    if (selectedFeatures.length === 0) {
      return message.warning("请先选择要删除的多余标注");
    }

    const featuresToDelete = getUniqueFeatures(selectedFeatures)
      .map(f => ({ feature: f, layer: findParentLayer(f, mapInstance, auditLayers) }))
      .filter(({ layer }) => layer);
    if (featuresToDelete.length === 0) {
      setSelectedFeatures([]);
      const selectInteraction = mapInstance?.getInteractions().getArray().find(i => i instanceof OlSelect);
      clearSelectedCollection(selectInteraction);
      return message.warning("No valid selected annotation to delete");
    }
    console.log("featuresToDelete from React State:", featuresToDelete); // 现在这里一定有内容
    const ids = featuresToDelete
      .map(({ feature }) => feature.get('markId') || feature.getId())
      .filter(id => id != null);

    setAuditData(prev => ({
      ...prev,
      deleted_feature_ids: [...new Set([...prev.deleted_feature_ids, ...ids])]
    }));

    const selectInteraction = mapInstance?.getInteractions().getArray().find(i => i instanceof OlSelect);
    clearSelectedCollection(selectInteraction);

    featuresToDelete.forEach(({ feature, layer }) => {
      layer.getSource().removeFeature(feature);
    });

    setSelectedFeatures([]);
    message.success(`${featuresToDelete.length} 个多余标注已移除`);
    // api.deleteFeatures(featureIds).then(...);
  }, [selectedFeatures, mapInstance, auditLayers, getUniqueFeatures, clearSelectedCollection]);

  // --- 步骤 1: 检测错标 ---
  //  重构 handleChangeCategory 以支持批量修改
  const handleChangeCategory = useCallback(() => {
    if (selectedFeatures.length === 0) return message.warning('请先选择要修正类别的标注');
    if (!targetCategoryId) return message.warning('请选择一个目标类别');

    const targetLayer = auditLayers.find(l => l.get('typeid') === targetCategoryId);
    if (!targetLayer) return message.error('找不到目标图层');

    const targetSource = targetLayer.getSource();
    let movedCount = 0;
    const reclassificationData = [];
    selectedFeatures.forEach(feature => {
      const currentLayer = findParentLayer(feature, mapInstance, auditLayers);
      // 只有当要素不属于目标图层时才移动
      if (currentLayer && currentLayer.get('typeid') !== targetCategoryId) {
        // 记录重分类数据
        reclassificationData.push({
          featureId: feature.get('markId') || feature.getId(),
          newTypeId: targetCategoryId,
        });
        currentLayer.getSource().removeFeature(feature);
        targetSource.addFeature(feature);
        movedCount++;
      }
    });
    // 将本次操作记录的所有重分类数据更新到 state
    if (reclassificationData.length > 0) {
      setAuditData(prev => ({
        ...prev,
        reclassified_features: [...prev.reclassified_features, ...reclassificationData]
      }));
    }
    if (movedCount > 0) {
      message.success(`成功修正了 ${movedCount} 个标注的类别`);
    } else {
      message.info('选中的标注已属于目标类别，无需修正');
    }

    // 修正: 只更新 React State
    setSelectedFeatures([]);

  }, [selectedFeatures, targetCategoryId, auditLayers, mapInstance]);

  // --- 步骤 3: 校正位置偏差 ---
  const handlePositionCorrection = useCallback(() => {
    if (selectedFeatures.length === 0) return message.warning('请先选择一个标注进行校正');
    message.success('校正已记录，请继续或进入下一步');
  }, [selectedFeatures]);


  const handleSubmitCorrections = useCallback(async () => {
    // 最终提交给后端的数据结构
    console.log('最终提交的审核数据:', auditData);
    message.loading({ content: '正在提交修正结果...', key: 'submit_pass' });
    // 此处调用后端API
    try {
      await submitAuditPass({
        taskId: taskInfo?.data[0].taskid,
        taskItemId: getTaskItemId,
        corrections: auditData
      });
      message.destroy('submit_pass');
      await handlePostSubmitStayInAudit('修正结果提交成功！');
    } catch (error) {
      message.error({ content: '提交失败!', key: 'submit_pass' });
    }
  }, [auditData, taskInfo, getTaskItemId, handlePostSubmitStayInAudit]);

  // --- “不通过”流程的处理函数 ---
  // --- 重构 handleSaveFeatureFeedback ---
  const handleSaveFeatureFeedback = useCallback(() => {
    if (selectedFeatures.length === 0) return message.warning('请先选择...');
    if (!currentFeatureFeedback) return message.warning('请填写反馈...');

    const newFeedbacks = {};
    selectedFeatures.forEach(feature => {
      newFeedbacks[feature.getId()] = currentFeatureFeedback;
    });

    setFeatureFeedback(prev => ({ ...prev, ...newFeedbacks }));
    message.success(`已为 ${selectedFeatures.length} 个标注保存反馈`);

    setCurrentFeatureFeedback('');

    // ✅ 修正: 只更新 React State。上面的 useEffect 会自动处理地图上的高亮清除
    setSelectedFeatures([]);

  }, [selectedFeatures, currentFeatureFeedback]); // 移除了 mapInstance 依赖

  //提交驳回的审核建议
  const handleSubmitRejection = useCallback(async () => {
    if (!overallFeedback) return message.warning('请填写总体的修改意见');
    message.loading({ content: '正在提交驳回结果...', key: 'submit_fail' });
    console.log("featureFeedback = ", featureFeedback);
    console.log("taskInfo = ", taskInfo);
    let taskId=taskInfo?.data[0].taskid;
    if (!taskId) return message.warning('任务ID缺失，无法提交');
    const feedbackArray = featureFeedback
      ? Object.entries(featureFeedback).map(([id, text]) => ({
        id: id,
        feedback: text,
      }))
      : [];
    try {
      await submitAuditFail({
        taskId,
        taskItemId: getTaskItemId,
        overallFeedback,
        featureFeedback: feedbackArray // 发送数组而不是对象
      });
      message.destroy('submit_fail');
      await handlePostSubmitStayInAudit('驳回及反馈提交成功！');

    } catch (error) {
      message.error({ content: '提交失败!', key: 'submit_fail' });
    }
  }, [overallFeedback, featureFeedback, taskInfo, getTaskItemId, handlePostSubmitStayInAudit]);

  // --- 步骤导航 ---
  const nextStep = () => setCurrentStep(currentStep + 1);
  const prevStep = () => setCurrentStep(currentStep - 1);

  //重置决策时清空已记录的审核数据
  const resetToDecision = useCallback(() => {
    setAuditDecision(null);
    setCurrentStep(0);
    setAuditData(INITIAL_AUDIT_DATA); // 清空所有已记录的变更
    setFeatureFeedback({});
    setOverallFeedback('');
  }, []);

  const handlePostSubmitStayInAudit = useCallback(async (successText) => {
    const nextTaskItemId = resolveNextTaskItemId();
    await refreshMarkGeoJsonArr?.();
    message.success(successText);
    resetToDecision();
    if (nextTaskItemId) {
      message.info('当前影像已审核，正在进入下一张影像');
      switchTaskItem(nextTaskItemId);
      return;
    }
    window.sessionStorage.removeItem('taskItemId');
    message.info('最后一张影像已审核完成，返回任务管理页面');
    history.push('/taskmanage');
  }, [refreshMarkGeoJsonArr, resetToDecision, resolveNextTaskItemId, switchTaskItem]);

  // 新增：用于切换图层可见性的回调函数
  const toggleLayerVisibility = useCallback((typeId, isVisible) => {
    // 1. 直接操作 OpenLayers 图层
    const layer = auditLayers.find(l => l.get('typeid') === typeId);
    if (layer) {
      layer.setVisible(isVisible);
    }

    // 2. 更新 React State 以便 UI (Checkbox) 能够正确显示
    setVisibleLayerIds(prevIds =>
      isVisible
        ? [...prevIds, typeId] // 如果要显示，就添加到数组中
        : prevIds.filter(id => id !== typeId) // 如果要隐藏，就从数组中移除
    );
  }, [auditLayers]); // 依赖 auditLayers 数组

  /**
   * 在地图上定位并高亮指定的 feature
   */
  const handleLocateFeature = useCallback((featureId) => {
    if (!mapInstance || !auditLayers.length) return;

    let featureToLocate = null;
    for (const layer of auditLayers) {
      const source = layer.getSource();
      if (source && source.getFeatureById(featureId)) {
        featureToLocate = source.getFeatureById(featureId);
        break;
      }
    }

    if (featureToLocate) {
      // 1. 地图视图定位到要素
      mapInstance.getView().fit(featureToLocate.getGeometry().getExtent(), {
        padding: [100, 100, 100, 100],
        duration: 500,
        maxZoom: 18,
      });

      // 修正: 意图是“替换”而不是“添加”。
      // 这使得该操作无论调用多少次，结果都是一样的（幂等）。
      // 它直接将 selectedFeatures 设置为仅包含当前要定位的要素的数组。
      setSelectedFeatures([featureToLocate]);

    } else {
      message.warning(`未在地图上找到标注 ${featureId}`);
    }
  }, [mapInstance, auditLayers]); // 依赖项中不需要 setSelectedFeatures

  /**
   * 从 featureFeedback state 中删除一条反馈
   */
  const handleDeleteFeedback = useCallback((featureId) => {
    setFeatureFeedback(prev => {
      const newFeedback = { ...prev };
      delete newFeedback[featureId];
      return newFeedback;
    });
    message.success(`已删除对标注 ${featureId} 的反馈`);
  }, []);

  /**
   * 更新 featureFeedback state 中的一条反馈
   */
  const handleUpdateFeedback = useCallback((featureId, newText) => {
    if (!newText) {
      message.warning('反馈内容不能为空');
      return;
    }
    setFeatureFeedback(prev => ({
      ...prev,
      [featureId]: newText,
    }));
    message.success(`已更新对标注 ${featureId} 的反馈`);
  }, []);


  // --- 渲染不同流程的UI ---
  const renderInitialDecision = () => (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Alert message="请对本次标注任务给出初步审核意见。" type="info" showIcon />
      <Button type="primary" block onClick={() => setAuditDecision('pass')}>
        审核通过（并进入修正流程）
      </Button>
      <Button danger block onClick={() => setAuditDecision('fail')}>
        审核不通过（并添加反馈意见）
      </Button>
    </Space>
  );

  //  更新 renderPassFlow 的 UI 和逻辑
  const renderPassFlow = () => (
    <>
      <Steps current={currentStep} size="small" style={{ marginBottom: 24 }}>
        <Steps.Step title="多标" />
        <Steps.Step title="错标" />
        <Steps.Step title="漏标" />
        <Steps.Step title="偏移" />
      </Steps>
      <div className="audit-step-content">
        {currentStep === 0 && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert message="请在地图上选择（可多选）多余的、重复的标注，然后点击删除。" type="info" showIcon />
            <Button danger block onClick={handleDeleteMultiLabel} disabled={selectedFeatures.length === 0}>
              删除选中的 {selectedFeatures.length > 0 ? `${selectedFeatures.length} 项` : '项'}
            </Button>
          </Space>
        )}
        {currentStep === 1 && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert message="选择（可多选）一个或多个标注，为其选择正确的目标类别，然后确认变更。" type="info" showIcon />
            {selectedFeatures.length === 0 && <p>请先在地图上选择标注</p>}
            {selectedFeatures.length > 0 && (
              <>
                <p>已选中 {selectedFeatures.length} 个标注。</p>
                <Select value={targetCategoryId} style={{ width: '100%' }} onChange={setTargetCategoryId} placeholder="请选择目标类别">
                  {auditLayers.map(l => <Select.Option key={l.get('typeid')} value={l.get('typeid')}>{l.get('title')}</Select.Option>)}
                </Select>
                <Button type="primary" block onClick={handleChangeCategory}>
                  修正类别
                </Button>
              </>
            )}
          </Space>
        )}
        {/* 实现步骤2的UI*/}
        {currentStep === 2 && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert message="选择要绘制的类别和形状，然后在地图上补绘遗漏的标注。" type="info" showIcon />
            <Space>
              <span>目标类别:</span>
              <Select value={targetDrawLayerId} style={{ width: 180 }} onChange={setTargetDrawLayerId}>
                {auditLayers.map(l => <Select.Option key={l.get('typeid')} value={l.get('typeid')}>{l.get('title')}</Select.Option>)}
              </Select>
            </Space>
            <Space>
              <span>绘制形状:</span>
              <Select value={selectedDrawType} style={{ width: 180 }} onChange={setSelectedDrawType}>
                <Select.Option value="Polygon">多边形</Select.Option>
                <Select.Option value="Box">矩形</Select.Option> {/* <-- 修正 */}
                <Select.Option value="Point">点</Select.Option>
                <Select.Option value="LineString">线</Select.Option>
              </Select>
            </Space>
            <p>设置完成后，即可在地图上开始绘制。</p>
          </Space>
        )}
        {currentStep === 3 && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert message="选择（可多选）标注后，直接在地图上拖拽点或边来修正其形状和位置。" type="info" showIcon />
            <p>{selectedFeatures.length > 0 ? `已选中 ${selectedFeatures.length} 个标注，请直接在地图上编辑。` : '请先在地图上选择标注。'}</p>
            {/* 保存是自动的，所以不需要确认按钮 */}
            <p><em>修改将在操作结束后自动记录。</em></p>
            {/*<Button block onClick={handlePositionCorrection} type="primary" ghost>确认本次校正</Button>*/}
          </Space>
        )}
      </div>
      <div className="audit-step-navigation" style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
        <Button onClick={prevStep} disabled={currentStep === 0}>上一步</Button>
        {currentStep < 3 ? (
          <Button type="primary" onClick={nextStep}>下一步</Button>
        ) : (
          <Button type="primary" onClick={handleSubmitCorrections}>提交修正</Button>
        )}
      </div>
      <Button type="link" onClick={resetToDecision} style={{ marginTop: '10px' }}>返回</Button>
    </>
  );

  const renderFailFlow = () => (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Alert message="请提供总体修改意见，并可点选具体标注添加针对性反馈。" type="warning" showIcon />
      <p><strong>总体修改意见:</strong></p>
      <TextArea
        rows={4}
        placeholder="例如：整体存在向东偏移，部分建筑物标注错误..."
        value={overallFeedback}
        onChange={(e) => setOverallFeedback(e.target.value)}
      />
      <p style={{ marginTop: '16px' }}><strong>针对性反馈 (可选):</strong></p>
      {selectedFeatures.length > 0 ? (
        <Card size="small" title={`对选中的 ${selectedFeatures.length} 个标注的反馈`}>
          <Input
            placeholder="例如：此标注类别应为道路"
            value={currentFeatureFeedback}
            onChange={(e) => setCurrentFeatureFeedback(e.target.value)}
          />
          <Button size="small" type="primary" onClick={handleSaveFeatureFeedback} style={{ marginTop: '8px' }}>
            保存此反馈
          </Button>
        </Card>
      ) : (
        <p>请在地图上点击一个标注以添加反馈。</p>
      )}

      {/* ✅ 3. 将原来的 Collapse 替换为新的 FeedbackList 组件 */}
      {Object.keys(featureFeedback).length > 0 && (
        <FeedbackList
          feedback={featureFeedback}
          onLocate={handleLocateFeature}
          onDelete={handleDeleteFeedback}
          onUpdate={handleUpdateFeedback}
        />
      )}

      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <Button type="primary" danger block onClick={handleSubmitRejection}>
          提交驳回结果
        </Button>
        <Button onClick={resetToDecision}>返回</Button>
      </div>
    </Space>
  );

return (
  <div className="audit-container">
    {/* 顶部居中：任务信息（透明浮层，仅展示） */}
    <div className="top-info-bar">
      <div className="top-info-item">
        <span className="top-info-label">任务名称：</span>
        <span className="top-info-name">{taskInfo?.data?.[0]?.taskname || '审核任务'}</span>
      </div>
      <div className="top-info-sep" />
      <div className="top-info-item">
        <span className="top-info-label">任务类型：</span>
        <span className="top-info-type">{taskInfo?.data?.[0]?.type || '-'}</span>
      </div>
      <div className="top-info-sep" />
      <div className="top-info-item">
        <span className="top-info-label">审核状态：</span>
        <span className={`top-info-name ${currentAuditStatus.className}`}>{currentAuditStatus.text}</span>
      </div>
      {taskItems?.length > 0 && (
        <>
          <div className="top-info-sep" />
          <div className="top-info-item">
            <span className="top-info-label">当前影像：</span>
            <span className="top-info-name">
              {(taskItems.findIndex((item) => Number(item?.taskItemId) === Number(getTaskItemId)) + 1) || 1}. {currentTaskItem?.itemName || currentTaskItem?.mapserver || '未命名影像'}
            </span>
          </div>
          <div className="top-info-sep" />
          <div className="top-info-item">
            <span className="top-info-label">审核进度：</span>
            <span className="top-info-name">{auditProgress.reviewed}/{auditProgress.total}</span>
          </div>
        </>
      )}
    </div>

    {/* 底部居中：上下任务导航 */}
    <div className="task-nav-bar">
      <Tooltip title="跳转上一个任务">
        <button
          className="task-nav-btn"
          onClick={() => navigateTask('prev')}
          disabled={(taskItems?.length || 0) <= 1}
        >
          <LeftOutlined />
        </button>
      </Tooltip>
      <span className="task-nav-label">
        {currentTaskItem?.itemName || taskInfo?.data[0]?.taskname || '审核任务'}
      </span>
      {(taskItems?.length || 0) > 0 && (
        <span className="task-nav-progress">
          {(taskItems.findIndex((item) => Number(item?.taskItemId) === Number(getTaskItemId)) + 1) || 1} / {taskItems.length}
        </span>
      )}
      <Tooltip title="跳转下一个任务">
        <button
          className="task-nav-btn"
          onClick={() => navigateTask('next')}
          disabled={(taskItems?.length || 0) <= 1}
        >
          <RightOutlined />
        </button>
      </Tooltip>
    </div>

    {/* 地图区域 - 占左侧全部空间 */}
    <div className="map-wrapper">
      <BasicMap
        setMap={(instance) => {
          if (instance && !mapInstance) {
            setMap(instance);
            setMapInstance(instance);
            setLoading(false);
          }
        }}
        extent={mapExtent}
        mode="audit"
      />
    </div>

    {/* 右侧审核面板 */}
    <div className="audit-sidebar">
      {taskInfo?.data?.[0]?.type !== '目标检测' && (
        <Card className="audit-conflict-panel" title="冲突提示" style={{ marginBottom: 12 }}>
          <Alert
            type={auditConflictCount > 0 ? 'warning' : 'success'}
            showIcon
            message={auditConflictCount > 0 ? `当前影像发现 ${auditConflictCount} 个潜在覆盖冲突` : '当前影像未发现潜在覆盖冲突'}
          />
          {auditConflictCount > 0 && (
            <div className="conflict-list" style={{ marginTop: 12 }}>
              {auditConflicts.map((item) => {
                const conflictKey = `${item?.selfMarkId || 's'}-${item?.otherMarkId || 'o'}-${item?.selfUserId || 'su'}-${item?.otherUserId || 'ou'}`;
                const selfTypeName = typeNameById[String(item?.selfTypeId)] || `类别${item?.selfTypeId || '-'}`;
                const otherTypeName = typeNameById[String(item?.otherTypeId)] || `类别${item?.otherTypeId || '-'}`;
                const otherUserName = userNameById[String(item?.otherUserId)] || `用户${item?.otherUserId || '-'}`;
                return (
                  <button
                    key={conflictKey}
                    className="conflict-item"
                    onClick={() => focusConflictMark(item?.selfMarkId || item?.otherMarkId)}
                  >
                    <div className="conflict-item-title">潜在覆盖冲突</div>
                    <div className="conflict-item-text">{`当前类别：${selfTypeName}`}</div>
                    <div className="conflict-item-text">{`参考用户：${otherUserName}`}</div>
                    <div className="conflict-item-text">{`参考类别：${otherTypeName}`}</div>
                    <div className="conflict-item-text">{`覆盖率：${Number(item?.coverageRatio || 0).toFixed(3)}`}</div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      )}
      {/* 把你原来 return 中的审核 UI 统统放进来 */}
      {/** —— 审核 UI 开始 —— */}
      <Card
        className="audit-control-panel audit-steps-panel"
        title={auditDecision === 'pass' ? "审核修正流程" : auditDecision === 'fail' ? "审核驳回反馈" : "审核决策"}
      >
        {/* 图层控制 */}
        {/*<Collapse ghost defaultActiveKey={['1']} style={{ marginBottom: '16px' }}>*/}
        {/*  <Collapse.Panel header="图层可见性控制" key="1">*/}
        {/*    /!* ... (图层控制UI与之前相同，此处省略) ... *!/*/}
        {/*  </Collapse.Panel>*/}
        {/*</Collapse>*/}

        {/* 核心流程渲染 */}
        {!auditDecision && renderInitialDecision()}
        {auditDecision === 'pass' && renderPassFlow()}
        {auditDecision === 'fail' && renderFailFlow()}
      </Card>
      {/** —— 审核 UI 结束 —— */}
    </div>
  </div>
);
}
