import { Modal, Form, Input } from 'antd';
import { formatMessage } from 'umi';

const t = (id, defaultMessage, values) => formatMessage({ id, defaultMessage }, values);

// 封装模态框表单
export default (
  <>
    {/* <Form.Item
      label="类别编码"
      name="typecode"
      rules={[{ required: true, message: '必须输入类别编码！' }]}
    >
      <Input placeholder="请输入类别编码" />
    </Form.Item> */}

    <Form.Item
      label={t('category.name', '类别名称')}
      name="typeName"
      rules={[{ required: true, message: t('category.name.required', '必须输入类别名称！') }]}
    >
      <Input placeholder={t('category.name.placeholder', '请输入类别名称')} />
    </Form.Item>
    <Form.Item label={t('category.color', '颜色')} name="typeColor" rules={[{ required: true, message: t('category.color.required', '请选择颜色！') }]}>
      <Input placeholder="" type={'color'} />
    </Form.Item>
  </>
);
