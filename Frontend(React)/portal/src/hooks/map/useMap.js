import { message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { reqGetCategoryList } from '@/services/category/api';
import { reqGetGeoServerInfo } from '@/services/serviceManage/api';
import { reqStartMark } from '@/services/taskManage/api';
import { Decrypt } from '@/utils/utils';
import { XYZ, TileWMS } from 'ol/source';
import { createXYZ } from 'ol/tilegrid';
import { transformExtent, Projection, addProjection } from 'ol/proj';
import View from 'ol/View';
import Tile from 'ol/layer/Tile';
import ImageLayer from 'ol/layer/Image';
import Static from 'ol/source/ImageStatic';
import { GEOSERVER_URL } from '@/config';
import { normalizeCoordinateCode, registerCommonProjections } from '@/utils/coordinateSystem';

// 预注册像素坐标投影，供本地任务的 readFeatures/writeFeatures 使用
const _pixelProj = new Projection({ code: 'pixel', units: 'pixels', extent: [0, 0, 65536, 65536] });
addProjection(_pixelProj);
registerCommonProjections();

const isValidExtent = (extent) => (
  Array.isArray(extent)
  && extent.length === 4
  && extent.every((value) => Number.isFinite(value))
  && extent[0] < extent[2]
  && extent[1] < extent[3]
);

const isNativeProjectedCrs = (crsCode) => {
  const normalized = normalizeCoordinateCode(crsCode);
  return normalized
    && !['EPSG:3857', 'EPSG:4326', 'NONE', 'UNKNOWN', 'pixel'].includes(normalized);
};

// 地图挂载与服务定位
function useMap() {
  const mapRef = useRef(null);
  const [typeList, setTypeList] = useState({});
  const [taskInfo, setTaskInfo] = useState({ data: [{ taskname: '无' }] });
  const [markGeoJsonArr, setMarkGeoJsonArr] = useState([]);
  const [mapExtent, setMapExtent] = useState(null);
  // 记录任务来源，供标注页面使用
  const [taskSource, setTaskSource] = useState('geoserver');
  const [localImagePath, setLocalImagePath] = useState(null);
  const [taskItems, setTaskItems] = useState([]);
  const [currentTaskItemId, setCurrentTaskItemId] = useState(null);
  const [mapProjectionCode, setMapProjectionCode] = useState('EPSG:3857');

  const setMap = (map) => {
    mapRef.current = map;
  };

  const resolveCoverageLayerName = (coverage) => {
    const namespace = coverage?.namespace?.name ? String(coverage.namespace.name).trim() : 'LUU';
    const name = coverage?.name ? String(coverage.name).trim() : '';
    if (name) {
      return `${namespace}:${name}`;
    }

    const title = coverage?.title ? String(coverage.title).trim() : '';
    if (title) {
      return `${namespace}:${title}`;
    }

    const rawStoreName = coverage?.store?.name;
    if (typeof rawStoreName === 'string' && rawStoreName.trim()) {
      return rawStoreName.trim();
    }

    return '';
  };

  const refreshMarkGeoJsonArr = async () => {
    try {
      let TASKID = window.sessionStorage.getItem('taskId');
      let taskId = Decrypt(TASKID);
      const storedTaskItemId = window.sessionStorage.getItem('taskItemId');
      let taskResult = await reqStartMark({
        taskid: taskId,
        taskItemId: storedTaskItemId ? Number(storedTaskItemId) : undefined,
      });
      if (taskResult && taskResult.markGeoJsonArr) {
        setTaskInfo(taskResult);
        setMarkGeoJsonArr(taskResult.markGeoJsonArr);
        if (taskResult.taskItems) {
          setTaskItems(taskResult.taskItems);
        }
        if (taskResult.currentTaskItemId) {
          setCurrentTaskItemId(taskResult.currentTaskItemId);
          window.sessionStorage.setItem('taskItemId', String(taskResult.currentTaskItemId));
        }
        return true;
      }
    } catch (error) {
      console.error('刷新标注数据失败:', error);
      return false;
    }
  };

  useEffect(() => {
    const initMapData = async () => {
      let mapserver, mapExtent, baseLayer;
      let map4326Extent;
      let crsCode;
      let coverageName;
      let workspaceName = 'LUU';

      let TASKID = window.sessionStorage.getItem('taskId');
      let taskId = Decrypt(TASKID);
      const storedTaskItemId = window.sessionStorage.getItem('taskItemId');
      const hide = message.loading('正在获取数据', 0);
      try {
        let typeResult = await reqGetCategoryList({ current: 1, pageSize: 9999 });
        setTypeList(typeResult);
        let taskResult = await reqStartMark({
          taskid: taskId,
          taskItemId: storedTaskItemId ? Number(storedTaskItemId) : undefined,
        });
        setTaskInfo(taskResult);
        setMarkGeoJsonArr(taskResult.markGeoJsonArr);
        setTaskItems(taskResult.taskItems || []);
        if (taskResult.currentTaskItemId) {
          setCurrentTaskItemId(taskResult.currentTaskItemId);
          window.sessionStorage.setItem('taskItemId', String(taskResult.currentTaskItemId));
        }

        // ===== 判断任务来源 =====
        const source = taskResult.taskSource || 'geoserver';
        setTaskSource(source);

        if (source === 'local') {
        // ===== 本地图片任务：带 token 拉取图片，转成 objectURL 给 ImageStatic =====
          setLocalImagePath(taskResult.localImagePath);
          hide();

          try {
          // token 存在 cookie 中，key 为 TOKEN，header 名为 token
            const getCookieVal = (name) => {
              const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
              return match ? decodeURIComponent(match[1]) : '';
            };
            const token = getCookieVal('TOKEN');
            const currentItemPart = taskResult.currentTaskItemId ? `&taskItemId=${taskResult.currentTaskItemId}` : '';
            const resp = await fetch(`/wegismarkapi/task/getLocalImage?taskId=${taskId}${currentItemPart}`, {
              headers: token ? { token } : {},
            });
            if (!resp.ok) {
              message.error(`本地图片加载失败: ${resp.status} ${resp.statusText}`);
              return;
            }
            const blob = await resp.blob();
            const objectUrl = URL.createObjectURL(blob);

            // 用 Image 探测尺寸
            const img = new window.Image();
            img.onload = () => {
              const w = img.naturalWidth;
              const h = img.naturalHeight;
              const extent = [0, 0, w, h];

              const pixelProjection = new Projection({
                code: 'pixel',
                units: 'pixels',
                extent: extent,
              });
              // 注册到 OpenLayers 全局，让 readFeatures/writeFeatures 能识别 'pixel'
              addProjection(pixelProjection);

              const staticSource = new Static({
                url: objectUrl,
                imageExtent: extent,
                projection: pixelProjection,
              });

              const imgLayer = new ImageLayer({
                title: '本地图片',
                source: staticSource,
              });

              if (mapRef.current) {
                mapRef.current.setView(
                  new View({
                    projection: pixelProjection,
                    center: [w / 2, h / 2],
                    zoom: 2,
                    extent: extent,
                  })
                );
                setMapProjectionCode('pixel');
                mapRef.current.addLayer(imgLayer);
                mapRef.current.getView().fit(extent, { padding: [20, 20, 20, 20] });
              }
            };
            img.onerror = () => message.error('图片解码失败，请检查文件格式');
            img.src = objectUrl;
          } catch (err) {
            message.error('本地图片请求异常: ' + err.message);
          }
          return;
        }

        // ===== GeoServer 任务：原有逻辑 =====
        mapserver = taskResult?.data?.[0]?.mapserver;
        const mapServerId = taskResult?.data?.[0]?.serverId;
        let geoResult = await reqGetGeoServerInfo(mapServerId);
        if (geoResult) {
          setMapExtent(geoResult.coverage.nativeBoundingBox);
          mapExtent = geoResult.coverage.nativeBoundingBox;
          map4326Extent = geoResult.coverage.latLonBoundingBox;
          coverageName = resolveCoverageLayerName(geoResult.coverage);
          workspaceName = geoResult.coverage?.namespace?.name
            ? String(geoResult.coverage.namespace.name).trim()
            : 'LUU';
        // 从 nativeBoundingBox.crs 获取实际坐标参考系（nativeBbox 始终使用原生CRS）
        // 仅当该字段缺失时回退到 srs（声明CRS）
          const bboxCRS = geoResult.coverage.nativeBoundingBox?.crs;
          if (bboxCRS) {
            if (typeof bboxCRS === 'string') {
              crsCode = normalizeCoordinateCode(bboxCRS);
            } else if (bboxCRS.$) {
              crsCode = normalizeCoordinateCode(bboxCRS.$);
            } else if (bboxCRS.type === 'EPSG' && bboxCRS.properties?.code) {
              crsCode = `EPSG:${bboxCRS.properties.code}`;
            }
          }
          if (!crsCode) {
            const rawSRS = geoResult.coverage.srs || geoResult.coverage.declaredSRS;
            if (rawSRS) {
              if (typeof rawSRS === 'string') {
                crsCode = normalizeCoordinateCode(rawSRS);
              } else if (rawSRS.type === 'EPSG' && rawSRS.properties?.code) {
                crsCode = `EPSG:${rawSRS.properties.code}`;
              } else if (rawSRS.type) {
                crsCode = normalizeCoordinateCode(rawSRS.type);
              }
            }
          }
        }
        hide();
      } catch (error) {
        message.error('获取数据失败,请重试！');
        hide();
      }

    if (mapserver) {
      try {
          const nativeExtent = mapExtent
            ? [mapExtent.minx, mapExtent.miny, mapExtent.maxx, mapExtent.maxy]
            : null;
          const useNativeProjectedView = isNativeProjectedCrs(crsCode) && isValidExtent(nativeExtent);
          const wmsUrl = useNativeProjectedView
            ? `${GEOSERVER_URL}/geoserver/${workspaceName}/wms`
            : `${GEOSERVER_URL}/geoserver/wms`;
          const wmsParams = {
            LAYERS: coverageName,
            TILED: true,
            FORMAT: 'image/png',
            TRANSPARENT: useNativeProjectedView,
          };
          if (useNativeProjectedView) {
            wmsParams.VERSION = '1.1.0';
            wmsParams.SRS = crsCode;
          }
          console.log('[wms_debug] srs=', crsCode);
          console.log('[wms_debug] wmsUrl=', wmsUrl);
          console.log('[wms_debug] layerName=', coverageName);
          console.log('[wms_debug] nativeExtent=', nativeExtent);
          const wmsSource = new TileWMS({
            url: wmsUrl,
            params: wmsParams,
            projection: useNativeProjectedView ? crsCode : 'EPSG:3857',
            transition: 0.1,
            serverType: 'geoserver',
          });
          baseLayer = new Tile({ title: '任务影像', source: wmsSource });
      } catch (error) {
        message.error('geoserver后台异常，请联系管理员！');
      }
    }

      let extent3857;
      const nativeExtent = mapExtent
        ? [mapExtent.minx, mapExtent.miny, mapExtent.maxx, mapExtent.maxy]
        : null;
      const useNativeProjectedView = isNativeProjectedCrs(crsCode) && isValidExtent(nativeExtent);
      try {
        if (useNativeProjectedView) {
          extent3857 = null;
        } else if (crsCode && !crsCode.endsWith('3857')) {
          const extentNative = [mapExtent.minx, mapExtent.miny, mapExtent.maxx, mapExtent.maxy];
          extent3857 = transformExtent(extentNative, crsCode, 'EPSG:3857');
        } else if (mapExtent) {
          extent3857 = [mapExtent.minx, mapExtent.miny, mapExtent.maxx, mapExtent.maxy];
        }
      } catch (e) {
        console.warn('坐标变换失败，尝试使用 latLonBoundingBox 回退:', e);
      }
      // latLonBoundingBox 始终是 EPSG:4326，作为回退方案
      if (!isValidExtent(extent3857) && map4326Extent) {
        extent3857 = transformExtent(
          [map4326Extent.minx, map4326Extent.miny, map4326Extent.maxx, map4326Extent.maxy],
          'EPSG:4326', 'EPSG:3857'
        );
      }

      if (baseLayer) {
        if (useNativeProjectedView && isValidExtent(nativeExtent)) {
          mapRef.current.setView(new View({
            projection: crsCode,
            center: [(nativeExtent[0] + nativeExtent[2]) / 2, (nativeExtent[1] + nativeExtent[3]) / 2],
            zoom: 2,
          }));
          mapRef.current.addLayer(baseLayer);
          const view = mapRef.current.getView();
          setMapProjectionCode(normalizeCoordinateCode(view.getProjection().getCode()));
          console.log('[wms_debug] viewProjection=', view.getProjection().getCode());
          view.fit(nativeExtent, {
            padding: [40, 40, 40, 40],
            duration: 500,
            maxZoom: 22,
          });
        } else {
          mapRef.current.addLayer(baseLayer);
          let view = mapRef.current.getView();
          setMapProjectionCode(normalizeCoordinateCode(view.getProjection().getCode()));
          console.log('[wms_debug] viewProjection=', view.getProjection().getCode());
          if (isValidExtent(extent3857)) {
          view.fit(extent3857, {
            maxZoom: 22,
            duration: 600,
            callback: () => { view.animate({ zoom: view.getZoom() - 1 }); },
          });
          } else {
            console.warn('底图范围无效，跳过 view.fit', { crsCode, mapExtent, map4326Extent, extent3857 });
          }
        }
      }
    };

    initMapData().catch((error) => {
      console.error('地图初始化异常:', error);
      message.error('地图初始化失败，请重试');
    });
  }, []);

  return { typeList, taskInfo, setMap, mapRef, markGeoJsonArr, mapExtent,
           refreshMarkGeoJsonArr, taskSource, localImagePath, taskItems, currentTaskItemId, mapProjectionCode };
}

export default useMap;
