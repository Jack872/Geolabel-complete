import React, { useEffect, useRef, useState } from 'react';
import {
  Card, Button, Row, Col, Tag, Typography, Space, Modal, Radio,
  message, Input, List, Image, Popconfirm, Descriptions, Statistic, Empty, Divider, Tooltip
} from 'antd';
import {
  DownloadOutlined, DeleteOutlined, EyeOutlined, SearchOutlined,
  FileZipOutlined, UserOutlined, CalendarOutlined, NumberOutlined, PictureOutlined
} from '@ant-design/icons';
import { reqGetSampleSetList, reqDeleteSampleSet, reqExportSampleSet, reqGetSampleSliceList } from '@/services/sampleSet/api';
import { getCookie } from '@/utils/cookie';
import moment from 'moment';

const { Meta } = Card;
const { Text, Title } = Typography;

// 类别颜色池
const CATEGORY_COLORS = [
  '#ff4d4f','#fa8c16','#fadb14','#52c41a','#13c2c2',
  '#1890ff','#722ed1','#eb2f96','#f5222d','#fa541c',
];
const getCategoryColor = (name) => {
  if (!name) return '#1890ff';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length];
};

const withPreviewToken = (url) => {
  const token = getCookie('TOKEN');
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
};

// slice 文件名 → mask 文件名：slice_1_0.jpg → mask_1_0.png
const toMaskFileName = (sliceFileName) => {
  if (!sliceFileName) return null;
  return sliceFileName.replace(/^slice_/, 'mask_').replace(/\.jpg$/i, '.png');
};

// ── 带标注框的切片图片组件（目标检测用）──────────────────────────────────────
const AnnotatedSliceImage = ({ src, annotations = [] }) => {
  const containerRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const [imgNatW, setImgNatW] = React.useState(0);
  const [imgNatH, setImgNatH] = React.useState(0);
  const [imgLoaded, setImgLoaded] = React.useState(false);

  const drawAnnotations = React.useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !imgLoaded || annotations.length === 0) return;
    const displayW = container.offsetWidth;
    const displayH = container.offsetHeight;
    canvas.width = displayW;
    canvas.height = displayH;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, displayW, displayH);
    const scaleX = displayW / (imgNatW || displayW);
    const scaleY = displayH / (imgNatH || displayH);
    annotations.forEach(({ bbox, category }) => {
      if (!bbox || bbox.length < 4) return;
      const [x, y, w, h] = bbox;
      const color = getCategoryColor(category);
      const rx = x * scaleX, ry = y * scaleY, rw = w * scaleX, rh = h * scaleY;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rx, ry, rw, rh);
      if (category) {
        ctx.fillStyle = color;
        const fontSize = Math.max(8, Math.min(11, displayW / 12));
        ctx.font = `${fontSize}px sans-serif`;
        const textW = ctx.measureText(category).width + 4;
        const labelY = ry > fontSize + 2 ? ry - 2 : ry + rh + fontSize + 2;
        ctx.fillRect(rx, labelY - fontSize, textW, fontSize + 2);
        ctx.fillStyle = '#fff';
        ctx.fillText(category, rx + 2, labelY);
      }
    });
  }, [imgLoaded, annotations, imgNatW, imgNatH]);

  React.useEffect(() => { drawAnnotations(); }, [drawAnnotations]);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <img src={src} alt="slice"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        onLoad={(e) => { setImgNatW(e.target.naturalWidth); setImgNatH(e.target.naturalHeight); setImgLoaded(true); }}
        onError={() => setImgLoaded(false)}
      />
      <canvas ref={canvasRef}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      />
    </div>
  );
};

