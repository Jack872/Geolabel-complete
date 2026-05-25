import React from 'react';
import { Card, Descriptions, Tag, Divider, Empty, Tooltip, Space } from 'antd';
import { ClockCircleOutlined, UserOutlined, InfoCircleOutlined, DatabaseOutlined, SettingOutlined } from '@ant-design/icons';
import { useIntl } from 'umi';
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

const ACTION_TRANSLATIONS_EN = {
  'UPLOAD': 'File Upload',
  'ANNOTATE': 'Annotation',
  'AUDIT_PASS': 'Audit Passed',
  'AUDIT_REJECT': 'Audit Rejected',
  'DATASET_GENERATE': 'Dataset Generation',
  'DATASET_EXPORT': 'Dataset Export',
  'PUBLISH_SERVICE': 'Publish Service',
  'DATASET_IMPORT': 'Dataset Import',
  'DATASET_CREATE': 'Dataset Creation',
  'DATASET_UPDATE': 'Dataset Update',
  'DATASET_DELETE': 'Dataset Deletion',
  'MODEL_TRAIN': 'Model Training',
  'MODEL_INFERENCE': 'Model Inference',
  'DATA_VALIDATION': 'Data Validation',
  'DATA_PREPROCESSING': 'Data Preprocessing',
  'QUALITY_CHECK': 'Quality Check',
  'AUDIT_LOG': 'Audit Log',
  'USER_OPERATION': 'User Operation',
  'SYSTEM_OPERATION': 'System Operation'
};

const ENTITY_TRANSLATIONS_EN = {
  'TASK': 'Annotation Task',
  'RAW_IMAGE': 'Raw Image',
  'SAMPLE_SET': 'Sample Set',
  'ANNOTATION_REVISION': 'Annotation Revision',
  'AUDIT_REJECT': 'Audit Record',
  'DATASET': 'Dataset',
  'MODEL': 'Model File',
  'ANNOTATION': 'Annotation Data',
  'IMAGE': 'Image File',
  'LABEL': 'Label File',
  'CONFIG': 'Config File',
  'LOG': 'Log File',
  'RESULT': 'Result File'
};

