import { Modal, Form, Input } from 'antd';
import { useIntl } from 'umi';

/**
 * 创建团队表单模态框
 * @param {Object} props 组件属性
 * @param {boolean} props.visible 是否可见
 * @param {Function} props.onCreate 提交回调
 * @param {Function} props.onCancel 取消回调
 */
const CreateTeamForm = ({ visible, onCreate, onCancel }) => {
  const intl = useIntl();
  const t = (id, defaultMessage, values) => intl.formatMessage({ id, defaultMessage }, values);
  const [form] = Form.useForm();

  return (
    <Modal
      open={visible}
      title={t('user.team.create', '创建团队')}
      okText={t('common.create', '创建')}
      cancelText={t('common.cancel', '取消')}
      onCancel={onCancel}
      destroyOnClose={true}
      afterClose={() => {
        form.resetFields();
      }}
      onOk={() => {
        form
          .validateFields()
          .then((values) => {
            form.resetFields();
            onCreate(values);
          })
          .catch((info) => {
            console.log('Validate Failed:', info);
          });
      }}
    >
      <Form form={form} name="create_team_form" labelCol={{ span: 6 }} wrapperCol={{ span: 16 }}>
        <Form.Item
          label={t('user.team.name', '团队名称')}
          name="teamName"
          rules={[{ required: true, message: t('user.team.name.placeholder', '请输入团队名称') }]}
        >
          <Input placeholder={t('user.team.name.placeholder', '请输入团队名称')} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateTeamForm; 
