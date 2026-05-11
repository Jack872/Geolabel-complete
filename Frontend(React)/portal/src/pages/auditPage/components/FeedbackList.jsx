// .ant-design-pro/src/pages/auditPage/components/FeedbackList.jsx

import { useState } from 'react';
import { List, Button, Input, Space, Popconfirm } from 'antd';
import { AimOutlined, EditOutlined, DeleteOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';

const { TextArea } = Input;

export default function FeedbackList({ feedback, onLocate, onDelete, onUpdate }) {
  const [editingKey, setEditingKey] = useState(''); // 正在编辑的 featureId
  const [editText, setEditText] = useState('');   // 编辑中的文本

  const isEditing = (key) => key === editingKey;

  const handleEdit = (key, text) => {
    setEditingKey(key);
    setEditText(text);
  };

  const handleSave = (key) => {
    onUpdate(key, editText); // 调用父组件的更新函数
    setEditingKey('');
    setEditText('');
  };

  const handleCancel = () => {
    setEditingKey('');
    setEditText('');
  };

  return (
    <div style={{ marginTop: '24px' }}>
      <List
        header={<h4>已添加的反馈 ({Object.keys(feedback).length}条)</h4>}
        bordered
        dataSource={Object.entries(feedback)} // 将 {id: text} 转换为 [[id, text], ...]
        renderItem={([featureId, text]) => {
          const editing = isEditing(featureId);
          return (
            <List.Item
              actions={[
                <Button
                  key="locate"
                  type="text"
                  icon={<AimOutlined />}
                  onClick={() => onLocate(featureId)}
                  title="在地图上定位"
                />,
                ...(editing
                    ? [
                      <Button key="save" type="text" icon={<SaveOutlined />} onClick={() => handleSave(featureId)} />,
                      <Popconfirm key="cancel" title="确定取消吗？" onConfirm={handleCancel}>
                        <Button type="text" icon={<CloseOutlined />} danger />
                      </Popconfirm>,
                    ]
                    : [
                      <Button key="edit" type="text" icon={<EditOutlined />} onClick={() => handleEdit(featureId, text)} />,
                      <Popconfirm key="delete" title="确定删除这条反馈吗？" onConfirm={() => onDelete(featureId)}>
                        <Button type="text" icon={<DeleteOutlined />} danger />
                      </Popconfirm>,
                    ]
                ),
              ]}
            >
              <List.Item.Meta
                title={<strong>标注 {featureId}</strong>}
                description={
                  editing ? (
                    <TextArea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      autoSize
                    />
                  ) : (
                    text
                  )
                }
              />
            </List.Item>
          );
        }}
      />
    </div>
  );
}
