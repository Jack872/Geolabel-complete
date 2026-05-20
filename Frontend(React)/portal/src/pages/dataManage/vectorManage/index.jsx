import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Row,
  Input,
  Select,
  Popconfirm,
  message,
  Form,
  Modal,
  Space, DatePicker,
} from 'antd';
import { PlusOutlined, EditTwoTone, DeleteTwoTone, UploadOutlined, EyeOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-table';
import StepUploadModal from '../component/StepUploadModal.jsx';
import CollectionCreateForm from '@/components/CollectionCreateForm';
import { PageContainer } from '@ant-design/pro-layout';
import { useModel } from 'umi';

// ===== 保留原接口 (暂时注释，标注 TODO) =====
import { reqGetfileData, reqEditfileData, reqDeleteFileDataById, reqPublishSet } from '@/services/dataManage/api';
import { PublishServer } from '@/services/serviceManage/api.js';
import { reqGetDatasetList, reqEditDataset, reqAddDataset, reqDeleteDataSet, reqGetSharedDatasets } from '@/services/dataset/api.js';
import { getUserByUsername } from '@/services/login/api';

const { Option } = Select;

const DatasetCardPage = () => {
  const [form] = Form.useForm();
  const actionRef = useRef();
  const { initialState } = useModel('@@initialState');

  /** --------------------
   * MOCK STATIC DATA (临时展示)
   * TODO: 替换为后端接口
   ---------------------- */
  const mockDatasetList = [
    { setId: 1, name: '地物提取样本', description: '地表覆盖训练样本', taskType: '地物提取', sampleNum: 320, createTime: '2025-10-31' },
    { setId: 2, name: '目标检测样本', description: '建筑物检测样本', taskType: '目标检测', sampleNum: 120, createTime: '2025-11-01' },
  ];

  const mockFileData = {
    1: [
      { fileId: 101, fileName: 'region_A.tif', size: '12MB', updateTime: '2025-11-01', status: 0 },
      { fileId: 102, fileName: 'region_B.tif', size: '10MB', updateTime: '2025-11-01', status: 1 },
    ],
    2: [{ fileId: 201, fileName: 'building_01.tif', size: '18MB', updateTime: '2025-11-02', status: 0 }],
  };

  const [datasetList, setDatasetList] = useState([]);
  const [filteredList, setFilteredList] = useState([]);
  const [stepUploadVisible, setStepUploadVisible] = useState(false);
  const [datasetFormVisible, setDatasetFormVisible] = useState(false);
  const [datasetFormTitle, setDatasetFormTitle] = useState('');
  const [datasetFormValues, setDatasetFormValues] = useState({});
  const [currentDataset, setCurrentDataset] = useState(null);
  const [selectedFileKeys, setSelectedFileKeys] = useState([]);
  const [fileModalVisible, setFileModalVisible] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [fileList, setFileList] = useState([]);
  const [datasetMetaMap, setDatasetMetaMap] = useState({});


  /** --------------------
   * 初始化加载数据集
   ---------------------- */
  const fetchDatasets = async () => {
    try {
      const currentUser = initialState?.currentState?.currentUser;
      let userId = null;

      if (typeof currentUser === 'object' && currentUser?.userid) {
        userId = currentUser.userid;
      } else if (typeof currentUser === 'string') {
        const response = await getUserByUsername(currentUser);
        userId = response?.userId || response?.userid || response?.id;
      }

      if (!userId) {
        message.error('无法获取用户信息');
        return;
      }
      const res = await reqGetSharedDatasets({ userId });
      if (res.data!=null) {
        setDatasetList(res.data);
        setFilteredList(res.data);
        fetchDatasetMetaSummary(res.data);
      }
    } catch (error) {
      message.error('获取数据集失败');
    }
  };

  const getDatasetId = (dataset) => dataset?.id ?? dataset?.setId ?? null;

  const fetchDatasetMetaSummary = async (datasets) => {
    if (!Array.isArray(datasets) || datasets.length === 0) {
      setDatasetMetaMap({});
      return;
    }
    const pairs = await Promise.all(
      datasets.map(async (dataset) => {
        const datasetId = getDatasetId(dataset);
        if (!datasetId) return [null, null];
        try {
          const res = await reqGetfileData({ datasetId, current: 1, pageSize: 1 });
          const latestFile = Array.isArray(res?.data) && res.data.length > 0 ? res.data[0] : null;
          return [datasetId, latestFile];
        } catch (error) {
          return [datasetId, null];
        }
      }),
    );
    const nextMap = {};
    pairs.forEach(([datasetId, latestFile]) => {
      if (datasetId) nextMap[datasetId] = latestFile;
    });
    setDatasetMetaMap(nextMap);
  };

  useEffect(() => {
    fetchDatasets();
  }, []);

  /** --------------------
   * 查询功能（按 type + name）
   ---------------------- */
  const handleSearch = (values) => {
    const { name, taskType } = values;
    const result = datasetList.filter(
      (ds) =>
        (!name || ds.name.includes(name)) &&
        (!taskType || ds.taskType === taskType)
    );
    setFilteredList(result);
  };

  /** --------------------
   * 新增/编辑 数据集
   ---------------------- */
  const openDatasetForm = (dataset = null) => {
    setDatasetFormValues(dataset || { setType: 'service' });
    setDatasetFormTitle(dataset ? '编辑数据集' : '新增数据集');
    setIsEdit(Boolean(dataset));          // <- 关键：使用参数直接设置，不依赖 state 更新
    setDatasetFormVisible(true);
  };

  const handleDatasetFormSubmit = async (values) => {
    try {
      if (datasetFormValues.setId) {
        // 编辑数据集
        const res = await reqEditDataset({ ...values, setId: datasetFormValues.setId });
        if (res.code==200) {
          message.success('编辑数据集成功！');
        } else {
          message.error(res.message || '编辑失败');
          return;
        }
      } else {
        // 新增数据集
        const res = await reqAddDataset(values);
        if (res.code==200) {
          message.success('新增数据集成功！');
        } else {
          message.error(res.message || '新增失败');
          return;
        }
      }
      // 请求成功，关闭弹窗并刷新列表
      setDatasetFormVisible(false);
      fetchDatasets();
    } catch (error) {
      console.error(error);
      message.error('操作失败，请联系管理员！');
    }
  };


  const handleDeleteDataset = async (dataset) => {
    const datasetId = getDatasetId(dataset);
    if (!datasetId) {
      message.error('无法获取影像集ID');
      return;
    }
    try {
      const res = await reqDeleteDataSet(datasetId);
      if (res.code === 200) {
        message.success('删除成功');
        fetchDatasets();
      } else {
        message.error(res.message || '删除失败');
      }
    } catch (error) {
      console.error(error);
      message.error('删除失败，请检查网络或接口');
    }
  };

  /** --------------------
   * 上传影像 / 批量发布
   ---------------------- */
  const handleUploadForDataset = (dataset) => {
    setCurrentDataset(dataset);
    setStepUploadVisible(true);
  };

  /** 批量发布影像 */
  const handleBatchPublish = async () => {
    if (currentDataset?.setType === 'local') {
      message.info('本地影像集不需要发布服务');
      return;
    }
    if (selectedFileKeys.length === 0) {
      message.error('请选择要发布的影像！');
      return;
    }
    // 过滤已发布的影像
    const alreadyPublished = fileList.filter(
      (f) => selectedFileKeys.includes(f.fileId) && f.status === 1
    );
    if (alreadyPublished.length > 0) {
      const names = alreadyPublished.map((f) => f.fileName).join('、');
      message.warning(`以下影像已发布，将跳过: ${names}`);
    }
    const toPublish = selectedFileKeys.filter(
      (id) => !alreadyPublished.some((f) => f.fileId === id)
    );
    if (toPublish.length === 0) {
      message.info('所选影像均已发布');
      return;
    }
    try {
      const res = await reqPublishSet({ fileIds: toPublish });
      if (res.code==200) {
        message.success('批量发布成功');
        // 重新加载文件列表
        const datasetId = getDatasetId(currentDataset);
        const updated = await reqGetfileData({ datasetId, current: 1, pageSize: 500 });
        if (updated.success) setFileList(updated.data);
      } else {
        message.error(res.message || '发布失败');
      }
    } catch (error) {
      message.error('发布失败，请检查网络或接口');
    }
  };

  /** --------------------
   * 查看影像 Modal
   ---------------------- */

  const handleViewFiles = async (dataset) => {
    try {
      setCurrentDataset(dataset);
      setFileModalVisible(true);

      const datasetId = getDatasetId(dataset);
      const res = await reqGetfileData({ datasetId, current: 1, pageSize: 500 });
      if (res.code==200 && Array.isArray(res.data)) {
        setFileList(res.data);
      } else {
        message.warning('未查询到影像文件');
        setFileList([]);
      }
    } catch (error) {
      console.error(error);
      message.error('获取影像列表失败');
    }
  };
  /** ProTable 影像表格列 */
  const columns = [
    { title: '序号', dataIndex: 'index', valueType: 'indexBorder', align: 'center', width: 60 },
    { title: '文件名称', dataIndex: 'fileName', align: 'center', width: 180, ellipsis: true },
    { title: '坐标系', dataIndex: 'crsCode', align: 'center', width: 100, ellipsis: true },
    { title: '采集开始', dataIndex: 'acquisitionTimeStart', align: 'center', width: 120, ellipsis: true },
    { title: '波段数', dataIndex: 'bandCount', align: 'center', width: 80 },
    { title: '传感器/平台', dataIndex: 'sensorPlatform', align: 'center', width: 120, ellipsis: true },
    { title: '处理级别', dataIndex: 'processingLevel', align: 'center', width: 100, ellipsis: true },
    { title: '上传备注', dataIndex: 'uploadDescription', align: 'center', width: 100, ellipsis: true },
    { title: '修改时间', dataIndex: 'updateTime', align: 'center', width: 160, ellipsis: true },
    { title: '状态', dataIndex: 'status', align: 'center', width: 80, valueEnum: { 0: '未发布', 1: '已发布' } },
    {
      title: '操作',
      align: 'center',
      width: 180,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          {/* 编辑按钮 */}
          <Button
            size="small"
            icon={<EditTwoTone />}
            onClick={() => {
              message.info(`编辑影像（模拟）：${record.fileName}`);
              // TODO: 调用编辑接口
              // await reqEditfileData(record);
            }}
          >
            编辑
          </Button>

          {/* 删除按钮 */}
          <Popconfirm
            title="确认删除该影像？"
            okText="确认"
            cancelText="取消"
            onConfirm={async () => {
              try {
                const res = await reqDeleteFileDataById(record.fileId);
                if (res && (res.code === 200 || res.success)) {
                  message.success(`已删除影像：${record.fileName}`);
                  const datasetId = getDatasetId(currentDataset);
                  if (datasetId) {
                    const updated = await reqGetfileData({ datasetId, current: 1, pageSize: 500 });
                    if (updated?.code === 200 && Array.isArray(updated.data)) {
                      setFileList(updated.data);
                    }
                  }
                  return;
                }
                message.error(res?.message || '删除失败');
              } catch (error) {
                message.error('删除失败，请检查接口或网络');
              }
            }}
          >
            <Button
              size="small"
              danger
              icon={<DeleteTwoTone twoToneColor="#ff4d4f" />}
              style={{ background: 'transparent' }}
            >
              删除
            </Button>
          </Popconfirm>

          {/* 发布按钮 */}
          {/*<Button
            size="small"
            type="primary"
            onClick={async () => {
              try {
                // ===== 原后端接口逻辑（保留） =====
                // const res = await PublishServer({ fileId: record.fileId });
                // if (res.success) message.success('发布成功');

                // ===== 前端静态模拟 =====
                message.success(`【静态演示】发布影像：${record.fileName}`);
              } catch (error) {
                message.error('发布失败，请检查接口配置');
              }
            }}
          >
            发布
          </Button>*/}
        </Space>
      ),
    },
  ];

  /** --------------------
   * 渲染卡片
   ---------------------- */
  const renderCards = () => (
    <Row gutter={[16, 16]}>
      {filteredList.map((dataset) => (
        <Col xs={24} sm={12} md={8} lg={6} key={getDatasetId(dataset) || dataset.name}>
          <Card
            title={dataset.name}
            bordered
            hoverable
            extra={
              <Space>
                <EditTwoTone onClick={() => openDatasetForm(dataset)} />
                <Popconfirm title="确认删除？" onConfirm={() => handleDeleteDataset(dataset)}>
                  <DeleteTwoTone twoToneColor="#ff4d4f" />
                </Popconfirm>
              </Space>
            }
          >
            {(() => {
              const meta = datasetMetaMap[getDatasetId(dataset)] || {};
              return (
                <>
                  <p><b>坐标系：</b>{meta.crsCode || '-'}</p>
                  <p><b>采集开始：</b>{meta.acquisitionTimeStart || '-'}</p>
                  <p><b>传感器/平台：</b>{meta.sensorPlatform || '-'}</p>
                  <p><b>波段数：</b>{meta.bandCount ?? '-'}</p>
                  <p><b>处理级别：</b>{meta.processingLevel || '-'}</p>
                </>
              );
            })()}
            <p><b>影像数：</b>{dataset.sampleNum ?? 0}</p>
            <p><b>影像集类型：</b>{dataset.setType === 'local' ? '本地文件夹' : '服务文件夹'}</p>

            <Space style={{ marginTop: 8 }}>
              <Button
                type="primary"
                icon={<EyeOutlined />}
                onClick={() => handleViewFiles(dataset)}
                >
                查看影像
            </Button>
              <Button icon={<UploadOutlined />} onClick={() => handleUploadForDataset(dataset)}>
                上传影像
              </Button>
            </Space>
          </Card>
        </Col>
      ))}
    </Row>
  );

  return (
    <PageContainer
      header={{
        title: '数据集管理',
      }}
    >
      {/* 查询表单 */}
      <Form layout="inline" form={form} onFinish={handleSearch} style={{ marginBottom: 16 }}>
        <Form.Item name="name" label="名称">
          <Input placeholder="输入数据集名称" allowClear />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit">查询</Button>
        </Form.Item>

        <Form.Item>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openDatasetForm()}>
            新增数据集
          </Button>
        </Form.Item>
      </Form>

      {/* 数据集卡片区域 */}
      {renderCards()}

      {/* 上传影像 Modal */}
      <StepUploadModal
        title={`上传到数据集: ${currentDataset?.name || ''}`}
        datasetType={currentDataset?.setType}
        open={stepUploadVisible}
        onCancel={() => setStepUploadVisible(false)}
        onUploadComplete={async () => {
          setStepUploadVisible(false);
          if (currentDataset) {
            const datasetId = getDatasetId(currentDataset);
            const updated = await reqGetfileData({ datasetId, current: 1, pageSize: 500 });
            if (updated.success) setFileList(updated.data);
          }
          fetchDatasets();
        }}
        datasetId={getDatasetId(currentDataset)}
      />

      {/* 查看影像 Modal */}
      <Modal
        title={`影像集 - ${currentDataset?.name}`}
        open={fileModalVisible}
        width={1600}
        footer={null}
        onCancel={() => setFileModalVisible(false)}
      >
        {currentDataset?.setType !== 'local' && (
          <div style={{ marginBottom: 12, textAlign: 'right' }}>
            <Button type="primary" onClick={handleBatchPublish}>
              批量发布
            </Button>
          </div>
        )}

        <ProTable
          columns={currentDataset?.setType === 'local'
            ? columns.filter(col => col.dataIndex !== 'status')
            : columns}
          actionRef={actionRef}
          rowSelection={
            currentDataset?.setType !== 'local'
              ? {
                  selectedRowKeys: selectedFileKeys,
                  onChange: (keys) => setSelectedFileKeys(keys),
                }
              : undefined
          }
          dataSource={fileList} // 直接用 handleViewFiles 拉取的文件列表
          rowKey="fileId"
          search={false}
          scroll={{ x: 1400 }}
          pagination={{ pageSize: 6 }}
        />
      </Modal>

      {/* 数据集新增/编辑 Modal */}
      <CollectionCreateForm
        formItemList={[
          <Form.Item label="名称" name="name"
                     rules={
                       isEdit ? [] : [{ required: true, message: '请输入名称！' }]
                     }
          >
            <Input />
          </Form.Item>,
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} />
          </Form.Item>,
          <Form.Item
            label="影像集类型"
            name="setType"
            rules={
              isEdit ? [] : [{ required: true, message: '请选择影像集类型！' }]
            }
          >
            <Select>
              <Option value="service">服务文件夹</Option>
              <Option value="local">本地文件夹</Option>
            </Select>
          </Form.Item>,
          <Form.Item
            label="年份"
            name="year"
            rules={
              isEdit ? [] : [{ required: true, message: '必须选择年份！', type: 'object' }]
            }
          >
            <DatePicker
              picker="year"
            />
          </Form.Item>,
        ]}
        title={datasetFormTitle}
        open={datasetFormVisible}
        onCreate={handleDatasetFormSubmit}
        onCancel={() => setDatasetFormVisible(false)}
      />
    </PageContainer>
  );
};

export default DatasetCardPage;
