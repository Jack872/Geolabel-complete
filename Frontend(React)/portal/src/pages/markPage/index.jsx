import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Button, Form, Input, message, Popconfirm, Tag, Slider, Select, Tooltip } from 'antd';
import { reqSaveService, reqExportService, reqAuditTask, reqAssistFunction, reqUqdateLabel,
  reqGetModelList,reqInferenceFunction, reqSplitPolygon, reqUnionPolygons} from '@/services/map/api';
import { reqGetMyTaskIds } from '@/services/taskManage/api';
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
import DragBox from 'ol/interaction/DragBox';
import {
  CheckOutlined, CloseOutlined, DeleteOutlined, RollbackOutlined, UpOutlined,
  SaveOutlined, SyncOutlined, ScissorOutlined, UndoOutlined, RedoOutlined,
  RobotOutlined, ThunderboltOutlined, AimOutlined, AppstoreOutlined,
  ExperimentOutlined, BuildOutlined,
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
import { getCoordinateSystemFromTask, getTransformationParams } from '@/utils/coordinateSystem';


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

export default function () {
  const shapeSelect = useRef();
  const layerSelect = useRef();

  const [showUploader, setShowUploader] = useState(false);
  const [showAuditLoader, setShowAuditLoader] = useState(false);
  const [markSource, setMarkSource] = useState(new VectorSource());
  const [modelContainerExpanded, setModelContainerExpanded] = useState(false);
  const [fillOpacity, setFillOpacity] = useState(0.1);
  const [modelList, setModelList] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState(null);
  const [activeShape, setActiveShape] = useState('None'); // 当前激活的形状
  const [toolbarState, setToolbarState] = useState({
    drawState: false,
    color: '',
    sourceKey: null,
    markSource: new VectorSource(),
    currentLayer: '',
  });
  // 任务导航：当前用户的任务 ID 列表
  const [myTaskIds, setMyTaskIds] = useState([]);
  const {
    initialState: {
      currentState: { currentUser },
    },
  } = useModel('@@initialState');

  //挂载地图并定位服务 hook
  const { typeList, taskInfo, setMap, mapRef, markGeoJsonArr, mapExtent, refreshMarkGeoJsonArr, taskSource, localImagePath } = useMap();
  const access = useAccess(); // access 实例的成员: canAdmin, canUser
  let select, modify, shapeDraw; // 将交互变量声明在组件顶层
  const selectRef = useRef(null);
  const modifyRef = useRef(null);
  const shapeDrawRef = useRef(null);
  const dragBoxRef = useRef(null);
  const unionFirstFeatureRef = useRef(null);
  const splitFirstFeatureRef = useRef(null);
  const refreshMarkGeoJsonArrRef = useRef(refreshMarkGeoJsonArr);
  const deletedMarkIdsRef = useRef([]);
  const interactionRunRef = useRef(0);
  const [toolMode, setToolMode] = useState('none'); // none | split | union | boxDelete
  const [deletedMarkIds, setDeletedMarkIds] = useState([]);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [featurePanelVersion, setFeaturePanelVersion] = useState(0);
  const FEATURE_BASE_STYLE_KEY = '__featureBaseStyle';
  const FEATURE_HIGHLIGHT_KEY = '__featureHighlightStyle';
  useEffect(() => {
    refreshMarkGeoJsonArrRef.current = refreshMarkGeoJsonArr;
  }, [refreshMarkGeoJsonArr]);
  useEffect(() => {
    deletedMarkIdsRef.current = deletedMarkIds;
  }, [deletedMarkIds]);

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
      : {};
    return format.writeFeatureObject(feature, writeOptions);
  }, [mapRef]);

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
          projection: taskInfo?.coordinateSystem || "EPSG:3857" // 动态获取坐标系
        });
        typeSource?.set('typeid', typeId);
        for (const item of markGeoJsonArr) {
          if (typeId == item.typeId) {
            // taskSource==='local' 时坐标是像素坐标，dataProjection 和 featureProjection 都设为 'pixel'
            // 防止 OpenLayers 把像素坐标当经纬度做投影转换
            const isLocal = taskSource === 'local';
            const readOptions = isLocal
              ? { dataProjection: 'pixel', featureProjection: 'pixel' }
              : {};
            let features = [];
            try {
              features = new GeoJSON().readFeatures(item.markGeoJson, readOptions);
            } catch (e) {
              // 投影未注册时降级：不做转换直接读
              features = new GeoJSON().readFeatures(item.markGeoJson,
                { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:4326' });
            }
            features.forEach(feature => {
              feature.set('markId', item.markId);
              feature.set('typeId', typeId);
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
    modelScopeLayer.set('displayInLayerSwitcher', false); // 设置不在图层切换器中显示
    modelScopeLayer.setZIndex(99);
    vectorLayerArr.push(modelScopeLayer);

    return vectorLayerArr;
  }, [markGeoJsonArr, taskInfo, taskSource, currentUser, mapRef, getTransparentColor]); // 依赖项包含任务状态和用户信息

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
      layer.setVisible(true);
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
        if (!feature.get('attrJson')) {
          feature.set('attrJson', {});
        }
        setFeaturePanelVersion((prev) => prev + 1);
      });
      shapeDraw.on('drawstart', () => {
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
        (evt.selected || []).forEach((feature) => applyFeatureHighlight(feature));
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

    if (select) {
      // 仅修改“已选中要素”，避免边缘点击被 Modify 抢占导致 Select 失效
      modify = new Modify({ features: select.getFeatures() });
      modifyRef.current = modify;
      //查看修改后的feature信息
      modify.on('modifyend', (event) => {
        // 获取绘制的矩形
        const feature = event.features;
        console.log("修改后的feature")
        console.log(feature)
        console.log(event)
        console.log(toolbarState.currentLayer)
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

      if (shapeSelect.current.value != 'None') {
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
        if (modify && mapRef.current && toolMode === 'none') {
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

    if (toolMode === 'boxDelete' && toolbarState.currentLayer) {
      dragBoxRef.current = new DragBox();
      dragBoxRef.current.on('boxend', () => {
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
    toolbarState.sourceKey,
    typeList,
    applyFeatureHighlight,
    restoreFeatureStyle,
    isPolygonFeature,
    getOuterRingCoordinates,
    featureToGeoJsonObject,
  ]);



  let featuresList = []; //绘制的要素集合

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
    try {
      let features = toolbarState.currentLayer.getSource().getFeatures();
      let feature = features.pop();
      if (feature) {
        toolbarState.currentLayer.getSource().removeFeature(feature);
        featuresList.push(feature);
      }
    } catch (error) {
      message.warn('请选择图层');
    }
  }, [toolbarState.currentLayer]);
  // 恢复
  const recover = useCallback(() => {
    let feature;
    feature = featuresList.pop();
    if (feature) {
      toolbarState.currentLayer.getSource().addFeature(feature);
    }
  }, [toolbarState.currentLayer]);
  const getTaskId = useMemo(() => {
    let TASKID = window.sessionStorage.getItem('taskId');
    // let TASKID=taskInfo.data[0].taskname
    let taskId=Decrypt(TASKID)
    return taskId;
  }, []);

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
    if (!selectedFeature) return;
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
    setFeaturePanelVersion((prev) => prev + 1);
  }, [selectedFeature]);

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
    if (selectedCollection) {
      selectedCollection.clear();
      selectedCollection.push(feature);
    }
    if (selectedFeature && selectedFeature !== feature) {
      restoreFeatureStyle(selectedFeature);
    }
    applyFeatureHighlight(feature);
    setSelectedFeature(feature);
    setFeaturePanelVersion((prev) => prev + 1);
  }, [applyFeatureHighlight, restoreFeatureStyle, selectedFeature]);

  useEffect(() => {
    if (!selectedFeature) return;
    const source = toolbarState?.currentLayer?.getSource?.();
    const exists = source?.getFeatures?.()?.includes?.(selectedFeature);
    if (!exists) {
      setSelectedFeature(null);
    }
  }, [selectedFeature, toolbarState?.currentLayer, featurePanelVersion]);

  const save = async () => {
    let taskId = getTaskId;
    const jsondataArr = [];

    for (const layer of generateMarkLayer) {
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
          : {};
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
        const currentUserId = taskInfo.data?.[0]?.userArr.filter(({ username }) => username == currentUser)[0].userid;
        const requestData = {
          userid: currentUserId,
          id: taskId,
          jsondataArr,
          typeArr: taskInfo.data?.[0]?.userArr.filter(({ username }) => username == currentUser)[0].typeArr,
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
        } else {
          message.error('保存失败！');
        }
      } catch (error) {
        console.error('Save error:', error);
        message.error('后台异常，请稍后重试！');
      }
  };
  // 删除要素
  const deleteFeature = useCallback(() => {
    const selectInteraction = selectRef.current;
    if (!selectInteraction) {
      message.warn('请先选择图层');
      return;
    }
    let selectFeasuresList = selectInteraction.getFeatures().getArray();
    if (selectFeasuresList.length > 0) {
      try {
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
  }, [toolbarState.currentLayer, deletedMarkIds]);

  const handleGetShp = (shp) => {
    //直接转化成对象，加入地图，如下
    const importJson = JSON.parse(shp);
    setMarkSource(markSource.addFeatures(new GeoJSON().readFeatures(importJson)));
  };

  const toggleToolMode = useCallback((mode) => {
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
  }, []);


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

  // 机器学习辅助生成按键（模型及参数选择）——区分目标识别和地物分类
  const [assistInput, setAssistInput] = useState('');
  const [modelName, setModelName] = useState(''); // 新增模型名称状态
  const [assistFunction, setAssistFunction] = useState('');
  const [param1, setParam1] = useState('');
  const [param2, setParam2] = useState('');
  const [param3, setParam3] = useState('');
  const [param4, setParam4] = useState('');
  const [categoryMapping, setCategoryMapping] = useState(JSON.stringify({0: '类别一ID', 1: '类别二ID', 2: '类别三ID'}, null, 2));
  const [modelResults, setModelResults] = useState({}); // 新增用于存储后端返回的字典
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

// 定义路径映射
  const getModelPathByTaskType = (taskType) => {
    const userId = getUserId();
    const pathMap = {
      '目标检测': '/home/change/labelcode/labelMark/trained_models/' + userId +'/detection_results',
      '地物分类': '/home/change/labelcode/labelMark/trained_models/' + userId + '/segmentation_results',
    };
    return pathMap[taskType] || '/models/default';
  };

// 状态定义（模型推理组件）
  const [selectedModel, setSelectedModel] = useState('');

  // 获取模型列表
useEffect(() => {
  const fetchModelList = async () => {
    if (!taskInfo?.data?.[0]) {
      return;
    }
    const userId = getUserId(); // 获取当前用户ID

    if (!userId) {
      return;
    }
    const taskType = taskInfo?.data?.[0]?.type;
    try {
      const response = await reqGetModelList({
        user_id: userId,
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

// 加载当前用户的任务 ID 列表（用于上下任务导航）
useEffect(() => {
  reqGetMyTaskIds({ pageSize: 1000 }).then(res => {
    if (res?.data) {
      const list = Array.isArray(res.data) ? res.data : (res.data.list || res.data.records || []);
      setMyTaskIds(list.map(t => t.taskid).filter(Boolean));
    }
  }).catch(() => {});
}, []);

// 上下任务导航：自动保存后跳转
const navigateTask = useCallback(async (direction) => {
  const currentTaskId = parseInt(getTaskId);
  if (!currentTaskId || myTaskIds.length === 0) return;
  const idx = myTaskIds.indexOf(currentTaskId);
  if (idx === -1) return;
  const nextIdx = direction === 'prev' ? idx - 1 : idx + 1;
  if (nextIdx < 0 || nextIdx >= myTaskIds.length) {
    message.info(direction === 'prev' ? '已是第一个任务' : '已是最后一个任务');
    return;
  }
  try {
    await save();
    const nextTaskId = myTaskIds[nextIdx];
    window.sessionStorage.setItem('taskId', Encrypt(nextTaskId));
    window.location.reload();
  } catch (e) {
    message.error('保存失败，无法跳转');
  }
}, [getTaskId, myTaskIds, save]);

// 辅助功能（模型训练）
  const handleAssistClick = async () => {
    let taskId = getTaskId;
    const taskType = taskInfo?.data?.[0]?.type;

    if (!assistFunction || assistFunction === 'none') {
      message.error('请先选择一个模型！');
      return;
    }

    const userId = getUserId();
    if (!userId) {
      message.error('无法获取用户 ID，请检查用户信息');
      return;
    }

    let parameters = {};
    if (taskType === '目标检测') {
      parameters = {
        param1: param1,
        param2: param2,
        param3: param3,
        param4: param4,
        categoryMapping: categoryMapping,
      };
    } else {
      parameters = {
        param1: param1,
        param2: param2,
        param3: param3,
        param4: param4,
        categoryMapping: categoryMapping,
      };
    }

    // 获取"模型作用范围"图层的多边形坐标
    const modelScopeLayer = generateMarkLayer.find(layer => layer.get('typeid') === 'modelScope');
    const modelScopeFeatures = modelScopeLayer.getSource().getFeatures();
    const modelScopeCoordinates = modelScopeFeatures.map(feature => feature.getGeometry().getCoordinates());
    parameters.modelScope = modelScopeCoordinates.length > 0 ? modelScopeCoordinates : [];

    try {
      //先保存当前页面的样本到数据库中
      await save();

      const hide = message.loading('正在调用辅助功能...');
      const result = await reqAssistFunction({
        taskid: taskId,
        mapfile_path: getMapfilePath(),
        task_type: taskType,
        user_id: userId,
        functionName: assistFunction,
        assistInput: assistInput || '150',
        modelName: modelName,
        parameters,
      });
      hide();
      if (result.code === 200) {
        message.success(result.message);
        setModelResults(result.data || {}); // 存储后端返回的字典数据
        // 刷新标注数据而不是整个页面
        await refreshMarkGeoJsonArr();
      } else {
        message.error(result.message || '调用辅助功能失败');
      }
    } catch (error) {
      message.error('调用辅助功能失败：' + error.message);
    }
  };


  // 模型推理功能
  const handleModelInference = async () => {
    if (!selectedModelId) {
      message.warning('请先选择模型');
      return;
    }

    const taskId = getTaskId;
    const userId = getUserId();
    const taskType = taskInfo?.data[0]?.type;

    if (!userId) {
      message.error('无法获取用户 ID，请检查用户信息');
      return;
    }

    // 获取选中的模型信息
    const selectedModel = modelList.find(m => m.id === selectedModelId);
    if (!selectedModel) {
      message.error('未找到选中的模型');
      return;
    }

    try {
      // 先保存当前标注
      await save();
      const hide = message.loading('正在进行模型推理...');
      // 构建类别映射（根据任务类型）
      const categoryMapping = {};
      // 假设 selectedModel.model_des 的值是 "3: 0; 5:1"
      if (selectedModel && selectedModel.details && typeof selectedModel.details === 'string') {
        // 1. 使用分号 (;) 将字符串切分成多个键值对部分
        // 结果变成数组: ["3: 0", " 5:1"]
        const mappingPairs = selectedModel.details.split(';');

        mappingPairs.forEach(pair => {
          // 去除多余的空格（防止末尾多一个分号导致切出空字符串报错）
          // eslint-disable-next-line no-param-reassign
          pair = pair.trim();
          if (!pair) return; // 如果是空的就跳过

          // 2. 使用冒号 (:) 分割出 typeId 和 classIndex
          const parts = pair.split(':');

          if (parts.length === 2) {
            // 3. 提取并转换成整数 (trim() 可以去掉 " 0" 前面的空格)
            const typeId = parseInt(parts[0].trim(), 10);
            const classIndex = parseInt(parts[1].trim(), 10);

            // 4. 构建 Python 需要的反向映射格式：{ classIndex: typeId }
            if (!isNaN(typeId) && !isNaN(classIndex)) {
              categoryMapping[classIndex] = typeId;
            }
          }
        });
      }

      // 调用推理接口
      const result = await reqInferenceFunction({
        taskid: taskId,
        mapfile_path: getMapfilePath(),
        user_id: userId,
        model_id: selectedModelId,
        // 新增：将所有算法特征参数封装在 parameters 对象中
        parameters: {
          param1: '0.3',   // 置信度
          param2: '640',   // 切片尺寸
          param3: '10',   // boundary_smoothing
          param4: '1',    // 其他参数
          // 直接传对象和数组，不要用 JSON.stringify
          categoryMapping: categoryMapping || {},
          modelScope: []  // 传空数组或者具体的范围数据
        }
      });

      hide();

      if (result.code === 200) {
        message.success(result.message || '推理任务已启动');
        // 等待一段时间后刷新标注显示
        setTimeout(async () => {
          await refreshMarkGeoJsonArr();
          message.success('标注已更新');
        }, 3000);
      } else {
        message.error(result.message || '推理失败');
      }
    } catch (error) {
      message.error('推理失败：' + error.message);
    }
  };

  // 提取目标功能（XGBoost固定参数）
  const handleExtractTarget = async () => {
    let taskId = getTaskId;
    const taskType = taskInfo?.data?.[0]?.type;
    const userId = getUserId();

    if (!userId) {
      message.error('无法获取用户 ID，请检查用户信息');
      return;
    }

    // 固定参数设置
    const fixedParameters = {
      param1: '100',
      param2: '800',
      param3: '10',
      param4: '1',
      categoryMapping: JSON.stringify({}),
    };

    // 获取"模型作用范围"图层的多边形坐标
    const modelScopeLayer = generateMarkLayer.find(layer => layer.get('typeid') === 'modelScope');
    const modelScopeFeatures = modelScopeLayer.getSource().getFeatures();
    const modelScopeCoordinates = modelScopeFeatures.map(feature => feature.getGeometry().getCoordinates());
    fixedParameters.modelScope = modelScopeCoordinates.length > 0 ? modelScopeCoordinates : [];

    try {
      await save();
      const hide = message.loading('正在提取目标...');
      const result = await reqAssistFunction({
        taskid: taskId,
        mapfile_path: getMapfilePath(),
        task_type: taskType,
        user_id: userId,
        functionName: 'xgboost',
        assistInput: '300',
        modelName: 'extract_target_model',
        parameters: fixedParameters,
      });
      hide();
      if (result.code === 200) {
        message.success(result.message);
        setModelResults(result.data || {});
        // 刷新标注数据而不是整个页面
        await refreshMarkGeoJsonArr();
      } else {
        message.error(result.message || '提取目标失败');
      }
    } catch (error) {
      message.error('提取目标失败：' + error.message);
    }
  };

  const handleSamPreAnnotation = async () => {
    let taskId = getTaskId;
    const taskType = taskInfo?.data?.[0]?.type;
    const userId = getUserId();

    if (!userId) {
      message.error('无法获取用户 ID，请检查用户信息');
      return;
    }

    // 1. 获取当前活跃图层的数据源
    const activeSource = toolbarState.markSource;
    if (!activeSource || activeSource.getFeatures().length === 0) {
      message.warn('请先在地图上绘制一个提示要素（点、线或矩形框）');
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
      param1: fillOpacity.toString(), // 传入当前透明度
      param2: '50', // min_object_size
      param3: '10', // hole_size
      param4: '1',  // smoothing
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
      await save();

      const hide = message.loading(`SAM 正在基于最新的${
        promptType === 'point' ? '点' : promptType === 'line' ? '线' : '框'
      }进行提取...`);

      // 6. 发送请求
      const result = await reqAssistFunction({
        taskid: taskId,
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
  };

  // 全图建筑自动预标注（YOLO-World 检测 + SAM 分割）
  const handleAutoBuildingSegmentation = async () => {
    const taskId = getTaskId;
    const taskType = taskInfo?.data[0]?.type;
    const userId = getUserId();

    if (!userId) {
      message.error('无法获取用户 ID，请检查用户信息');
      return;
    }

    if (!toolbarState.sourceKey) {
      message.warning('请先选择一个标注图层，以便将建筑轮廓写入对应类别');
      return;
    }

    try {
      await save();
      const hide = message.loading('正在全图检测建筑并分割，请稍候（可能需要数十秒）...');
      const result = await reqAssistFunction({
        taskid: taskId,
        mapfile_path: getMapfilePath(),
        task_type: taskType,
        user_id: userId,
        functionName: 'auto_building_sam',
        assistInput: '1',
        modelName: 'YOLO+SAM',
        parameters: {
          param2: '50',   // min_object_size
          param3: '10',   // hole_size
          param4: '1',    // smoothing
          currentTypeId: toolbarState.sourceKey,
          categoryMapping: JSON.stringify({}),
          modelScope: [],
        },
      });
      hide();
      if (result.code === 200) {
        message.success('全图建筑预标注完成');
        await refreshMarkGeoJsonArr();
      } else {
        message.error(result.message || '全图预标注失败');
      }
    } catch (error) {
      message.error('全图预标注异常：' + error.message);
    }
  };

// 模型推理
  const handleInferenceClick = async () => {
    if (!selectedModel) {
      message.error('请先选择一个推理模型！');
      return;
    }

    let taskId = getTaskId;
    const taskType = taskInfo?.data?.[0]?.type;
    const userId = getUserId();
    if (!userId) {
      message.error('无法获取用户 ID，请检查用户信息');
      return;
    }

    let parameters = {};
    if (taskType === '目标检测') {
      parameters = {
        param1: param1,
        param2: param2,
        param3: param3,
        param4: param4,
        categoryMapping: categoryMapping,
      };
    } else {
      parameters = {
        param1: param1,
        param2: param2,
        param3: param3,
        param4: param4,
        categoryMapping: categoryMapping,
      };
    }

    // 获取"模型作用范围"图层的多边形坐标
    const modelScopeLayer = generateMarkLayer.find(layer => layer.get('typeid') === 'modelScope');
    const modelScopeFeatures = modelScopeLayer.getSource().getFeatures();
    const modelScopeCoordinates = modelScopeFeatures.map(feature => feature.getGeometry().getCoordinates());
    parameters.modelScope = modelScopeCoordinates.length > 0 ? modelScopeCoordinates : [];

    try {
      await save();
      const hide = message.loading('正在进行模型推理...');
      const result = await reqInferenceFunction({
        taskid: taskId,
        user_id: userId,
        model: selectedModel,
        parameters,
      });
      hide();
      if (result.code === 200) {
        message.success(result.message);
        // 刷新标注数据而不是整个页面
        await refreshMarkGeoJsonArr();
      } else {
        message.error(result.message || '模型推理失败');
      }
    } catch (error) {
      message.error('模型推理失败：' + error.message);
    }
  };


  const isObjectDetection = taskInfo?.data?.[0]?.type === '目标检测'; // 判断是否为目标检测任务

// 定义模型选项
  const objectDetectionModels = [
    { value: 'yolo', label: 'YOLO' },
  ];
  const classificationModels = [
    { value: 'sam_box', label: 'SAM_BOX' },
    { value: 'sam', label: 'SAM' },
    { value: 'light_unet', label: 'Light UNet' },
    { value: 'unet', label: 'UNet' },
    { value: 'fast_scnn', label: 'Fast SCNN' },
    { value: 'xgboost', label: 'XGBoost' },
    { value: 'svm', label: 'SVM' },
  ];

  //更新新绘制样本功能
  const update_label = async () => {
    let taskId = getTaskId;
    try {

      //先执行保存操作
      await save();

      const hide = message.loading('正在更新样本...');
      const result = await reqUqdateLabel({ taskid: taskId });
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
  const currentUserData = userArr.find(u => u.username === currentUser);
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
        {taskInfo?.data?.[0]?.auditfeedback && (
          <>
            <div className="top-info-sep" />
            <div className="top-info-item">
              <span className="top-info-label">审核反馈：</span>
              <span className="top-info-feedback">{taskInfo?.data?.[0]?.auditfeedback}</span>
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
            disabled={myTaskIds.length === 0}
          >
            <LeftOutlined />
          </button>
        </Tooltip>
        <span className="task-nav-label">{taskInfo?.data?.[0]?.taskname}</span>
        {myTaskIds.length > 0 && (
          <span className="task-nav-progress">
            {myTaskIds.indexOf(parseInt(getTaskId)) + 1} / {myTaskIds.length}
          </span>
        )}
        <Tooltip title="保存并跳转下一个任务">
          <button
            className="task-nav-btn"
            onClick={() => navigateTask('next')}
            disabled={myTaskIds.length === 0}
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
          ].map(({ value, icon, title }) => (
            <Tooltip key={value} title={title}>
              <button
                className={`shape-icon-btn${activeShape === value ? ' active' : ''}${toolbarState.drawState && value !== 'None' ? ' disabled' : ''}`}
                disabled={toolbarState.drawState && value !== 'None'}
                onClick={() => {
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
          ))}

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
          <Tooltip title="删除选中标注"><button className="action-btn danger" onClick={deleteFeature}><ScissorOutlined /></button></Tooltip>
          <Tooltip title="撤销"><button className="action-btn" onClick={undo}><UndoOutlined /></button></Tooltip>
          <Tooltip title="重做"><button className="action-btn" onClick={recover}><RedoOutlined /></button></Tooltip>
          <Tooltip title="保存标注"><button className="action-btn primary" onClick={save}><SaveOutlined /></button></Tooltip>
          <Tooltip title="更新样本"><button className="action-btn primary" onClick={update_label}><SyncOutlined /></button></Tooltip>
          <div className="op-divider" />
          <Tooltip title="切分工具：依次选择两个多边形，删除第一个与第二个的交集">
            <button
              className={`action-btn ${toolMode === 'split' ? 'active-tool' : ''}`}
              onClick={() => toggleToolMode('split')}
            >
              <SplitCellsOutlined />
            </button>
          </Tooltip>
          <Tooltip title="并集工具：连续点击两个相交多边形自动求并">
            <button
              className={`action-btn ${toolMode === 'union' ? 'active-tool' : ''}`}
              onClick={() => toggleToolMode('union')}
            >
              <MergeCellsOutlined />
            </button>
          </Tooltip>
          <Tooltip title="框选删除：拖框选择多个要素后一键删除">
            <button
              className={`action-btn ${toolMode === 'boxDelete' ? 'active-tool' : ''}`}
              onClick={() => toggleToolMode('boxDelete')}
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
        />

        {/* 右侧：模型辅助工具面板 */}
        <div className="model-panel model-panel-main">
          {/* 自训练模型 */}
          <div className="model-block">
            <div className="model-block-title"><RobotOutlined /> 自训练模型</div>
            <Select
              placeholder="选择模型"
              style={{ width: '100%', marginBottom: 8 }}
              onChange={setSelectedModelId}
              value={selectedModelId}
              allowClear
              size="small"
            >
              {modelList.map(model => (
                <Select.Option key={model.id} value={model.id}>
                  {model.name} ({model.type})
                </Select.Option>
              ))}
            </Select>

            {selectedModelId && (
              <div className="param-grid">
                <div className="param-item">
                  <label>置信度</label>
                  <Input size="small" placeholder="0.3" value={param1} onChange={e => setParam1(e.target.value)} />
                </div>
                <div className="param-item">
                  <label>切片尺寸</label>
                  <Input size="small" placeholder="640" value={param2} onChange={e => setParam2(e.target.value)} />
                </div>
                <div className="param-item">
                  <label>边界平滑</label>
                  <Input size="small" placeholder="10" value={param3} onChange={e => setParam3(e.target.value)} />
                </div>
                <div className="param-item">
                  <label>其他</label>
                  <Input size="small" placeholder="1" value={param4} onChange={e => setParam4(e.target.value)} />
                </div>
                <div className="param-item full">
                  <label>类别映射</label>
                  <Input.TextArea size="small" placeholder='{"0":3}' value={categoryMapping} onChange={e => setCategoryMapping(e.target.value)} rows={2} />
                </div>
              </div>
            )}

            <Tooltip title="使用选中模型生成标注">
              <button className="model-action-btn" onClick={handleModelInference} disabled={!selectedModelId}>
                <ThunderboltOutlined /> 生成标注
              </button>
            </Tooltip>
          </div>

          {/* 辅助模型（地物分类任务） */}
          {taskInfo?.data?.[0]?.type === '地物分类' && (
            <div className="model-block">
              <div className="model-block-title"><ExperimentOutlined /> 辅助模型</div>
              <div className="assist-btns">
                <button className="assist-btn" onClick={handleExtractTarget}><AimOutlined /> XGBoost</button>
                <button className="assist-btn sam" onClick={handleSamPreAnnotation}><AppstoreOutlined /> SAM</button>
              </div>
            </div>
          )}

          {/* 模型预标注 */}
          <div className="model-block">
            <div className="model-block-title"><BuildOutlined /> 模型预标注</div>
            <button className="pre-annotate-btn" onClick={handleAutoBuildingSegmentation}>
              <ThunderboltOutlined /> 一键预标注
            </button>
          </div>

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
