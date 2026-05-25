import React from 'react';
import { Card, Descriptions, Tag, Divider, Empty, Tooltip, Space } from 'antd';
import { ClockCircleOutlined, UserOutlined, InfoCircleOutlined, DatabaseOutlined, SettingOutlined } from '@ant-design/icons';
import moment from 'moment';

// PROV模型实体类型信息
const PROV_MODEL_INFO = {
  'ACTIVITY': {
    label: '活动 (Activity)',
    description: 'PROV模型中的核心概念，表示数据处理、转换或生成的过程',
    color: '#ffa940',
    icon: <SettingOutlined />
  },
  'ENTITY': {
    label: '实体 (Entity)', 
    description: 'PROV模型中的数据对象，可以是文件、数据集、模型等',
    color: '#1890ff',
    icon: <DatabaseOutlined />
  },
  'AGENT': {
    label: '代理 (Agent)',
    description: 'PROV模型中负责执行活动的主体，可以是人员、系统或服务',
    color: '#52c41a',
    icon: <UserOutlined />
  }
};

// 操作类型中文映射
const ACTION_TRANSLATIONS = {
  'UPLOAD': '文件上传',
  'ANNOTATE': '数据标注',
  'AUDIT_PASS': '审核通过',
  'AUDIT_REJECT': '审核驳回',
  'DATASET_GENERATE': '数据集生成',
  'DATASET_EXPORT': '数据集导出',
  'PUBLISH_SERVICE': '发布服务',
  'DATASET_IMPORT': '数据集导入',
  'DATASET_CREATE': '数据集创建', 
  'DATASET_UPDATE': '数据集更新',
  'DATASET_DELETE': '数据集删除',
  'MODEL_TRAIN': '模型训练',
  'MODEL_INFERENCE': '模型推理',
  'DATA_VALIDATION': '数据验证',
  'DATA_PREPROCESSING': '数据预处理',
  'QUALITY_CHECK': '质量检查',
  'AUDIT_LOG': '审计日志',
  'USER_OPERATION': '用户操作',
  'SYSTEM_OPERATION': '系统操作'
};

// 实体类型中文映射
const ENTITY_TRANSLATIONS = {
  'TASK': '标注任务',
  'RAW_IMAGE': '原始影像',
  'SAMPLE_SET': '样本集',
  'ANNOTATION_REVISION': '标注版本',
  'AUDIT_REJECT': '审核记录',
  'DATASET': '数据集',
  'MODEL': '模型文件',
  'ANNOTATION': '标注数据',
  'IMAGE': '图像文件',
  'LABEL': '标签文件',
  'CONFIG': '配置文件',
  'LOG': '日志文件',
  'RESULT': '结果文件'
};

// 格式化时间
const formatDateTime = (dateTimeStr) => {
  if (!dateTimeStr) return '未知时间';
  
  try {
    const date = moment(dateTimeStr);
    if (date.isValid()) {
      return date.format('YYYY年MM月DD日 HH:mm:ss');
    }
    return dateTimeStr;
  } catch (error) {
    return dateTimeStr;
  }
};

// 格式化JSON显示
const formatJsonValue = (obj) => {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  
  try {
    return JSON.stringify(obj, null, 2);
  } catch (error) {
    return String(obj);
  }
};