// 格式化时间
const formatDateTime = (dateTimeStr, locale = 'zh-CN') => {
  if (!dateTimeStr) return locale.startsWith('en') ? 'Unknown time' : '未知时间';
  
  try {
    const date = moment(dateTimeStr);
    if (date.isValid()) {
      return locale.startsWith('en') ? date.format('YYYY-MM-DD HH:mm:ss') : date.format('YYYY年MM月DD日 HH:mm:ss');
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
  const intl = useIntl();
  const t = (id, defaultMessage, values) => intl.formatMessage({ id, defaultMessage }, values);
  const isEn = String(intl.locale || '').startsWith('en');
  const actionLabels = isEn ? ACTION_TRANSLATIONS_EN : ACTION_TRANSLATIONS;
  const entityLabels = isEn ? ENTITY_TRANSLATIONS_EN : ENTITY_TRANSLATIONS;
  const provModelInfo = {
    'ACTIVITY': {
      ...PROV_MODEL_INFO.ACTIVITY,
      label: t('prov.model.activity', '活动 (Activity)'),
      description: t('prov.model.activity.desc', 'PROV模型中的核心概念，表示数据处理、转换或生成的过程'),
    },
    'ENTITY': {
      ...PROV_MODEL_INFO.ENTITY,
      label: t('prov.model.entity', '实体 (Entity)'),
      description: t('prov.model.entity.desc', 'PROV模型中的数据对象，可以是文件、数据集、模型等'),
    },
    'AGENT': {
      ...PROV_MODEL_INFO.AGENT,
      label: t('prov.model.agent', '代理 (Agent)'),
      description: t('prov.model.agent.desc', 'PROV模型中负责执行活动的主体，可以是人员、系统或服务'),
    }
  };

  if (!detail) {
    return (
      <Card title={t('prov.detail.title', '节点详情')} className={`details-panel ${className || ''}`}>
        <div className="empty-detail">
          <Empty 
            description={t('prov.detail.empty', '点击图谱或时间轴中的节点查看详细信息')} 
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </div>
      </Card>
    );
  }

  const { originType, rawData, agentData } = detail;
  const isActivity = originType === 'ACTIVITY';
  const isAgent = originType === 'AGENT';
  const provInfo = provModelInfo[originType] || provModelInfo['ENTITY'];

  // 获取显示标题
  const getDisplayTitle = () => {
    if (isActivity) {
      return actionLabels[rawData.actType] || rawData.actType;
    } else if (isAgent) {
      if (rawData.agentType === 'PERSON') return isEn ? 'User' : '用户';
      if (rawData.agentType === 'SOFTWARE') return isEn ? 'Software System' : '软件系统';
      if (rawData.agentType === 'ORGANIZATION') return isEn ? 'Organization' : '组织机构';
      return rawData.agentType || t('prov.model.agent', '代理 (Agent)');
    } else {
      return entityLabels[rawData.entityType] || rawData.entityType;
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
          <span>{t('prov.detail.title', '节点详情')}</span>
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
              {t('prov.systemId', '系统ID')}
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
                {t('prov.businessId', '业务ID')}
              </Space>
            }
          >
            {rawData.businessId}
          </Descriptions.Item>
        )}
        
        {rawData.label && (
          <Descriptions.Item label={t('prov.labelName', '标签名称')}>
            {rawData.label}
          </Descriptions.Item>
        )}

        {isAgent && rawData.agentName && (
          <Descriptions.Item label={t('prov.agentName', '代理名称')}>
            {rawData.agentName}
          </Descriptions.Item>
        )}

        {isAgent && rawData.externalId && (
          <Descriptions.Item label={t('prov.externalId', '外部业务ID')}>
            {rawData.externalId}
          </Descriptions.Item>
        )}
        
        <Descriptions.Item label={t('prov.description', '描述信息')}>
          {rawData.description || t('prov.noDescription', '无描述信息')}
        </Descriptions.Item>
        
        <Descriptions.Item 
          label={
            <Space>
              <ClockCircleOutlined />
              {isActivity ? t('prov.startTime', '开始时间') : t('prov.createTime', '创建时间')}
            </Space>
          }
        >
          {formatDateTime(rawData.startTime || rawData.createdAt, intl.locale)}
        </Descriptions.Item>
        
        {isActivity && rawData.endTime && (
          <Descriptions.Item 
            label={
              <Space>
                <ClockCircleOutlined />
                {t('prov.endTime', '结束时间')}
              </Space>
            }
          >
            {formatDateTime(rawData.endTime, intl.locale)}
          </Descriptions.Item>
        )}
        
        {isActivity && rawData.endTime && rawData.startTime && (
          <Descriptions.Item label={t('prov.duration', '执行时长')}>
            <Tag color="blue">
              {t('prov.seconds', '{seconds}秒', { seconds: moment(rawData.endTime).diff(moment(rawData.startTime), 'seconds') })}
            </Tag>
          </Descriptions.Item>
        )}
        
        {/* 代理信息 */}
        {isActivity && (rawData.agentId || agentData) && (
          <Descriptions.Item 
            label={
              <Space>
                <UserOutlined />
                {t('prov.executor', '执行主体')}
              </Space>
            }
          >
            <Space>
              <Tag color="green">
                {agentData ? agentData.agentName : rawData.agentId}
              </Tag>
              {agentData && (
                <Tag color="blue" size="small">
                  {agentData.agentType === 'PERSON' ? (isEn ? 'User' : '用户') : 
                   agentData.agentType === 'SOFTWARE' ? (isEn ? 'Software' : '软件') : 
                   agentData.agentType === 'ORGANIZATION' ? (isEn ? 'Organization' : '组织') : agentData.agentType}
                </Tag>
              )}
            </Space>
          </Descriptions.Item>
        )}

        {/* 实体位置信息 */}
        {!isActivity && !isAgent && rawData.location && (
          <Descriptions.Item label={t('prov.location', '数据位置')}>
            <code style={{ background: '#f5f5f5', padding: '2px 6px', borderRadius: '3px', fontSize: '11px' }}>
              {rawData.location}
            </code>
          </Descriptions.Item>
        )}

        {/* 实体类型 */}
        {!isActivity && !isAgent && rawData.entityType && (
          <Descriptions.Item label={t('prov.entityType', '实体类型')}>
            <Tag color="purple">{rawData.entityType}</Tag>
          </Descriptions.Item>
        )}

        {isAgent && rawData.agentType && (
          <Descriptions.Item label={t('prov.agentType', '代理类型')}>
            <Tag color="green">{rawData.agentType}</Tag>
          </Descriptions.Item>
        )}

        {/* 活动状态 */}
        {isActivity && rawData.status && (
          <Descriptions.Item label={t('prov.status', '执行状态')}>
            <Tag color={rawData.status === 'SUCCESS' ? 'green' : 'red'}>
              {rawData.status === 'SUCCESS' ? t('prov.status.success', '成功') : t('prov.status.fail', '失败')}
            </Tag>
          </Descriptions.Item>
        )}
      </Descriptions>

      {/* PROV模型说明 */}
      <div className="attributes-section">
        <Divider orientation="left" style={{ fontSize: '12px', color: '#666' }}>
          {t('prov.modelInfo', 'PROV模型信息')}
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
              <strong>{t('prov.relationType', '关系类型:')}</strong> {t('prov.activityRelation', '可通过 used/wasGeneratedBy 关系与实体连接')}
            </div>
          )}
          {!isActivity && (
            <div style={{ marginTop: '8px', color: '#0284c7' }}>
              <strong>{t('prov.relationType', '关系类型:')}</strong> {t('prov.entityRelation', '可被活动使用(used)或由活动生成(wasGeneratedBy)')}
            </div>
          )}
        </div>
      </div>

      {/* 扩展属性 */}
      {hasExtraProps && (
        <div className="attributes-section">
          <Divider orientation="left" style={{ fontSize: '12px', color: '#666' }}>
            {isActivity ? t('prov.params', '执行参数') : t('prov.attributes', '扩展属性')}
            <Tooltip title={isActivity ? t('prov.params.tip', '活动执行时的配置参数') : t('prov.attributes.tip', '实体的附加属性信息')}>
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
        {t('prov.detail.tip', '提示: 在关系图谱中点击其他节点可查看相关联的溯源信息')}
      </div>
    </Card>
  );
};

export default DetailsPanel;