// ── 地物分类封面格子：左半原图 + 右半彩色 mask 叠加 ──────────────────────────
const SegCoverCell = ({ imgSrc, maskSrc }) => {
  const canvasRef = React.useRef(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgSrc || !maskSrc) return;
    const ctx = canvas.getContext('2d');
    const img = new window.Image();
    const mask = new window.Image();
    img.crossOrigin = 'anonymous';
    mask.crossOrigin = 'anonymous';

    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      mask.onload = () => {
        // 将灰度 mask 转为彩色叠加
        const offscreen = document.createElement('canvas');
        offscreen.width = mask.naturalWidth;
        offscreen.height = mask.naturalHeight;
        const octx = offscreen.getContext('2d');
        octx.drawImage(mask, 0, 0);
        const imageData = octx.getImageData(0, 0, offscreen.width, offscreen.height);
        const d = imageData.data;
        // 将非零像素映射为彩色（按灰度值选色）
        for (let i = 0; i < d.length; i += 4) {
          const gray = d[i];
          if (gray > 0) {
            const colorIdx = (gray - 1) % CATEGORY_COLORS.length;
            const hex = CATEGORY_COLORS[colorIdx];
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            d[i] = r; d[i+1] = g; d[i+2] = b; d[i+3] = 180; // 半透明
          } else {
            d[i+3] = 0; // 背景透明
          }
        }
        octx.putImageData(imageData, 0, 0);
        // 缩放到 canvas 尺寸后叠加
        ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
      };
      mask.src = maskSrc;
    };
    img.src = imgSrc;
  }, [imgSrc, maskSrc]);

  return (
    <canvas ref={canvasRef}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  );
};

