import React, { useEffect, useMemo, useState } from 'react';
import moment from 'moment';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  List,
  message,
  Modal,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  PrinterOutlined,
  ProfileOutlined,
  WarningOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';
import { history } from 'umi';
import { reqGetQualityReport, reqGetQualityReportHtml } from '@/services/quality/api';
import { QUALITY_SOURCE_COLORS, QUALITY_SOURCE_LABELS, DIMENSION_STATUS_LABELS, METRIC_STATUS_LABELS } from '../config';
import '../style.less';

const { Paragraph, Text } = Typography;

const getStatusColor = (status) => {
  if (status === 'pass' || status === 'good') return 'green';
  if (status === 'warning' || status === 'signal_only') return 'gold';
  if (status === 'fail' || status === 'risk') return 'red';
  return 'default';
};

const TASK_STATUS_META = {
  0: { label: '审核中', color: 'processing' },
  1: { label: '审核通过', color: 'success' },
  2: { label: '审核驳回', color: 'error' },
  3: { label: '未提交', color: 'default' },
};

const QualityReportDetailPage = (props) => {
  const reportId = props?.match?.params?.reportId;
  const [loading, setLoading] = useState(false);
  const [reportDetail, setReportDetail] = useState(null);
  const [reportPreviewVisible, setReportPreviewVisible] = useState(false);
  const [reportPreviewHtml, setReportPreviewHtml] = useState('');
  const reportResult = useMemo(() => reportDetail?.result || {}, [reportDetail]);
  const sampleSetInfo = useMemo(() => reportResult?.sampleSetBasicInfo || {}, [reportResult]);
  const dimensions = useMemo(
    () => reportResult?.dimensionResults || reportResult?.dimensions || [],
    [reportResult],
  );
  const sampleSetId = sampleSetInfo.sampleSetId || reportDetail?.sampleSetId;
  const sourceTasks = useMemo(() => {
    if (Array.isArray(sampleSetInfo?.sourceTasks) && sampleSetInfo.sourceTasks.length > 0) {
      return sampleSetInfo.sourceTasks;
    }
    if (Array.isArray(sampleSetInfo?.sourceTaskIds)) {
      return sampleSetInfo.sourceTaskIds.map((taskId) => ({ taskId }));
    }
    return [];
  }, [sampleSetInfo]);

  useEffect(() => {
    const fetchReportDetail = async () => {
      if (!reportId) return;
      setLoading(true);
      try {
        const res = await reqGetQualityReport(reportId);
        setReportDetail(res?.data || null);
      } catch (error) {
        message.error('获取质量报告详情失败');
      } finally {
        setLoading(false);
      }
    };
    fetchReportDetail();
  }, [reportId]);

  const handleDownloadReportJson = async () => {
    if (!reportId) return;
    try {
      const res = await reqGetQualityReport(reportId);
      const blob = new Blob([JSON.stringify(res?.data || {}, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `quality-report-${reportId}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      message.error('导出 JSON 报告失败');
    }
  };

  const handlePreviewOrPrintReport = async () => {
    if (!reportId) return;
    try {
      const html = await reqGetQualityReportHtml(reportId);
      setReportPreviewHtml(html);
      setReportPreviewVisible(true);
    } catch (error) {
      message.error('获取 HTML 报告失败');
    }
  };

  const handlePrintPreview = () => {
    if (!reportPreviewHtml) return;
    const printWindow = window.open('', '_blank', 'width=1200,height=900');
    if (!printWindow) {
      message.warning('浏览器阻止了打印窗口，请允许弹窗后重试');
      return;
    }
    printWindow.document.write(reportPreviewHtml);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const buildProvRoute = (taskId) => {
    const params = new URLSearchParams();
    if (sampleSetId) {
      params.set('datasetId', sampleSetId);
    }
    if (taskId) {
      params.set('focusEntityType', 'TASK');
      params.set('focusEntityId', taskId);
    }
    if (reportId) {
      params.set('fromReportId', reportId);
    }
    return `/prov?${params.toString()}`;
  };

  const handleOpenSampleSetProv = () => {
    if (!sampleSetId) {
      message.warning('当前报告未记录样本集信息，暂时无法打开溯源');
      return;
    }
    history.push(buildProvRoute());
  };

  const handleLocateTaskProv = (taskId) => {
    if (!sampleSetId || !taskId) {
      message.warning('当前报告未记录来源任务信息，暂时无法定位溯源');
      return;
    }
    history.push(buildProvRoute(taskId));
  };

  return (
    <div className="quality-container">
      <Spin spinning={loading}>
        {reportDetail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card bordered={false}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
                <div>
                  <Space size={12}>
                    <Button icon={<ArrowLeftOutlined />} onClick={() => history.push('/quality')}>
                      返回工作台
                    </Button>
                    <Tag color="blue">报告 #{reportDetail.id}</Tag>
                  </Space>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 600, marginTop: 14 }}>
                    <ProfileOutlined />
                    <span>{reportResult.profileName || '质量评价报告详情'}</span>
                  </div>
                  <Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 0 }}>
                    本页面展示规则型质量评价结果。参考模型结果仅作为辅助证据，不作为严格真值。
                  </Paragraph>
                </div>
                <Space>
                  <Button icon={<DownloadOutlined />} onClick={handleDownloadReportJson}>
                    下载 JSON
                  </Button>
                  <Button type="primary" icon={<PrinterOutlined />} onClick={handlePreviewOrPrintReport}>
                    预览 / 打印
                  </Button>
                </Space>
              </div>
            </Card>

            <Card bordered={false} title="报告基础信息">
              <Descriptions column={4} size="small">
                <Descriptions.Item label="报告ID">{reportDetail.id}</Descriptions.Item>
                <Descriptions.Item label="样本集ID">{reportDetail.sampleSetId || '-'}</Descriptions.Item>
                <Descriptions.Item label="样本集名称">{sampleSetInfo.sampleSetName || '-'}</Descriptions.Item>
                <Descriptions.Item label="任务类型">{sampleSetInfo.taskType || '-'}</Descriptions.Item>
                <Descriptions.Item label="模板ID">{reportDetail.qualityProfileId || '-'}</Descriptions.Item>
                <Descriptions.Item label="模板名称">{reportResult.profileName || '-'}</Descriptions.Item>
                <Descriptions.Item label="最终建议">{reportResult.finalSuggestion || '-'}</Descriptions.Item>
                <Descriptions.Item label="生成时间">
                  {reportDetail.createdTime ? moment(reportDetail.createdTime).format('YYYY-MM-DD HH:mm:ss') : '-'}
                </Descriptions.Item>
              </Descriptions>
              <Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
                {reportDetail.summary || reportResult.summary || '-'}
              </Paragraph>
            </Card>

            <Card
              bordered={false}
              title="来源任务与溯源定位"
              extra={(
                <Space>
                  <Button icon={<NodeIndexOutlined />} onClick={handleOpenSampleSetProv}>
                    查看样本集全链路溯源
                  </Button>
                  {sourceTasks.length === 1 ? (
                    <Button type="primary" onClick={() => handleLocateTaskProv(sourceTasks[0]?.taskId)}>
                      直接定位到任务溯源
                    </Button>
                  ) : null}
                </Space>
              )}
            >
              <Paragraph type="secondary" style={{ marginBottom: 12 }}>
                质量评价结果基于样本集生成。若要进一步定位低质量问题的来源，可从这里回溯到具体标注任务。
              </Paragraph>
              <Descriptions column={4} size="small" style={{ marginBottom: 12 }}>
                <Descriptions.Item label="来源任务数">{sampleSetInfo.sourceTaskCount || sourceTasks.length || 0}</Descriptions.Item>
                <Descriptions.Item label="样本集ID">{sampleSetId || '-'}</Descriptions.Item>
                <Descriptions.Item label="是否带溯源">{sampleSetInfo.hasProvenance ? '是' : '否'}</Descriptions.Item>
                <Descriptions.Item label="跳转方式">{sourceTasks.length <= 1 ? '可直接定位任务' : '可先看全链路或按任务定位'}</Descriptions.Item>
              </Descriptions>
              {sourceTasks.length > 0 ? (
                <List
                  dataSource={sourceTasks}
                  renderItem={(task) => {
                    const statusMeta = TASK_STATUS_META[task?.status] || { label: task?.status ?? '未知', color: 'default' };
                    return (
                      <List.Item
                        actions={[
                          <Button key="locate" type="link" onClick={() => handleLocateTaskProv(task?.taskId)}>
                            定位到任务溯源
                          </Button>,
                        ]}
                      >
                        <List.Item.Meta
                          title={(
                            <Space wrap>
                              <Text strong>{task?.taskName || `任务 #${task?.taskId || '-'}`}</Text>
                              <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
                              {task?.taskType ? <Tag>{task.taskType}</Tag> : null}
                              {task?.taskSource ? <Tag color="cyan">{task.taskSource}</Tag> : null}
                            </Space>
                          )}
                          description={(
                            <Space wrap size={[8, 8]}>
                              <Text type="secondary">任务ID: {task?.taskId || '-'}</Text>
                              {task?.batchId ? <Text type="secondary">批次: {task.batchId}</Text> : null}
                              {task?.batchIndex ? <Text type="secondary">序号: {task.batchIndex}</Text> : null}
                            </Space>
                          )}
                        />
                      </List.Item>
                    );
                  }}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前报告未记录来源任务清单" />
              )}
            </Card>

            <Card bordered={false} title="参考模型证据（非真值）">
              {reportResult.referenceModel?.enabled ? (
                <Descriptions column={3} size="small">
                  <Descriptions.Item label="模型名称">{reportResult.referenceModel?.modelName || '-'}</Descriptions.Item>
                  <Descriptions.Item label="模型版本">{reportResult.referenceModel?.modelVersion || '-'}</Descriptions.Item>
                  <Descriptions.Item label="可靠性等级">{reportResult.referenceModel?.referenceReliabilityLevel || '-'}</Descriptions.Item>
                  <Descriptions.Item label="coverageRate">{reportResult.referenceModel?.coverageRate ?? '--'}%</Descriptions.Item>
                  <Descriptions.Item label="confidenceMean">{reportResult.referenceModel?.confidenceMean ?? '--'}%</Descriptions.Item>
                  <Descriptions.Item label="lowConfidenceRatio">{reportResult.referenceModel?.lowConfidenceRatio ?? '--'}%</Descriptions.Item>
                  <Descriptions.Item label="sampleCoverageRate">{reportResult.referenceModel?.sampleCoverageRate ?? '--'}%</Descriptions.Item>
                  <Descriptions.Item label="classCoverageRate">{reportResult.referenceModel?.classCoverageRate ?? '--'}%</Descriptions.Item>
                  <Descriptions.Item label="评估样本">
                    {reportResult.referenceModel?.evaluatedSamples ?? '--'} / {reportResult.referenceModel?.totalSamples ?? '--'}
                  </Descriptions.Item>
                </Descriptions>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本次报告未启用参考模型评估" />
              )}
            </Card>

            <Card bordered={false} title="维度结果">
              <Row gutter={[16, 16]}>
                {(dimensions || []).map((dimension) => (
                  <Col span={24} key={dimension.key || dimension.dimensionKey}>
                    <Card size="small" bordered={false} style={{ background: '#fafafa' }}>
                      <Space size={8}>
                        <Text strong>{dimension.dimensionName || dimension.label}</Text>
                        <Tag color={getStatusColor(dimension.status)}>
                          {DIMENSION_STATUS_LABELS[dimension.status] || dimension.status || '未评价'}
                        </Tag>
                      </Space>
                      <Paragraph style={{ marginTop: 8, marginBottom: 8 }}>
                        结论：{dimension.conclusionText || '-'}
                      </Paragraph>
                      <Paragraph style={{ marginBottom: 10 }}>
                        建议：{dimension.suggestionText || '-'}
                      </Paragraph>
                      <TableLikeMetrics dimension={dimension} />
                    </Card>
                  </Col>
                ))}
              </Row>
            </Card>

            <Row gutter={16}>
              <Col span={12}>
                <Card bordered={false} title={<span><WarningOutlined /> 问题清单</span>} style={{ height: '100%' }}>
                  {(reportResult.issues || []).length > 0 ? (
                    <List
                      dataSource={reportResult.issues || []}
                      renderItem={(item) => (
                        <List.Item>
                          <Space direction="vertical" size={2} style={{ width: '100%' }}>
                            <Space>
                              <Tag color={item.level === 'warning' ? 'gold' : item.level === 'error' ? 'red' : 'blue'}>{item.level}</Tag>
                              <Text strong>{item.message}</Text>
                            </Space>
                            <Text type="secondary">{item.dimensionKey} / {item.indicatorKey} / {item.code}</Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  ) : (
                    <Empty description="当前未发现问题" />
                  )}
                </Card>
              </Col>
              <Col span={12}>
                <Card bordered={false} title="自动评价意见" style={{ height: '100%' }}>
                  {(reportResult.opinions || []).length > 0 ? (
                    <List dataSource={reportResult.opinions || []} renderItem={(item, index) => <List.Item><Text>{index + 1}. {item}</Text></List.Item>} />
                  ) : (
                    <Empty description="暂未生成评价意见" />
                  )}
                </Card>
              </Col>
            </Row>
          </Space>
        ) : (
          <Card bordered={false}>
            <Empty description="未找到对应的质量评价报告" />
          </Card>
        )}
      </Spin>

      <Modal
        open={reportPreviewVisible}
        title="质量评价 HTML 报告预览"
        width={1080}
        onCancel={() => setReportPreviewVisible(false)}
        footer={[
          <Button key="close" onClick={() => setReportPreviewVisible(false)}>关闭</Button>,
          <Button key="print" type="primary" icon={<PrinterOutlined />} onClick={handlePrintPreview}>打印</Button>,
        ]}
      >
        <iframe title="quality-report-detail-preview" className="report-preview-frame" srcDoc={reportPreviewHtml} />
      </Modal>
    </div>
  );
};

const TableLikeMetrics = ({ dimension }) => {
  const metrics = dimension.metrics || dimension.indicators || [];
  return (
    <div>
      {(metrics || []).map((metric) => (
        <div key={metric.key || metric.metricKey} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10, marginBottom: 8, background: '#fff' }}>
          <Space wrap size={[8, 8]}>
            <Text strong>{metric.metricName || metric.label}</Text>
            <Tag color={getStatusColor(metric.status)}>{METRIC_STATUS_LABELS[metric.status] || metric.status || '未评价'}</Tag>
            <Tag color={QUALITY_SOURCE_COLORS[metric.sourceType] || 'default'}>
              {QUALITY_SOURCE_LABELS[metric.sourceType] || metric.sourceType || '未知来源'}
            </Tag>
          </Space>
          <div style={{ marginTop: 6 }}><Text type="secondary">计算值：</Text>{metric.value || '--'}</div>
          <div><Text type="secondary">阈值/规则：</Text>{metric.thresholdRule || '--'}</div>
        </div>
      ))}
    </div>
  );
};

export default QualityReportDetailPage;
