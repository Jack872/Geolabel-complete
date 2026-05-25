import { Modal, Form, Input, Select } from 'antd';
import { useEffect } from 'react';
import { useIntl } from 'umi';

// 封装模态框表单
export default ({ visible, onCreate, onCancel, renderOrgList, defaultValue, teamOptions = [] }) => {
  const intl = useIntl();
  const t = (id, defaultMessage, values) => intl.formatMessage({ id, defaultMessage }, values);
  const [form] = Form.useForm();
  const onChange = (value) => {
    console.log(`selected ${value}`);
  };

  useEffect(() => {
    form.setFieldsValue({
      userid: defaultValue.userid,
      username: defaultValue.username,
      isadmin: defaultValue.isadmin,
      teamId: defaultValue.teamId,
    });
  }, [defaultValue, form]);

  return (
    <Modal
      open={visible}
      title={t('user.edit.title', '修改用户信息')}
      okText={t('common.submit', '提交')}
      cancelText={t('common.cancel', '取消')}
      onCancel={onCancel}
      initialValues={defaultValue}
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
      <Form form={form} name="form_in_modal" labelCol={{ span: 6 }} wrapperCol={{ span: 16 }}>
        <Form.Item label={t('user.id', '用户编号')} name="userid" initialValue={defaultValue.userid}>
          <Input disabled />
        </Form.Item>
        <Form.Item
          label={t('user.name', '用户名')}
          name="username"
          rules={[{ required: true, message: t('user.name.required', '必须输入用户名！') }]}
          initialValue={defaultValue.username}
        >
          <Input placeholder={t('user.name.placeholder', '请输入用户名')} />
        </Form.Item>

        <Form.Item
          label={t('user.role', '权限')}
          name="isadmin"
          // initialValue={defaultValue.isadmin}
          rules={[{ required: true, message: t('user.role.required', '必须选择用户权限！') }]}
        >
          <Select placeholder={t('user.role.placeholder', '请选择用户权限')} onChange={onChange}>
            <Select.Option value="1">{t('user.role.admin', '管理员')}</Select.Option>
            <Select.Option value="0">{t('user.role.normal', '普通用户')}</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item label={t('user.team', '所属团队')} name="teamId">
          <Select placeholder={t('user.team.placeholder', '请选择所属团队')} allowClear>
            {teamOptions.map((team) => (
              <Select.Option key={team.teamId} value={String(team.teamId)}>
                {team.name}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
      </Form>
    </Modal>
  );
};
