import React from 'react';
import { Modal, Descriptions, Spin, Empty } from 'antd';

// 格式化百分比的辅助函数
const formatPercentage = (value) => {
  if (typeof value !== 'number') {
    return 'N/A';
  }
  return `${(value * 100).toFixed(2)}%`;
};

const AuditReportModal = ({ visible, data, onClose }) => {
  return (
    <Modal
      title="审核报告详情"
      open={visible} // antd v5+ 使用 open 属性
      onCancel={onClose}
      footer={[
        <button key="close" type="button" className="ant-btn ant-btn-primary" onClick={onClose}>
          关闭
        </button>,
      ]}
      width={600}
      destroyOnClose // 关闭时销毁 Modal 里的子元素
    >
      {data ? (
        <Descriptions bordered column={2} labelStyle={{ width: '150px' }}>
          <Descriptions.Item label="任务ID">{data.taskId || 'N/A'}</Descriptions.Item>
          <Descriptions.Item label="错标率">
            {/* 假设错标率大于5%为高风险，显示红色 */}
            <span style={{ color: (data.mislabelNum/data.labelNum) > 0.05 ? '#ff4d4f' : '#52c41a', fontWeight: 'bold' }}>
              {formatPercentage(data.mislabelNum/data.labelNum)}
            </span>
          </Descriptions.Item>
          <Descriptions.Item label="多标率">
            {/* 假设多标率大于3%为高风险，显示红色 */}
            <span style={{ color: (data.overMarkNum/data.labelNum) > 0.03 ? '#ff4d4f' : '#52c41a', fontWeight: 'bold' }}>
              {formatPercentage(data.overMarkNum/data.labelNum)}
            </span>
          </Descriptions.Item>
          <Descriptions.Item label="漏标率">
            {/* 假设多标率大于3%为高风险，显示红色 */}
            <span style={{ color: (data.missNum/data.labelNum) > 0.03 ? '#ff4d4f' : '#52c41a', fontWeight: 'bold' }}>
              {formatPercentage(data.missNum/data.labelNum)}
            </span>
          </Descriptions.Item>
          <Descriptions.Item label="交并比">
            {/* 假设多标率大于3%为高风险，显示红色 */}
            <span style={{ color: (data.iou) > 0.03 ? '#ff4d4f' : '#52c41a', fontWeight: 'bold' }}>
              {formatPercentage(data.iou)}
            </span>
          </Descriptions.Item>
          <Descriptions.Item label="标注覆盖率">
             <span style={{ color: (data.labelCoverRation) > 0.03 ? '#ff4d4f' : '#52c41a', fontWeight: 'bold' }}>
              {formatPercentage(data.labelCoverRation)}
            </span>
          </Descriptions.Item>
          <Descriptions.Item label="审核轮次">
            {data.auditNum ? `${data.auditNum} 轮` : '0轮'}
          </Descriptions.Item>
          {/* 您可以根据接口返回结果继续添加更多字段 */}
          <Descriptions.Item label="审核员">{data.auditor || '未知'}</Descriptions.Item>
          <Descriptions.Item label="审核完成时间">{data.auditTime || '未知'}</Descriptions.Item>
        </Descriptions>
      ) : (
        // 如果没有数据，显示一个空状态
        <Empty description="无法获取报告数据" />
      )}
    </Modal>
  );
};

export default AuditReportModal;
