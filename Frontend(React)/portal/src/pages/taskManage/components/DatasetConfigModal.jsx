import React from 'react';
import { Modal, Form, Input, InputNumber, Switch, Row, Col, Select, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';

const DatasetConfigModal = ({ visible, onCancel, onCreate, selectedRows }) => {
  const [form] = Form.useForm();

  return (
    <Modal
      open={visible}
      title="生成综合样本集"
      okText="开始生成"
      cancelText="取消"
      width={600} // 稍微加宽一点以便展示参数
      onCancel={() => {
        form.resetFields(); // 关闭时重置表单
        onCancel();
      }}
      onOk={() => {
        form.validateFields().then((values) => {
          onCreate(values);
        }).catch((info) => {
          console.log('Validate Failed:', info);
        });
      }}
    >
      <Form
        form={form}
        layout="vertical"
        name="form_in_modal"
        initialValues={{
          datasetName: '',
          description: '',
          // --- 新增默认参数 ---
          targetSize: 256,   // 默认 256x256
          expandRatio: 0.1,  // 默认外扩 10%
          forceSquare: true, // 默认补黑边成正方形
        }}
      >
        <div style={{ marginBottom: 16, color: '#666', background: '#f5f5f5', padding: '8px 12px', borderRadius: '4px' }}>
          已选择 <b>{selectedRows.length}</b> 个任务影像作为数据源。
        </div>

        <Row gutter={16}>
          <Col span={24}>
            <Form.Item
              name="datasetName"
              label="数据集名称"
              rules={[
                { required: true, message: '请输入数据集名称' },
                { pattern: /^[a-zA-Z0-9_\-]+$/, message: '仅支持字母、数字、下划线和中划线' }
              ]}
            >
              <Input placeholder="例如: Vehicle_Train_20231027" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={24}>
            <Form.Item
              name="description"
              label="描述备注"
            >
              <Input.TextArea rows={2} placeholder="请输入数据集描述..." />
            </Form.Item>
          </Col>
        </Row>

        {/* --- 新增的高级参数区域 --- */}
        <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 16, marginTop: 8 }}>
          <span style={{ fontWeight: 'bold', display: 'block', marginBottom: 12 }}>裁剪参数配置</span>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="targetSize"
                label={
                  <span>
                    切片尺寸 (px)&nbsp;
                    <Tooltip title="最终生成的图片宽高，深度学习通常使用 256, 512 或 640">
                      <QuestionCircleOutlined style={{ color: '#999' }} />
                    </Tooltip>
                  </span>
                }
              >
                <Select placeholder="选择尺寸">
                  <Select.Option value={256}>256 x 256</Select.Option>
                  <Select.Option value={512}>512 x 512</Select.Option>
                  <Select.Option value={640}>640 x 640</Select.Option>
                  <Select.Option value={1024}>1024 x 1024</Select.Option>
                  {/* 如果需要支持原图裁剪，可以传 null 或 0，但为了训练稳定通常建议固定尺寸 */}
                </Select>
              </Form.Item>
            </Col>

            <Col span={8}>
              <Form.Item
                name="expandRatio"
                label={
                  <span>
                    外扩比例&nbsp;
                    <Tooltip title="标注框向外扩展的比例。0.1 表示长宽各增加 10% 的背景环境">
                      <QuestionCircleOutlined style={{ color: '#999' }} />
                    </Tooltip>
                  </span>
                }
              >
                <InputNumber
                  min={0}
                  max={1.0}
                  step={0.05}
                  style={{ width: '100%' }}
                  placeholder="0.1"
                />
              </Form.Item>
            </Col>

            <Col span={8}>
              <Form.Item
                name="forceSquare"
                label={
                  <span>
                    强制正方形&nbsp;
                    <Tooltip title="开启后，若裁剪区域为长方形，将自动用黑色背景填充为正方形，防止物体变形">
                      <QuestionCircleOutlined style={{ color: '#999' }} />
                    </Tooltip>
                  </span>
                }
                valuePropName="checked"
              >
                <Switch checkedChildren="开启" unCheckedChildren="关闭" />
              </Form.Item>
            </Col>
          </Row>
        </div>

      </Form>
    </Modal>
  );
};

export default DatasetConfigModal;
