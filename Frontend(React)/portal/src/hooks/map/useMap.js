import { message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { reqGetCategoryList } from '@/services/category/api';
import { reqGetGeoServerInfo } from '@/services/serviceManage/api';
import { reqStartMark } from '@/services/taskManage/api';
import { Decrypt } from '@/utils/utils';
import { XYZ } from 'ol/source';
import { createXYZ } from 'ol/tilegrid';
import { transformExtent, Projection, addProjection } from 'ol/proj';
import Tile from 'ol/layer/Tile';
import ImageLayer from 'ol/layer/Image';
import Static from 'ol/source/ImageStatic';

// 预注册像素坐标投影，供本地任务的 readFeatures/writeFeatures 使用
const _pixelProj = new Projection({ code: 'pixel', units: 'pixels', extent: [0, 0, 65536, 65536] });
addProjection(_pixelProj);

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

  const setMap = (map) => {
    mapRef.current = map;
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

  useEffect(async () => {
    let mapserver, mapExtent, baseLayer;
    let map4326Extent;
    let nativeSRS, declaredSRS, crsCode;
    let coverageName;

      let TASKID = window.sessionStorage.getItem('taskId');
      let taskId = Decrypt(TASKID);
      const storedTaskItemId = window.sessionStorage.getItem('taskItemId');
      const hide = message.loading('正在获取数据', 0);
      try {
        let typeResult = await reqGetCategoryList();
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
              const View = require('ol/View').default;
              mapRef.current.setView(
                new View({
                  projection: pixelProjection,
                  center: [w / 2, h / 2],
                  zoom: 2,
                  extent: extent,
                })
              );
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
      mapserver = taskResult.data[0].mapserver;
      let geoResult = await reqGetGeoServerInfo(mapserver);
      if (geoResult) {
        setMapExtent(geoResult.coverage.nativeBoundingBox);
        mapExtent = geoResult.coverage.nativeBoundingBox;
        map4326Extent = geoResult.coverage.latLonBoundingBox;
        coverageName = geoResult.coverage.name;
        nativeSRS = geoResult.coverage.nativeCRS || geoResult.coverage.nativeSRS;
        declaredSRS = geoResult.coverage.srs || geoResult.coverage.declaredSRS;
        if (nativeSRS) {
          crsCode = typeof nativeSRS === 'string' ? nativeSRS : nativeSRS.type;
        }
      }
      hide();
    } catch (error) {
      message.error('获取数据失败,请重试！');
      hide();
    }

    if (mapserver) {
      try {
        const tmsSource = new XYZ({
          url: `http://localhost:8081/geoserver/gwc/service/tms/1.0.0/LUU:${coverageName}@EPSG%3A900913@png/{z}/{x}/{-y}.png`,
          projection: 'EPSG:3857',
          tileGrid: createXYZ({ maxZoom: 20, tileSize: 256 }),
          transition: 0.1,
        });
        baseLayer = new Tile({ title: '任务切片影像', source: tmsSource });
      } catch (error) {
        message.error('geoserver后台异常，请联系管理员！');
      }
    }

    let extent3857;
    if (crsCode && !crsCode.endsWith('3857')) {
      const extentNative = [mapExtent.minx, mapExtent.miny, mapExtent.maxx, mapExtent.maxy];
      extent3857 = transformExtent(extentNative, crsCode, 'EPSG:3857');
    } else if (mapExtent) {
      extent3857 = [mapExtent.minx, mapExtent.miny, mapExtent.maxx, mapExtent.maxy];
    }

    if (baseLayer) {
      mapRef.current.addLayer(baseLayer);
      let view = mapRef.current.getView();
      view.fit(extent3857, {
        maxZoom: 22,
        duration: 600,
        callback: () => { view.animate({ zoom: view.getZoom() - 1 }); },
      });
    }
  }, []);

  return { typeList, taskInfo, setMap, mapRef, markGeoJsonArr, mapExtent,
           refreshMarkGeoJsonArr, taskSource, localImagePath, taskItems, currentTaskItemId };
}

export default useMap;
