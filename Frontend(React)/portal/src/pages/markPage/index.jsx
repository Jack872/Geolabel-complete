import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Button, Form, Input, message, Popconfirm, Tag, Slider, Select, Tooltip, Alert } from 'antd';
import { reqSaveService, reqExportService, reqAuditTask, reqAssistFunction, reqUqdateLabel,
  reqGetModelList,reqInferenceFunction, reqSplitPolygon, reqUnionPolygons} from '@/services/map/api';
import { reqFinishTaskItem, reqCancelFinishTaskItem } from '@/services/taskManage/api';
import { Vector as VectorLayer } from 'ol/layer';
import { Vector as VectorSource } from 'ol/source';
import { Fill, Stroke, Style } from 'ol/style';
import { Circle as CircleStyle } from 'ol/style';
import 'ol-layerswitcher/dist/ol-layerswitcher.css';
import 'ol/ol.css';
import Draw, { createBox, createRegularPolygon } from 'ol/interaction/Draw';
import { GeoJSON } from 'ol/format';
import './style.less';
import {Modify, Select as OlSelect} from 'ol/interaction';
import { altKeyOnly, singleClick } from 'ol/events/condition';
import DragBox from 'ol/interaction/DragBox';
import {
  CheckOutlined, CloseOutlined, DeleteOutlined, RollbackOutlined, UpOutlined,
  SaveOutlined, SyncOutlined, ScissorOutlined, UndoOutlined, RedoOutlined,
  RobotOutlined, ThunderboltOutlined, AppstoreOutlined, BuildOutlined, QuestionCircleOutlined,
  LeftOutlined, RightOutlined,
  MergeCellsOutlined,
  SplitCellsOutlined,
  BorderOutlined
} from '@ant-design/icons';
import Uploader from './Uploader';
import { Redirect, Access, useAccess, history, useModel } from 'umi';
import { Decrypt, Encrypt, jumpRoutesInNewPage } from '@/utils/utils';
import BasicMap from './components/basicMap';
import FeatureAttributePanel from './components/FeatureAttributePanel';
import useMap from '@/hooks/map/useMap';
import CollectionCreateForm from '@/components/CollectionCreateForm';
import { Collection } from 'ol';
import Polygon from 'ol/geom/Polygon';
import { Text } from 'ol/style';
import { getCoordinateSystemFromTask, getTransformationParams, normalizeCoordinateCode, registerCommonProjections } from '@/utils/coordinateSystem';

registerCommonProjections();


// 创建可旋转矩形的几何函数
const createRotatableRectangle = () => {
  return function (coordinates, geometry) {
    if (!coordinates || coordinates.length < 2) {
      return geometry;
    }

    const center = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    const dx = last[0] - center[0];
    const dy = last[1] - center[1];

    // 计算拖拽距离
    const distance = Math.sqrt(dx * dx + dy * dy);

    // 计算旋转角度（基于拖拽方向）
    const rotation = Math.atan2(dy, dx);

    // 动态计算矩形尺寸
    // 长边为拖拽距离，短边为长边的0.4倍（可调整比例）
    const length = distance;
    const width = distance*0.618;

    // 创建矩形的四个角点（相对于中心点，长边沿着拖拽方向）
    const halfLength = length/2;
    const halfWidth = width/2;

    const corners = [
      [-halfLength, -halfWidth],
      [halfLength, -halfWidth],
      [halfLength, halfWidth],
      [-halfLength, halfWidth],
      [-halfLength, -halfWidth] // 闭合多边形
    ];

    // 应用旋转变换
    const rotatedCorners = corners.map(([x, y]) => {
      const rotatedX = x * Math.cos(rotation) - y * Math.sin(rotation);
      const rotatedY = x * Math.sin(rotation) + y * Math.cos(rotation);
      return [center[0] + rotatedX, center[1] + rotatedY];
    });

    if (!geometry) {
      // eslint-disable-next-line no-param-reassign
      geometry = new Polygon([rotatedCorners]);
    } else {
      geometry.setCoordinates([rotatedCorners]);
    }

    return geometry;
  };
};

const RECTANGLE_SHAPE_KEY = 'shapeKind';
const RECTANGLE_SHAPE = 'rectangle';
const ROTATED_RECTANGLE_SHAPE = 'rotatedRectangle';

const getPolygonCorners = (feature) => {
  const geometry = feature?.getGeometry?.();
  if (geometry?.getType?.() !== 'Polygon') {
    return [];
  }
  const ring = geometry.getCoordinates?.()?.[0] || [];
  if (ring.length < 4) {
    return [];
  }
  const corners = ring.slice();
  const first = corners[0];
  const last = corners[corners.length - 1];
  if (first && last && first[0] === last[0] && first[1] === last[1]) {
    corners.pop();
  }
  return corners.length === 4 ? corners : [];
};

const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

const isAxisAlignedRectangle = (corners) => {
  if (corners.length !== 4) return false;
  const xs = [...new Set(corners.map(([x]) => Number(x.toFixed(8))))];
  const ys = [...new Set(corners.map(([, y]) => Number(y.toFixed(8))))];
  return xs.length === 2 && ys.length === 2;
};

const isRectangleLike = (corners) => {
  if (corners.length !== 4) return false;
  const edges = corners.map((point, index) => {
    const next = corners[(index + 1) % corners.length];
    return [next[0] - point[0], next[1] - point[1]];
  });
  const lengths = edges.map(([x, y]) => Math.hypot(x, y));
  const maxLength = Math.max(...lengths);
  if (!maxLength || lengths.some((length) => length < maxLength * 0.02)) {
    return false;
  }
  const dotTolerance = maxLength * maxLength * 0.08;
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    const nextEdge = edges[(index + 1) % edges.length];
    const dot = edge[0] * nextEdge[0] + edge[1] * nextEdge[1];
    if (Math.abs(dot) > dotTolerance) {
      return false;
    }
  }
  return true;
};

const resolveRectangleShapeKind = (feature) => {
  const savedKind = feature?.get?.(RECTANGLE_SHAPE_KEY);
  if ([RECTANGLE_SHAPE, ROTATED_RECTANGLE_SHAPE].includes(savedKind)) {
    return savedKind;
  }
  const corners = getPolygonCorners(feature);
  if (isAxisAlignedRectangle(corners)) {
    return RECTANGLE_SHAPE;
  }
  if (isRectangleLike(corners)) {
    return ROTATED_RECTANGLE_SHAPE;
  }
  return null;
};

const getMovedCornerIndex = (beforeCorners, afterCorners) => {
  if (!beforeCorners || beforeCorners.length !== 4 || afterCorners.length !== 4) {
    return -1;
  }
  let movedIndex = -1;
  let maxDistance = 0;
  afterCorners.forEach((corner, index) => {
    const currentDistance = distance(beforeCorners[index], corner);
    if (currentDistance > maxDistance) {
      maxDistance = currentDistance;
      movedIndex = index;
    }
  });
  return maxDistance > 0 ? movedIndex : -1;
};

const projectPoint = ([x, y], ux, uy) => ({
  u: x * ux[0] + y * ux[1],
  v: x * uy[0] + y * uy[1],
});

const setAxisAlignedRectangleGeometry = (feature, corners, beforeCorners = null) => {
  let referenceCorners = corners;
  const movedIndex = getMovedCornerIndex(beforeCorners, corners);
  if (movedIndex >= 0) {
    const movedCorner = corners[movedIndex];
    const oppositeCorner = beforeCorners[(movedIndex + 2) % 4];
    referenceCorners = [movedCorner, oppositeCorner];
  }

  const xs = referenceCorners.map(([x]) => x);
  const ys = referenceCorners.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (minX === maxX || minY === maxY) {
    return false;
  }
  feature.getGeometry().setCoordinates([[
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
  ]]);
  return true;
};

const setOrientedRectangleGeometryFromBaseline = (feature, corners, beforeCorners) => {
  const movedIndex = getMovedCornerIndex(beforeCorners, corners);
  if (movedIndex < 0) {
    return false;
  }
  const movedCorner = corners[movedIndex];
  const oppositeCorner = beforeCorners[(movedIndex + 2) % 4];
  const nextCorner = beforeCorners[(movedIndex + 1) % 4];
  const previousCorner = beforeCorners[(movedIndex + 3) % 4];
  const uLength = distance(beforeCorners[movedIndex], nextCorner);
  const vLength = distance(beforeCorners[movedIndex], previousCorner);
  if (!uLength || !vLength) {
    return false;
  }
  const ux = [
    (nextCorner[0] - beforeCorners[movedIndex][0]) / uLength,
    (nextCorner[1] - beforeCorners[movedIndex][1]) / uLength,
  ];
  const uy = [
    (previousCorner[0] - beforeCorners[movedIndex][0]) / vLength,
    (previousCorner[1] - beforeCorners[movedIndex][1]) / vLength,
  ];
  const movedProjection = projectPoint(movedCorner, ux, uy);
  const oppositeProjection = projectPoint(oppositeCorner, ux, uy);
  const toCoordinate = (u, v) => [u * ux[0] + v * uy[0], u * ux[1] + v * uy[1]];
  const nextProjection = { u: oppositeProjection.u, v: movedProjection.v };
  const previousProjection = { u: movedProjection.u, v: oppositeProjection.v };
  const orderedCorners = [];
  orderedCorners[movedIndex] = movedCorner;
  orderedCorners[(movedIndex + 1) % 4] = toCoordinate(nextProjection.u, nextProjection.v);
  orderedCorners[(movedIndex + 2) % 4] = toCoordinate(oppositeProjection.u, oppositeProjection.v);
  orderedCorners[(movedIndex + 3) % 4] = toCoordinate(previousProjection.u, previousProjection.v);
  if (distance(orderedCorners[movedIndex], orderedCorners[(movedIndex + 1) % 4]) === 0
      || distance(orderedCorners[movedIndex], orderedCorners[(movedIndex + 3) % 4]) === 0) {
    return false;
  }
  feature.getGeometry().setCoordinates([[...orderedCorners, orderedCorners[0]]]);
  return true;
};

const setOrientedRectangleGeometry = (feature, corners, beforeCorners = null) => {
  if (beforeCorners?.length === 4 && setOrientedRectangleGeometryFromBaseline(feature, corners, beforeCorners)) {
    return true;
  }

  const edges = corners.map((point, index) => {
    const next = corners[(index + 1) % corners.length];
    return { start: point, end: next, length: distance(point, next) };
  });
  const majorEdge = edges.reduce((best, edge) => (edge.length > best.length ? edge : best), edges[0]);
  if (!majorEdge?.length) {
    return false;
  }
  const ux = [(majorEdge.end[0] - majorEdge.start[0]) / majorEdge.length, (majorEdge.end[1] - majorEdge.start[1]) / majorEdge.length];
  const uy = [-ux[1], ux[0]];
  const projections = corners.map(([x, y]) => ({
    u: x * ux[0] + y * ux[1],
    v: x * uy[0] + y * uy[1],
  }));
  const uValues = projections.map(({ u }) => u);
  const vValues = projections.map(({ v }) => v);
  const minU = Math.min(...uValues);
  const maxU = Math.max(...uValues);
  const minV = Math.min(...vValues);
  const maxV = Math.max(...vValues);
  if (minU === maxU || minV === maxV) {
    return false;
  }
  const toCoordinate = (u, v) => [u * ux[0] + v * uy[0], u * ux[1] + v * uy[1]];
  feature.getGeometry().setCoordinates([[
    toCoordinate(minU, minV),
    toCoordinate(maxU, minV),
    toCoordinate(maxU, maxV),
    toCoordinate(minU, maxV),
    toCoordinate(minU, minV),
  ]]);
  return true;
};

const constrainRectangleFeature = (feature, beforeCorners = null) => {
  const kind = resolveRectangleShapeKind(feature);
  if (!kind) {
    return false;
  }
  const corners = getPolygonCorners(feature);
  if (corners.length !== 4) {
    return false;
  }
  const updated = kind === RECTANGLE_SHAPE
    ? setAxisAlignedRectangleGeometry(feature, corners, beforeCorners)
    : setOrientedRectangleGeometry(feature, corners, beforeCorners);
  if (updated) {
    feature.set(RECTANGLE_SHAPE_KEY, kind);
  }
  return updated;
};

const selectionContainsRectangle = (features) => {
  return (features?.getArray?.() || []).some((feature) => !!resolveRectangleShapeKind(feature));
};

