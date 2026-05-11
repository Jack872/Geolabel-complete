import React, { useState, useEffect } from 'react';
import { Drawer, Descriptions, Tag, Spin, Alert, Card, Progress, Statistic, Row, Col, Empty } from 'antd';
import { 
  CheckCircleOutlined, 
  ClockCircleOutlined, 
  ThunderboltOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  LineChartOutlined
} from '@ant-design/icons';
import { reqGetModelTrainDetails } from '@/services/map/api';
import './ModelDetailsDrawer.less';

const ModelDetailsDrawer = ({ visible, onClose, modelInfo }) => {
  const [loading, setLoading] = useState(false);
  const [trainDetails, setTrainDetails] = useState(null);

  useEffect(() => {
    if (visible && modelInfo) {
      fetchTrainDetails();
    }
  }, [visible, modelInfo]);

  const fetchTrainDetails = async () => {
    if (!modelInfo || !modelInfo.modelId) {
      return;
    }

    setLoading(true);
    try {
      const response = await reqGetModelTrainDetails({
        model_id: modelInfo.modelId,
        user_id: modelInfo.userId
      });

      if (response && response.code === 200) {
        setTrainDetails(response.data);
      } else {
        console.warn('获取模型训练详情失败:', response);
      }
    } catch (error) {
      console.error('获取模型训练详情异常:', error);
    } finally {
      setLoading(false);
    }
  };

  const modelMeta = modelInfo?.modelMeta && typeof modelInfo.modelMeta === 'object'
    ? modelInfo.modelMeta
    : {};

  const renderTrainMetrics = () => {
    if (!trainDetails || !trainDetails.metrics) {
      return (
        <Empty 
          description="暂无训练指标数据" 
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      );
    }

    const { metrics } = trainDetails;

    return (
      <Card 
        title={
          <span>
            <LineChartOutlined style={{ marginRight: 8 }} />
            训练指标
          </span>
        }
        bordered={false}
        className="metrics-card"
      >
        <Row gutter={[16, 16]}>
          {metrics.accuracy && (
            <Col span={12}>
              <Card className="metric-item">
                <Statistic
                  title="准确率"
                  value={metrics.accuracy}
                  precision={2}
                  suffix="%"
                  valueStyle={{ color: '#3f8600' }}
                />
                <Progress 
                  percent={metrics.accuracy} 
                  strokeColor={{
                    '0%': '#108ee9',
                    '100%': '#87d068',
                  }}
                  showInfo={false}
                />
              </Card>
            </Col>
          )}
          
          {metrics.loss && (
            <Col span={12}>
              <Card className="metric-item">
                <Statistic
                  title="损失值"
                  value={metrics.loss}
                  precision={4}
                  valueStyle={{ color: '#cf1322' }}
                />
              </Card>
            </Col>
          )}

          {metrics.precision && (
            <Col span={12}>
              <Card className="metric-item">
                <Statistic
                  title="精确率"
                  value={metrics.precision}
                  precision={2}
                  suffix="%"
                  valueStyle={{ color: '#1890ff' }}
                />
              </Card>
            </Col>
          )}

          {metrics.recall && (
            <Col span={12}>
              <Card className="metric-item">
                <Statistic
                  title="召回率"
                  value={metrics.recall}
                  precision={2}
                  suffix="%"
                  valueStyle={{ color: '#722ed1' }}
                />
              </Card>
            </Col>
          )}

          {metrics.f1_score && (
            <Col span={12}>
              <Card className="metric-item">
                <Statistic
                  title="F1分数"
                  value={metrics.f1_score}
                  precision={2}
                  suffix="%"
                  valueStyle={{ color: '#eb2f96' }}
                />
              </Card>
            </Col>
          )}

          {metrics.iou && (
            <Col span={12}>
              <Card className="metric-item">
                <Statistic
                  title="IoU"
                  value={metrics.iou}
                  precision={2}
                  suffix="%"
                  valueStyle={{ color: '#fa8c16' }}
                />
              </Card>
            </Col>
          )}
        </Row>
      </Card>
    );
  };

  const renderTrainParams = () => {
    if (!trainDetails || !trainDetails.params) {
      return null;
    }

    const { params } = trainDetails;

    return (
      <Card 
        title={
          <span>
            <ExperimentOutlined style={{ marginRight: 8 }} />
            训练参数
          </span>
        }
        bordered={false}
        className="params-card"
        style={{ marginTop: 16 }}
      >
        <Descriptions column={2} bordered size="small">
          {params.epochs && (
            <Descriptions.Item label="训练轮数">
              <Tag color="blue">{params.epochs}</Tag>
            </Descriptions.Item>
          )}
          {params.batch_size && (
            <Descriptions.Item label="批次大小">
              <Tag color="cyan">{params.batch_size}</Tag>
            </Descriptions.Item>
          )}
          {params.learning_rate && (
            <Descriptions.Item label="学习率">
              <Tag color="purple">{params.learning_rate}</Tag>
            </Descriptions.Item>
          )}
          {params.optimizer && (
            <Descriptions.Item label="优化器">
              <Tag color="green">{params.optimizer}</Tag>
            </Descriptions.Item>
          )}
          {params.img_size && (
            <Descriptions.Item label="图像尺寸">
              <Tag color="orange">{params.img_size}</Tag>
            </Descriptions.Item>
          )}
          {params.conf_threshold && (
            <Descriptions.Item label="置信度阈值">
              <Tag color="red">{params.conf_threshold}</Tag>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>
    );
  };

  return (
    <Drawer
      title={
        <span>
          <DatabaseOutlined style={{ marginRight: 8 }} />
          模型详情 - {modelInfo?.modelName || '未命名'}
        </span>
      }
      width={720}
      open={visible}
      onClose={onClose}
      className="model-details-drawer"
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px 0' }}>
          <Spin size="large" tip="加载模型详情中..." />
        </div>
      ) : (
        <>
          <Card 
            title={
              <span>
                <ThunderboltOutlined style={{ marginRight: 8 }} />
                基本信息
              </span>
            }
            bordered={false}
            className="info-card"
          >
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="模型名称">
                {modelInfo?.modelName || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="模型描述">
                {modelInfo?.modelDes || modelMeta?.description || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="任务类型">
                <Tag color={modelInfo?.taskType === '目标检测' ? 'blue' : 'green'}>
                  {modelInfo?.taskType || '-'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="模型类型">
                <Tag color="purple">{modelInfo?.modelType || '-'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="输入通道数">
                <Tag color="cyan">{modelInfo?.inputNum || '-'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="输出通道数">
                <Tag color="orange">{modelInfo?.outputNum || '-'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="适用类别">
                {Array.isArray(modelMeta?.applicableTypeIds) && modelMeta.applicableTypeIds.length > 0
                  ? modelMeta.applicableTypeIds.map((item) => (
                    <Tag key={item} color="blue">{item}</Tag>
                  ))
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {trainDetails?.createTime || modelInfo?.createTime || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="训练状态">
                {trainDetails?.status === 'completed' ? (
                  <Tag icon={<CheckCircleOutlined />} color="success">
                    训练完成
                  </Tag>
                ) : trainDetails?.status === 'training' ? (
                  <Tag icon={<ClockCircleOutlined />} color="processing">
                    训练中
                  </Tag>
                ) : (
                  <Tag color="default">未知</Tag>
                )}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {renderTrainMetrics()}
          {renderTrainParams()}

          {trainDetails && trainDetails.mapping && (
            <Card 
              title="类别映射"
              bordered={false}
              style={{ marginTop: 16 }}
            >
              <Alert
                message={trainDetails.mapping}
                type="info"
                showIcon
              />
            </Card>
          )}

          {modelMeta?.classMapping && (
            <Card title="上传映射配置" bordered={false} style={{ marginTop: 16 }}>
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {JSON.stringify(modelMeta.classMapping, null, 2)}
              </pre>
            </Card>
          )}

          {modelMeta?.inferParams && (
            <Card title="默认推理参数" bordered={false} style={{ marginTop: 16 }}>
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {JSON.stringify(modelMeta.inferParams, null, 2)}
              </pre>
            </Card>
          )}
        </>
      )}
    </Drawer>
  );
};

export default ModelDetailsDrawer;