// ── 地物分类预览格子：上方原图 + 下方彩色 mask ────────────────────────────────
const SegPreviewCell = ({ imgSrc, maskSrc, fileName, datasetId }) => {
  const maskCanvasRef = React.useRef(null);

  React.useEffect(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas || !maskSrc) return;
    const mask = new window.Image();
    mask.crossOrigin = 'anonymous';
    mask.onload = () => {
      canvas.width = mask.naturalWidth;
      canvas.height = mask.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(mask, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const gray = d[i];
        if (gray > 0) {
          const colorIdx = (gray - 1) % CATEGORY_COLORS.length;
          const hex = CATEGORY_COLORS[colorIdx];
          d[i]   = parseInt(hex.slice(1, 3), 16);
          d[i+1] = parseInt(hex.slice(3, 5), 16);
          d[i+2] = parseInt(hex.slice(5, 7), 16);
          d[i+3] = 220;
        } else {
          d[i+3] = 30; // 背景极淡
        }
      }
      ctx.putImageData(imageData, 0, 0);
    };
    mask.src = maskSrc;
  }, [maskSrc]);

  return (
    <div style={{ border: '1px solid #f0f0f0', borderRadius: 4, overflow: 'hidden', background: '#fafafa' }}>
      {/* 上：原图 */}
      <div style={{ height: 100, overflow: 'hidden' }}>
        <img src={imgSrc} alt="原图"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
      {/* 下：彩色 mask */}
      <div style={{ height: 100, overflow: 'hidden', background: '#1a1a2e' }}>
        <canvas ref={maskCanvasRef}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
      <div style={{ fontSize: 10, color: '#999', textAlign: 'center', padding: '3px 4px',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {fileName}
      </div>
    </div>
  );
};

export default function DatasetReleaseManage({ currentState = {} }) {
  // ... (原有的状态保持不变) ...
  const [loading, setLoading] = useState(false);
  const [datasetList, setDatasetList] = useState([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchText, setSearchText] = useState('');
  const searchReadyRef = useRef(false);

  const [downloadModalVisible, setDownloadModalVisible] = useState(false);
  const [currentDataset, setCurrentDataset] = useState(null);
  const [exportFormat, setExportFormat] = useState('COCO');
  const [downloading, setDownloading] = useState(false);

  // [修改] 预览 Modal 状态
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  // [新增] 预览切片列表，每项 {fileName, annotations:[]}
  const [previewSlices, setPreviewSlices] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  // [新增] 封面切片缓存 datasetId -> [{fileName, annotations}]
  const [coverSlicesMap, setCoverSlicesMap] = useState({});

// 2. 加载数据
  useEffect(() => {
    fetchDatasets(1, '');
    searchReadyRef.current = true;
  }, []);

  useEffect(() => {
    if (!searchReadyRef.current) return;
    const timer = setTimeout(() => {
      fetchDatasets(1, searchText);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const fetchDatasets = async (page = 1, keyword = searchText) => {
    setLoading(true);
    try {
      const params = {
        current: page,
        pageSize: 12,
        name: keyword,
      };
      const res = await reqGetSampleSetList(params);
      if (res && res.code === 200) {
        const records = res.data?.records || [];
        setDatasetList(records);
        setTotal(res.data?.total || 0);
        setCurrentPage(page);
        // 异步拉取每个数据集的封面切片（4张）
        records.forEach(async (item) => {
          try {
            const r = await reqGetSampleSliceList({ id: item.id, limit: 4 });
            if (r && r.code === 200) {
              setCoverSlicesMap(prev => ({ ...prev, [item.id]: r.data || [] }));
            }
          } catch (_) {}
        });
      } else {
        setDatasetList([]);
      }
    } catch (error) {
      console.error(error);
      message.error('获取样本集列表失败');
    } finally {
      setLoading(false);
    }
  };

  // 3. 删除逻辑
  const handleDelete = async (id) => {
    try {
      const res = await reqDeleteSampleSet([id]);
      if (res.code === 200) {
        message.success('样本集已删除');
        fetchDatasets(currentPage);
      } else {
        message.error(res.message || '删除失败');
      }
    } catch (error) {
      message.error('删除请求出错');
    }
  };

  // 4. 打开下载弹窗
  const openDownloadModal = (dataset) => {
    setCurrentDataset(dataset);
    setExportFormat('COCO');
    setDownloadModalVisible(true);
  };

  // 5. 【关键】处理下载逻辑 (必须定义在这里)
  const handleDownload = async () => {
    if (!currentDataset) return;
    setDownloading(true);
    const hide = message.loading(`正在打包 ${exportFormat} 格式，请稍候...`, 0);

    try {
      const res = await reqExportSampleSet({
        id: currentDataset.id,
        format: exportFormat,
      });
      const payload = res?.data || res;
      if (!payload?.downloadUrl) {
        message.error(res?.message || '下载失败');
      } else {
        window.open(payload.downloadUrl, '_blank', 'noopener,noreferrer');
        message.success('下载成功');
        setDownloadModalVisible(false);
      }
    } catch (error) {
      console.error(error);
      message.error('下载请求失败');
    } finally {
      hide();
      setDownloading(false);
    }
  };

  // [修改] 打开预览逻辑：改为 Modal 并请求切片列表
  const openPreviewModal = async (dataset) => {
    setCurrentDataset(dataset);
    setPreviewModalVisible(true);
    setPreviewSlices([]);
    setPreviewLoading(true);
    try {
      const res = await reqGetSampleSliceList({ id: dataset.id, limit: 8 });
      if (res && res.code === 200) {
        // 新格式：[{fileName, annotations:[]}]
        setPreviewSlices(res.data || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setPreviewLoading(false);
    }
  };

  // 获取切片图片的完整 URL (后端需提供静态资源映射或流接口)
  // 假设后端接口为 /wegismarkapi/sampleSet/image?path=xxx
  const getSliceImageUrl = (fileName) => {
    if (!currentDataset || !fileName) return '';
    return withPreviewToken(`/wegismarkapi/sampleSet/image/preview?datasetId=${currentDataset.id}&fileName=${encodeURIComponent(fileName)}`);
  };

  // --- 渲染 ---
  return (
    <div style={{ padding: '20px', height: '100%', backgroundColor: '#f0f2f5', display: 'flex', flexDirection: 'column' }}>

      {/* 顶部搜索栏 (保持不变) */}
      <Card bodyStyle={{ padding: '16px 24px' }} style={{ marginBottom: 20 }}>
        {/* ... */}
        <Row justify="space-between" align="middle">
          <Col>
            <Title level={4} style={{ margin: 0 }}>样本集仓库</Title>
          </Col>
          <Col>
            <Space>
              <Input
                placeholder="搜索数据集名称"
                allowClear
                prefix={<SearchOutlined />}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                style={{ width: 300 }}
              />
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 数据集卡片列表 */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 20 }}>
        <List
          // [修改 1] 调整栅格布局：
          // md: 2 (中屏一行2个)
          // lg: 3 (大屏一行3个)
          // xl: 3 (超大屏一行3个，原来是4个太挤了)
          // xxl: 4 (巨幕一行4个)
          grid={{ gutter: 24, xs: 1, sm: 1, md: 2, lg: 3, xl: 3, xxl: 4 }}

          dataSource={datasetList}
          loading={loading}
          pagination={{
            current: currentPage, pageSize: 12, total: total,
            onChange: (page) => fetchDatasets(page), align: 'center'
          }}
          renderItem={(item) => (
            <List.Item>
              <Card
                hoverable
                style={{ borderRadius: 8, overflow: 'hidden' }}
                bodyStyle={{ padding: '12px 20px' }}
                cover={
                  <div style={{
                    height: 160,
                    backgroundColor: '#fafafa',
                    display: 'flex', justifyContent: 'center', alignItems: 'center',
                    borderBottom: '1px solid #f0f0f0', cursor: 'pointer',
                    position: 'relative', overflow: 'hidden',
                  }} onClick={() => openPreviewModal(item)}>
                    {/* 封面：4张随机切片+标注框 2x2 网格 */}
                    {coverSlicesMap[item.id] && coverSlicesMap[item.id].length > 0 ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 1, width: '100%', height: '100%' }}>
                        {coverSlicesMap[item.id].slice(0, 4).map((slice, idx) => {
                          const imgUrl = withPreviewToken(`/wegismarkapi/sampleSet/image/preview?datasetId=${item.id}&fileName=${encodeURIComponent(slice.fileName)}`);
                          const maskFileName = toMaskFileName(slice.fileName);
                          const maskUrl = maskFileName
                            ? withPreviewToken(`/wegismarkapi/sampleSet/mask/preview?datasetId=${item.id}&fileName=${encodeURIComponent(maskFileName)}`)
                            : null;
                          return item.taskType === '地物分类' ? (
                            <SegCoverCell key={idx} imgSrc={imgUrl} maskSrc={maskUrl} />
                          ) : (
                            <AnnotatedSliceImage key={idx} src={imgUrl} annotations={slice.annotations || []} />
                          );
                        })}
                      </div>
                    ) : (
                      <PictureOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />
                    )}
                    <div style={{ position: 'absolute', bottom: 5, right: 10 }}>
                      <Tag color="cyan">{item.width || '?'} x {item.height || '?'}</Tag>
                    </div>
                  </div>
                }
                // [修改 2] 优化按钮：使用 Tooltip + Icon，解决重叠问题
                actions={[
                  <Tooltip title="预览详情">
                    <div onClick={() => openPreviewModal(item)} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                      <EyeOutlined key="view" style={{ fontSize: 16 }} />
                    </div>
                  </Tooltip>,

                  <Tooltip title="导出下载">
                    <div onClick={() => openDownloadModal(item)} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                      <DownloadOutlined key="download" style={{ fontSize: 16 }} />
                    </div>
                  </Tooltip>,

                  <Popconfirm title="确认删除此数据集？" onConfirm={() => handleDelete(item.id)}>
                    <Tooltip title="删除">
                      <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                        <DeleteOutlined key="delete" style={{ color: '#ff4d4f', fontSize: 16 }} />
                      </div>
                    </Tooltip>
                  </Popconfirm>
                ]}
              >
                <Meta
                  title={
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span title={item.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>
                        {item.name}
                      </span>
                      <Space size={4}>
                        <Tag color={item.isPublic ? 'green' : 'default'} style={{ marginRight: 0 }}>
                          {item.isPublic ? '公开' : '私有'}
                        </Tag>
                        <Tag color="blue" style={{ marginRight: 0 }}>{item.taskType || 'DET'}</Tag>
                      </Space>
                    </div>
                  }
                  description={
                    <Space direction="vertical" size={2} style={{ width: '100%', fontSize: 13, marginTop: 8 }}>
                      <div style={{display:'flex', alignItems:'center', color: '#000'}}>
                        <UserOutlined style={{marginRight: 6}}/> {item.creator || 'System'}
                      </div>
                      <div style={{display:'flex', alignItems:'center', color: '#000'}}>
                        <CalendarOutlined style={{marginRight: 6}}/> {item.createDate ? moment(item.createDate).format('YYYY-MM-DD') : '-'}
                      </div>
                      <div style={{ marginTop: 4, color: '#000' }}>
                        <NumberOutlined style={{marginRight: 6}}/> 样本量: <b style={{color: '#1890ff'}}>{item.num}</b>
                      </div>
                    </Space>
                  }
                />
              </Card>
            </List.Item>
          )}
        />
      </div>

      <Modal
        title={currentDataset ? `详情: ${currentDataset.name}` : '数据集详情'}
        open={previewModalVisible}
        onCancel={() => setPreviewModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setPreviewModalVisible(false)}>关闭</Button>,
          <Button key="download" type="primary" icon={<DownloadOutlined />} onClick={() => { setPreviewModalVisible(false); openDownloadModal(currentDataset); }}>
            去下载
          </Button>
        ]}
        width={currentDataset?.taskType === '地物分类' ? 900 : 700}
        centered
      >
        {currentDataset && (
          <div>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="创建人">{currentDataset.creator}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{moment(currentDataset.createDate).format('YYYY-MM-DD')}</Descriptions.Item>
              <Descriptions.Item label="样本总数">{currentDataset.num} 张</Descriptions.Item>
              <Descriptions.Item label="图像尺寸">{currentDataset.width} x {currentDataset.height}</Descriptions.Item>
              <Descriptions.Item label="包含类别" span={2}>
                {currentDataset.type ? currentDataset.type.split(',').map(t => <Tag key={t}>{t}</Tag>) : '无'}
              </Descriptions.Item>
              <Descriptions.Item label="描述备注" span={2}>{currentDataset.description || '无'}</Descriptions.Item>
            </Descriptions>

            <Divider orientation="left" style={{margin: '16px 0'}}>
              切片随机预览 (Top 8)
              {currentDataset.taskType === '地物分类' && (
                <span style={{ marginLeft: 8, fontSize: 12, color: '#888' }}>
                  上：原图 / 下：彩色掩码
                </span>
              )}
            </Divider>

            <div style={{ minHeight: 120 }}>
              {previewLoading ? (
                <div style={{textAlign:'center', padding: 30}}>加载中...</div>
              ) : (
                previewSlices.length > 0 ? (
                  <Row gutter={[12, 12]}>
                    {previewSlices.map((slice, index) => {
                      const imgUrl = getSliceImageUrl(slice.fileName);
                      const maskFileName = toMaskFileName(slice.fileName);
                      const maskUrl = maskFileName
                        ? withPreviewToken(`/wegismarkapi/sampleSet/mask/preview?datasetId=${currentDataset.id}&fileName=${encodeURIComponent(maskFileName)}`)
                        : null;

                      return (
                        <Col span={currentDataset.taskType === '地物分类' ? 6 : 6} key={index}>
                          {currentDataset.taskType === '地物分类' ? (
                            <SegPreviewCell
                              imgSrc={imgUrl}
                              maskSrc={maskUrl}
                              fileName={slice.fileName}
                              datasetId={currentDataset.id}
                            />
                          ) : (
                            <>
                              <div style={{
                                border: '1px solid #f0f0f0', borderRadius: 4, overflow: 'hidden',
                                height: 120, background: '#fafafa'
                              }}>
                                <AnnotatedSliceImage src={imgUrl} annotations={slice.annotations || []} />
                              </div>
                              <div style={{fontSize: 10, color: '#999', textAlign:'center', marginTop: 4,
                                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                                {slice.fileName}
                              </div>
                            </>
                          )}
                        </Col>
                      );
                    })}
                  </Row>
                ) : (
                  <Empty description="暂无预览图片" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* 下载 Modal */}
      <Modal
        title={<span><FileZipOutlined /> 数据集导出配置</span>}
        open={downloadModalVisible}
        onCancel={() => setDownloadModalVisible(false)}
        onOk={handleDownload}
        confirmLoading={downloading}
        okText="开始打包下载"
        width={450}
      >
        <Descriptions column={1} size="small" bordered style={{ marginBottom: 20 }}>
          <Descriptions.Item label="数据集">{currentDataset?.name}</Descriptions.Item>
          <Descriptions.Item label="样本数量">{currentDataset?.num} 张</Descriptions.Item>
          <Descriptions.Item label="图像尺寸">{currentDataset?.width} x {currentDataset?.height}</Descriptions.Item>
        </Descriptions>

        <div style={{ fontWeight: 'bold', marginBottom: 10 }}>目标格式：</div>
        <Radio.Group onChange={(e) => setExportFormat(e.target.value)} value={exportFormat} style={{ width: '100%' }}>
          <Space direction="vertical">
            <Radio value="COCO">COCO 格式 (.json) <Tag style={{marginLeft:10}}>原生</Tag></Radio>
            <Radio value="YOLO">YOLO 格式 (.txt) <Tag color="orange" style={{marginLeft:10}}>自动转换</Tag></Radio>
            <Radio value="VOC">VOC 格式 (.xml) <Tag color="orange" style={{marginLeft:10}}>自动转换</Tag></Radio>
            <Radio value="DML">Training-DML-AI (.json) <Tag color="green" style={{marginLeft:10}}>国产标准</Tag></Radio>
          </Space>
        </Radio.Group>
      </Modal>
    </div>
  );
}