const DetailsPanel = ({ detail, className }) => {
  if (!detail) {
    return (
      <Card title="节点详情" className={`details-panel ${className || ''}`}>
        <div className="empty-detail">
          <Empty 
            description="点击图谱或时间轴中的节点查看详细信息" 
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </div>
      </Card>
    );
  }

  const { originType, rawData, agentData } = detail;
  const isActivity = originType === 'ACTIVITY';
  const isAgent = originType === 'AGENT';
  const provInfo = PROV_MODEL_INFO[originType] || PROV_MODEL_INFO['ENTITY'];

  // 获取显示标题
  const getDisplayTitle = () => {
    if (isActivity) {
      return ACTION_TRANSLATIONS[rawData.actType] || rawData.actType;
    } else if (isAgent) {
      if (rawData.agentType === 'PERSON') return '用户';
      if (rawData.agentType === 'SOFTWARE') return '软件系统';
      if (rawData.agentType === 'ORGANIZATION') return '组织机构';
      return rawData.agentType || '代理';
    } else {
      return ENTITY_TRANSLATIONS[rawData.entityType] || rawData.entityType;
    }
  };

  // 提取扩展属性
  const extraProps = isActivity ? rawData.parameters : (isAgent ? null : rawData.attributes);
  const hasExtraProps = extraProps && Object.keys(extraProps).length > 0;

  return (
    <Card 
      title={
        <Space>
          {provInfo.icon}
          <span>节点详情</span>
          <Tooltip title={provInfo.description}>
            <InfoCircleOutlined style={{ color: '#999', fontSize: '14px' }} />
          </Tooltip>
        </Space>
      }
      extra={
        <Space>
          <Tag color={provInfo.color} style={{ fontWeight: '500' }}>
            {getDisplayTitle()}
          </Tag>
          <Tag className="prov-model-tag">
            {provInfo.label}
          </Tag>
        </Space>
      }
      className={`details-panel ${className || ''}`}
    >
      {/* 基本信息 */}
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item 
          label={
            <Space>
              <DatabaseOutlined />
              系统ID
            </Space>
          }
        >
          <code style={{ background: '#f5f5f5', padding: '2px 6px', borderRadius: '3px' }}>
            {rawData.id}
          </code>
        </Descriptions.Item>
        
        {rawData.businessId && (
          <Descriptions.Item 
            label={
              <Space>
                <InfoCircleOutlined />
                业务ID
              </Space>
            }
          >
            {rawData.businessId}
          </Descriptions.Item>
        )}
        
        {rawData.label && (
          <Descriptions.Item label="标签名称">
            {rawData.label}
          </Descriptions.Item>
        )}

        {isAgent && rawData.agentName && (
          <Descriptions.Item label="代理名称">
            {rawData.agentName}
          </Descriptions.Item>
        )}

        {isAgent && rawData.externalId && (
          <Descriptions.Item label="外部业务ID">
            {rawData.externalId}
          </Descriptions.Item>
        )}
        
        <Descriptions.Item label="描述信息">
          {rawData.description || '无描述信息'}
        </Descriptions.Item>
        
        <Descriptions.Item 
          label={
            <Space>
              <ClockCircleOutlined />
              {isActivity ? '开始时间' : '创建时间'}
            </Space>
          }
        >
          {formatDateTime(rawData.startTime || rawData.createdAt)}
        </Descriptions.Item>
        
        {isActivity && rawData.endTime && (
          <Descriptions.Item 
            label={
              <Space>
                <ClockCircleOutlined />
                结束时间
              </Space>
            }
          >
            {formatDateTime(rawData.endTime)}
          </Descriptions.Item>
        )}
        
        {isActivity && rawData.endTime && rawData.startTime && (
          <Descriptions.Item label="执行时长">
            <Tag color="blue">
              {moment(rawData.endTime).diff(moment(rawData.startTime), 'seconds')}秒
            </Tag>
          </Descriptions.Item>
        )}
        
        {/* 代理信息 */}
        {isActivity && (rawData.agentId || agentData) && (
          <Descriptions.Item 
            label={
              <Space>
                <UserOutlined />
                执行主体
              </Space>
            }
          >
            <Space>
              <Tag color="green">
                {agentData ? agentData.agentName : rawData.agentId}
              </Tag>
              {agentData && (
                <Tag color="blue" size="small">
                  {agentData.agentType === 'PERSON' ? '👤 用户' : 
                   agentData.agentType === 'SOFTWARE' ? '🤖 软件' : 
                   agentData.agentType === 'ORGANIZATION' ? '🏢 组织' : agentData.agentType}
                </Tag>
              )}
            </Space>
          </Descriptions.Item>
        )}

        {/* 实体位置信息 */}
        {!isActivity && !isAgent && rawData.location && (
          <Descriptions.Item label="数据位置">
            <code style={{ background: '#f5f5f5', padding: '2px 6px', borderRadius: '3px', fontSize: '11px' }}>
              {rawData.location}
            </code>
          </Descriptions.Item>
        )}

        {/* 实体类型 */}
        {!isActivity && !isAgent && rawData.entityType && (
          <Descriptions.Item label="实体类型">
            <Tag color="purple">{rawData.entityType}</Tag>
          </Descriptions.Item>
        )}

        {isAgent && rawData.agentType && (
          <Descriptions.Item label="代理类型">
            <Tag color="green">{rawData.agentType}</Tag>
          </Descriptions.Item>
        )}

        {/* 活动状态 */}
        {isActivity && rawData.status && (
          <Descriptions.Item label="执行状态">
            <Tag color={rawData.status === 'SUCCESS' ? 'green' : 'red'}>
              {rawData.status === 'SUCCESS' ? '✅ 成功' : '❌ 失败'}
            </Tag>
          </Descriptions.Item>
        )}
      </Descriptions>

      {/* PROV模型说明 */}
      <div className="attributes-section">
        <Divider orientation="left" style={{ fontSize: '12px', color: '#666' }}>
          PROV模型信息
        </Divider>
        <div style={{ 
          background: '#f0f9ff', 
          padding: '12px', 
          borderRadius: '6px',
          border: '1px solid #bae6fd',
          fontSize: '12px',
          lineHeight: '1.5'
        }}>
          <div style={{ fontWeight: '600', color: '#0369a1', marginBottom: '4px' }}>
            {provInfo.label}
          </div>
          <div style={{ color: '#0284c7' }}>
            {provInfo.description}
          </div>
          {isActivity && (
            <div style={{ marginTop: '8px', color: '#0284c7' }}>
              <strong>关系类型:</strong> 可通过 used/wasGeneratedBy 关系与实体连接
            </div>
          )}
          {!isActivity && (
            <div style={{ marginTop: '8px', color: '#0284c7' }}>
              <strong>关系类型:</strong> 可被活动使用(used)或由活动生成(wasGeneratedBy)
            </div>
          )}
        </div>
      </div>

      {/* 扩展属性 */}
      {hasExtraProps && (
        <div className="attributes-section">
          <Divider orientation="left" style={{ fontSize: '12px', color: '#666' }}>
            {isActivity ? '执行参数' : '扩展属性'}
            <Tooltip title={isActivity ? '活动执行时的配置参数' : '实体的附加属性信息'}>
              <InfoCircleOutlined style={{ marginLeft: '4px', fontSize: '11px' }} />
            </Tooltip>
          </Divider>
          <div className="attributes-content">
            <pre>{formatJsonValue(extraProps)}</pre>
          </div>
        </div>
      )}

      {/* 操作提示 */}
      <div style={{ 
        marginTop: '16px', 
        padding: '8px 12px', 
        background: '#f6ffed', 
        border: '1px solid #b7eb8f',
        borderRadius: '4px',
        fontSize: '11px',
        color: '#389e0d'
      }}>
        💡 提示: 在关系图谱中点击其他节点可查看相关联的溯源信息
      </div>
    </Card>
  );
};

export default DetailsPanel;
