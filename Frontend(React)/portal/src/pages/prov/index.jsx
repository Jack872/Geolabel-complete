import React, { useState, useEffect } from 'react';
import { useIntl } from 'umi';
import { Row, Col, Card, Tabs, Descriptions, Badge, Empty, Button, Upload, Space, Tag, Typography, List, Spin, message, Tooltip } from 'antd';
import {
  NodeIndexOutlined,
  FileSearchOutlined,
  CloudSyncOutlined,
  UploadOutlined,
  DatabaseOutlined,
  HistoryOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';

// 导入接口
import { reqGetDatasetList, reqGetDatasetProv } from '@/services/prov/api';

import ProvenanceGraph from './components/ProvenanceGraph';
import ProvTimeline from './components/ProvTimeline';
import DetailsPanel from './components/DetailsPanel';
import './style.less';

const { Title, Text } = Typography;
const { TabPane } = Tabs;

const getRouteFocusContext = () => {
  const params = new URLSearchParams(window.location.search || '');
  return {
    datasetId: params.get('datasetId'),
    focusEntityType: params.get('focusEntityType'),
    focusEntityId: params.get('focusEntityId'),
    fromReportId: params.get('fromReportId'),
  };
};

const buildEntityNodeDetail = (entity) => ({
  id: entity?.id,
  originType: 'ENTITY',
  rawData: entity,
});

const findFocusedTaskNode = (provData, focusEntityType, focusEntityId) => {
  if (!provData || focusEntityType !== 'TASK' || !focusEntityId) {
    return null;
  }
  const target = String(focusEntityId);
  const entity = (provData.entities || []).find((item) => (
    String(item?.entityType || '').toUpperCase() === 'TASK'
      && (String(item?.businessId || '') === target || String(item?.id || '') === target)
  ));
  if (!entity) {
    return null;
  }
  return {
    nodeId: entity.id,
    detail: buildEntityNodeDetail(entity),
  };
};

const SampleSetProvenance = () => {
  const intl = useIntl();
  const t = (id, defaultMessage, values) => intl.formatMessage({ id, defaultMessage }, values);
  const routeContext = getRouteFocusContext();
  const [activeTab, setActiveTab] = useState('graph');
  const [loadingList, setLoadingList] = useState(false);
  const [loadingProv, setLoadingProv] = useState(false);

  const [datasetList, setDatasetList] = useState([]); // 样本集列表
  const [selectedSet, setSelectedSet] = useState(null); // 当前选中的样本集详情
  const [provData, setProvData] = useState(null); // 溯源图数据
  const [selectedNode, setSelectedNode] = useState(null); // 图中选中的节点
  const [focusedNodeId, setFocusedNodeId] = useState(null);
  const [routeFocusActive, setRouteFocusActive] = useState(Boolean(routeContext.focusEntityType && routeContext.focusEntityId));

  // 1. 获取样本集列表
  const fetchDatasetList = async () => {
    setLoadingList(true);
    try {
      const res = await reqGetDatasetList({ pageNum: 1, pageSize: 100 });
      if (res && res.data) {
        // 假设返回结构是 { data: { list: [] } } 或 { data: [] }
        const list = Array.isArray(res.data.records) ? res.data.records : (res.data.list || []);
        setDatasetList(list);
      }
    } catch (e) {
      message.error(t('prov.fetch.failed', '获取样本集列表失败'));
    } finally {
      setLoadingList(false);
    }
  };

  // 2. 获取选中样本集的溯源信息
  const fetchProvenance = async (id) => {
    setLoadingProv(true);
    setSelectedNode(null);
    setFocusedNodeId(null);
    try {
      const res = await reqGetDatasetProv(id);
      if (res && res.data) {
        setProvData(res.data);
      } else {
        setProvData(null);
        message.info(t('prov.empty.record', '该样本集暂无溯源记录'));
      }
    } catch (e) {
      message.error(t('prov.sync.failed', '同步溯源信息失败'));
    } finally {
      setLoadingProv(false);
    }
  };

  // 3. 处理文件导入 (识别下载的 JSON)
  const handleImportJson = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const jsonData = JSON.parse(e.target.result);
        setProvData(jsonData);
        setSelectedNode(null);
        message.success(t('prov.import.success', '离线文件识别成功'));
      } catch (err) {
        message.error(t('prov.import.invalid', '无效的 JSON 文件'));
      }
    };
    reader.readAsText(file);
    return false;
  };

  // 初始化加载列表
  useEffect(() => {
    fetchDatasetList();
  }, []);

  useEffect(() => {
    if (!routeContext.datasetId || datasetList.length === 0 || selectedSet) {
      return;
    }
    const matched = datasetList.find((item) => String(item?.id) === String(routeContext.datasetId));
    const nextSelected = matched || { id: Number(routeContext.datasetId), name: `样本集 #${routeContext.datasetId}` };
    setSelectedSet(nextSelected);
    fetchProvenance(routeContext.datasetId);
  }, [datasetList, routeContext.datasetId, selectedSet]);

  useEffect(() => {
    if (!provData) {
      return;
    }
    if (routeFocusActive && routeContext.focusEntityType && routeContext.focusEntityId) {
      const focused = findFocusedTaskNode(provData, routeContext.focusEntityType, routeContext.focusEntityId);
      if (focused) {
        setActiveTab('graph');
        setSelectedNode(focused.detail);
        setFocusedNodeId(focused.nodeId);
        setRouteFocusActive(false);
        return;
      }
      setRouteFocusActive(false);
      message.info(t('prov.focus.missing', '已打开样本集溯源图，但未找到报告指定的任务节点'));
    }
  }, [provData, routeContext.focusEntityId, routeContext.focusEntityType, routeFocusActive]);

  return (
    <div className="prov-container">
      <Row gutter={16}>
        {/* 左侧：样本集选择列表 */}
        <Col span={5}>
          <Card
            title={
              <span>
                <DatabaseOutlined /> {t('prov.dataset.list', '样本集列表')}
                <Tooltip title={t('prov.dataset.tip', '选择要查看溯源信息的数据集')}>
                  <InfoCircleOutlined style={{ marginLeft: 8, color: '#999' }} />
                </Tooltip>
              </span>
            }
            bordered={false}
            className="dataset-list"
          >
            <Spin spinning={loadingList}>
              <List
                dataSource={datasetList}
                renderItem={item => (
                  <List.Item
                    className={`dataset-item ${selectedSet?.id === item.id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedSet(item);
                      fetchProvenance(item.id);
                    }}
                  >
                    <List.Item.Meta
                      className="dataset-meta"
                      title={<Text strong>{item.name}</Text>}
                      description={`${item.taskType} | ${item.num}${t('prov.slice', '切片')}`}
                    />
                  </List.Item>
                )}
              />
            </Spin>
          </Card>
        </Col>

        {/* 右侧：溯源工作区 */}
        <Col span={19}>
          <div className="prov-workspace">
            {selectedSet ? (
              <>
                {/* 样本集基础信息 */}
                <Card bordered={false} className="prov-header">
                  <Row justify="space-between" align="middle">
                    <Col span={18}>
                      <div className="prov-title">
                        <HistoryOutlined />
                        {t('prov.archive', '{name} 数据溯源档案', { name: selectedSet.name })}
                        <Tooltip title={t('prov.model.tip', '基于PROV-DM模型的数据血缘追踪')}>
                          <Tag color="blue" style={{ marginLeft: 8, fontSize: '10px' }}>PROV-DM</Tag>
                        </Tooltip>
                        {routeContext.fromReportId ? (
                          <Tag color="gold" style={{ marginLeft: 8, fontSize: '10px' }}>
                            {t('prov.fromReport', '来自质量报告 #{id}', { id: routeContext.fromReportId })}
                          </Tag>
                        ) : null}
                      </div>
                      <Descriptions column={3} size="small" style={{ marginTop: 12 }}>
                        <Descriptions.Item label={t('prov.creator', '创建者')}>{selectedSet.creator}</Descriptions.Item>
                        <Descriptions.Item label={t('prov.createDate', '创建日期')}>{selectedSet.createDate}</Descriptions.Item>
                        <Descriptions.Item label={t('prov.crs', '坐标系')}>{selectedSet.crs}</Descriptions.Item>
                      </Descriptions>
                    </Col>
                    <Col span={6} style={{ textAlign: 'right' }}>
                      <Space className="prov-actions">
                        <Upload beforeUpload={handleImportJson} showUploadList={false}>
                          <Button icon={<UploadOutlined />}>{t('prov.import', '导入离线文件')}</Button>
                        </Upload>
                        <Button type="primary" ghost onClick={() => fetchProvenance(selectedSet.id)}>
                          {t('prov.refresh', '刷新溯源')}
                        </Button>
                      </Space>
                    </Col>
                  </Row>
                </Card>

                {/* 图谱与详情 */}
                <Row gutter={16} className="prov-content">
                  <Col span={16}>
                    <Card
                      bordered={false}
                      className="prov-main"
                      tabList={[
                        { 
                          key: 'graph', 
                          tab: (
                            <span>
                              <NodeIndexOutlined /> {t('prov.graph', '关系图谱')}
                              <Tooltip title={t('prov.graph.tip', '显示实体(Entity)、活动(Activity)、代理(Agent)之间的依赖关系')}>
                                <InfoCircleOutlined style={{ marginLeft: 4, fontSize: '12px' }} />
                              </Tooltip>
                            </span>
                          )
                        },
                        { 
                          key: 'timeline', 
                          tab: (
                            <span>
                              <FileSearchOutlined /> {t('prov.timeline', '时间轴视图')}
                              <Tooltip title={t('prov.timeline.tip', '按时间顺序展示所有溯源活动')}>
                                <InfoCircleOutlined style={{ marginLeft: 4, fontSize: '12px' }} />
                              </Tooltip>
                            </span>
                          )
                        },
                      ]}
                      activeTabKey={activeTab}
                      onTabChange={setActiveTab}
                    >
                      <Spin spinning={loadingProv}>
                        {provData ? (
                          activeTab === 'graph' ? (
                            <ProvenanceGraph
                              data={provData}
                              onNodeClick={(node) => {
                                setSelectedNode(node);
                                setFocusedNodeId(node?.id || null);
                              }}
                              focusedNodeId={focusedNodeId}
                            />
                          ) : (
                            <ProvTimeline data={provData} onNodeClick={setSelectedNode} />
                          )
                        ) : <Empty style={{ marginTop: 100 }} description={t('prov.empty.data', '暂无溯源数据')} />}
                      </Spin>
                    </Card>
                  </Col>
                  <Col span={8}>
                    <DetailsPanel detail={selectedNode} className="prov-details" />
                  </Col>
                </Row>
              </>
            ) : (
              <Card className="empty-state">
                <Empty description={t('prov.empty.select', '请从左侧选择一个样本集以查看其全链路溯源信息')} />
              </Card>
            )}
          </div>
        </Col>
      </Row>
    </div>
  );
};

export default SampleSetProvenance;
