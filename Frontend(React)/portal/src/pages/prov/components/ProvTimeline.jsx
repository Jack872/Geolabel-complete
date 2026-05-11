import React from 'react';
import { Timeline, Card, Tag, Typography, Button, Tooltip } from 'antd';
import { CheckCircleOutlined, SyncOutlined, ExportOutlined, ContainerOutlined, ImportOutlined, EditOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import moment from 'moment';

const { Text } = Typography;

// 操作类型中英文映射和图标
const ACTION_CONFIG = {
  'UPLOAD': { 
    label: '文件上传', 
    icon: <ImportOutlined />, 
    color: '#52c41a',
    provType: 'Activity',
    description: '将文件上传到系统中'
  },
  'ANNOTATE': { 
    label: '数据标注', 
    icon: <EditOutlined />, 
    color: '#faad14',
    provType: 'Activity',
    description: '对数据进行人工标注'
  },
  'AUDIT_PASS': { 
    label: '审核通过', 
    icon: <CheckCircleOutlined />, 
    color: '#52c41a',
    provType: 'Activity',
    description: '审核通过数据质量检查'
  },
  'AUDIT_REJECT': { 
    label: '审核驳回', 
    icon: <DeleteOutlined />, 
    color: '#f5222d',
    provType: 'Activity',
    description: '审核驳回，需要重新处理'
  },
  'DATASET_GENERATE': { 
    label: '数据集生成', 
    icon: <ContainerOutlined />, 
    color: '#722ed1',
    provType: 'Activity',
    description: '生成新的数据集'
  },
  'DATASET_EXPORT': { 
    label: '数据集导出', 
    icon: <ExportOutlined />, 
    color: '#1890ff',
    provType: 'Activity',
    description: '将数据集导出为指定格式'
  },
  'PUBLISH_SERVICE': { 
    label: '发布服务', 
    icon: <SyncOutlined />, 
    color: '#13c2c2',
    provType: 'Activity',
    description: '发布数据服务'
  },
  'DATASET_IMPORT': { 
    label: '数据集导入', 
    icon: <ImportOutlined />, 
    color: '#1890ff',
    provType: 'Activity',
    description: '从外部源导入数据集'
  },
  'DATASET_CREATE': { 
    label: '数据集创建', 
    icon: <ContainerOutlined />, 
    color: '#722ed1',
    provType: 'Activity',
    description: '创建新的数据集'
  },
  'DATASET_UPDATE': { 
    label: '数据集更新', 
    icon: <EditOutlined />, 
    color: '#fa8c16',
    provType: 'Activity',
    description: '修改现有数据集内容'
  },
  'DATASET_DELETE': { 
    label: '数据集删除', 
    icon: <DeleteOutlined />, 
    color: '#f5222d',
    provType: 'Activity',
    description: '删除数据集'
  },
  'MODEL_TRAIN': { 
    label: '模型训练', 
    icon: <SyncOutlined spin />, 
    color: '#13c2c2',
    provType: 'Activity',
    description: '使用数据集训练机器学习模型'
  },
  'MODEL_INFERENCE': { 
    label: '模型推理', 
    icon: <EyeOutlined />, 
    color: '#eb2f96',
    provType: 'Activity',
    description: '使用训练好的模型进行预测'
  },
  'DATA_VALIDATION': { 
    label: '数据验证', 
    icon: <CheckCircleOutlined />, 
    color: '#52c41a',
    provType: 'Activity',
    description: '验证数据质量和完整性'
  },
  'QUALITY_CHECK': { 
    label: '质量检查', 
    icon: <CheckCircleOutlined />, 
    color: '#1890ff',
    provType: 'Activity',
    description: '执行数据质量检查流程'
  },
  'AUDIT_LOG': { 
    label: '审计记录', 
    icon: <ContainerOutlined />, 
    color: '#666',
    provType: 'Activity',
    description: '记录系统操作日志'
  }
};

// 格式化时间为年月日
const formatDateTime = (dateTimeStr) => {
  if (!dateTimeStr) return '未知时间';
  
  try {
    // 尝试解析各种时间格式
    const date = moment(dateTimeStr);
    if (date.isValid()) {
      return date.format('YYYY年MM月DD日 HH:mm:ss');
    }
    return dateTimeStr;
  } catch (error) {
    return dateTimeStr;
  }
};

// 获取相对时间
const getRelativeTime = (dateTimeStr) => {
  if (!dateTimeStr) return '';
  
  try {
    const date = moment(dateTimeStr);
    if (date.isValid()) {
      const now = moment();
      const diffDays = now.diff(date, 'days');
      const diffHours = now.diff(date, 'hours');
      const diffMinutes = now.diff(date, 'minutes');
      
      if (diffDays > 0) {
        return `${diffDays}天前`;
      } else if (diffHours > 0) {
        return `${diffHours}小时前`;
      } else if (diffMinutes > 0) {
        return `${diffMinutes}分钟前`;
      } else {
        return '刚刚';
      }
    }
    return '';
  } catch (error) {
    return '';
  }
};

const ProvTimeline = ({ data, onNodeClick }) => {
  if (!data?.activities) return null;

  // 按时间排序
  const sortedActs = [...data.activities].sort((a, b) => {
    const dateA = moment(a.startTime);
    const dateB = moment(b.startTime);
    return dateB.isValid() && dateA.isValid() ? dateB - dateA : 0;
  });

  const getActionConfig = (actType) => {
    return ACTION_CONFIG[actType] || {
      label: actType,
      icon: <ContainerOutlined />,
      color: '#666',
      provType: 'Activity',
      description: '未知操作类型'
    };
  };

  return (
    <div className="prov-timeline">
      <Timeline mode="left">
        {sortedActs.map((act, index) => {
          const config = getActionConfig(act.actType);
          const formattedTime = formatDateTime(act.startTime);
          const relativeTime = getRelativeTime(act.startTime);
          
          return (
            <Timeline.Item
              key={act.id}
              dot={
                <div style={{ 
                  color: config.color, 
                  fontSize: '16px',
                  background: '#fff',
                  border: `2px solid ${config.color}`,
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {config.icon}
                </div>
              }
              label={
                <div style={{ textAlign: 'right', minWidth: '120px' }}>
                  <div style={{ fontSize: '12px', color: '#666', fontWeight: '500' }}>
                    {formattedTime}
                  </div>
                  {relativeTime && (
                    <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>
                      {relativeTime}
                    </div>
                  )}
                </div>
              }
            >
              <Card
                hoverable
                size="small"
                className="timeline-card"
                onClick={() => onNodeClick({ originType: 'ACTIVITY', rawData: act })}
              >
                <div className="card-header">
                  <div className="action-title" style={{ color: config.color }}>
                    {config.label}
                  </div>
                  <Tag color={config.color} className="agent-tag">
                    {act.agentId || '系统'}
                  </Tag>
                </div>
                
                <div className="card-content">
                  {/* PROV模型信息 */}
                  <div className="prov-info">
                    <Tooltip title={config.description}>
                      <span>
                        📋 PROV模型: {config.provType} 
                        <span style={{ marginLeft: 8, fontSize: '10px' }}>
                          (活动实体 - 表示数据处理过程)
                        </span>
                      </span>
                    </Tooltip>
                  </div>
                  
                  {/* 操作描述 */}
                  {act.description && (
                    <div className="description">
                      {act.description}
                    </div>
                  )}
                  
                  {/* 关键参数展示 */}
                  {act.parameters && Object.keys(act.parameters).length > 0 && (
                    <div className="parameters">
                      {Object.entries(act.parameters).slice(0, 3).map(([key, value]) => (
                        <Tag key={key} color="geekblue" size="small">
                          {key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </Tag>
                      ))}
                      {Object.keys(act.parameters).length > 3 && (
                        <Tag color="default" size="small">
                          +{Object.keys(act.parameters).length - 3} 更多
                        </Tag>
                      )}
                    </div>
                  )}
                  
                  {/* 执行时长 */}
                  {act.endTime && act.startTime && (
                    <div style={{ marginTop: '8px', fontSize: '11px', color: '#999' }}>
                      ⏱️ 执行时长: {moment(act.endTime).diff(moment(act.startTime), 'seconds')}秒
                    </div>
                  )}
                </div>
              </Card>
            </Timeline.Item>
          );
        })}
      </Timeline>
      
      {sortedActs.length === 0 && (
        <div style={{ textAlign: 'center', color: '#999', marginTop: '50px' }}>
          暂无溯源活动记录
        </div>
      )}
    </div>
  );
};

export default ProvTimeline;