export default function () {
  const shapeSelect = useRef();
  const layerSelect = useRef();

  const [showUploader, setShowUploader] = useState(false);
  const [showAuditLoader, setShowAuditLoader] = useState(false);
  const [markSource, setMarkSource] = useState(new VectorSource());
  const [fillOpacity, setFillOpacity] = useState(0.1);
  const [modelList, setModelList] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState(null);
  const [samInteractiveEnabled, setSamInteractiveEnabled] = useState(false);
  const [samParam1, setSamParam1] = useState('0.85');
  const [samParam2, setSamParam2] = useState('50');
  const [samParam3, setSamParam3] = useState('20');
  const [samParam4, setSamParam4] = useState('1');
  const [activeShape, setActiveShape] = useState('None'); // 当前激活的形状
  const [toolbarState, setToolbarState] = useState({
    drawState: false,
    color: '',
    sourceKey: null,
    markSource: new VectorSource(),
    currentLayer: '',
  });
  // 任务导航：当前用户的任务 ID 列表
  const {
    initialState: {
      currentState: { currentUser },
    },
  } = useModel('@@initialState');

  //挂载地图并定位服务 hook
  const { typeList, taskInfo, setMap, mapRef, markGeoJsonArr, mapExtent, refreshMarkGeoJsonArr, taskSource, localImagePath, taskItems, currentTaskItemId, mapProjectionCode } = useMap();
  const taskCoordinateSystem = normalizeCoordinateCode(
    taskInfo?.data?.[0]?.coordinateSystem || taskInfo?.coordinateSystem || 'EPSG:3857'
  );
  const currentTaskType = taskInfo?.data?.[0]?.type || '';
  const isTargetRecognitionTask = currentTaskType === '目标检测' || currentTaskType === '目标识别';
  const access = useAccess(); // access 实例的成员: canAdmin, canUser
  let select, modify, shapeDraw; // 将交互变量声明在组件顶层
  const selectRef = useRef(null);
  const modifyRef = useRef(null);
  const shapeDrawRef = useRef(null);
  const dragBoxRef = useRef(null);
  const unionFirstFeatureRef = useRef(null);
  const splitFirstFeatureRef = useRef(null);
  const samInteractiveEnabledRef = useRef(false);
  const triggerSamInteractiveRef = useRef(null);
  const refreshMarkGeoJsonArrRef = useRef(refreshMarkGeoJsonArr);
  const deletedMarkIdsRef = useRef([]);
  const interactionRunRef = useRef(0);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const pendingHistorySnapshotRef = useRef(null);
  const rectangleModifyStartRef = useRef(new Map());
  const [toolMode, setToolMode] = useState('none'); // none | split | union | boxDelete
  const [deletedMarkIds, setDeletedMarkIds] = useState([]);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [featurePanelVersion, setFeaturePanelVersion] = useState(0);
  const lastConflictFeatureRef = useRef(null);
  const FEATURE_BASE_STYLE_KEY = '__featureBaseStyle';
  const FEATURE_HIGHLIGHT_KEY = '__featureHighlightStyle';
  useEffect(() => {
    refreshMarkGeoJsonArrRef.current = refreshMarkGeoJsonArr;
  }, [refreshMarkGeoJsonArr]);
  useEffect(() => {
    deletedMarkIdsRef.current = deletedMarkIds;
  }, [deletedMarkIds]);

  useEffect(() => {
    if (!isCurrentUserReadOnly) return;
    setToolMode('none');
    if (shapeSelect.current && shapeSelect.current.value !== 'None') {
      shapeSelect.current.value = 'None';
      setActiveShape('None');
      shapeSelect.current.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, [isCurrentUserReadOnly]);

  // 辅助函数：将颜色转换为指定透明度版本
  const getTransparentColor = useCallback((color, opacity = fillOpacity) => {
    if (!color) return `rgba(102, 153, 255, ${opacity})`;

    // 如果已经是rgba格式，替换透明度
    if (color.startsWith('rgba')) {
      return color.replace(/,\s*[\d.]+\)$/, `, ${opacity})`);
    }

    // 如果是hex格式，转换为rgba
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }

    // 如果是rgb格式，转换为rgba
    if (color.startsWith('rgb')) {
      return color.replace('rgb', 'rgba').replace(')', `, ${opacity})`);
    }

    // 默认颜色
    return `rgba(102, 153, 255, ${opacity})`;
  }, [fillOpacity]);

  const createHighlightStyle = useCallback((feature) => {
    const geometryType = feature?.getGeometry?.()?.getType?.();
    if (geometryType === 'Point') {
      return new Style({
        image: new CircleStyle({
          radius: 8,
          fill: new Fill({ color: 'rgba(255, 235, 59, 0.45)' }),
          stroke: new Stroke({ color: '#ff9800', width: 3 }),
        }),
      });
    }
    if (geometryType === 'LineString') {
      return new Style({
        stroke: new Stroke({ color: '#ff9800', width: 5 }),
      });
    }
    return new Style({
      fill: new Fill({ color: 'rgba(255, 235, 59, 0.2)' }),
      stroke: new Stroke({ color: '#ff9800', width: 4 }),
    });
  }, []);

  const applyFeatureHighlight = useCallback((feature) => {
    if (!feature) return;
    if (feature.get(FEATURE_BASE_STYLE_KEY) === undefined) {
      feature.set(FEATURE_BASE_STYLE_KEY, feature.getStyle() || null);
    }
    const highlightStyle = feature.get(FEATURE_HIGHLIGHT_KEY) || createHighlightStyle(feature);
    feature.set(FEATURE_HIGHLIGHT_KEY, highlightStyle);
    feature.setStyle(highlightStyle);
  }, [createHighlightStyle]);

  const restoreFeatureStyle = useCallback((feature) => {
    if (!feature) return;
    if (feature.get(FEATURE_BASE_STYLE_KEY) === undefined &&
        feature.get(FEATURE_HIGHLIGHT_KEY) === undefined) {
      return;
    }
    const baseStyle = feature.get(FEATURE_BASE_STYLE_KEY);
    feature.setStyle(baseStyle || undefined);
    feature.unset(FEATURE_BASE_STYLE_KEY, true);
    feature.unset(FEATURE_HIGHLIGHT_KEY, true);
  }, []);

  const isPolygonFeature = useCallback((feature) => {
    const geometryType = feature?.getGeometry?.()?.getType?.();
    return geometryType === 'Polygon' || geometryType === 'MultiPolygon';
  }, []);

  const getOuterRingCoordinates = useCallback((feature) => {
    const geometry = feature?.getGeometry?.();
    const geometryType = geometry?.getType?.();
    if (geometryType === 'Polygon') {
      return geometry?.getCoordinates?.()?.[0] || [];
    }
    if (geometryType === 'MultiPolygon') {
      return geometry?.getCoordinates?.()?.[0]?.[0] || [];
    }
    return [];
  }, []);

  const featureToGeoJsonObject = useCallback((feature) => {
    if (!feature) return null;
    const format = new GeoJSON();
    const viewProj = mapRef.current?.getView?.()?.getProjection?.()?.getCode?.() || 'EPSG:3857';
    const writeOptions = viewProj === 'pixel'
      ? { dataProjection: 'pixel', featureProjection: 'pixel' }
      : getTransformationParams(taskCoordinateSystem, viewProj);
    return format.writeFeatureObject(feature, writeOptions);
  }, [mapRef, taskCoordinateSystem]);

  //修改标注显示部分的代码，将原来标注显示部分的代码由useEffect改为在generateMarkLayer函数中进行,根据用户角色进行判断，仅当用户为管理员时才进行渲染
  const generateMarkLayer = useMemo(() => {
    console.log('遍历已标注的的标注图层');
    // 如果是审核状态（status=0），则显示所有用户的标注;否则只显示自己的
    //修改点1，添加安全校验
    const userList = taskInfo?.data?.[0]?.status === 0
      ? taskInfo?.data?.[0]?.userArr ?? []  // 如果是审核状态，使用所有用户
      : taskInfo?.data?.[0]?.userArr?.filter(({ username }) => username === currentUser) ?? []; // 否则只显示当前用户

    const totalTypeIdArr = [];
    if (userList) {
      for (const { typeArr,username } of userList) {
        //修改点2，审核状态显示所有标注
        if(taskInfo?.data?.[0]?.status === 0){
          totalTypeIdArr.push(...typeArr);
          continue
        }
        totalTypeIdArr.push(...typeArr);
      }
    }

    // 添加背景图层到类型数组中（仅在非审核状态下为当前用户添加）
    if (taskInfo?.data?.[0]?.status !== 0) {
      totalTypeIdArr.push({
        typeId: 0,
        typeName: '背景',
        typeColor: '#ff0000' // 红色表示要消除的区域
      });
    }

    let vectorLayerArr = [];
    if (totalTypeIdArr.length) {
      vectorLayerArr = totalTypeIdArr.map(({ typeColor, typeName, typeId }) => {
        const typeSource = new VectorSource({
          format:new GeoJSON(),
          projection: taskCoordinateSystem // 动态获取坐标系
        });
        typeSource?.set('typeid', typeId);
        for (const item of markGeoJsonArr) {
          const itemUserId = item?.userId == null ? null : Number(item.userId);
          const isCurrentUserMark = currentUserId == null
            ? true
            : (itemUserId == null || itemUserId === currentUserId);
          if (typeId == item.typeId && isCurrentUserMark) {
            // taskSource==='local' 时坐标是像素坐标，dataProjection 和 featureProjection 都设为 'pixel'
            // 防止 OpenLayers 把像素坐标当经纬度做投影转换
            const isLocal = taskSource === 'local';
            const dataProjection = normalizeCoordinateCode(item.coordinateSystem || taskCoordinateSystem || 'EPSG:3857');
            const mapProjection = normalizeCoordinateCode(mapProjectionCode || taskCoordinateSystem || 'EPSG:3857');
            const readOptions = isLocal
              ? { dataProjection: 'pixel', featureProjection: 'pixel' }
              : getTransformationParams(dataProjection, mapProjection);
            let features = [];
            try {
              features = new GeoJSON().readFeatures(item.markGeoJson, readOptions);
            } catch (e) {
              console.error('读取标注 GeoJSON 失败，已跳过该要素:', e, {
                markId: item.markId,
                dataProjection,
                mapProjection,
              });
              continue;
            }
            features.forEach(feature => {
              feature.set('markId', item.markId);
              feature.set('typeId', typeId);
              feature.set('userId', item.userId);
              feature.set('readonlyReference', false);
              const rawAttrJson = item.attrJson ?? feature.get('attrJson') ?? feature.get('attr_json') ?? null;
              if (rawAttrJson && typeof rawAttrJson === 'string') {
                try {
                  feature.set('attrJson', JSON.parse(rawAttrJson));
                } catch (error) {
                  feature.set('attrJson', {});
                }
              } else if (rawAttrJson && typeof rawAttrJson === 'object') {
                feature.set('attrJson', rawAttrJson);
              } else {
                feature.set('attrJson', {});
              }
              if (item.feedback) {
                feature.set('feedback', item.feedback);
              }
              typeSource.addFeature(feature);
            });
          }
        }

        // Create a style function that handles both Point and Polygon geometries
        const styleFunction = (feature) => {
          const geometry = feature.getGeometry();
          const geometryType = geometry.getType();
          const feedbackText = feature.get('feedback'); // 获取反馈信息

          let baseStyle; // 1. 先声明一个变量

          // 2. 根据类型创建基础样式，并赋值给 baseStyle
          if (geometryType === 'Point') {
            baseStyle = new Style({
              image: new CircleStyle({
                radius: 6,
                fill: new Fill({ color: getTransparentColor('#ffffff') }),
                stroke: new Stroke({ color: typeColor, width: 3 }),
              }),
            });
          } else {
            if (typeId === 0) {
              baseStyle = new Style({
                fill: new Fill({ color: getTransparentColor(typeColor, 0.3) }),
                stroke: new Stroke({ color: typeColor, width: 3, lineDash: [5, 5] }),
              });
            } else {
              baseStyle = new Style({
                fill: new Fill({ color: getTransparentColor(typeColor) }),
                stroke: new Stroke({ color: typeColor, width: 3 }),
              });
            }
          }

          // 3. 在基础样式上，有条件地添加 Text
          if (feedbackText) {
            baseStyle.setText(new Text({
              text: feedbackText,
              font: 'bold 14px sans-serif',
              overflow: true,
              fill: new Fill({ color: '#fff' }),
              backgroundFill: new Fill({ color: 'rgba(255, 0, 0, 0.8)' }),
              padding: [4, 8, 4, 8],
              offsetY: geometryType === 'Point' ? -20 : 0,
              textAlign: 'center',
              textBaseline: 'middle'
            }));
          }

          // 4. 最后返回这个 style 对象
          return baseStyle;
        };


        const vectorLayer = new VectorLayer({
          title: typeName,
          source: typeSource,
          style: styleFunction,
        });
        vectorLayer.set('typeid', typeId);
        vectorLayer.set('editableLayer', true);
        vectorLayer.setZIndex(99);
        return vectorLayer;
      });
    }

    // 添加"模型作用范围"图层（不在图层切换器中显示）
    const modelScopeSource = new VectorSource();
    const modelScopeLayer = new VectorLayer({
      title: '模型作用范围',
      source: modelScopeSource,
      style: new Style({
        fill: new Fill({
          color: getTransparentColor('#ffcc33'),
        }),
        stroke: new Stroke({
          color: '#ffcc33', // 使用特定颜色区分
          width: 3,
        }),
      }),
    });
    modelScopeLayer.set('typeid', 'modelScope');
    modelScopeLayer.set('editableLayer', false);
    modelScopeLayer.set('displayInLayerSwitcher', false); // 设置不在图层切换器中显示
    modelScopeLayer.setZIndex(99);
    vectorLayerArr.push(modelScopeLayer);

    return vectorLayerArr;
  }, [currentUserData, currentUserId, markGeoJsonArr, taskInfo, taskSource, currentUser, mapRef, getTransparentColor, mapProjectionCode, taskCoordinateSystem]); // 依赖项包含任务状态和用户信息

  // 管理图层的添加和移除
  useEffect(() => {
    if (!mapRef.current || !generateMarkLayer.length) return;

    // 移除之前的标注图层（避免重复添加）
    const existingLayers = mapRef.current.getLayers().getArray().slice();
    existingLayers.forEach(layer => {
      if (layer.get('typeid') && layer.get('typeid') !== 'base') {
        mapRef.current.removeLayer(layer);
      }
    });

    // 添加新的标注图层
    generateMarkLayer.forEach(layer => {
      layer.setZIndex(99);
      mapRef.current.addLayer(layer);
      const typeId = layer.get('typeid');
      const isModelScopeLayer = typeId === 'modelScope';
      const isSelectedLayer = toolbarState.sourceKey !== null && toolbarState.sourceKey !== undefined
        && String(typeId) === String(toolbarState.sourceKey);
      layer.setVisible(isModelScopeLayer ? false : isSelectedLayer);
      console.log('添加图层:', layer.get('title'), '类型ID:', layer.get('typeid'), '要素数量:', layer.getSource().getFeatures().length);
    });

    // 输出当前地图中的所有图层信息
    console.log('当前地图图层总数:', mapRef.current.getLayers().getLength());
    mapRef.current.getLayers().forEach((layer, index) => {
      console.log(`图层 ${index}:`, layer.get('title'), '可见性:', layer.getVisible(), '类型ID:', layer.get('typeid'));
    });

    // 数据刷新后，如果当前有选中的图层，需要更新toolbarState中的数据源
    if (toolbarState.sourceKey !== null && toolbarState.sourceKey !== undefined) {
      const currentLayer = generateMarkLayer.find(layer => layer.get('typeid') == toolbarState.sourceKey);
      if (currentLayer) {
        console.log('数据刷新后更新工具栏状态，图层ID:', toolbarState.sourceKey);
        setToolbarState(prevState => ({
          ...prevState,
          drawState: false,
          markSource: currentLayer.getSource(),
          currentLayer: currentLayer,
        }));
      }
    }

    return () => {
      // 清理函数：组件卸载时移除图层
      if (mapRef.current) {
        generateMarkLayer.forEach(layer => {
          mapRef.current.removeLayer(layer);
        });
      }
    };
  }, [generateMarkLayer, mapRef, toolbarState.sourceKey]); // 添加toolbarState.sourceKey到依赖项
  useEffect(() => {
    interactionRunRef.current += 1;
    console.log(`[interactionEffect] run #${interactionRunRef.current}`, {
      toolMode,
      hasLayer: !!toolbarState.currentLayer,
      sourceKey: toolbarState.sourceKey,
      shape: shapeSelect.current?.value,
    });
    // 当前选择的数据源
    const currentSelectSource = toolbarState.markSource;
    // 添加绘制效果

    // 清理之前的交互
    if (mapRef.current) {
      const interactions = mapRef.current.getInteractions().getArray().slice();
      interactions.forEach(interaction => {
        if (interaction instanceof Draw ||
            interaction instanceof OlSelect ||
            interaction instanceof Modify ||
            interaction instanceof DragBox) {
          mapRef.current.removeInteraction(interaction);
        }
      });
    }

    const addDrawInteraction = () => {
      let value = shapeSelect.current.value;
      const selectedShapeValue = value;
      let geometryFunction;
      let cursorStyle = 'crosshair'; // 默认十字光标

      switch (value) {
        // 矩形
        case 'Box':
          value = 'Circle';
          geometryFunction = createBox();
          cursorStyle = 'crosshair';
          break;
        // 可旋转矩形
        case 'RotatableRectangle':
          value = 'Circle';
          geometryFunction = createRotatableRectangle();
          cursorStyle = 'crosshair';
          break;
        // 多边形
        case 'Polygon':
          value = 'Polygon';
          cursorStyle = 'crosshair';
          break;
        case 'Point':  // 新增对 Point 类型的处理
          value = 'Point';
          cursorStyle = 'crosshair';
          break;
        case 'LineString': // 新增线段支持
          value = 'LineString';
          cursorStyle = 'crosshair';
          break;
      }

      // 设置地图容器的光标样式
      if (mapRef.current) {
        const mapElement = mapRef.current.getTargetElement();
        if (mapElement) {
          // 创建自定义光标样式
          mapElement.style.cursor = cursorStyle;
          // 添加一个CSS类来标识当前处于绘制模式
          mapElement.classList.add('drawing-mode');
          mapElement.setAttribute('data-draw-type', shapeSelect.current.value);
        }
      }

// 定义绘制样式，与当前图层样式一致
      let drawStyle;

      if (value === 'Point') {
        drawStyle = new Style({
          image: new CircleStyle({
            radius: 6, // 设置点的半径为 6 像素
            fill: new Fill({
              color: getTransparentColor('#ffffff'), // 与图层填充一致
            }),
            stroke: new Stroke({
              color: toolbarState.color || '#6699ff', // 使用当前图层的颜色
              width: 3, // 与图层边框宽度一致
            }),
          }),
        });
      } else {
        // 为多边形和其他几何类型定义样式
        drawStyle = new Style({
          fill: new Fill({
            color: getTransparentColor(toolbarState.color), // 使用改进的颜色转换函数
          }),
          stroke: new Stroke({
            color: toolbarState.color || '#6699ff', // 使用当前图层的颜色
            width: 3, // 与图层边框宽度一致
          }),
        });
      }
      shapeDraw = new Draw({
        source: currentSelectSource,
        type: value,
        geometryFunction: geometryFunction,
        style: drawStyle // 将自定义样式应用到绘制交互
      });
      shapeDrawRef.current = shapeDraw;
      console.log('标注的数据源');
      console.log(currentSelectSource);

      shapeDraw.on('drawend', (event) => {
        // 获取绘制的矩形
        const geometry = event.feature.getGeometry();
        // 获取矩形的坐标
        const coordinates = geometry.getExtent();
        // 获取地图分辨率
        const resolution = mapRef.current.getView().getResolution();

        // 确保绘制完成后的要素保持正确的样式
        const feature = event.feature;
        // 保持与绘制时一致的填充/描边，确保未保存面要素也有命中区域可被选择
        feature.setStyle(drawStyle);
        feature.set('typeId', toolbarState.sourceKey);
        if (selectedShapeValue === 'Box') {
          feature.set(RECTANGLE_SHAPE_KEY, RECTANGLE_SHAPE);
        } else if (selectedShapeValue === 'RotatableRectangle') {
          feature.set(RECTANGLE_SHAPE_KEY, ROTATED_RECTANGLE_SHAPE);
        }
        if (!feature.get('attrJson')) {
          feature.set('attrJson', {});
        }
        setFeaturePanelVersion((prev) => prev + 1);

        const geometryType = feature.getGeometry()?.getType?.();
        if (samInteractiveEnabledRef.current && ['Point', 'LineString', 'Polygon'].includes(geometryType)) {
          setTimeout(() => {
            triggerSamInteractiveRef.current?.({ silentNoPrompt: true });
          }, 0);
        }
        recordHistoryChange(pendingHistorySnapshotRef.current, captureHistorySnapshot());
        pendingHistorySnapshotRef.current = null;
      });
      shapeDraw.on('drawstart', () => {
        pendingHistorySnapshotRef.current = captureHistorySnapshot();
        console.log('[draw] start', shapeSelect.current?.value);
      });
      shapeDraw.on('drawend', () => {
        console.log('[draw] end', shapeSelect.current?.value);
      });
      if (mapRef.current) {
        mapRef.current.addInteraction(shapeDraw);
      }
    };

    // 添加绘制的交互
    if (toolbarState.currentLayer) {
      select = new OlSelect({
        layers: [toolbarState.currentLayer],
        multi: true,
        hitTolerance: 6,
        style: null, // 使用手动高亮样式，避免默认样式覆盖图层逻辑
      });
      selectRef.current = select;
      select.on('select', async (evt) => {
        (evt.selected || []).forEach((feature) => {
          const rectangleKind = resolveRectangleShapeKind(feature);
          if (rectangleKind) {
            feature.set(RECTANGLE_SHAPE_KEY, rectangleKind);
          }
          applyFeatureHighlight(feature);
        });
        (evt.deselected || []).forEach((feature) => restoreFeatureStyle(feature));
        if (evt.selected && evt.selected.length > 0) {
          setSelectedFeature(evt.selected[evt.selected.length - 1]);
        } else if (evt.deselected && evt.deselected.length > 0) {
          setSelectedFeature(null);
        }

        if (toolMode !== 'union' && toolMode !== 'split') return;
        const clickedFeature = evt.selected?.[0];
        if (!clickedFeature) return;

        if (!isPolygonFeature(clickedFeature)) {
          message.warning('该工具仅支持多边形要素');
          return;
        }

        if (toolMode === 'union') {
          const beforeSnapshot = captureHistorySnapshot();
          const firstFeature = unionFirstFeatureRef.current;
          if (!firstFeature) {
            unionFirstFeatureRef.current = clickedFeature;
            return;
          }
          if (firstFeature === clickedFeature) return;
          unionFirstFeatureRef.current = null;

          const featureGeoJson1 = featureToGeoJsonObject(firstFeature);
          const featureGeoJson2 = featureToGeoJsonObject(clickedFeature);
          if (!featureGeoJson1 || !featureGeoJson2) {
            message.warning('并集要素无效');
            select.getFeatures().clear();
            return;
          }

          const hide = message.loading('正在计算并集...');
          try {
            const result = await reqUnionPolygons({
              featureGeoJson1,
              featureGeoJson2,
            });
            hide();
            if (result?.code === 200) {
              const unionFeatures = Array.isArray(result?.unionFeatures) ? result.unionFeatures : [];
              if (!toolbarState.currentLayer) {
                message.error('当前图层无效，无法应用并集结果');
                select.getFeatures().clear();
                return;
              }
              const source = toolbarState.currentLayer.getSource();
              const removeIds = [];
              [firstFeature, clickedFeature].forEach((feature) => {
                const markId = feature.get('markId') || feature.getId();
                if (markId) removeIds.push(markId);
                source.removeFeature(feature);
              });
              if (removeIds.length > 0) {
                setDeletedMarkIds((prev) => [...prev, ...removeIds]);
              }

              if (unionFeatures.length > 0) {
                const format = new GeoJSON();
                const viewProj = mapRef.current?.getView?.()?.getProjection?.()?.getCode?.() || 'EPSG:3857';
                const readOptions = viewProj === 'pixel'
                  ? { dataProjection: 'pixel', featureProjection: 'pixel' }
                  : {};
                const newFeatures = format.readFeatures({
                  type: 'FeatureCollection',
                  features: unionFeatures,
                }, readOptions);
                newFeatures.forEach((feature) => {
                  feature.set('markId', null);
                  feature.set('typeId', toolbarState.sourceKey);
                  if (!feature.get('attrJson')) {
                    feature.set('attrJson', {});
                  }
                  source.addFeature(feature);
                });
              }

              recordHistoryChange(beforeSnapshot, captureHistorySnapshot(removeIds.length > 0 ? [...deletedMarkIdsRef.current, ...removeIds] : deletedMarkIdsRef.current));
              message.success(result?.message || '并集成功');
              setSelectedFeature(null);
              setFeaturePanelVersion((prev) => prev + 1);
              select.getFeatures().clear();
            } else {
              message.error(result?.message || '并集失败');
            }
          } catch (e) {
            hide();
            message.error('并集失败：' + e.message);
          }
          return;
        }

        const firstFeature = splitFirstFeatureRef.current;
        if (!firstFeature) {
          splitFirstFeatureRef.current = clickedFeature;
          message.info('已选择第一个多边形，请再选择第二个多边形');
          return;
        }
        if (firstFeature === clickedFeature) return;
        splitFirstFeatureRef.current = null;
        const markId = firstFeature.get('markId') || firstFeature.getId();
        if (!markId) {
          message.warning('第一个多边形尚未保存，请先保存后再删除交集');
          select.getFeatures().clear();
          return;
        }
        const erasePolygonCoordinates = getOuterRingCoordinates(clickedFeature);
        if (erasePolygonCoordinates.length < 4) {
          message.warning('第二个要素多边形无效');
          select.getFeatures().clear();
          return;
        }
        const hide = message.loading('正在删除交集...');
        try {
          const result = await reqSplitPolygon({ markId, erasePolygonCoordinates });
          hide();
          if (result?.code === 200) {
            message.success(result?.message || '删除交集成功');
            select.getFeatures().clear();
            setSelectedFeature(null);
            setFeaturePanelVersion((prev) => prev + 1);
            await refreshMarkGeoJsonArrRef.current?.();
          } else {
            message.error(result?.message || '删除交集失败');
          }
        } catch (e) {
          hide();
          message.error('删除交集失败：' + e.message);
        }
      });
      mapRef.current?.addInteraction(select);
    }

    if (select && !isCurrentUserReadOnly) {
      // 仅修改“已选中要素”，避免边缘点击被 Modify 抢占导致 Select 失效
      const selectedFeatures = select.getFeatures();
      modify = new Modify({
        features: selectedFeatures,
        insertVertexCondition: () => !selectionContainsRectangle(selectedFeatures),
        deleteCondition: (event) => (
          !selectionContainsRectangle(selectedFeatures)
          && altKeyOnly(event)
          && singleClick(event)
        ),
      });
      modifyRef.current = modify;
      modify.on('modifystart', (event) => {
        pendingHistorySnapshotRef.current = captureHistorySnapshot();
        const rectangleMap = new Map();
        event.features?.getArray?.().forEach((item) => {
          const kind = resolveRectangleShapeKind(item);
          const corners = getPolygonCorners(item);
          if (kind && corners.length === 4) {
            item.set(RECTANGLE_SHAPE_KEY, kind);
            rectangleMap.set(item, corners.map((corner) => [...corner]));
          }
        });
        rectangleModifyStartRef.current = rectangleMap;
      });
      //查看修改后的feature信息
      modify.on('modifyend', (event) => {
        // 获取绘制的矩形
        const feature = event.features;
        console.log("修改后的feature")
        console.log(feature)
        console.log(event)
        console.log(toolbarState.currentLayer)
        event.features?.getArray?.().forEach((item) => {
          constrainRectangleFeature(item, rectangleModifyStartRef.current.get(item));
        });
        rectangleModifyStartRef.current = new Map();
        recordHistoryChange(pendingHistorySnapshotRef.current, captureHistorySnapshot());
        pendingHistorySnapshotRef.current = null;
        setFeaturePanelVersion((prev) => prev + 1);
      });
      //对绘制图形进行修改
      mapRef.current?.addInteraction(modify);
    }

    // 标注形状选择
    const onSelect = () => {
      if (shapeDraw && mapRef.current) {
        mapRef.current.removeInteraction(shapeDraw);
      }
      if (modify && mapRef.current) {
        mapRef.current.removeInteraction(modify);
      }

      if (shapeSelect.current.value != 'None' && !isCurrentUserReadOnly) {
        if (isTargetRecognitionTask && shapeSelect.current.value === 'Polygon') {
          message.warning('目标识别任务中禁止绘制多边形');
          shapeSelect.current.value = 'None';
          setActiveShape('None');
          return;
        }
        if (!toolbarState.currentLayer) {
          message.warning('请先选择图层再绘制');
          shapeSelect.current.value = 'None';
          setActiveShape('None');
          return;
        }
        if (toolMode !== 'none') {
          setToolMode('none');
          unionFirstFeatureRef.current = null;
          splitFirstFeatureRef.current = null;
        }
        addDrawInteraction();
        if (modify && mapRef.current) {
          mapRef.current.addInteraction(modify);
        }
      } else {
        // 非绘制状态下也允许选中后修改边界
        if (modify && mapRef.current && toolMode === 'none' && !isCurrentUserReadOnly) {
          mapRef.current.addInteraction(modify);
        }
        // 恢复默认光标并清理CSS类
        if (mapRef.current) {
          const mapElement = mapRef.current.getTargetElement();
          if (mapElement) {
            mapElement.style.cursor = 'default';
            mapElement.classList.remove('drawing-mode');
            mapElement.removeAttribute('data-draw-type');
          }
        }
      }
    };
    if (shapeSelect.current) {
      shapeSelect.current.onchange = onSelect;
    }
    // 按下esc取消绘制
    document.onkeydown = (event) => {
      if (event.key == 'Escape') {
        shapeSelect.current.value = 'None';
        setActiveShape('None');
        onSelect();
        // 恢复默认光标并清理CSS类
        if (mapRef.current) {
          const mapElement = mapRef.current.getTargetElement();
          if (mapElement) {
            mapElement.style.cursor = 'default';
            mapElement.classList.remove('drawing-mode');
            mapElement.removeAttribute('data-draw-type');
          }
        }
      }
    };
    // 选择编辑图层
    const onLayerSelect = () => {
      setSelectedFeature(null);
      setFeaturePanelVersion((prev) => prev + 1);
      if (toolMode !== 'none') {
        setToolMode('none');
        unionFirstFeatureRef.current = null;
        splitFirstFeatureRef.current = null;
      }
      const key = layerSelect.current.value;
      if (key != 'None') {
        const normalizedKey = key == '0' ? 0 : key;
        const source = currentSource(normalizedKey);
        const layer = currentLayer(normalizedKey);
        const safeTypeList = Array.isArray(typeList?.data) ? typeList.data : [];
        const type = safeTypeList.find((item) => String(item.typeId) === String(normalizedKey));
        const fallbackType = typeArr.find((item) => String(item.typeId) === String(normalizedKey));
        const fallbackColor = normalizedKey == 0 ? '#ff0000' : '#6699ff';

        setToolbarState({
          color: type?.typeColor || fallbackType?.typeColor || fallbackColor,
          // 图层尚未挂载成功前先禁用绘制，待 generateMarkLayer effect 自动补齐后再开启
          drawState: !(source && layer),
          sourceKey: normalizedKey,
          markSource: source || new VectorSource(),
          currentLayer: layer || '',
        });
      } else {
        setToolbarState({
          color: null,
          drawState: true,
          sourceKey: null,
          markSource: new VectorSource(),
        });
        // mapRef.current.removeInteraction(modify);
      }
      if (shapeDraw && mapRef.current) {
        mapRef.current.removeInteraction(shapeDraw);
      }
      shapeSelect.current.value = 'None';
    };
    if (layerSelect.current) {
      layerSelect.current.onchange = onLayerSelect;
    }

    if (toolMode === 'boxDelete' && toolbarState.currentLayer && !isCurrentUserReadOnly) {
      dragBoxRef.current = new DragBox();
      dragBoxRef.current.on('boxend', () => {
        const beforeSnapshot = captureHistorySnapshot();
        const extent = dragBoxRef.current.getGeometry().getExtent();
        const features = toolbarState.currentLayer.getSource().getFeaturesInExtent(extent) || [];
        if (!features.length) {
          message.info('框选区域内没有要素');
          return;
        }
        try {
          const newDeletedIds = [...deletedMarkIdsRef.current];
          features.forEach((item) => {
            const markId = item.get('markId') || item.getId();
            if (markId) newDeletedIds.push(markId);
            toolbarState.currentLayer.getSource().removeFeature(item);
          });
          setDeletedMarkIds(newDeletedIds);
          recordHistoryChange(beforeSnapshot, captureHistorySnapshot(newDeletedIds));
          setSelectedFeature(null);
          setFeaturePanelVersion((prev) => prev + 1);
          message.success(`已删除 ${features.length} 个要素`);
        } catch (error) {
          message.error('框选删除失败');
        }
      });
      mapRef.current?.addInteraction(dragBoxRef.current);
    }
    // 清理函数
    return () => {
      if (mapRef.current) {
        const selectedFeatures = select?.getFeatures?.()?.getArray?.() || [];
        selectedFeatures.forEach((feature) => restoreFeatureStyle(feature));
        if (shapeDraw) mapRef.current.removeInteraction(shapeDraw);
        if (select) mapRef.current.removeInteraction(select);
        if (modify) mapRef.current.removeInteraction(modify);
        if (dragBoxRef.current) {
          mapRef.current.removeInteraction(dragBoxRef.current);
          dragBoxRef.current = null;
        }
      }
    };
  }, [
    toolbarState.markSource,
    toolbarState.currentLayer,
    getTransparentColor,
    fillOpacity,
    toolMode,
    isCurrentUserReadOnly,
    toolbarState.sourceKey,
    typeList,
    applyFeatureHighlight,
    restoreFeatureStyle,
    isPolygonFeature,
    getOuterRingCoordinates,
    featureToGeoJsonObject,
    isTargetRecognitionTask,
  ]);

  // 获取当前标注的数据源
  const currentSource = useCallback(
    (typeid) => {
      for (const layer of generateMarkLayer) {
        if (layer.getSource().get('typeid') == typeid) {
          return layer.getSource();
        }
      }
    },
    [generateMarkLayer],
  );
  const captureHistorySnapshot = useCallback((overrideDeletedMarkIds) => {
    const format = new GeoJSON();
    const viewProj = mapRef.current?.getView?.()?.getProjection?.()?.getCode?.() || 'EPSG:3857';
    const projectionOptions = viewProj === 'pixel'
      ? { dataProjection: 'pixel', featureProjection: 'pixel' }
      : { dataProjection: viewProj, featureProjection: viewProj };
    return {
      layers: generateMarkLayer
        .filter((layer) => layer.get('editableLayer'))
        .map((layer) => ({
          typeId: layer.get('typeid'),
          features: (layer.getSource()?.getFeatures?.() || []).map((feature) => ({
            id: feature.getId?.() ?? null,
            geoJson: format.writeFeatureObject(feature, projectionOptions),
          })),
        })),
      deletedMarkIds: [...(overrideDeletedMarkIds ?? deletedMarkIdsRef.current ?? [])],
    };
  }, [generateMarkLayer, mapRef]);

  const restoreHistorySnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    const format = new GeoJSON();
    const viewProj = mapRef.current?.getView?.()?.getProjection?.()?.getCode?.() || 'EPSG:3857';
    const projectionOptions = viewProj === 'pixel'
      ? { dataProjection: 'pixel', featureProjection: 'pixel' }
      : { dataProjection: viewProj, featureProjection: viewProj };

    generateMarkLayer
      .filter((layer) => layer.get('editableLayer'))
      .forEach((layer) => {
        layer.getSource()?.clear?.();
      });

    (snapshot.layers || []).forEach((layerSnapshot) => {
      const layer = generateMarkLayer.find((item) => item.get('typeid') == layerSnapshot.typeId);
      const source = layer?.getSource?.();
      if (!source) return;
      (layerSnapshot.features || []).forEach((featureSnapshot) => {
        const [feature] = format.readFeatures(featureSnapshot.geoJson, projectionOptions);
        if (!feature) return;
        if (featureSnapshot.id !== null && featureSnapshot.id !== undefined) {
          feature.setId(featureSnapshot.id);
        }
        source.addFeature(feature);
      });
    });

    deletedMarkIdsRef.current = [...(snapshot.deletedMarkIds || [])];
    setDeletedMarkIds([...(snapshot.deletedMarkIds || [])]);
    selectRef.current?.getFeatures?.()?.clear?.();
    setSelectedFeature(null);
    setFeaturePanelVersion((prev) => prev + 1);
  }, [generateMarkLayer, mapRef]);

  const snapshotsEqual = useCallback((left, right) => {
    return JSON.stringify(left) === JSON.stringify(right);
  }, []);

  const recordHistoryChange = useCallback((beforeSnapshot, afterSnapshot) => {
    if (!beforeSnapshot || !afterSnapshot || snapshotsEqual(beforeSnapshot, afterSnapshot)) {
      return;
    }
    const nextUndoStack = [...undoStackRef.current, { before: beforeSnapshot, after: afterSnapshot }];
    undoStackRef.current = nextUndoStack.slice(-3);
    redoStackRef.current = [];
  }, [snapshotsEqual]);

  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    pendingHistorySnapshotRef.current = null;
    deletedMarkIdsRef.current = [];
    setDeletedMarkIds([]);
  }, [currentTaskItemId, markGeoJsonArr]);

  // 获取当前标注的图层
  const currentLayer = useCallback(
    (typeid) => {
      for (const layer of generateMarkLayer) {
        if (layer.get('typeid') == typeid) {
          //TODO
          return layer;
        }
      }
    },
    [generateMarkLayer],
  );
  // 回滚
  const undo = useCallback(() => {
    const entry = undoStackRef.current.pop();
    if (!entry) {
      message.info('没有可撤销的操作');
      return;
    }
    restoreHistorySnapshot(entry.before);
    redoStackRef.current = [...redoStackRef.current, entry].slice(-3);
  }, [restoreHistorySnapshot]);
  // 恢复
  const recover = useCallback(() => {
    const entry = redoStackRef.current.pop();
    if (!entry) {
      message.info('没有可重做的操作');
      return;
    }
    restoreHistorySnapshot(entry.after);
    undoStackRef.current = [...undoStackRef.current, entry].slice(-3);
  }, [restoreHistorySnapshot]);
  const getTaskId = useMemo(() => {
    let TASKID = window.sessionStorage.getItem('taskId');
    // let TASKID=taskInfo.data[0].taskname
    let taskId=Decrypt(TASKID)
    return taskId;
  }, []);

  const getTaskItemId = useMemo(() => {
    const rawTaskItemId = window.sessionStorage.getItem('taskItemId');
    if (!rawTaskItemId) return currentTaskItemId;
    const numericId = Number(rawTaskItemId);
    return Number.isFinite(numericId) ? numericId : currentTaskItemId;
  }, [currentTaskItemId]);

  const currentTaskItem = useMemo(() => {
    if (!Array.isArray(taskItems) || taskItems.length === 0) return null;
    return taskItems.find((item) => Number(item?.taskItemId) === Number(getTaskItemId)) || taskItems[0];
  }, [getTaskItemId, taskItems]);
  const markProgress = useMemo(() => {
    const total = Array.isArray(taskItems) ? taskItems.length : 0;
    if (total === 0) {
      return { finished: 0, total: 0 };
    }
    const finished = taskItems.filter((item) => {
      const itemStatus = Number(item?.status);
      if (itemStatus === 0 || itemStatus === 1) {
        return true;
      }
      return !!item?.finishSummary?.allFinished;
    }).length;
    return { finished, total };
  }, [taskItems]);

  const currentUserData = useMemo(() => {
    const taskUsers = taskInfo?.data?.[0]?.userArr || [];
    return taskUsers.find((item) => item?.username === currentUser) || null;
  }, [currentUser, taskInfo]);

  const currentUserTaskTypes = useMemo(() => {
    return currentUserData?.typeArr || [];
  }, [currentUserData]);
  const currentUserId = currentUserData?.userid == null ? null : Number(currentUserData.userid);

  const currentTaskItemStatus = Number(
    taskInfo?.currentTaskItemStatus ?? currentTaskItem?.status ?? 3
  );
  const currentUserAssignedTypeIds = Array.isArray(taskInfo?.currentUserAssignedTypeIds)
    ? taskInfo.currentUserAssignedTypeIds
    : [];
  const currentUserFinished = !!taskInfo?.currentUserFinished;
  const currentUserAssignedTypeNames = currentUserTaskTypes
    .filter((item) => currentUserAssignedTypeIds.includes(Number(item?.typeId)))
    .map((item) => item?.typeName)
    .filter(Boolean);
  const assignedTypeText = currentUserAssignedTypeNames.length > 0
    ? currentUserAssignedTypeNames.join('、')
    : '未分配类别';
  const currentUserFinishStatusText = currentUserFinished ? '标注完成' : '未完成';
  const canToggleFinish = currentUserAssignedTypeIds.length > 0;
  const isTaskItemEditable = currentTaskItemStatus === 3 || currentTaskItemStatus === 2;
  const finishButtonDisabled = !canToggleFinish || !isTaskItemEditable;
  const isCurrentUserReadOnly = currentUserFinished || currentTaskItemStatus === 0 || currentTaskItemStatus === 1;
  const currentTaskItemAuditFeedback = taskInfo?.currentTaskItemAuditFeedback
    ?? currentTaskItem?.auditFeedback
    ?? '';
  const currentUserConflictSummary = taskInfo?.currentUserConflictSummary || {};
  const currentTaskItemConflictSummary = taskInfo?.currentTaskItemConflictSummary || {};
  const markPageConflictSummary = currentUserConflictSummary?.conflicts ? currentUserConflictSummary : currentTaskItemConflictSummary;
  const markPageConflicts = Array.isArray(markPageConflictSummary?.conflicts) ? markPageConflictSummary.conflicts : [];
  const markPageConflictCount = Number(markPageConflictSummary?.conflictCount || 0);

  const resolveFeatureTypeName = useCallback((feature) => {
    if (!feature) return '';
    const typeId = feature.get('typeId') ?? toolbarState?.sourceKey;
    if (typeId === null || typeId === undefined) return '';

    const userTypeArr = (taskInfo?.data?.[0]?.userArr || [])
      .flatMap((user) => user?.typeArr || []);
    const fromUserType = userTypeArr.find((item) => String(item?.typeId) === String(typeId));
    if (fromUserType?.typeName) return fromUserType.typeName;

    const fromTypeList = (typeList?.data || []).find((item) => String(item?.typeId) === String(typeId));
    return fromTypeList?.typeName || '';
  }, [taskInfo, typeList, toolbarState?.sourceKey]);

  const parseEnumOptions = useCallback((raw) => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    }
    return [];
  }, []);

  const taskTypeAttributeRows = useMemo(() => {
    const fromRoot = taskInfo?.taskTypeAttributes;
    if (Array.isArray(fromRoot)) {
      return fromRoot;
    }
    const fromTaskData = taskInfo?.data?.[0]?.taskTypeAttributes;
    return Array.isArray(fromTaskData) ? fromTaskData : [];
  }, [taskInfo]);

  const taskTypeAttrConfigByType = useMemo(() => {
    const grouped = {};
    taskTypeAttributeRows.forEach((row) => {
      const typeId = row?.typeId;
      if (typeId === undefined || typeId === null) return;
      const key = String(typeId);
      if (!grouped[key]) {
        grouped[key] = { typeId, fields: [] };
      }
      const dataType = String(row?.dataType || 'string').toLowerCase();
      let fieldType = 'string';
      if (dataType === 'enum') {
        fieldType = 'enum';
      } else if (dataType === 'integer' || dataType === 'int') {
        fieldType = 'integer';
      } else if (['number', 'float', 'double', 'decimal'].includes(dataType)) {
        fieldType = 'number';
      }
      grouped[key].fields.push({
        attrId: row?.attrId,
        key: row?.attrKey,
        label: row?.attrName || row?.attrKey,
        type: fieldType,
        required: !!row?.isRequired,
        displayOrder: Number(row?.displayOrder || 9999),
        placeholder: row?.placeholder || '',
        remark: row?.remark || '',
        unit: row?.unit || '',
        options: parseEnumOptions(row?.enumOptionsJson),
      });
    });
    Object.keys(grouped).forEach((key) => {
      grouped[key].fields = grouped[key].fields
        .filter((field) => !!field.key)
        .sort((a, b) => a.displayOrder - b.displayOrder);
    });
    return grouped;
  }, [parseEnumOptions, taskTypeAttributeRows]);

  const selectedCategoryConfig = useMemo(() => {
    const selectedTypeId = selectedFeature?.get('typeId') ?? toolbarState?.sourceKey;
    if (selectedTypeId === undefined || selectedTypeId === null) {
      return null;
    }
    return taskTypeAttrConfigByType[String(selectedTypeId)] || null;
  }, [selectedFeature, taskTypeAttrConfigByType, toolbarState?.sourceKey]);

  const selectedFeatureAttrJson = useMemo(() => {
    if (!selectedFeature) return {};
    const raw = selectedFeature.get('attrJson') || selectedFeature.get('attr_json') || {};
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch (error) {
        return {};
      }
    }
    return raw && typeof raw === 'object' ? raw : {};
  }, [selectedFeature, featurePanelVersion]);

  const userNameById = useMemo(() => {
    const map = {};
    (taskInfo?.data?.[0]?.userArr || []).forEach((item) => {
      if (item?.userid !== undefined && item?.userid !== null) {
        map[String(item.userid)] = item?.username || `用户${item.userid}`;
      }
    });
    return map;
  }, [taskInfo]);

  const typeNameById = useMemo(() => {
    const map = {};
    (taskInfo?.data?.[0]?.userArr || []).forEach((user) => {
      (user?.typeArr || []).forEach((item) => {
        if (item?.typeId !== undefined && item?.typeId !== null) {
          map[String(item.typeId)] = item?.typeName || `类别${item.typeId}`;
        }
      });
    });
    (typeList?.data || []).forEach((item) => {
      if (item?.typeId !== undefined && item?.typeId !== null && !map[String(item.typeId)]) {
        map[String(item.typeId)] = item?.typeName || `类别${item.typeId}`;
      }
    });
    return map;
  }, [taskInfo, typeList]);

  const isEmptyAttrValue = useCallback((value) => {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim() === '';
    return false;
  }, []);

  const getFeatureAttrObject = useCallback((feature) => {
    if (!feature) return {};
    const raw = feature.get('attrJson') || feature.get('attr_json') || {};
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch (error) {
        return {};
      }
    }
    return raw && typeof raw === 'object' ? raw : {};
  }, []);

  const getMissingRequiredFields = useCallback((feature) => {
    if (!feature) return [];
    const featureTypeId = feature.get('typeId') ?? toolbarState?.sourceKey;
    if (featureTypeId === undefined || featureTypeId === null) return [];
    const categoryConfig = taskTypeAttrConfigByType[String(featureTypeId)] || null;
    const fields = categoryConfig?.fields || [];
    if (fields.length === 0) return [];
    const attrs = getFeatureAttrObject(feature);
    return fields
      .filter((field) => field.required)
      .filter((field) => isEmptyAttrValue(attrs[field.key]))
      .map((field) => field.label || field.key);
  }, [getFeatureAttrObject, isEmptyAttrValue, taskTypeAttrConfigByType, toolbarState?.sourceKey]);

  const updateSelectedFeatureAttr = useCallback((fieldKey, rawValue, fieldType) => {
    if (isCurrentUserReadOnly) {
      message.info(currentUserFinished ? '当前负责类别已标注完成，请先撤销完成后再修改' : '当前影像为只读状态');
      return;
    }
    if (!selectedFeature) return;
    const beforeSnapshot = captureHistorySnapshot();
    const prevAttrs = selectedFeature.get('attrJson') || {};
    const nextAttrs = { ...prevAttrs };

    if (rawValue === undefined || rawValue === null || rawValue === '') {
      delete nextAttrs[fieldKey];
    } else if (fieldType === 'integer') {
      const intValue = parseInt(rawValue, 10);
      nextAttrs[fieldKey] = Number.isNaN(intValue) ? rawValue : intValue;
    } else if (fieldType === 'number') {
      const numberValue = Number(rawValue);
      nextAttrs[fieldKey] = Number.isNaN(numberValue) ? rawValue : numberValue;
    } else {
      nextAttrs[fieldKey] = rawValue;
    }

    selectedFeature.set('attrJson', nextAttrs);
    recordHistoryChange(beforeSnapshot, captureHistorySnapshot());
    setFeaturePanelVersion((prev) => prev + 1);
  }, [captureHistorySnapshot, currentUserFinished, isCurrentUserReadOnly, recordHistoryChange, selectedFeature]);

  const layerFeatureRows = useMemo(() => {
    const source = toolbarState?.currentLayer?.getSource?.();
    const features = source?.getFeatures?.() || [];
    return features.map((feature, index) => {
      const attrs = getFeatureAttrObject(feature);
      const hasAttrs = attrs && Object.keys(attrs).length > 0;
      const missingRequiredFields = getMissingRequiredFields(feature);
      return {
        key: feature.ol_uid || feature.getId() || `feature-${index}`,
        feature,
        label: `要素 ${index + 1}`,
        hasAttrs,
        missingRequiredFields,
        requiredCompleted: missingRequiredFields.length === 0,
        typeName: resolveFeatureTypeName(feature) || '-',
      };
    });
  }, [featurePanelVersion, getFeatureAttrObject, getMissingRequiredFields, resolveFeatureTypeName, toolbarState?.currentLayer]);

  const focusFeatureFromPanel = useCallback((feature) => {
    if (!feature) return;
    const selectedCollection = selectRef.current?.getFeatures?.();
    const currentSource = toolbarState?.currentLayer?.getSource?.();
    const featureExistsInCurrentLayer = currentSource?.getFeatures?.()?.includes?.(feature);
    if (selectedCollection && featureExistsInCurrentLayer) {
      selectedCollection.clear();
      selectedCollection.push(feature);
    }
    if (selectedFeature && selectedFeature !== feature) {
      restoreFeatureStyle(selectedFeature);
    }
    applyFeatureHighlight(feature);
    setSelectedFeature(feature);
    setFeaturePanelVersion((prev) => prev + 1);
  }, [applyFeatureHighlight, restoreFeatureStyle, selectedFeature, toolbarState?.currentLayer]);

  const focusConflictMark = useCallback((markId) => {
    if (!markId) return;
    let targetFeature = null;
    let targetLayer = null;
    generateMarkLayer.some((layer) => {
      const source = layer?.getSource?.();
      const feature = source?.getFeatures?.()?.find?.((item) => Number(item?.get?.('markId')) === Number(markId));
      if (feature) {
        targetFeature = feature;
        targetLayer = layer;
        return true;
      }
      return false;
    });
    if (!targetFeature) {
      message.warning(`未找到冲突标注 ${markId}`);
      return;
    }

    if (lastConflictFeatureRef.current && lastConflictFeatureRef.current !== targetFeature && lastConflictFeatureRef.current !== selectedFeature) {
      restoreFeatureStyle(lastConflictFeatureRef.current);
    }

    if (targetLayer && !targetLayer.getVisible()) {
      targetLayer.setVisible(true);
    }
    if (selectedFeature && selectedFeature !== targetFeature) {
      restoreFeatureStyle(selectedFeature);
    }
    applyFeatureHighlight(targetFeature);
    lastConflictFeatureRef.current = targetFeature;
    setSelectedFeature(targetFeature);
    setFeaturePanelVersion((prev) => prev + 1);

    const geometry = targetFeature?.getGeometry?.();
    if (geometry && mapRef.current) {
      const extent = geometry.getExtent?.();
      if (extent && extent[0] !== extent[2] && extent[1] !== extent[3]) {
        mapRef.current.getView().fit(extent, { padding: [80, 80, 80, 80], duration: 300, maxZoom: 21 });
      } else {
        const coordinate = geometry.getFirstCoordinate?.() || geometry.getCoordinates?.();
        if (coordinate) {
          mapRef.current.getView().animate({ center: coordinate, duration: 300, zoom: Math.max(mapRef.current.getView().getZoom() || 18, 18) });
        }
      }
    }
  }, [applyFeatureHighlight, generateMarkLayer, mapRef, restoreFeatureStyle, selectedFeature]);

  useEffect(() => {
    if (!selectedFeature) return;
    const source = toolbarState?.currentLayer?.getSource?.();
    const exists = source?.getFeatures?.()?.includes?.(selectedFeature);
    if (!exists) {
      setSelectedFeature(null);
    }
  }, [selectedFeature, toolbarState?.currentLayer, featurePanelVersion]);

  const save = async () => {
    if (isCurrentUserReadOnly) {
      message.info(currentUserFinished ? '当前负责类别已标注完成，请先撤销完成后再保存修改' : '当前影像为只读状态，不能保存');
      return false;
    }
    let taskId = getTaskId;
    const jsondataArr = [];

    for (const layer of generateMarkLayer.filter((item) => item.get('editableLayer'))) {
      const features = layer.getSource().getFeatures();
      const typeId = layer.getSource().get('typeid');
      console.log('Layer features:', features);

      if (features.length > 0) {
        const validationErrors = [];
        features.forEach((feature, index) => {
          const missingRequiredFields = getMissingRequiredFields(feature);
          if (missingRequiredFields.length > 0) {
            validationErrors.push({
              feature,
              index,
              typeName: resolveFeatureTypeName(feature) || String(typeId),
              missingRequiredFields,
            });
          }
        });
        if (validationErrors.length > 0) {
          const firstError = validationErrors[0];
          focusFeatureFromPanel(firstError.feature);
          message.error(
            `属性约束未满足：${firstError.typeName} 第${firstError.index + 1}个要素缺少 ${firstError.missingRequiredFields.join('、')}`,
          );
          return;
        }
      }

      if (features.length > 0) {
        // Add markId property to each feature for tracking
        features.forEach(feature => {
          if (!feature.get('markId')) {
            // Only set markId if it doesn't already exist
            feature.set('markId', null);
          }
          feature.set('typeId', typeId);
          const attrJson = feature.get('attrJson');
          if (!attrJson || typeof attrJson !== 'object') {
            feature.set('attrJson', {});
          }
        });

        // Use OpenLayers GeoJSON format to correctly generate standard GeoJSON for both Point and Polygon
        const format = new GeoJSON();
        const viewProj = mapRef.current?.getView()?.getProjection()?.getCode?.() || 'EPSG:3857';
        const writeOptions = viewProj === 'pixel'
          ? { dataProjection: 'pixel', featureProjection: 'pixel' }
          : getTransformationParams(taskCoordinateSystem, viewProj);
        const geoJson = format.writeFeatures(features, writeOptions);

        jsondataArr.push({
          geoJson,
          typeId
        });
      }
    }
      // 保存标注结果，传任务id和标注数据
      console.log('保存的数据', { id: Number(taskId), jsondataArr });
    const deleteIds = [...new Set(deletedMarkIds)]; // 去重，防止重复添加
      try {
        const hide = message.loading('正在保存');
        console.log('Sending request to save data...');
        const currentUserId = taskInfo.data[0].userArr.filter(({ username }) => username == currentUser)[0].userid;
        const requestData = {
          userid: currentUserId,
          id: taskId,
          taskItemId: getTaskItemId,
          jsondataArr,
          typeArr: taskInfo.data[0].userArr.filter(({ username }) => username == currentUser)[0].typeArr,
          //TODO
          setAsSubmitter: false, // 添加该字段表示将当前用户设为唯一执行者
          // [新增] 传递删除列表给后端
          deleteMarkIds: deleteIds
        };
        console.log('Request data:', requestData);
        let result = await reqSaveService(requestData);
        console.log('Save response:', result);
        if (result && result.code === 200) {
          hide();
          message.success('保存成功！');
          // 保存成功后刷新标注数据以确保显示最新状态
          await refreshMarkGeoJsonArr();
          setFeaturePanelVersion((prev) => prev + 1);
          return true;
        } else {
          message.error(result?.message || '保存失败！');
          return false;
        }
      } catch (error) {
        console.error('Save error:', error);
        message.error('后台异常，请稍后重试！');
        return false;
      }
  };
  // 删除要素
  const deleteFeature = useCallback(() => {
    if (isCurrentUserReadOnly) {
      message.info(currentUserFinished ? '当前负责类别已标注完成，请先撤销完成后再删除' : '当前影像为只读状态');
      return;
    }
    const selectInteraction = selectRef.current;
    if (!selectInteraction) {
      message.warn('请先选择图层');
      return;
    }
    let selectFeasuresList = selectInteraction.getFeatures().getArray();
    if (selectFeasuresList.length > 0) {
      try {
        const beforeSnapshot = captureHistorySnapshot();
        const newDeletedIds = [...deletedMarkIds];
        selectFeasuresList.forEach((item) => {
          const markId = item.get('markId') || item.getId(); // 根据你存 ID 的位置调整
          // 如果有 ID，说明是数据库里已有的，需要记录删除
          if (markId) {
            newDeletedIds.push(markId);
          }
          // 直接从数据源中移除要素
          toolbarState.currentLayer.getSource().removeFeature(item);
        });
        // 更新删除列表
        setDeletedMarkIds(newDeletedIds);
        recordHistoryChange(beforeSnapshot, captureHistorySnapshot(newDeletedIds));
        setSelectedFeature(null);
        setFeaturePanelVersion((prev) => prev + 1);
        message.success('已删除选中的标注');
      } catch (error) {
        message.error('删除操作失败！');
      }
    } else {
      message.warn('未标注或未选中图形！');
    }
    selectInteraction.getFeatures().clear();
  }, [captureHistorySnapshot, currentUserFinished, deletedMarkIds, isCurrentUserReadOnly, recordHistoryChange, toolbarState.currentLayer]);

  const handleGetShp = (shp) => {
    //直接转化成对象，加入地图，如下
    const importJson = JSON.parse(shp);
    setMarkSource(markSource.addFeatures(new GeoJSON().readFeatures(importJson)));
  };

  const toggleToolMode = useCallback((mode) => {
    if (isCurrentUserReadOnly) {
      message.info(currentUserFinished ? '当前负责类别已标注完成，请先撤销完成后再操作' : '当前影像为只读状态');
      return;
    }
    setToolMode((prev) => (prev === mode ? 'none' : mode));
    unionFirstFeatureRef.current = null;
    splitFirstFeatureRef.current = null;
    if (shapeSelect.current && shapeSelect.current.value !== 'None') {
      shapeSelect.current.value = 'None';
      setActiveShape('None');
      shapeSelect.current.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (selectRef.current && mode !== 'union' && mode !== 'split') {
      selectRef.current.getFeatures().clear();
    }
  }, [currentUserFinished, isCurrentUserReadOnly]);


  const onCreate = useCallback(async ({ auditFeedback }) => {
    let taskid = getTaskId;
    try {
      const hide = message.loading('正在提交');
      const result = await reqAuditTask({ taskId: taskid, status: 2, auditFeedback });
      if (result.code == 200) {
        hide();
        message.success('提交成功！');
        history.push('/taskmanage');
      } else {
        message.error('提交失败！');
      }
      setShowAuditLoader(false);
    } catch (error) {
      message.error('后台异常，请稍后重试！');
      setShowAuditLoader(false);
    }
  }, []);
  const onCancel = useCallback(() => {
    setShowAuditLoader(false);
  }, []);

  const toggleFinishTaskItem = useCallback(async () => {
    if (!getTaskId || !getTaskItemId) {
      message.warning('当前影像信息不完整，无法更新完成状态');
      return;
    }
    if (finishButtonDisabled) {
      message.info(currentTaskItemStatus === 0 || currentTaskItemStatus === 1
        ? '当前影像已提交或已审核，不能再修改完成状态'
        : '当前用户未分配该影像标注');
      return;
    }

    const api = currentUserFinished ? reqCancelFinishTaskItem : reqFinishTaskItem;
    const loadingKey = currentUserFinished ? 'cancel_finish_task_item' : 'finish_task_item';
    const loadingText = currentUserFinished ? '正在撤销完成状态...' : '正在更新完成状态...';

    message.loading({ content: loadingText, key: loadingKey });
    try {
      if (!currentUserFinished) {
        const saved = await save();
        if (!saved) {
          message.destroy(loadingKey);
          return;
        }
      }
      const result = await api({
        taskId: Number(getTaskId),
        taskItemId: Number(getTaskItemId),
      });
      if (result?.success === false) {
        message.error({ content: result?.message || '更新完成状态失败', key: loadingKey });
        return;
      }
      await refreshMarkGeoJsonArr();
      message.success({
        content: result?.message || (currentUserFinished ? '已撤销完成' : '已标注完成'),
        key: loadingKey,
      });
      if (result?.warning && result?.conflictSummary?.conflictCount > 0) {
        message.warning(`当前影像存在 ${result.conflictSummary.conflictCount} 个潜在覆盖冲突，审核员将重点检查`);
      }
    } catch (error) {
      message.error({ content: '更新完成状态失败，请稍后重试', key: loadingKey });
    }
  }, [
    currentTaskItemStatus,
    currentUserFinished,
    finishButtonDisabled,
    getTaskId,
    getTaskItemId,
    refreshMarkGeoJsonArr,
    save,
  ]);

  const [param1, setParam1] = useState('');
  const [param2, setParam2] = useState('');
  const [param3, setParam3] = useState('');
  const [param4, setParam4] = useState('');
  const [categoryMappingObj, setCategoryMappingObj] = useState({});
  const [modelResults, setModelResults] = useState({}); // 新增用于存储后端返回的字典
  useEffect(() => {
    samInteractiveEnabledRef.current = samInteractiveEnabled;
  }, [samInteractiveEnabled]);

// 定义获取 user_id 的函数
  const getUserId = () => {
    const user = taskInfo?.data?.[0]?.userArr?.find(({ username }) => username === currentUser);
    return user?.userid;
  };

  // 获取Python后端使用的mapfile_path
  // 本地任务：直接使用本地文件路径（去掉.tif后缀）
  // GeoServer任务：使用mapServer字段
  const getMapfilePath = () => {
    if (taskSource === 'local' && localImagePath) {
      return localImagePath.replace(/\.tiff?$/i, '');
    }
    return taskInfo?.data?.[0]?.mapserver || '';
  };
  const currentLayerTypeId = toolbarState?.sourceKey == null ? null : Number(toolbarState.sourceKey);
  const isYoloSamTaskType = currentTaskType === '地物提取' || currentTaskType === '地物分类';
  const availableTaskTypes = currentUserTaskTypes;
  const hasSelectedAnnotationLayer = !!toolbarState.currentLayer
    && toolbarState.sourceKey !== null
    && toolbarState.sourceKey !== undefined;

  const getModelFamily = useCallback((model) => {
    const raw = `${model?.type || ''} ${model?.name || ''}`.toLowerCase();
    if (raw.includes('deeplab')) return 'deeplab';
    if (raw.includes('unet')) return 'unet';
    if (raw.includes('yolo')) return 'yolo';
    return 'generic';
  }, []);

  const getDefaultInferParams = useCallback((family) => {
    if (family === 'yolo') {
      return { param1: '0.3', param2: '640', param3: '0.5', param4: '100' };
    }
    if (family === 'unet' || family === 'deeplab') {
      return { param1: '50', param2: '10', param3: '1', param4: '0.1' };
    }
    return { param1: '0.3', param2: '640', param3: '10', param4: '1' };
  }, []);

  const buildCategoryMappingObject = useCallback((model) => {
    if (model?.classMapping && typeof model.classMapping === 'object' && !Array.isArray(model.classMapping)) {
      return Object.fromEntries(
        Object.entries(model.classMapping).map(([key, value]) => [String(key), value == null ? undefined : Number(value)])
      );
    }

    if (typeof model?.details === 'string' && model.details.trim()) {
      const mapping = {};
      model.details.split(';').forEach((pair) => {
        const [typeId, classIndex] = pair.split(':').map((item) => item?.trim());
        if (typeId && classIndex) {
          mapping[classIndex] = Number(typeId);
        }
      });
      return mapping;
    }

    return {};
  }, []);

  const filteredModelList = useMemo(() => {
    return (modelList || []).filter((model) => {
      const family = getModelFamily(model);
      if (family === 'yolo') return true;
      return !(model?.taskType && currentTaskType && model.taskType !== currentTaskType);
    });
  }, [currentTaskType, getModelFamily, modelList]);

  const selectedPreAnnotateModel = useMemo(() => (
    (modelList || []).find((model) => Number(model?.id) === Number(selectedModelId)) || null
  ), [modelList, selectedModelId]);

  const selectedModelFamily = useMemo(() => (
    selectedPreAnnotateModel ? getModelFamily(selectedPreAnnotateModel) : 'generic'
  ), [getModelFamily, selectedPreAnnotateModel]);

  const modelClassIndexList = useMemo(() => {
    if (!selectedPreAnnotateModel) return [];
    const fromMapping = Object.keys(categoryMappingObj || {})
      .map((key) => Number(key))
      .filter((value) => Number.isInteger(value))
      .sort((a, b) => a - b);
    if (fromMapping.length > 0) {
      return fromMapping;
    }
    const outputNum = Number(selectedPreAnnotateModel?.outputNum || 0);
    if (outputNum > 0) {
      return Array.from({ length: outputNum }, (_, index) => index);
    }
    return [0];
  }, [categoryMappingObj, selectedPreAnnotateModel]);

  const paramSchema = useMemo(() => {
    if (selectedModelFamily === 'yolo') {
      return [
        { key: 'param1', label: '置信度阈值', placeholder: '0.3', tip: '范围建议 0.1 - 0.9，推荐 0.25 - 0.4。值越大，筛选越严格，误检更少但漏检可能增加；值越小，召回更高，但会带来更多候选结果。' },
        { key: 'param2', label: '切片尺寸', placeholder: '640', tip: '范围建议 256 - 1024，推荐 512 或 640。值越大，上下文更完整，但显存和耗时更高；值越小，速度更快，但大目标可能被切碎。' },
        { key: 'param3', label: 'IoU阈值', placeholder: '0.5', tip: '范围建议 0.3 - 0.8，推荐 0.5。值越大，允许保留更多重叠检测框；值越小，去重更激进，结果更干净但可能压掉邻近目标。' },
        { key: 'param4', label: '切片重叠率', placeholder: '0.1', tip: '范围建议 0 - 0.5，推荐 0.1 - 0.2。值越大，切片边缘目标更不容易漏掉，但推理时间更长；值越小，速度更快，但边界区域可能出现漏检。' },
      ];
    }
    if (selectedModelFamily === 'unet') {
      return [
        { key: 'param1', label: '最小目标面积', placeholder: '50', tip: '范围建议 0 - 5000，推荐 30 - 200。值越大，越会过滤小碎片和噪点；值越小，能保留更多细小目标，但杂点也会更多。' },
        { key: 'param2', label: '孔洞填充阈值', placeholder: '10', tip: '范围建议 0 - 500，推荐 5 - 30。值越大，内部小孔洞越容易被自动填平；值越小，能保留更多原始细节和镂空结构。' },
        { key: 'param3', label: '边界平滑系数', placeholder: '1', tip: '范围建议 0 - 10，推荐 1 - 3。值越大，边界越圆滑、锯齿更少；值越小，轮廓更贴近原始像素，但会更毛躁。' },
        { key: 'param4', label: '掩膜阈值', placeholder: '0.1', tip: '范围建议 0 - 1，推荐 0.05 - 0.3。值越大，前景判定更保守，面会变小；值越小，前景更容易被保留，面会更大。' },
      ];
    }
    if (selectedModelFamily === 'deeplab') {
      return [
        { key: 'param1', label: '最小目标面积', placeholder: '50', tip: '范围建议 0 - 5000，推荐 30 - 200。值越大，越偏向保留大面对象；值越小，小斑块更容易被保留。' },
        { key: 'param2', label: '孔洞填充阈值', placeholder: '10', tip: '范围建议 0 - 500，推荐 5 - 30。值越大，内部小孔更容易被补平；值越小，洞和细碎结构保留更多。' },
        { key: 'param3', label: '边界平滑系数', placeholder: '1', tip: '范围建议 0 - 10，推荐 1 - 3。值越大，轮廓更顺滑；值越小，边界更锐利但可能更锯齿。' },
        { key: 'param4', label: '置信度补偿', placeholder: '0.1', tip: '范围建议 0 - 1，推荐 0.05 - 0.3。值越大，会更积极地保留边缘和弱响应区域；值越小，结果更保守。' },
      ];
    }
    return [
      { key: 'param1', label: '参数1', placeholder: '0.3', tip: '当前模型未配置专用说明。' },
      { key: 'param2', label: '参数2', placeholder: '640', tip: '当前模型未配置专用说明。' },
      { key: 'param3', label: '参数3', placeholder: '10', tip: '当前模型未配置专用说明。' },
      { key: 'param4', label: '参数4', placeholder: '1', tip: '当前模型未配置专用说明。' },
    ];
  }, [currentTaskType, selectedModelFamily]);

  const samParamSchema = useMemo(() => ([
    { key: 'param1', label: '质量阈值', placeholder: '0.85', tip: '范围建议 0 - 1，推荐 0.7 - 0.95。值越大，保留的前景区域越严格，误提取更少；值越小，结果更积极，但更容易带入边缘噪点。' },
    { key: 'param2', label: '最小目标面积', placeholder: '50', tip: '范围建议 0 - 5000，推荐 30 - 200。值越大，越会过滤细小碎片和噪点；值越小，能保留更多细小目标，但杂点也会更多。' },
    { key: 'param3', label: '孔洞填充阈值', placeholder: '20', tip: '范围建议 0 - 500，推荐 5 - 30。值越大，目标内部的小孔洞更容易被自动补平；值越小，能保留更多中空和细节结构。' },
    { key: 'param4', label: '边界平滑系数', placeholder: '1', tip: '范围建议 0 - 10，推荐 1 - 3。值越大，边界越圆滑、锯齿更少；值越小，轮廓更贴近原始掩膜，但会更毛躁。' },
  ]), []);

  useEffect(() => {
    if (selectedModelId && !filteredModelList.some((model) => Number(model?.id) === Number(selectedModelId))) {
      setSelectedModelId(null);
    }
  }, [filteredModelList, selectedModelId]);

  useEffect(() => {
    if (!selectedPreAnnotateModel) return;
    const defaults = getDefaultInferParams(getModelFamily(selectedPreAnnotateModel));
    const inferParams = selectedPreAnnotateModel?.inferParams && typeof selectedPreAnnotateModel.inferParams === 'object'
      ? selectedPreAnnotateModel.inferParams
      : {};
    setParam1(String(inferParams.param1 ?? defaults.param1));
    setParam2(String(inferParams.param2 ?? defaults.param2));
    setParam3(String(inferParams.param3 ?? defaults.param3));
    setParam4(String(inferParams.param4 ?? defaults.param4));
    setCategoryMappingObj(buildCategoryMappingObject(selectedPreAnnotateModel));
  }, [buildCategoryMappingObject, getDefaultInferParams, getModelFamily, selectedPreAnnotateModel]);

  // 获取模型列表
useEffect(() => {
  const fetchModelList = async () => {
    if (!taskInfo?.data?.[0]) {
      return;
    }
    const taskType = taskInfo?.data?.[0]?.type;
    try {
      const response = await reqGetModelList({
        task_type: taskType
      });
      if (response.code === 200) {
        const list = Array.isArray(response.data)
          ? response.data
          : (Array.isArray(response?.data?.list) ? response.data.list : []);
        setModelList(list);
      } else {
        setModelList([]);
      }
    } catch (error) {
      setModelList([]);
    }
  };

  fetchModelList();
}, [taskInfo]);

// 任务内影像导航：自动保存后跳转
const navigateTask = useCallback(async (direction) => {
  if (!Array.isArray(taskItems) || taskItems.length === 0) return;
  const idx = taskItems.findIndex((item) => Number(item?.taskItemId) === Number(getTaskItemId));
  if (idx === -1) return;
  const nextIdx = direction === 'prev' ? idx - 1 : idx + 1;
  if (nextIdx < 0 || nextIdx >= taskItems.length) {
    message.info(direction === 'prev' ? '已是第一个任务' : '已是最后一个任务');
    return;
  }
  try {
    if (!isCurrentUserReadOnly) {
      const saved = await save();
      if (saved === false) {
        throw new Error('save_failed');
      }
    }
    const nextTaskItemId = taskItems[nextIdx]?.taskItemId;
    if (!nextTaskItemId) return;
    window.sessionStorage.setItem('taskItemId', String(nextTaskItemId));
    window.location.reload();
  } catch (e) {
    message.error('保存失败，无法跳转');
  }
}, [getTaskItemId, isCurrentUserReadOnly, save, taskItems]);

  // 模型推理功能
  const handleModelInference = async () => {
    if (isCurrentUserReadOnly) {
      message.info(currentUserFinished ? '当前负责类别已标注完成，请先撤销完成后再预标注' : '当前影像为只读状态');
      return;
    }
    if (!hasSelectedAnnotationLayer) {
      message.warning('请先选择图层，再启动预标注');
      return;
    }
    if (!selectedPreAnnotateModel) {
      message.warning('请先选择预标注模型');
      return;
    }

    const taskId = getTaskId;
    const userId = getUserId();

    if (!userId) {
      message.error('无法获取用户 ID，请检查用户信息');
      return;
    }

    try {
      const saved = await save();
      if (saved === false) {
        return;
      }
      const hide = message.loading('正在启动预标注...');
      const modelScopeLayer = generateMarkLayer.find((layer) => layer.get('typeid') === 'modelScope');
      const modelScopeFeatures = modelScopeLayer?.getSource?.().getFeatures?.() || [];
      const modelScopeCoordinates = modelScopeFeatures.map((feature) => feature.getGeometry().getCoordinates());
      const requestParameters = {
        param1: param1 || '',
        param2: param2 || '',
        param3: param3 || '',
        param4: param4 || '',
        categoryMapping: categoryMappingObj || {},
        modelScope: modelScopeCoordinates.length > 0 ? modelScopeCoordinates : [],
        currentTypeId: currentLayerTypeId,
        model_id: selectedModelId,
      };

      const result = selectedModelFamily === 'yolo' && isYoloSamTaskType
        ? await reqAssistFunction({
          taskid: taskId,
          taskItemId: getTaskItemId,
          mapfile_path: getMapfilePath(),
          task_type: currentTaskType,
          user_id: userId,
          model_id: selectedModelId,
          functionName: 'auto_building_sam',
          assistInput: '1',
          modelName: selectedPreAnnotateModel?.name || 'YOLO+SAM',
          parameters: requestParameters,
        })
        : await reqInferenceFunction({
          taskid: taskId,
          taskItemId: getTaskItemId,
          mapfile_path: getMapfilePath(),
          user_id: userId,
          model_id: selectedModelId,
          parameters: requestParameters,
        });

      hide();

      if (result.code === 200) {
        setModelResults({
          selectedValue: `${selectedPreAnnotateModel.name || '所选模型'} 已启动预标注`,
          params: { param1, param2, param3, param4 },
        });
        message.success(result.message || '预标注任务已启动');
        setTimeout(async () => {
          await refreshMarkGeoJsonArr();
          message.success('标注已更新');
        }, 3000);
      } else {
        message.error(result.message || '预标注失败');
      }
    } catch (error) {
      message.error('预标注失败：' + error.message);
    }
  };

  const handleSamPreAnnotation = useCallback(async (options = {}) => {
    if (isCurrentUserReadOnly) {
      message.info(currentUserFinished ? '当前负责类别已标注完成，请先撤销完成后再使用SAM交互标注' : '当前影像为只读状态');
      return;
    }
    if (!hasSelectedAnnotationLayer) {
      message.warning('请先选择图层，再使用 SAM 交互标注');
      return;
    }
    const { silentNoPrompt = false } = options;
    let taskId = getTaskId;
    const taskType = taskInfo?.data[0].type;
    const userId = getUserId();

    if (!userId) {
      message.error('无法获取用户 ID，请检查用户信息');
      return;
    }

    // 1. 获取当前活跃图层的数据源
    const activeSource = toolbarState.markSource;
    if (!activeSource || activeSource.getFeatures().length === 0) {
      if (!silentNoPrompt) {
        message.warn('请先在地图上绘制一个提示要素（点、线或面）');
      }
      return;
    }

    // 2. 取最后一个【用户刚绘制的】要素（没有 markId 的，排除已保存的 SAM 结果）
    const allFeatures = activeSource.getFeatures();
    // 优先找没有 markId 的（用户刚画的），找不到才退而求其次取最后一个
    const drawnFeatures = allFeatures.filter(f => !f.get('markId'));
    const targetFeature = drawnFeatures.length > 0
      ? drawnFeatures[drawnFeatures.length - 1]
      : allFeatures[allFeatures.length - 1];

    let promptType = 'point';
    let coords = null;

    // 3. 根据几何类型自动识别提示词类型
    const geom = targetFeature.getGeometry();
    const gType = geom.getType();

    if (gType === 'Point') {
      promptType = 'point';
      coords = geom.getCoordinates();
    } else if (gType === 'LineString') {
      promptType = 'line';
      coords = geom.getCoordinates();
    } else if (gType === 'Polygon') {
      // 如果是矩形框（Box）或多边形，统一识别为 bbox
      // SAM 后端通常需要 [minX, minY, maxX, maxY]
      promptType = 'bbox';
      coords = geom.getExtent(); // 获取外接矩形范围
    }

    console.log(`发送最新提示要素: 类型=${promptType}`, coords);

    // 4. 组装参数
    const parameters = {
      param1: samParam1 || '0.85',
      param2: samParam2 || '50',
      param3: samParam3 || '20',
      param4: samParam4 || '1',
      categoryMapping: JSON.stringify({}),
      promptType: promptType,
      coordinates: coords, // 只传这一个要素的坐标
      currentTypeId: toolbarState.sourceKey, // 告诉后端生成哪种类型的多边形
    };

    // 获取模型作用范围（可选）
    const modelScopeLayer = generateMarkLayer.find(layer => layer.get('typeid') === 'modelScope');
    if (modelScopeLayer) {
      const modelScopeCoords = modelScopeLayer.getSource().getFeatures().map(f => f.getGeometry().getCoordinates());
      parameters.modelScope = modelScopeCoords.length > 0 ? modelScopeCoords : [];
    }

    try {
      // 5. 先保存一次（确保当前最新画的这个点/线/框已经进入数据库，方便后端备用或记录）
      const saved = await save();
      if (saved === false) {
        return;
      }

      const hide = message.loading(`SAM 正在基于最新的${
        promptType === 'point' ? '点' : promptType === 'line' ? '线' : '框'
      }进行提取...`);

      // 6. 发送请求
      const result = await reqAssistFunction({
        taskid: taskId,
        taskItemId: getTaskItemId,
        mapfile_path: getMapfilePath(),
        task_type: taskType,
        user_id: userId,
        functionName: 'sam_inference',
        assistInput: '1',
        modelName: 'SAM',
        parameters: parameters,
      });

      hide();
      if (result.code === 200) {
        message.success('SAM 提取成功');

        // 7. 刷新图层：此时后端应该已经删除了那个“提示点/线/框”，并替换成了真正的“多边形”
        await refreshMarkGeoJsonArr();

        // 8. 💡 关键：如果是点选/线选模式，自动触发一次 onSelect 逻辑，让用户可以连续绘制
        setTimeout(() => {
          if (shapeSelect.current && shapeSelect.current.value !== 'None') {
            shapeSelect.current.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, 100);

      } else {
        message.error(result.message || 'SAM 执行失败');
      }
    } catch (error) {
      console.error('SAM Error:', error);
      message.error('SAM 调用异常');
    }
  }, [currentUserFinished, generateMarkLayer, getTaskId, getTaskItemId, hasSelectedAnnotationLayer, isCurrentUserReadOnly, refreshMarkGeoJsonArr, samParam1, samParam2, samParam3, samParam4, save, taskInfo, toolbarState.markSource, toolbarState.sourceKey]);

  useEffect(() => {
    triggerSamInteractiveRef.current = handleSamPreAnnotation;
  }, [handleSamPreAnnotation]);

  const handleToggleSamInteractive = useCallback(() => {
    if (isCurrentUserReadOnly) {
      message.info(currentUserFinished ? '当前负责类别已标注完成，请先撤销完成后再开启SAM交互标注' : '当前影像为只读状态');
      return;
    }
    if (currentTaskType !== '地物分类') {
      message.info('SAM交互标注当前仅在地物分类任务中启用');
      return;
    }
    if (!toolbarState.currentLayer || !toolbarState.markSource) {
      message.warning('请先选择一个类别图层，再开启 SAM 交互标注');
      return;
    }
    setSamInteractiveEnabled((prev) => {
      const next = !prev;
      message.success(next ? 'SAM交互标注已开启' : 'SAM交互标注已关闭');
      return next;
    });
  }, [currentTaskType, currentUserFinished, isCurrentUserReadOnly, toolbarState.currentLayer, toolbarState.markSource]);

  //更新新绘制样本功能
  const update_label = async () => {
    if (isCurrentUserReadOnly) {
      message.info(currentUserFinished ? '当前负责类别已标注完成，请先撤销完成后再更新样本' : '当前影像为只读状态');
      return;
    }
    let taskId = getTaskId;
    try {

      //先执行保存操作
      const saved = await save();
      if (saved === false) {
        return;
      }

      const hide = message.loading('正在更新样本...');
      const result = await reqUqdateLabel({ taskid: taskId, taskItemId: getTaskItemId });
      hide();
      if (result.code === 200) {
        message.success(result.message);
        // 刷新标注数据而不是整个页面
        await refreshMarkGeoJsonArr();
      } else {
        message.error(result.message || '样本更新失败');
      }
    } catch (error) {
      message.error('调用样本更新失败失败：' + error.message);
    }
  };

  // 更新所有图层样式的函数
  const updateLayerStyles = useCallback(() => {
    if (!mapRef.current) return;

    generateMarkLayer.forEach(layer => {
      const typeId = layer.get('typeid');
      if (typeId === 'modelScope') {
        // 更新模型作用范围图层样式
        layer.setStyle(new Style({
          fill: new Fill({
            color: getTransparentColor('#ffcc33'),
          }),
          stroke: new Stroke({
            color: '#ffcc33',
            width: 3,
          }),
        }));
      } else {
        // 更新标注图层样式
        const typeInfo = taskInfo?.data?.[0]?.userArr
          ?.flatMap(user => user.typeArr)
          ?.find(type => type.typeId == typeId);

        if (typeInfo) {
          const styleFunction = (feature) => {
            const geometry = feature.getGeometry();
            const geometryType = geometry.getType();
            const feedbackText = feature.get('feedback'); //  获取反馈

            let baseStyle; // 1. 先声明

            // 2. 创建基础样式
            if (geometryType === 'Point') {
              baseStyle = new Style({
                image: new CircleStyle({
                  radius: 6,
                  fill: new Fill({ color: getTransparentColor('#ffffff') }),
                  stroke: new Stroke({ color: typeInfo.typeColor, width: 3 }),
                }),
              });
            } else {
              baseStyle = new Style({
                fill: new Fill({ color: getTransparentColor(typeInfo.typeColor) }),
                stroke: new Stroke({ color: typeInfo.typeColor, width: 3 }),
              });
            }

            // 3. 条件性添加 Text
            if (feedbackText) {
              baseStyle.setText(new Text({
                text: feedbackText,
                font: 'bold 14px sans-serif',
                overflow: true,
                fill: new Fill({ color: '#fff' }),
                backgroundFill: new Fill({ color: 'rgba(255, 0, 0, 0.8)' }),
                padding: [4, 8, 4, 8],
                offsetY: geometryType === 'Point' ? -20 : 0,
              }));
            }

            // 4. 返回
            return baseStyle;
          };
          layer.setStyle(styleFunction);
        }
      }
    });
  }, [generateMarkLayer, getTransparentColor, taskInfo]);

  // 当不透明度改变时更新所有图层样式
  useEffect(() => {
    updateLayerStyles();
  }, [fillOpacity, updateLayerStyles]);

  // 取出当前用户的标注类别数组
  const userArr = taskInfo.data?.[0]?.userArr || [];
  const typeArr = currentUserData?.typeArr || [];

  return (
    <>
      <BasicMap setMap={setMap} />


      {/* 底部左侧：比例尺右边的不透明度控制器（与比例尺同行） */}
      <div className="opacity-control">
        <span className="opacity-label">填充</span>
        <Slider
          min={0}
          max={1}
          step={0.1}
          value={fillOpacity}
          onChange={setFillOpacity}
          className="opacity-slider"
          tooltip={{ formatter: (value) => `${Math.round(value * 100)}%` }}
        />
        <span className="opacity-value">{Math.round(fillOpacity * 100)}%</span>
      </div>

      {/* 顶部居中：任务信息（无白底，透明浮层） */}
      <div className="top-info-bar">
        <div className="top-info-item">
          <span className="top-info-label">任务名称：</span>
          <span className="top-info-name">{taskInfo?.data?.[0]?.taskname}</span>
        </div>
        <div className="top-info-sep" />
        <div className="top-info-item">
          <span className="top-info-label">任务类型：</span>
          <span className="top-info-type">{taskInfo?.data?.[0]?.type}</span>
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
              <span className="top-info-label">标注进度：</span>
              <span className="top-info-name">{markProgress.finished}/{markProgress.total}</span>
            </div>
          </>
        )}
        {canToggleFinish && (
          <>
            <div className="top-info-sep" />
            <div className="top-info-item">
              <span className="top-info-label">负责类别：</span>
              <span className="top-info-name">{assignedTypeText}</span>
            </div>
            <div className="top-info-sep" />
            <div className="top-info-item">
              <span className="top-info-label">我的状态：</span>
              <span className={`top-info-name${currentUserFinished ? ' top-info-status-finished' : ' top-info-status-pending'}`}>
                {currentUserFinishStatusText}
              </span>
            </div>
            <div className="top-info-sep" />
            <div className="top-info-item top-info-item-action">
              <button
                className={`top-finish-btn${currentUserFinished ? ' is-finished' : ''}`}
                onClick={toggleFinishTaskItem}
                disabled={finishButtonDisabled}
              >
                {currentUserFinished ? '撤销完成' : '标注完成'}
              </button>
            </div>
          </>
        )}
        {currentTaskItemAuditFeedback && (
          <>
            <div className="top-info-sep" />
            <div className="top-info-item">
              <span className="top-info-label">审核反馈：</span>
              <Tooltip title={currentTaskItemAuditFeedback} mouseEnterDelay={0.1}>
                <span className="top-info-feedback">{currentTaskItemAuditFeedback}</span>
              </Tooltip>
            </div>
          </>
        )}
      </div>

      {/* 底部居中：上下任务导航 */}
      <div className="task-nav-bar">
        <Tooltip title="保存并跳转上一个任务">
          <button
            className="task-nav-btn"
            onClick={() => navigateTask('prev')}
            disabled={(taskItems?.length || 0) <= 1}
          >
            <LeftOutlined />
          </button>
        </Tooltip>
        <span className="task-nav-label">{taskInfo?.data[0].taskname}</span>
        {(taskItems?.length || 0) > 0 && (
          <span className="task-nav-progress">
            {(taskItems.findIndex((item) => Number(item?.taskItemId) === Number(getTaskItemId)) + 1) || 1} / {taskItems.length}
          </span>
        )}
        <Tooltip title="保存并跳转下一个任务">
          <button
            className="task-nav-btn"
            onClick={() => navigateTask('next')}
            disabled={(taskItems?.length || 0) <= 1}
          >
            <RightOutlined />
          </button>
        </Tooltip>
      </div>

      {/* 左上角：工具栏 */}
      <div className="left-panel">

        {/* 图层 + 形状（一行） */}
        <div className="toolbar-row">

          {/* 图层选择 */}
          <span className="selector-label">图层</span>
          <select className="layer-select" ref={layerSelect} defaultValue={'None'}>
            <option value={'None'}>无图层</option>
            <option value={0} style={{color: '#ff0000'}}>背景</option>
            {typeArr.map(item => (
              <option value={item.typeId} key={item.typeId}>{item.typeName}</option>
            ))}
          </select>
          <Tag color={toolbarState.color} className="layer-color-tag" />

          <div className="toolbar-sep" />

          {/* 形状图标按钮组 */}
          <span className="selector-label">形状</span>
          {[
            { value: 'None',               icon: '⊘', title: '取消绘制' },
            { value: 'Point',              icon: '·',  title: '点（SAM提示）' },
            { value: 'LineString',         icon: '╱', title: '线（SAM提示）' },
            { value: 'Box',                icon: '▭', title: '矩形' },
            { value: 'RotatableRectangle', icon: '⬡', title: '旋转矩形' },
            { value: 'Polygon',            icon: '⬠', title: '多边形' },
          ].map(({ value, icon, title }) => {
            const polygonForbidden = isTargetRecognitionTask && value === 'Polygon';
            const disabled = polygonForbidden || ((toolbarState.drawState || isCurrentUserReadOnly) && value !== 'None');
            return (
              <Tooltip key={value} title={polygonForbidden ? '目标识别任务中禁止绘制多边形' : title}>
                <button
                  className={`shape-icon-btn${activeShape === value ? ' active' : ''}${disabled ? ' disabled' : ''}`}
                  disabled={disabled}
                  onClick={() => {
                    if (polygonForbidden) {
                      message.warning('目标识别任务中禁止绘制多边形');
                      return;
                    }
                    if (isCurrentUserReadOnly) {
                      message.info(currentUserFinished ? '当前负责类别已标注完成，请先撤销完成后再绘制' : '当前影像为只读状态');
                      return;
                    }
                    if (!toolbarState.currentLayer && value !== 'None') {
                      message.warn('请先选择图层再绘制');
                      return;
                    }
                    if (shapeSelect.current) {
                      shapeSelect.current.value = value;
                      setActiveShape(value);
                      shapeSelect.current.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                  }}
                >
                  {icon}
                </button>
              </Tooltip>
            );
          })}

          {/* 隐藏的原生 select，保持原有逻辑不变 */}
          <select style={{ display: 'none' }} ref={shapeSelect} defaultValue={'None'}>
            <option value="None">无</option>
            <option value="Point">点</option>
            <option value="LineString">线</option>
            <option value="Box">矩形</option>
            <option value="RotatableRectangle">旋转矩形</option>
            <option value="Polygon">多边形</option>
          </select>

        </div>

        {/* 操作工具栏（垂直，位于图层/形状栏下方） */}
        <div className="operation-toolbar-vertical">
          <div className="op-title">操作</div>
          <Tooltip title="删除选中标注"><button className="action-btn danger" onClick={deleteFeature} disabled={isCurrentUserReadOnly}><ScissorOutlined /></button></Tooltip>
          <Tooltip title="撤销"><button className="action-btn" onClick={undo}><UndoOutlined /></button></Tooltip>
          <Tooltip title="重做"><button className="action-btn" onClick={recover}><RedoOutlined /></button></Tooltip>
          <Tooltip title="保存标注"><button className="action-btn primary" onClick={save} disabled={isCurrentUserReadOnly}><SaveOutlined /></button></Tooltip>
          <Tooltip title="更新样本"><button className="action-btn primary" onClick={update_label} disabled={isCurrentUserReadOnly}><SyncOutlined /></button></Tooltip>
          <div className="op-divider" />
          <Tooltip title="切分工具：依次选择两个多边形，删除第一个与第二个的交集">
            <button
              className={`action-btn ${toolMode === 'split' ? 'active-tool' : ''}`}
              onClick={() => toggleToolMode('split')}
              disabled={isCurrentUserReadOnly}
            >
              <SplitCellsOutlined />
            </button>
          </Tooltip>
          <Tooltip title="并集工具：连续点击两个相交多边形自动求并">
            <button
              className={`action-btn ${toolMode === 'union' ? 'active-tool' : ''}`}
              onClick={() => toggleToolMode('union')}
              disabled={isCurrentUserReadOnly}
            >
              <MergeCellsOutlined />
            </button>
          </Tooltip>
          <Tooltip title="框选删除：拖框选择多个要素后一键删除">
            <button
              className={`action-btn ${toolMode === 'boxDelete' ? 'active-tool' : ''}`}
              onClick={() => toggleToolMode('boxDelete')}
              disabled={isCurrentUserReadOnly}
            >
              <BorderOutlined />
            </button>
          </Tooltip>
        </div>

      </div>

        <FeatureAttributePanel
          layerFeatureRows={layerFeatureRows}
          selectedFeature={selectedFeature}
          selectedCategoryConfig={selectedCategoryConfig}
          selectedFeatureAttrJson={selectedFeatureAttrJson}
          onFocusFeature={focusFeatureFromPanel}
          onUpdateAttr={updateSelectedFeatureAttr}
          readOnly={isCurrentUserReadOnly}
        />

        {/* 右侧：模型辅助工具面板 */}
        <div className="model-panel model-panel-main">
          <div className="model-block">
            <div className="model-block-title"><BorderOutlined /> 冲突提示</div>
            <Alert
              type={markPageConflictCount > 0 ? 'warning' : 'success'}
              showIcon
              message={markPageConflictCount > 0 ? `当前影像发现 ${markPageConflictCount} 个潜在覆盖冲突` : '当前影像未发现潜在覆盖冲突'}
            />
            {markPageConflictCount > 0 && (
              <div className="conflict-list">
                {markPageConflicts.map((item, index) => {
                  const otherUserName = userNameById[String(item?.otherUserId)] || `用户${item?.otherUserId || '-'}`;
                  const selfTypeName = typeNameById[String(item?.selfTypeId)] || `类别${item?.selfTypeId || '-'}`;
                  const otherTypeName = typeNameById[String(item?.otherTypeId)] || `类别${item?.otherTypeId || '-'}`;
                  const conflictKey = `${item?.selfMarkId || 's'}-${item?.otherMarkId || 'o'}-${item?.selfUserId || 'su'}-${item?.otherUserId || 'ou'}`;
                  return (
                    <button
                      key={conflictKey}
                      className="conflict-item"
                      onClick={() => focusConflictMark(item?.selfMarkId || item?.otherMarkId)}
                    >
                      <div className="conflict-item-title">{`冲突 ${index + 1}`}</div>
                      <div className="conflict-item-text">{`当前类别：${selfTypeName}`}</div>
                      <div className="conflict-item-text">{`参考用户：${otherUserName}`}</div>
                      <div className="conflict-item-text">{`参考类别：${otherTypeName}`}</div>
                      <div className="conflict-item-text">{`覆盖率：${Number(item?.coverageRatio || 0).toFixed(3)}`}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="model-block">
            <div className="model-block-title"><RobotOutlined /> 预标注模型</div>
            <div className="model-filter-hint">
              {`当前按任务类型“${currentTaskType || '-'}”筛选模型中心中的可用模型`}
            </div>
            <Select
              placeholder="选择模型中心中的预标注模型"
              style={{ width: '100%', marginBottom: 8 }}
              onChange={setSelectedModelId}
              value={selectedModelId}
              allowClear
              size="small"
            >
              {filteredModelList.map(model => (
                <Select.Option key={model.id} value={model.id}>
                  {model.name} ({model.type})
                </Select.Option>
              ))}
            </Select>
            {filteredModelList.length === 0 && (
              <div className="model-empty-hint">当前筛选条件下暂无可用模型</div>
            )}

            {selectedPreAnnotateModel && (
              <>
                <div className="model-meta-card">
                  <div><span>模型类型：</span>{selectedPreAnnotateModel.type || '-'}</div>
                  <div><span>适用类别：</span>{Array.isArray(selectedPreAnnotateModel.applicableTypeIds) && selectedPreAnnotateModel.applicableTypeIds.length > 0 ? selectedPreAnnotateModel.applicableTypeIds.join('，') : '不限'}</div>
                  {selectedPreAnnotateModel.description && (
                    <div><span>模型说明：</span>{selectedPreAnnotateModel.description}</div>
                  )}
                </div>
                <div className="model-subtitle">参数设置</div>
              <div className="param-grid">
                {paramSchema.map((item) => (
                  <div className="param-item" key={item.key}>
                    <div className="param-label-row">
                      <label>{item.label}</label>
                      <Tooltip title={item.tip} placement="left">
                        <span className="param-tip-icon">
                          <QuestionCircleOutlined />
                        </span>
                      </Tooltip>
                    </div>
                    <Input
                      size="small"
                      placeholder={item.placeholder}
                      value={
                        item.key === 'param1' ? param1 :
                        item.key === 'param2' ? param2 :
                        item.key === 'param3' ? param3 :
                        param4
                      }
                      onChange={(e) => {
                        const value = e.target.value;
                        if (item.key === 'param1') setParam1(value);
                        if (item.key === 'param2') setParam2(value);
                        if (item.key === 'param3') setParam3(value);
                        if (item.key === 'param4') setParam4(value);
                      }}
                    />
                  </div>
                ))}
                <div className="param-item full">
                  <div className="param-label-row">
                    <label>类别映射</label>
                    <Tooltip title="为每个模型输出类别选择要写入的任务类别。未选择的类别索引不会参与写入。">
                      <span className="param-tip-icon">
                        <QuestionCircleOutlined />
                      </span>
                    </Tooltip>
                  </div>
                  <div className="mapping-grid">
                    {modelClassIndexList.map((classIndex) => (
                      <div className="mapping-row" key={classIndex}>
                        <span className="mapping-index">模型类别 {classIndex}</span>
                        <Select
                          size="small"
                          allowClear
                          placeholder="选择任务类别"
                          value={categoryMappingObj?.[String(classIndex)]}
                          onChange={(value) => {
                            setCategoryMappingObj((prev) => {
                              const next = { ...(prev || {}) };
                              if (value === undefined || value === null) {
                                delete next[String(classIndex)];
                              } else {
                                next[String(classIndex)] = Number(value);
                              }
                              return next;
                            });
                          }}
                        >
                          {availableTaskTypes.map((typeItem) => (
                            <Select.Option key={typeItem.typeId} value={typeItem.typeId}>
                              {typeItem.typeName}
                            </Select.Option>
                          ))}
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
            )}
          </div>

          <div className="model-block">
            <div className="model-block-title"><AppstoreOutlined /> 标注辅助</div>
            <div className="model-subtitle">SAM参数设置</div>
            <div className="param-grid">
              {samParamSchema.map((item) => (
                <div className="param-item" key={item.key}>
                  <div className="param-label-row">
                    <label>{item.label}</label>
                    <Tooltip title={item.tip}>
                      <span className="param-tip-icon">
                        <QuestionCircleOutlined />
                      </span>
                    </Tooltip>
                  </div>
                  <Input
                    size="small"
                    placeholder={item.placeholder}
                    value={
                      item.key === 'param1' ? samParam1 :
                      item.key === 'param2' ? samParam2 :
                      item.key === 'param3' ? samParam3 :
                      samParam4
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      if (item.key === 'param1') setSamParam1(value);
                      if (item.key === 'param2') setSamParam2(value);
                      if (item.key === 'param3') setSamParam3(value);
                      if (item.key === 'param4') setSamParam4(value);
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="assist-btns dual">
              <Tooltip title={currentTaskType === '地物分类' ? '开启后按钮常亮。之后在影像上绘制点、线、面提示要素，会自动调用 SAM 完成提取；再次点击可关闭。' : 'SAM交互标注当前仅用于地物分类任务。'}>
                <button
                  className={`assist-btn sam${samInteractiveEnabled ? ' active' : ''}`}
                  onClick={handleToggleSamInteractive}
                  disabled={isCurrentUserReadOnly}
                >
                  <AppstoreOutlined /> SAM交互标注
                </button>
              </Tooltip>
              <Tooltip title={selectedModelFamily === 'yolo' && isYoloSamTaskType ? '当前选择的是 YOLO，地物提取/地物分类任务下会自动走 YOLO+SAM 联合预标注。' : '使用当前选中的预标注模型和参数，对当前影像启动预标注。'}>
                <button className="model-action-btn pre-annotate-btn" onClick={handleModelInference} disabled={!selectedPreAnnotateModel || isCurrentUserReadOnly}>
                  <ThunderboltOutlined /> 预标注启动
                </button>
              </Tooltip>
            </div>
          </div>

          {selectedModelId && (
            <div className="model-block">
              <div className="model-block-title"><BuildOutlined /> 运行结果</div>
              <div className="param-grid">
                <div className="param-item full">
                  <Input.TextArea
                    size="small"
                    value={modelResults.selectedValue || JSON.stringify(modelResults, null, 2)}
                    readOnly
                    rows={4}
                  />
                </div>
              </div>
            </div>
          )}

        </div>

      {/* 弹窗组件 */}
      {showAuditLoader && (
        <CollectionCreateForm
          open={showAuditLoader}
          onCreate={onCreate}
          onCancel={onCancel}
          title="审核反馈"
          formItemList={() => {
            return (
              <Form.Item
                label="未通过原因"
                name="auditFeedback"
                rules={[{ required: true, message: '必须输入未通过原因！' }]}
              >
                <Input placeholder="边界、框不贴合/标注类别不符..." />
              </Form.Item>
            );
          }}
        />
      )}
      {showUploader && (
        <Uploader
          onUploadStatusChange={(flag) => {
            setShowUploader(flag);
          }}
          getShp={handleGetShp}
        />
      )}
    </>
  );
}
